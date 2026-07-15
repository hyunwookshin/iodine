import OpenAI from 'openai';
import { Response } from 'express';
import { TOOL_SCHEMAS } from './fileTools';
import { executeAgentTool } from './agentTools';
import { rootPath } from '../state';

export async function loadOpenAIKey(): Promise<string> {
  if (process.env.OPENAI_TOKEN) return process.env.OPENAI_TOKEN;
  throw new Error('OPENAI_TOKEN environment variable is not set');
}

// Reasoning models require reasoning_effort: 'none' to use function tools on /v1/chat/completions.
const REASONING_MODEL_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5'];
function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_PREFIXES.some(prefix => model.startsWith(prefix));
}

const TOOLS: OpenAI.ChatCompletionTool[] = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
  type: 'function' as const,
  function: {
    name,
    description: schema.description,
    parameters: schema.parameters,
  },
}));

function writeSSE(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function buildSystemPrompt(activeFile: string | null): string {
  const workspaceInfo = rootPath ? `Workspace: ${rootPath}` : 'No workspace is currently open.';
  const activeFileInfo = activeFile ? `The user currently has this file open in the editor: ${activeFile}` : '';
  return `You are a coding assistant with access to the user's project files.
${workspaceInfo}
${activeFileInfo}

You can read, write, list, and search files, and run terminal commands. When modifying files, read them first.
Be concise in your explanations. When writing files with write_file, ALWAYS write the complete file content — never truncate, abbreviate, or use placeholder comments like "// rest of file unchanged" or "// ...". The file on disk will be exactly what you pass to write_file, so partial content means a broken file.`;
}

export async function runOpenAIAgentLoop(
  messages: { role: 'user' | 'assistant'; content: string }[],
  model: string,
  res: Response,
  abortSignal: { aborted: boolean },
  activeFile: string | null = null,
  customSystemPrompt?: string,
) {
  const apiKey = await loadOpenAIKey();
  const client = new OpenAI({ apiKey });

  const history: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: customSystemPrompt ?? buildSystemPrompt(activeFile) },
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

      if (delta?.content) {
        writeSSE(res, 'text_delta', { text: delta.content });
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallsAcc.has(tc.index)) {
            toolCallsAcc.set(tc.index, { id: '', name: '', args: '' });
          }
          const acc = toolCallsAcc.get(tc.index)!;
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
        }
      }

      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
    }

    if (abortSignal.aborted) return;

    const toolCalls = Array.from(toolCallsAcc.values());

    if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
      writeSSE(res, 'done', {});
      return;
    }

    // Append assistant message with tool_calls
    history.push({
      role: 'assistant',
      content: null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.args },
      })),
    });

    // Execute tools and append results
    for (const tc of toolCalls) {
      if (abortSignal.aborted) return;

      let input: Record<string, unknown> = {};
      try { input = JSON.parse(tc.args); } catch { /* malformed args */ }

      writeSSE(res, 'tool_call', { id: tc.id, name: tc.name, input });

      const result = await executeAgentTool(tc.name, input, res, abortSignal);
      writeSSE(res, 'tool_result', {
        tool_use_id: tc.id,
        name: tc.name,
        preview: result.preview,
        error: result.error,
      });

      history.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result.content,
      });
    }
  }
}
