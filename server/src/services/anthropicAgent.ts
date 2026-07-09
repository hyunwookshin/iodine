import Anthropic from '@anthropic-ai/sdk';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { Response } from 'express';
import { executeTool, TOOL_SCHEMAS } from './fileTools';
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

You can read, write, list, and search files. When modifying files, read them first.
Be concise. Show diffs or full updated files when making changes.`;

  const history = [...messages];

  while (true) {
    if (abortSignal.aborted) return;

    const stream = client.messages.stream({
      model,
      max_tokens: 8096,
      system,
      tools: TOOLS,
      messages: history,
    });

    for await (const event of stream) {
      if (abortSignal.aborted) return;
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        writeSSE(res, 'text_delta', { text: event.delta.text });
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

    // Append assistant message
    history.push({ role: 'assistant', content: finalMessage.content });

    // Execute tools and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      if (abortSignal.aborted) return;
      writeSSE(res, 'tool_call', { id: toolUse.id, name: toolUse.name, input: toolUse.input });

      const result = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
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
