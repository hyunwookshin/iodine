import { useRef, useState, useCallback } from 'react';

// WebSocket connections bypass the Vite proxy and hit the backend directly.
const WS_BASE = import.meta.env.DEV
  ? 'ws://localhost:3001'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

const BUFFER_SIZE = 4096;
const OPENAI_INPUT_RATE = 24000;
const GEMINI_INPUT_RATE = 16000;
/** Both providers output 24 kHz PCM16. */
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
  /** Start a live meeting with the current provider. */
  start: () => Promise<void>;
  /** Stop the active meeting and clean up all resources. */
  stop: () => void;
  /** Toggle microphone mute on/off. */
  toggleMute: () => void;
  isActive: boolean;
  isMuted: boolean;
  speaking: 'user' | 'agent' | 'idle';
  /** Live AnalyserNode for waveform visualisation (mic input). */
  analyserNode: AnalyserNode | null;
  error: string | null;
}

export function useLiveMeeting(provider: string): UseLiveMeetingReturn {
  const [isActive, setIsActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [speaking, setSpeaking] = useState<'user' | 'agent' | 'idle'>('idle');
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
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

  // Set to true once the provider confirms the session is ready for audio.
  const readyRef = useRef(false);

  // Snapshot of provider at the time start() was called.
  const providerAtStartRef = useRef<string>('');
  // Current provider — updated on every render so start() always reads the latest.
  const providerRef = useRef(provider);
  providerRef.current = provider;

  // ── Agent audio playback queue ──────────────────────────────────────────

  const playQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);

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
      src.connect(c.destination);
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
    playQueueRef.current = [];
    isPlayingRef.current = false;
    readyRef.current = false;
    providerAtStartRef.current = '';
    setIsActive(false);
    setIsMuted(false);
    isMutedRef.current = false;
    setSpeaking('idle');
    setAnalyserNode(null);
  }, []);

  // ── Start ─────────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    // Prevent double-start
    if (wsRef.current) return;
    setError(null);

    const prov = providerRef.current;
    providerAtStartRef.current = prov;

    if (prov !== 'openai' && prov !== 'google') {
      setError(`Provider '${prov}' does not support live meetings. Switch to OpenAI or Google.`);
      return;
    }

    try {
      // 1. Exchange server-side API key for session credentials
      const res = await fetch('/api/meeting/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: prov }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((body as { error?: string }).error ?? 'Failed to create meeting session');
      }
      const session = await res.json() as {
        provider: string;
        clientSecret?: string;
        useRelay?: boolean;
      };

      // 2. Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 3. AudioContext at output rate (24 kHz) — input is resampled before sending
      const audioCtx = new AudioContext({ sampleRate: OUTPUT_RATE });
      audioCtxRef.current = audioCtx;
      const actualRate = audioCtx.sampleRate;
      const inputRate = prov === 'openai' ? OPENAI_INPUT_RATE : GEMINI_INPUT_RATE;

      // 4. Audio graph
      //    source (mic) ──► analyser (for waveform visualisation)
      //                └──► scriptProcessor (PCM capture; output silenced)
      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      setAnalyserNode(analyser);

      const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;
      source.connect(processor);
      // ScriptProcessor must be connected to destination for onaudioprocess to fire.
      // We silence the output buffer in the callback to prevent mic feedback.
      processor.connect(audioCtx.destination);

      // 5. Open WebSocket to the provider
      let ws: WebSocket;
      if (prov === 'openai') {
        ws = new WebSocket(
          'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview',
          ['realtime', `openai-insecure-api-key.${session.clientSecret}`, 'openai-beta.realtime-v1'],
        );
      } else {
        ws = new WebSocket(`${WS_BASE}/meeting/relay`);
      }
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        if (prov === 'openai') {
          // Configure the realtime session
          ws.send(JSON.stringify({
            type: 'session.update',
            session: {
              modalities: ['audio', 'text'],
              input_audio_format: 'pcm16',
              output_audio_format: 'pcm16',
              turn_detection: { type: 'server_vad' },
            },
          }));
        }
        // Gemini: setup is sent after receiving relay-ready
      };

      ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);
          const msg = JSON.parse(raw);

          if (prov === 'google') {
            handleGeminiMessage(msg, ws);
          } else {
            handleOpenAIMessage(msg);
          }
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

      // 6. Stream mic audio to the provider
      processor.onaudioprocess = (e) => {
        // Silence output to prevent speaker feedback
        e.outputBuffer.getChannelData(0).fill(0);

        if (isMutedRef.current || !readyRef.current) return;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const rawSamples = e.inputBuffer.getChannelData(0);
        const samples = actualRate !== inputRate
          ? resample(rawSamples, actualRate, inputRate)
          : rawSamples;
        const b64 = float32ToBase64Pcm16(samples);

        if (prov === 'openai') {
          ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
        } else {
          ws.send(JSON.stringify({
            realtimeInput: {
              audio: { mimeType: `audio/pcm;rate=${inputRate}`, data: b64 },
            },
          }));
        }
      };

      setIsActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      stop();
    }
  }, [stop, enqueueAndPlay]);

  // ── Provider-specific message handlers ────────────────────────────────────

  function handleGeminiMessage(msg: Record<string, unknown>, ws: WebSocket) {
    // Relay error (e.g. missing API key)
    if (msg.type === 'error') {
      setError((msg.message as string) ?? 'Meeting relay error');
      stop();
      return;
    }

    // Relay ready — send the Gemini Live setup message
    if (msg.type === 'relay-ready') {
      ws.send(JSON.stringify({
        setup: {
          model: 'models/gemini-3.8-live',
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
            },
          },
        },
      }));
      return;
    }

    // Gemini setup complete — safe to start sending audio
    if ('setupComplete' in msg) {
      readyRef.current = true;
      return;
    }

    // Agent audio data
    const serverContent = msg.serverContent as {
      modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
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
    if (serverContent?.turnComplete) {
      setSpeaking(s => s === 'agent' ? 'idle' : s);
    }
  }

  function handleOpenAIMessage(msg: Record<string, unknown>) {
    const type = msg.type as string | undefined;

    // Session confirmed — safe to start sending audio
    if (type === 'session.created' || type === 'session.updated') {
      readyRef.current = true;
    }

    // Agent audio delta
    if (type === 'response.audio.delta' && msg.delta) {
      setSpeaking('agent');
      enqueueAndPlay(base64Pcm16ToFloat32(msg.delta as string));
    }

    // Agent finished speaking
    if (type === 'response.audio.done' || type === 'response.done') {
      setSpeaking(s => s === 'agent' ? 'idle' : s);
    }

    // User speaking (server VAD)
    if (type === 'input_audio_buffer.speech_started') {
      setSpeaking('user');
    }
    if (type === 'input_audio_buffer.speech_stopped') {
      setSpeaking(s => s === 'user' ? 'idle' : s);
    }
  }

  // ── Mute toggle ───────────────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    setIsMuted(m => {
      isMutedRef.current = !m;
      return !m;
    });
  }, []);

  return { start, stop, toggleMute, isActive, isMuted, speaking, analyserNode, error };
}
