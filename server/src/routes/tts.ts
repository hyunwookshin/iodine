import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { loadOpenAIKey } from '../services/openaiAgent';
import { loadGeminiKey } from '../services/geminiAgent';
import { loadApiKey as loadAnthropicKey } from '../services/anthropicAgent';
import { CONDENSATION_FALLBACK, NARRATION_PROMPT } from '../prompts/ttsPrompts';

const router = Router();

function sanitizeForTts(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,{2,}/g, ',')
    .trim();
}

function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitDepth = 16): Buffer {
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);                                     // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitDepth / 8), 28);
  header.writeUInt16LE(channels * (bitDepth / 8), 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

/** Condense text into a slide-deck narration using whichever chat provider the user has selected. */
async function condense(chatProvider: string, chatModel: string, text: string): Promise<string> {
  const fallback = sanitizeForTts(text) || CONDENSATION_FALLBACK;

  if (chatProvider === 'openai') {
    const client = new OpenAI({ apiKey: await loadOpenAIKey() });
    const completion = await client.chat.completions.create({
      model: chatModel,
      messages: [
        { role: 'system', content: NARRATION_PROMPT },
        { role: 'user', content: text },
      ],
      max_completion_tokens: 60,
    });
    return completion.choices[0]?.message?.content?.trim() || fallback;

  } else if (chatProvider === 'anthropic') {
    const client = new Anthropic({ apiKey: await loadAnthropicKey() });
    const msg = await client.messages.create({
      model: chatModel,
      max_tokens: 60,
      system: NARRATION_PROMPT,
      messages: [{ role: 'user', content: text }],
    });
    return (msg.content[0] as { type: string; text: string })?.text?.trim() || fallback;

  } else {
    const ai = new GoogleGenAI({ apiKey: await loadGeminiKey() });
    const condensed = await ai.models.generateContent({
      model: chatModel,
      contents: [{ parts: [{ text }] }],
      config: { systemInstruction: NARRATION_PROMPT },
    });
    return condensed.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || fallback;
  }
}

router.post('/tts/verbally', async (req: Request, res: Response) => {
  const { text, provider, chatProvider, chatModel } = req.body as {
    text: string;
    provider: string;     // speech provider (openai | google)
    chatProvider: string; // conversation provider used for condensation
    chatModel: string;    // conversation model used for condensation
  };

  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });

  // Step 1: condense using the chat provider/model
  let narration = sanitizeForTts(text) || CONDENSATION_FALLBACK;
  try {
    narration = await condense(chatProvider, chatModel, text);
  } catch (error) {
    console.error('TTS condensation failed:', error);
    // Continue to TTS with the fallback when condensation fails.
  }

  // Step 2: TTS using the selected speech provider
  try {
    if (provider === 'openai') {
      const client = new OpenAI({ apiKey: await loadOpenAIKey() });
      const speech = await client.audio.speech.create({
        model: 'tts-1-hd',
        voice: 'nova',
        input: narration,
      });
      res.set('Content-Type', 'audio/mpeg');
      return res.send(Buffer.from(await speech.arrayBuffer()));

    } else if (provider === 'google') {
      const ai = new GoogleGenAI({ apiKey: await loadGeminiKey() });
      const audioResp = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text: narration }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
          },
        } as Record<string, unknown>,
      });
      const inlineData = audioResp.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inlineData?.data) return res.status(500).json({ error: 'No audio returned from Gemini TTS' });
      const pcm = Buffer.from(inlineData.data, 'base64');
      res.set('Content-Type', 'audio/wav');
      return res.send(pcmToWav(pcm));

    } else {
      return res.status(400).json({ error: `Provider '${provider}' does not support Verbally` });
    }
  } catch (err) {
    console.error('[TTS/Verbally]', err);
    return res.status(500).json({ error: (err as Error).message });
  }
});


export default router;
