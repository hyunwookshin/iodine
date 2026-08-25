import Anthropic from '@anthropic-ai/sdk';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { Response } from 'express';
import { selectToolEntries } from './fileTools';
import { executeAgentTool } from './agentTools';
import type { AgentToolOptions } from './agentTools';
import { buildSystemPrompt } from '../prompts/systemPrompt';

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

function toAnthropicTools(planning?: boolean, executingPlan?: boolean): Anthropic.Tool[] {
  return selectToolEntries(planning, executingPlan).map(([name, schema]) => ({
    name,
    description: schema.description,
    input_schema: schema.parameters as Anthropic.Tool['input_schema'],
  }));
}

// Older models use extended thinking with a budget; newer models use adaptive.
// Default to adaptive so any future model works without code changes.
const LEGACY_THINKING_MODELS = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5']);

function getThinkingParam(model: string): Anthropic.ThinkingConfigParam {
  if (LEGACY_THINKING_MODELS.has(model)) {
    return { type: 'enabled', budget_tokens: 8000 };
  }
  return { type: 'adaptive' };
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
  tutorMode?: boolean,
  planOptions?: AgentToolOptions,
) {
  const apiKey = await loadApiKey();
  const client = new Anthropic({ apiKey });

  const system = customSystemPrompt ?? buildSystemPrompt(activeFile, tutorMode, planOptions);
  const tools = toAnthropicTools(planOptions?.planningMode, planOptions?.executing);

  const history = [...messages];

  while (true) {
    if (abortSignal.aborted) return;

    const stream = client.messages.stream({
      model,
      max_tokens: 32000,
      thinking: getThinkingParam(model),
      system,
      tools,
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
      writeSSE(res, 'done', {});
      return;
    }

    const contentForHistory = finalMessage.content.filter(
      b => b.type !== 'thinking' || (b as Anthropic.ThinkingBlock).thinking.length > 0
    );
    history.push({ role: 'assistant', content: contentForHistory });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      if (abortSignal.aborted) return;
      writeSSE(res, 'tool_call', { id: toolUse.id, name: toolUse.name, input: toolUse.input, approval_id: toolUse.name === 'run_terminal_command' ? toolUse.id : undefined });

      const result = await executeAgentTool(toolUse.name, toolUse.input as Record<string, unknown>, res, abortSignal, toolUse.id, planOptions);
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
