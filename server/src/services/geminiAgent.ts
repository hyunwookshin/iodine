import { GoogleGenAI, Type } from '@google/genai';
import { Response } from 'express';
import { executeTool, TOOL_SCHEMAS } from './fileTools';
import { rootPath } from '../state';

export async function loadGeminiKey(): Promise<string> {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  throw new Error('GEMINI_API_KEY environment variable is not set');
}

// Map JSON Schema type strings to Gemini Type enum
function toGeminiType(t: string): Type {
  switch (t) {
    case 'string':  return Type.STRING;
    case 'number':  return Type.NUMBER;
    case 'integer': return Type.INTEGER;
    case 'boolean': return Type.BOOLEAN;
    case 'array':   return Type.ARRAY;
    default:        return Type.OBJECT;
  }
}

// Convert a JSON Schema properties map to Gemini Schema properties
function convertProperties(
  props: Record<string, { type: string; description?: string }>,
): Record<string, { type: Type; description?: string }> {
  const out: Record<string, { type: Type; description?: string }> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = { type: toGeminiType(v.type), description: v.description };
  }
  return out;
}

const FUNCTION_DECLARATIONS = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
  name,
  description: schema.description,
  parameters: {
    type: Type.OBJECT,
    properties: convertProperties(
      (schema.parameters as { properties?: Record<string, { type: string; description?: string }> }).properties ?? {},
    ),
    required: (schema.parameters as { required?: string[] }).required ?? [],
  },
}));

function writeSSE(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function buildSystemInstruction(activeFile: string | null): string {
  const workspaceInfo = rootPath ? `Workspace: ${rootPath}` : 'No workspace is currently open.';
  const activeFileInfo = activeFile ? `The user currently has this file open in the editor: ${activeFile}` : '';
  return `You are a coding assistant with access to the user's project files.
${workspaceInfo}
${activeFileInfo}

You can read, write, list, and search files. When modifying files, read them first.
Be concise. Show diffs or full updated files when making changes.`;
}

type GeminiContent = {
  role: string;
  parts: Array<
    | { text: string }
    | { functionCall: { name: string; args: Record<string, unknown> } }
    | { functionResponse: { name: string; response: { result: string } } }
  >;
};

export async function runGeminiAgentLoop(
  messages: { role: 'user' | 'assistant'; content: string }[],
  model: string,
  res: Response,
  abortSignal: { aborted: boolean },
  activeFile: string | null = null,
  customSystemPrompt?: string,
) {
  const apiKey = await loadGeminiKey();
  const ai = new GoogleGenAI({ apiKey });

  // Build Gemini contents array — 'assistant' → 'model'
  const history: GeminiContent[] = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  while (true) {
    if (abortSignal.aborted) return;

    // Gemini 2.5 models support thinking; earlier models don't
    const supportsThinking = model.includes('2.5');

    const stream = await ai.models.generateContentStream({
      model,
      contents: history,
      config: {
        systemInstruction: customSystemPrompt ?? buildSystemInstruction(activeFile),
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
        ...(supportsThinking ? { thinkingConfig: { thinkingBudget: 8000 } } : {}),
      },
    });

    // Accumulate text and function calls across chunks
    let assistantText = '';
    const functionCalls: Array<{ name: string; args: Record<string, unknown>; id: string }> = [];

    for await (const chunk of stream) {
      if (abortSignal.aborted) return;

      // Iterate parts directly so we can distinguish thought vs answer text
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.text) {
          if ((part as { thought?: boolean }).thought) {
            writeSSE(res, 'thought_delta', { text: part.text });
          } else {
            writeSSE(res, 'text_delta', { text: part.text });
            assistantText += part.text;
          }
        }
      }

      if (chunk.functionCalls) {
        for (const fc of chunk.functionCalls) {
          functionCalls.push({
            name: fc.name ?? '',
            args: (fc.args ?? {}) as Record<string, unknown>,
            id: fc.id ?? `${fc.name}-${Date.now()}`,
          });
        }
      }
    }

    if (abortSignal.aborted) return;

    // No tool calls — we're done
    if (functionCalls.length === 0) {
      writeSSE(res, 'done', {});
      return;
    }

    // Append model turn (text + function calls)
    const modelParts: GeminiContent['parts'] = [];
    if (assistantText) modelParts.push({ text: assistantText });
    for (const fc of functionCalls) {
      modelParts.push({ functionCall: { name: fc.name, args: fc.args } });
    }
    history.push({ role: 'model', parts: modelParts });

    // Execute tools and collect function responses
    const responseParts: GeminiContent['parts'] = [];
    for (const fc of functionCalls) {
      if (abortSignal.aborted) return;

      writeSSE(res, 'tool_call', { id: fc.id, name: fc.name, input: fc.args });

      const result = await executeTool(fc.name, fc.args);
      writeSSE(res, 'tool_result', {
        tool_use_id: fc.id,
        name: fc.name,
        preview: result.preview,
        error: result.error,
      });

      responseParts.push({
        functionResponse: {
          name: fc.name,
          response: { result: result.content },
        },
      });
    }

    // Append user turn with all function responses
    history.push({ role: 'user', parts: responseParts });
  }
}
