import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { loadApiKey } from '../services/anthropicAgent';
import { loadOpenAIKey } from '../services/openaiAgent';
import { loadGeminiKey } from '../services/geminiAgent';
import { PROACTIVE_REPHRASE_SYSTEM } from '../prompts/proactiveSystem';
import { WATCH_SYSTEM } from '../prompts/watchSystem';

const router = Router();

router.post('/proactive/rephrase', async (req, res) => {
  const { message, provider, model } = req.body as {
    message: string;
    provider: string;
    model: string;
  };

  try {
    let rephrased = message;

    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey: await loadApiKey() });
      const response = await client.messages.create({
        model,
        max_tokens: 120,
        system: PROACTIVE_REPHRASE_SYSTEM,
        messages: [{ role: 'user', content: message }],
      });
      const block = response.content[0];
      if (block?.type === 'text') rephrased = block.text.trim();

    } else if (provider === 'openai') {
      const client = new OpenAI({ apiKey: await loadOpenAIKey() });
      const response = await client.chat.completions.create({
        model,
        max_completion_tokens: 120,
        messages: [
          { role: 'system', content: PROACTIVE_REPHRASE_SYSTEM },
          { role: 'user', content: message },
        ],
      });
      rephrased = response.choices[0]?.message?.content?.trim() ?? message;

    } else if (provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: await loadGeminiKey() });
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: message }] }],
        config: { systemInstruction: PROACTIVE_REPHRASE_SYSTEM },
      });
      rephrased = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? message;
    }

    res.json({ rephrased });
  } catch {
    // Degrade gracefully — return the original canned message.
    res.json({ rephrased: message });
  }
});

router.post('/proactive/watch', async (req, res) => {
  const { previousReply, diffSnapshots, provider, model } = req.body as {
    previousReply: string;
    diffSnapshots: string[];
    provider: string;
    model: string;
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const SNAPSHOT_TIMES = [4, 10, 20];
  const diffsText = diffSnapshots
    .map((d, i) => {
      const t = SNAPSHOT_TIMES[i] ?? (i + 1) * 10;
      return d.trim()
        ? `Snapshot ${i + 1} (at ${t}s):\n\`\`\`diff\n${d}\n\`\`\``
        : `Snapshot ${i + 1} (at ${t}s): (no changes)`;
    })
    .join('\n\n');

  const userContent =
    `My previous reply:\n---\n${previousReply}\n---\n\nGit diff snapshots:\n${diffsText}`;

  try {
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey: await loadApiKey() });
      const stream = client.messages.stream({
        model,
        max_tokens: 300,
        system: WATCH_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          send('text_delta', { text: event.delta.text });
        }
      }

    } else if (provider === 'openai') {
      const client = new OpenAI({ apiKey: await loadOpenAIKey() });
      const stream = await client.chat.completions.create({
        model,
        max_completion_tokens: 300,
        stream: true,
        messages: [
          { role: 'system', content: WATCH_SYSTEM },
          { role: 'user', content: userContent },
        ],
      });
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) send('text_delta', { text });
      }

    } else if (provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: await loadGeminiKey() });
      const stream = await ai.models.generateContentStream({
        model,
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        config: { systemInstruction: WATCH_SYSTEM },
      });
      for await (const chunk of stream) {
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) send('text_delta', { text });
      }
    }

    send('done', {});
  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : 'Unknown error' });
  } finally {
    res.end();
  }
});

export default router;
