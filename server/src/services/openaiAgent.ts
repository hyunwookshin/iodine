import OpenAI from 'openai';
import { Response } from 'express';
import { selectToolEntries } from './fileTools';
import { executeAgentTool } from './agentTools';
import type { AgentToolOptions } from './agentTools';
import { buildSystemPrompt } from '../prompts/systemPrompt';

export async function loadOpenAIKey(): Promise<string> {
  if (process.env.OPENAI_TOKEN) return process.env.OPENAI_TOKEN;
  throw new Error('OPENAI_TOKEN environment variable is not set');
}

// Reasoning models require reasoning_effort: 'none' to use function tools on /v1/chat/completions.
const REASONING_MODEL_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5'];
function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_PREFIXES.some(prefix => model.startsWith(prefix));
}

function toOpenAITools(planning?: boolean, executingPlan?: boolean): OpenAI.ChatCompletionTool[] {
  return selectToolEntries(planning, executingPlan).map(([name, schema]) => ({
    type: 'function' as const,
    function: {
      name,
      description: schema.description,
      parameters: schema.parameters,
    },
  }));
}

function writeSSE(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function runOpenAIAgentLoop(
  messages: { role: 'user' | 'assistant'; content: string }[],
  model: string,
  res: Response,
  abortSignal: { aborted: boolean },
  activeFile: string | null = null,
  customSystemPrompt?: string,
  tutorMode?: boolean,
  planOptions?: AgentToolOptions,
) {
  const apiKey = await loadOpenAIKey();
  const client = new OpenAI({ apiKey });

  const history: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: customSystemPrompt ?? buildSystemPrompt(activeFile, tutorMode, planOptions) },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const tools = toOpenAITools(planOptions?.planningMode, planOptions?.executing);

  while (true) {
    if (abortSignal.aborted) return;

    const stream = await client.chat.completions.create({
      model,
      tools,
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
      const result = await executeAgentTool(tc.name, input, res, abortSignal, tc.id, planOptions);
      writeSSE(res, 'tool_result', { tool_use_id: tc.id, name: tc.name, preview: result.preview, error: result.error });
      history.push({ role: 'tool', tool_call_id: tc.id, content: result.content });
    }
  }
}
