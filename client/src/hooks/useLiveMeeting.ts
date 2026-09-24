import { useRef, useState, useCallback } from 'react';

// WebSocket connections bypass the Vite proxy and hit the backend directly.
const WS_BASE = import.meta.env.DEV
  ? 'ws://localhost:3001'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

const BUFFER_SIZE = 4096;
const GEMINI_INPUT_RATE = 16000;
/** Gemini outputs 24 kHz PCM16. */
const OUTPUT_RATE = 24000;

// ── PCM conversion helpers ──────────────────────────────────────────────────

/** Convert Float32 PCM samples (–1…1) to base64-encoded Int16 PCM. */
function float32ToBase64Pcm16(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Decode base64-encoded Int16 PCM to Float32 samples (–1…1). */
function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

/** Linear-interpolation resample from sourceRate to targetRate. */
function resample(buffer: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return buffer;
  const ratio = sourceRate / targetRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, buffer.length - 1);
    const frac = srcIdx - lo;
    result[i] = buffer[lo] * (1 - frac) + buffer[hi] * frac;
  }
  return result;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export interface UseLiveMeetingReturn {
  /** Start a live meeting (Google provider only). Optionally pass prior conversation context. */
  start: (context?: string) => Promise<void>;
  /** Stop the active meeting and clean up all resources. */
  stop: () => void;
  /** Toggle microphone mute on/off. */
  toggleMute: () => void;
  isActive: boolean;
  isMuted: boolean;
  speaking: 'user' | 'agent' | 'idle';
  /** Live AnalyserNode on the Gemini output path — drives the waveform visualisation. */
  analyserNode: AnalyserNode | null;
  /** Live AnalyserNode on the mic input path — drives the bottom glow bar. */
  micAnalyserNode: AnalyserNode | null;
  error: string | null;
}

export function useLiveMeeting(provider: string, onTranscriptReady?: (transcript: string) => void): UseLiveMeetingReturn {
  const [isActive, setIsActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [speaking, setSpeaking] = useState<'user' | 'agent' | 'idle'>('idle');
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [micAnalyserNode, setMicAnalyserNode] = useState<AnalyserNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs for cleanup — all torn down in stop()
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Mute ref mirrors React state so the ScriptProcessor callback can read it
  // without re-registering on every state change.
  const isMutedRef = useRef(false);

  // Set to true once Gemini confirms the session is ready for audio.
  const readyRef = useRef(false);

  // Prior conversation context passed to start() — injected as systemInstruction on relay-ready.
  const contextRef = useRef<string | undefined>(undefined);

  // ── Transcript accumulation ───────────────────────────────────────────────
  const transcriptRef    = useRef<{ role: 'user' | 'agent'; text: string }[]>([]);
  const userTurnBufRef   = useRef('');
  const agentTurnBufRef  = useRef('');
  const onTranscriptRef  = useRef(onTranscriptReady);
  onTranscriptRef.current = onTranscriptReady;

  // Current provider — updated on every render so start() always reads the latest.
  const providerRef = useRef(provider);
  providerRef.current = provider;

  // ── Agent audio playback queue ──────────────────────────────────────────

  const playQueueRef      = useRef<Float32Array[]>([]);
  const isPlayingRef      = useRef(false);
  // Analyser tapped on the Gemini playback path — drives the waveform visualisation.
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);

  const enqueueAndPlay = useCallback((samples: Float32Array) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    playQueueRef.current.push(samples);
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;

    const playNext = () => {
      const chunk = playQueueRef.current.shift();
      if (!chunk || !audioCtxRef.current) {
        isPlayingRef.current = false;
        return;
      }
      const c = audioCtxRef.current;
      const buf = c.createBuffer(1, chunk.length, c.sampleRate);
      buf.copyToChannel(chunk as Float32Array<ArrayBuffer>, 0);
      const src = c.createBufferSource();
      src.buffer = buf;
      // Route through output analyser so the waveform reflects Gemini's voice.
      const outAnalyser = outputAnalyserRef.current;
      if (outAnalyser) {
        src.connect(outAnalyser);
      } else {
        src.connect(c.destination);
      }
      src.onended = playNext;
      src.start();
    };
    playNext();
  }, []);

  // ── Stop / cleanup ────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* already gone */ }
      wsRef.current = null;
    }
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch { /* ignore */ }
      processorRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch { /* ignore */ }
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    // Fire transcript callback before clearing state.
    const lines = transcriptRef.current;
    if (lines.length > 0) {
      const formatted = lines
        .map(e => `**${e.role === 'user' ? 'You' : 'Gemini'}:** ${e.text.trim()}`)
        .join('\n\n');
      onTranscriptRef.current?.(`**Meeting transcript**\n\n${formatted}`);
    }
    transcriptRef.current   = [];
    userTurnBufRef.current  = '';
    agentTurnBufRef.current = '';

    playQueueRef.current = [];
    isPlayingRef.current = false;
    readyRef.current = false;
    contextRef.current = undefined;
    outputAnalyserRef.current = null;
    setIsActive(false);
    setIsMuted(false);
    isMutedRef.current = false;
    setSpeaking('idle');
    setAnalyserNode(null);
    setMicAnalyserNode(null);
  }, []);

  // ── Start ─────────────────────────────────────────────────────────────────

  const start = useCallback(async (context?: string) => {
    // Prevent double-start
    if (wsRef.current) return;
    setError(null);
    contextRef.current = context;

    if (providerRef.current !== 'google') {
      setError(`Live meetings require the Google provider. Switch to Google to start a meeting.`);
      return;
    }

    try {
      // 1. Exchange server-side API key for session credentials
      const res = await fetch('/api/meeting/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((body as { error?: string }).error ?? 'Failed to create meeting session');
      }

      // 2. Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 3. AudioContext at output rate (24 kHz) — input is resampled before sending
      const audioCtx = new AudioContext({ sampleRate: OUTPUT_RATE });
      audioCtxRef.current = audioCtx;
      const actualRate = audioCtx.sampleRate;

      // 4. Audio graph
      //    Gemini playback: bufferSource ──► outputAnalyser ──► destination
      //    Mic capture:     source ──► micAnalyser (read-only tap)
      //                     source ──► scriptProcessor (PCM; output silenced)
      const outputAnalyser = audioCtx.createAnalyser();
      outputAnalyser.fftSize = 2048; // time-domain buffer for smooth waveform
      outputAnalyser.connect(audioCtx.destination);
      outputAnalyserRef.current = outputAnalyser;
      setAnalyserNode(outputAnalyser);

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Mic analyser: read-only tap for the bottom glow bar (no destination connection needed).
      const micAnalyser = audioCtx.createAnalyser();
      micAnalyser.fftSize = 512;
      source.connect(micAnalyser);
      setMicAnalyserNode(micAnalyser);

      const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;
      source.connect(processor);
      // ScriptProcessor must be connected to destination for onaudioprocess to fire.
      // We silence the output buffer in the callback to prevent mic feedback.
      processor.connect(audioCtx.destination);

      // 5. Open WebSocket relay to Gemini Live
      const ws = new WebSocket(`${WS_BASE}/meeting/relay`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);
          const msg = JSON.parse(raw);
          handleGeminiMessage(msg, ws);
        } catch { /* ignore malformed frames */ }
      };

      ws.onerror = () => {
        setError('Meeting connection error');
        stop();
      };

      ws.onclose = () => {
        // Only auto-stop if WE didn't initiate the close (stop() nulls wsRef first)
        if (wsRef.current === ws) stop();
      };

      // 6. Stream mic audio to Gemini
      processor.onaudioprocess = (e) => {
        // Silence output to prevent speaker feedback
        e.outputBuffer.getChannelData(0).fill(0);

        if (isMutedRef.current || !readyRef.current) return;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const rawSamples = e.inputBuffer.getChannelData(0);
        const samples = actualRate !== GEMINI_INPUT_RATE
          ? resample(rawSamples, actualRate, GEMINI_INPUT_RATE)
          : rawSamples;
        const b64 = float32ToBase64Pcm16(samples);

        ws.send(JSON.stringify({
          realtimeInput: {
            audio: { mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}`, data: b64 },
          },
        }));
      };

      setIsActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      stop();
    }
  }, [stop, enqueueAndPlay]);

  // ── Gemini message handler ─────────────────────────────────────────────────

  function handleGeminiMessage(msg: Record<string, unknown>, ws: WebSocket) {
    // Relay error (e.g. missing API key)
    if (msg.type === 'error') {
      setError((msg.message as string) ?? 'Meeting relay error');
      stop();
      return;
    }

    // Relay ready — send the Gemini Live setup message
    if (msg.type === 'relay-ready') {
      const ctx = contextRef.current;
      ws.send(JSON.stringify({
        setup: {
          model: 'models/gemini-3.8-live',
          systemInstruction: {
            parts: [{
              text: ctx
                ? `You are a helpful voice assistant continuing a prior text conversation with the user. Respond conversationally and concisely — this is a live voice session, not a text chat.\n\nWhen the session starts, greet the user with a single warm sentence that naturally references the prior topic (e.g. "Hey, great to continue our chat about X this way!"), then wait for them to speak. Do not list what you can do.\n\n[PRIOR CONVERSATION]\n${ctx}`
                : `You are a helpful voice assistant. Respond conversationally and concisely — this is a live voice session.\n\nWhen the session starts, greet the user with a single friendly sentence and ask what they're working on. Keep it brief.`,
            }],
          },
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      }));
      return;
    }

    // Gemini setup complete — safe to start sending audio.
    // Send a silent trigger so Gemini opens with its intro without waiting for the user.
    if ('setupComplete' in msg) {
      readyRef.current = true;
      ws.send(JSON.stringify({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: 'start' }] }],
          turnComplete: true,
        },
      }));
      return;
    }

    // Agent audio data + transcription
    const serverContent = msg.serverContent as {
      modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
      inputTranscription?:  { text?: string };
      outputTranscription?: { text?: string };
      turnComplete?: boolean;
    } | undefined;

    if (serverContent?.modelTurn?.parts) {
      for (const part of serverContent.modelTurn.parts) {
        if (part.inlineData?.data) {
          setSpeaking('agent');
          enqueueAndPlay(base64Pcm16ToFloat32(part.inlineData.data));
        }
      }
    }

    // Accumulate transcription text per turn
    if (serverContent?.inputTranscription?.text) {
      userTurnBufRef.current += serverContent.inputTranscription.text;
    }
    if (serverContent?.outputTranscription?.text) {
      agentTurnBufRef.current += serverContent.outputTranscription.text;
    }

    if (serverContent?.turnComplete) {
      // Flush completed turn buffers into the transcript
      if (userTurnBufRef.current.trim()) {
        transcriptRef.current.push({ role: 'user',  text: userTurnBufRef.current.trim() });
        userTurnBufRef.current = '';
      }
      if (agentTurnBufRef.current.trim()) {
        transcriptRef.current.push({ role: 'agent', text: agentTurnBufRef.current.trim() });
        agentTurnBufRef.current = '';
      }
      setSpeaking(s => s === 'agent' ? 'idle' : s);
    }
  }

  // ── Mute toggle ───────────────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    setIsMuted(m => {
      isMutedRef.current = !m;
      return !m;
    });
  }, []);

  return { start, stop, toggleMute, isActive, isMuted, speaking, analyserNode, micAnalyserNode, error };
}
