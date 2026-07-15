import Anthropic from '@anthropic-ai/sdk';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { Response } from 'express';
import { TOOL_SCHEMAS } from './fileTools';
import { executeAgentTool } from './agentTools';
import { rootPath } from '../state';

export async function loadApiKey(): Promise<string> {
  try {
    const keyFile = path.join(os.homedir(), '.anthropic', 'api_key');
    const key = await fs.promises.readFile(keyFile, 'utf-8');
    return key.trim();
  } catch {
    // fall through
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  throw new Error('API key not found');
}

const TOOLS: Anthropic.Tool[] = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
  name,
  description: schema.description,
  input_schema: schema.parameters as Anthropic.Tool['input_schema'],
}));

// Newer models use adaptive thinking; older models use extended thinking with a budget.
const ADAPTIVE_THINKING_MODELS = new Set(['claude-opus-4-8', 'claude-sonnet-5']);

function getThinkingParam(model: string): Anthropic.ThinkingConfigParam {
  if (ADAPTIVE_THINKING_MODELS.has(model)) {
    return { type: 'adaptive' };
  }
  return { type: 'enabled', budget_tokens: 8000 };
}

function writeSSE(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function runAgentLoop(
  messages: Anthropic.MessageParam[],
  model: string,
  res: Response,
  abortSignal: { aborted: boolean },
  activeFile: string | null = null,
  customSystemPrompt?: string,
) {
  const apiKey = await loadApiKey();
  const client = new Anthropic({ apiKey });

  const workspaceInfo = rootPath ? `Workspace: ${rootPath}` : 'No workspace is currently open.';
  const activeFileInfo = activeFile ? `The user currently has this file open in the editor: ${activeFile}` : '';
  const system = customSystemPrompt ?? `You are a coding assistant with access to the user's project files.
${workspaceInfo}
${activeFileInfo}

You can read, write, list, and search files, and run terminal commands. When modifying files, read them first.
Be concise in your explanations. When writing files with write_file, ALWAYS write the complete file content — never truncate, abbreviate, or use placeholder comments like "// rest of file unchanged" or "// ...". The file on disk will be exactly what you pass to write_file, so partial content means a broken file.`;

  const history = [...messages];

  while (true) {
    if (abortSignal.aborted) return;

    const stream = client.messages.stream({
      model,
      max_tokens: 32000,
      thinking: getThinkingParam(model),
      system,
      tools: TOOLS,
      messages: history,
    });

    for await (const event of stream) {
      if (abortSignal.aborted) return;
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          writeSSE(res, 'text_delta', { text: event.delta.text });
        } else if (event.delta.type === 'thinking_delta') {
          writeSSE(res, 'thought_delta', { text: event.delta.thinking });
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    if (abortSignal.aborted) return;

    const toolUseBlocks = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUseBlocks.length === 0) {
      // No more tool calls — done
      writeSSE(res, 'done', {});
      return;
    }

    // Append assistant message — drop any thinking blocks with empty content
    // (the API rejects them on subsequent turns when they have thinking: "")
    const contentForHistory = finalMessage.content.filter(
      b => b.type !== 'thinking' || (b as Anthropic.ThinkingBlock).thinking.length > 0
    );
    history.push({ role: 'assistant', content: contentForHistory });

    // Execute tools and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      if (abortSignal.aborted) return;
      writeSSE(res, 'tool_call', { id: toolUse.id, name: toolUse.name, input: toolUse.input });

      const result = await executeAgentTool(toolUse.name, toolUse.input as Record<string, unknown>, res, abortSignal);
      writeSSE(res, 'tool_result', {
        tool_use_id: toolUse.id,
        name: toolUse.name,
        preview: result.preview,
        error: result.error,
      });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result.content,
        is_error: result.error,
      });
    }

    history.push({ role: 'user', content: toolResults });
  }
}
