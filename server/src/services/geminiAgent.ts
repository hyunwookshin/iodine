import { GoogleGenAI, Type } from '@google/genai';
import { Response } from 'express';
import { TOOL_SCHEMAS } from './fileTools';
import { executeAgentTool } from './agentTools';
import { buildSystemPrompt } from '../prompts/systemPrompt';

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

type JsonSchema = {
  type?: string;
  description?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
};

type GeminiSchema = {
  type: Type;
  description?: string;
  items?: GeminiSchema;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
};

// Recursively convert a JSON Schema node to a Gemini Schema.
// Gemini rejects arrays without `items`, so nested items/properties must be preserved.
function convertSchema(s: JsonSchema): GeminiSchema {
  const out: GeminiSchema = { type: toGeminiType(s.type ?? 'object') };
  if (s.description) out.description = s.description;
  if (s.type === 'array') out.items = convertSchema(s.items ?? { type: 'string' });
  if (s.properties) {
    out.properties = Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => [k, convertSchema(v)]),
    );
  }
  if (s.required?.length) out.required = [...s.required];
  return out;
}

const FUNCTION_DECLARATIONS = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => {
  const params = convertSchema(schema.parameters as JsonSchema);
  return {
    name,
    description: schema.description,
    parameters: { ...params, properties: params.properties ?? {}, required: params.required ?? [] },
  };
});

function writeSSE(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Permissive part type so thought parts (with thoughtSignature) are preserved verbatim.
type GeminiPart = Record<string, unknown>;
type GeminiContent = {
  role: string;
  parts: GeminiPart[];
};

export async function runGeminiAgentLoop(
  messages: { role: 'user' | 'assistant'; content: string }[],
  model: string,
  res: Response,
  abortSignal: { aborted: boolean },
  activeFile: string | null = null,
  customSystemPrompt?: string,
  tutorMode?: boolean,
  redact: boolean = true,
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
        systemInstruction: customSystemPrompt ?? buildSystemPrompt(activeFile, tutorMode),
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
        ...(supportsThinking ? { thinkingConfig: { thinkingBudget: 8000 } } : {}),
      },
    });

    // Accumulate raw parts verbatim (preserves thoughtSignature on thought parts)
    // and separately track function calls for tool execution.
    const rawModelParts: GeminiPart[] = [];
    const functionCalls: Array<{ name: string; args: Record<string, unknown>; id: string }> = [];

    for await (const chunk of stream) {
      if (abortSignal.aborted) return;

      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        // Preserve the raw part so thought signatures are kept for history
        rawModelParts.push(part as GeminiPart);

        if (typeof part.text === 'string' && part.text) {
          if ((part as { thought?: boolean }).thought) {
            writeSSE(res, 'thought_delta', { text: part.text });
          } else {
            writeSSE(res, 'text_delta', { text: part.text });
          }
        }

        if (part.functionCall) {
          const fc = part.functionCall as { name?: string; args?: Record<string, unknown>; id?: string };
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

    // Append model turn using the raw parts (thought signatures intact)
    history.push({ role: 'model', parts: rawModelParts });

    // Execute tools and collect function responses
    const responseParts: GeminiPart[] = [];
    for (const fc of functionCalls) {
      if (abortSignal.aborted) return;

      writeSSE(res, 'tool_call', { id: fc.id, name: fc.name, input: fc.args, approval_id: fc.name === 'run_terminal_command' ? fc.id : undefined });

      const result = await executeAgentTool(fc.name, fc.args, res, abortSignal, fc.id, redact);
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
