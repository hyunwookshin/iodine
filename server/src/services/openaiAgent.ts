import OpenAI from 'openai';
import { Response } from 'express';
import { TOOL_SCHEMAS } from './fileTools';
import { executeAgentTool } from './agentTools';
import { buildSystemPrompt } from '../prompts/systemPrompt';

export async function loadOpenAIKey(): Promise<string> {
  if (process.env.OPENAI_TOKEN) return process.env.OPENAI_TOKEN;
  throw new Error('OPENAI_TOKEN environment variable is not set');
}

// These reasoning models accept reasoning_effort: 'none', which is what /v1/chat/completions
// requires before it will allow function tools alongside reasoning.
const REASONING_MODEL_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5'];
function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_PREFIXES.some(prefix => model.startsWith(prefix));
}

// Models that reject reasoning_effort: 'none' and refuse function tools on /v1/chat/completions.
// They must go through /v1/responses instead (e.g. gpt-6-astra).
const RESPONSES_API_MODEL_PREFIXES = ['gpt-6'];
function requiresResponsesAPI(model: string): boolean {
  return RESPONSES_API_MODEL_PREFIXES.some(prefix => model.startsWith(prefix));
}

const TOOLS: OpenAI.ChatCompletionTool[] = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
  type: 'function' as const,
  function: {
    name,
    description: schema.description,
    parameters: schema.parameters,
  },
}));

// Same tool schemas, in the flat shape /v1/responses expects.
const RESPONSES_TOOLS: OpenAI.Responses.FunctionTool[] = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
  type: 'function' as const,
  name,
  description: schema.description,
  parameters: schema.parameters as Record<string, unknown>,
  strict: false,
}));

function writeSSE(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Agent loop over /v1/responses for models (e.g. gpt-6-astra) that refuse function tools
// on /v1/chat/completions. Emits the same SSE events as the chat-completions loop.
async function runResponsesAgentLoop(
  client: OpenAI,
  messages: { role: 'user' | 'assistant'; content: string }[],
  model: string,
  res: Response,
  abortSignal: { aborted: boolean },
  systemPrompt: string,
) {
  const input: OpenAI.Responses.ResponseInputItem[] = messages.map(m => ({ role: m.role, content: m.content }));

  while (true) {
    if (abortSignal.aborted) return;

    const stream = await client.responses.create({
      model,
      instructions: systemPrompt,
      input,
      tools: RESPONSES_TOOLS,
      stream: true,
    });

    const toolCalls: { callId: string; name: string; args: string }[] = [];
    // Full output of this turn (reasoning items, assistant messages, function calls). Reasoning
    // models require these to be echoed back verbatim on the next turn alongside tool results.
    let outputItems: OpenAI.Responses.ResponseOutputItem[] = [];
    let completed = false;

    for await (const event of stream) {
      if (abortSignal.aborted) return;

      if (event.type === 'response.output_text.delta') {
        writeSSE(res, 'text_delta', { text: event.delta });
      } else if (event.type === 'response.output_item.done' && event.item.type === 'function_call') {
        toolCalls.push({ callId: event.item.call_id, name: event.item.name, args: event.item.arguments });
      } else if (event.type === 'response.completed') {
        outputItems = event.response.output;
        completed = true;
      } else if (event.type === 'response.failed') {
        throw new Error(event.response.error?.message ?? 'OpenAI response failed');
      } else if (event.type === 'response.incomplete') {
        throw new Error(`OpenAI response incomplete: ${event.response.incomplete_details?.reason ?? 'unknown reason'}`);
      } else if (event.type === 'error') {
        throw new Error(event.message ?? 'OpenAI stream error');
      }
    }

    if (abortSignal.aborted) return;
    if (!completed) throw new Error('OpenAI stream ended without a completed response');
    if (toolCalls.length === 0) {
      writeSSE(res, 'done', {});
      return;
    }

    // Echo the model's own output items back before appending tool results.
    input.push(...(outputItems as OpenAI.Responses.ResponseInputItem[]));

    for (const tc of toolCalls) {
      if (abortSignal.aborted) return;
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(tc.args); } catch { /* malformed args */ }
      writeSSE(res, 'tool_call', { id: tc.callId, name: tc.name, input: parsed, approval_id: tc.name === 'run_terminal_command' ? tc.callId : undefined });
      const result = await executeAgentTool(tc.name, parsed, res, abortSignal, tc.callId);
      writeSSE(res, 'tool_result', { tool_use_id: tc.callId, name: tc.name, preview: result.preview, error: result.error });

      input.push({ type: 'function_call_output', call_id: tc.callId, output: result.content });
    }
  }
}

export async function runOpenAIAgentLoop(
  messages: { role: 'user' | 'assistant'; content: string }[],
  model: string,
  res: Response,
  abortSignal: { aborted: boolean },
  activeFile: string | null = null,
  customSystemPrompt?: string,
  tutorMode?: boolean,
) {
  const apiKey = await loadOpenAIKey();
  const client = new OpenAI({ apiKey });
  const systemPrompt = customSystemPrompt ?? buildSystemPrompt(activeFile, tutorMode);

  if (requiresResponsesAPI(model)) {
    return runResponsesAgentLoop(client, messages, model, res, abortSignal, systemPrompt);
  }

  const history: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  while (true) {
    if (abortSignal.aborted) return;

    const stream = await client.chat.completions.create({
      model,
      tools: TOOLS,
      messages: history,
      stream: true,
      ...(isReasoningModel(model) ? { reasoning_effort: 'none' as const } : {}),
    });

    // Accumulate tool call deltas across chunks
    const toolCallsAcc: Map<number, { id: string; name: string; args: string }> = new Map();
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      if (abortSignal.aborted) return;
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) writeSSE(res, 'text_delta', { text: delta.content });

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallsAcc.has(tc.index)) toolCallsAcc.set(tc.index, { id: '', name: '', args: '' });
          const acc = toolCallsAcc.get(tc.index)!;
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
        }
      }

      if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
    }

    if (abortSignal.aborted) return;
    const toolCalls = Array.from(toolCallsAcc.values());
    if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
      writeSSE(res, 'done', {});
      return;
    }

    history.push({
      role: 'assistant',
      content: null,
      tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.args } })),
    });

    for (const tc of toolCalls) {
      if (abortSignal.aborted) return;
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(tc.args); } catch { /* malformed args */ }
      writeSSE(res, 'tool_call', { id: tc.id, name: tc.name, input, approval_id: tc.name === 'run_terminal_command' ? tc.id : undefined });
      const result = await executeAgentTool(tc.name, input, res, abortSignal, tc.id);
      writeSSE(res, 'tool_result', { tool_use_id: tc.id, name: tc.name, preview: result.preview, error: result.error });
      history.push({ role: 'tool', tool_call_id: tc.id, content: result.content });
    }
  }
}
