import { useCallback, useRef } from 'react';
import { GREETING_PHRASES, QUESTION_BRIDGE_PHRASES, TOOL_NARRATION_PHRASES } from '../prompts/toolNarration';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

// Exploration/navigation narrations are skippable when the final summary is ready.
// Edit/write narrations are kept because they announce meaningful changes.
const SKIPPABLE_TOOLS = new Set(['read_file', 'open_file', 'list_directory', 'search_files']);
const MAX_TOOL_NARRATIONS_PER_TURN = 4;
const NON_CODE_EXTENSIONS = new Set([
  'md', 'mdx', 'rst', 'adoc', 'txt', 'log',
  'html', 'htm', 'svg',
  'json', 'yaml', 'yml', 'xml', 'toml', 'ini', 'conf', 'csv', 'tsv', 'lock',
]);
const IMPLEMENTATION_PHRASE = /\b(?:code|implementation|logic)\b/i;

interface NarrationEntry {
  fn: () => Promise<string>;
  skippable: boolean;
  approvalId?: string;
}

export const toolNarrationInternals = {
  skippableTools: SKIPPABLE_TOOLS,
  getFileParts(path?: string) {
    const filename = path?.split(/[/\\]/).filter(Boolean).pop() ?? null;
    const extension = filename?.match(/\.([^.]+)$/)?.[1].toLowerCase() ?? null;
    const displayName = filename?.replace(/\.[^.]+$/, '') ?? null;
    return { filename, extension, displayName };
  },
  getFileType(extension: string | null) {
    const names: Record<string, string> = {
      java: 'Java', sh: 'Script', cc: 'C plus plus', cpp: 'C plus plus', c: 'C', h: 'Header',
      ts: 'TypeScript', tsx: 'TypeScript', kt: 'Kotlin', js: 'JavaScript', jsx: 'JavaScript',
      py: 'Python', json: 'JSON', md: 'Markdown', css: 'CSS', html: 'HTML', yml: 'YAML', yaml: 'YAML',
    };
    return extension ? names[extension] ?? extension.toUpperCase() : null;
  },
  describeFile(path: string | undefined, narrationIndex: number) {
    const { displayName, extension } = this.getFileParts(path);
    const fileType = this.getFileType(extension);
    return fileType && narrationIndex % 2 === 1
      ? `${displayName ?? 'this'} ${fileType} file`
      : `${displayName ?? 'this'} file`;
  },
  describeTarget(name: string, path: string | undefined, narrationIndex: number) {
    if (name === 'list_directory') {
      const directoryName = path?.split(/[/\\]/).filter(Boolean).pop() ?? 'this';
      return `${directoryName} directory`;
    }
    return this.describeFile(path, narrationIndex);
  },
  getFamily(name: string) {
    return name === 'open_file' || name === 'read_file' ? 'read' : name;
  },
  formatPhrase(template: string, fileDescription: string, continuesRead: boolean) {
    return continuesRead ? `And ${fileDescription}.` : template.replace('{file}', fileDescription);
  },
  getPhrases(name: string, extension: string | null) {
    const phrases = TOOL_NARRATION_PHRASES[name] ?? ['I can handle this.'];
    return extension && NON_CODE_EXTENSIONS.has(extension)
      ? phrases.filter(phrase => !IMPLEMENTATION_PHRASE.test(phrase))
      : phrases;
  },
  isBridgeQuestion(text: string) {
    return text.includes('?') && /\b(?:how does|why is|when should|where is|when can|what if)\b/i.test(text);
  },
};

export function useToolNarration(speechProviderId: 'google' | 'openai') {
  const queueRef      = useRef<NarrationEntry[]>([]);
  const audioRef      = useRef<HTMLAudioElement | null>(null);
  const generationRef = useRef(0);
  const drainingRef   = useRef(false);
  // Cleared at the start of each turn to suppress duplicate narration within that turn.
  const narratedRef        = useRef(new Set<string>());
  // Persists across turns so repeated tool/file combinations can be announced with “again”.
  const previouslyNarratedRef = useRef(new Set<string>());
  // Limits repeat wording to the first repeated narration in each turn.
  const saidAgainThisTurnRef = useRef(false);
  // Caps tool narration so long turns do not sound repetitive or robotic.
  const toolNarrationCountRef = useRef(0);
  // Cycles repeat wording predictably instead of choosing it at random.
  const repeatVariationRef = useRef(0);
  // Alternates file narrations between a natural filename and filename + file type.
  const fileNarrationCountRef = useRef(0);
  // Tracks accepted tool calls so adjacent reads can continue with “And <file>.”
  const previousFamilyRef = useRef<string | null>(null);
  const hadNarrationsRef   = useRef(false);
  const hadUnskippableRef  = useRef(false);
  const unskippableCountRef = useRef(0);
  const onEmptyRef         = useRef<(() => void) | null>(null);
  const pendingBridgeRef   = useRef(false);

  const stop = useCallback(() => {
    generationRef.current++;
    queueRef.current = [];
    pendingBridgeRef.current = false;
    audioRef.current?.pause();
    audioRef.current = null;
    drainingRef.current = false;
    onEmptyRef.current?.();
    onEmptyRef.current = null;
  }, []);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    const generation = generationRef.current;
    while (queueRef.current.length && generation === generationRef.current) {
      const { fn: fetchAudio } = queueRef.current.shift()!;
      try {
        const url = await fetchAudio();
        if (generation !== generationRef.current) { URL.revokeObjectURL(url); break; }
        await new Promise<void>(resolve => {
          const audio = new Audio(url);
          audioRef.current = audio;
          let finished = false;
          const finish = () => { if (finished) return; finished = true; URL.revokeObjectURL(url); resolve(); };
          audio.play().catch(finish);
          audio.addEventListener('ended', finish, { once: true });
          audio.addEventListener('error', finish, { once: true });
          audio.addEventListener('pause', finish, { once: true });
        });
      } catch { /* skip failed clips */ }
    }
    if (generation === generationRef.current) {
      drainingRef.current = false;
      onEmptyRef.current?.();
      onEmptyRef.current = null;
    }
  }, []);

  /** Remove all skippable entries from the pending queue (does not interrupt the current clip). */
  const evictSkippable = useCallback(() => {
    queueRef.current = queueRef.current.filter(e => !e.skippable);
  }, []);

  /** Remove only narration associated with an approval that the user has already resolved. */
  const evictApprovalNarration = useCallback((approvalId: string) => {
    queueRef.current = queueRef.current.filter(entry => entry.approvalId !== approvalId);
  }, []);

  const narrate = useCallback((name: string, input: Record<string, unknown>, approvalId?: string) => {
    if (toolNarrationCountRef.current >= MAX_TOOL_NARRATIONS_PER_TURN) return;

    const path = Object.values(input).find(
      value => typeof value === 'string' && (value.includes('/') || value.includes('\\'))
    ) as string | undefined;
    // Treat reading and opening as the same action, and normalize path separators so
    // equivalent tool/file calls share one stable identity on every platform.
    const family = name === 'open_file' || name === 'read_file' ? 'read' : name;
    const normalized = path?.replace(/\\/g, '/').replace(/^\.\//, '') ?? '';
    const key = `${family}:${normalized}`;

    // A duplicate in the current turn is silent. Only the first read/open key repeated
    // from an earlier turn gets repeat wording; other tools are narrated normally.
    if (narratedRef.current.has(key)) return;

    if (pendingBridgeRef.current) {
      pendingBridgeRef.current = false;
      const text = QUESTION_BRIDGE_PHRASES[Math.floor(Math.random() * QUESTION_BRIDGE_PHRASES.length)];
      queueRef.current.push({
        skippable: false,
        fn: async () => {
          const response = await fetch(`${API_BASE}/api/tts/speak`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, provider: speechProviderId }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return URL.createObjectURL(await response.blob());
        },
      });
    }

    // This cap counts accepted narration requests, including clips that later fail
    // during TTS/audio playback or are removed as skippable before they play.
    toolNarrationCountRef.current++;
    const shouldUseRepeatWording =
      family === 'read'
      && previouslyNarratedRef.current.has(key)
      && !saidAgainThisTurnRef.current;
    if (shouldUseRepeatWording) saidAgainThisTurnRef.current = true;
    const continuesRead = family === 'read' && previousFamilyRef.current === 'read';
    previousFamilyRef.current = family;
    narratedRef.current.add(key);
    previouslyNarratedRef.current.add(key);
    hadNarrationsRef.current = true;
    const isUnskippable = !SKIPPABLE_TOOLS.has(name);
    if (isUnskippable) {
      hadUnskippableRef.current = true;
      unskippableCountRef.current++;
    }

    // After 2 unskippable (edit/write) narrations in a turn, make the rest skippable
    // so repeated "let me edit…" clips don't pile up and feel robotic.
    const skippable = SKIPPABLE_TOOLS.has(name) || unskippableCountRef.current > 2;

    const filename = path?.split(/[/\\]/).filter(Boolean).pop() ?? null;
    const extension = filename?.match(/\.([^.]+)$/)?.[1].toLowerCase() ?? null;
    const displayName = filename?.replace(/\.[^.]+$/, '') ?? null;
    const phrases = toolNarrationInternals.getPhrases(name, extension);
    const template = phrases[Math.floor(Math.random() * phrases.length)];
    const fileTypeNames: Record<string, string> = {
      java: 'Java',
      sh: 'Script',
      cc: 'C plus plus',
      cpp: 'C plus plus',
      c: 'C',
      h: 'Header',
      ts: 'TypeScript',
      tsx: 'TypeScript',
      kt: 'Kotlin',
      js: 'JavaScript',
      jsx: 'JavaScript',
      py: 'Python',
      json: 'JSON',
      md: 'Markdown',
      css: 'CSS',
      html: 'HTML',
      yml: 'YAML',
      yaml: 'YAML',
    };
    const fileType = extension ? fileTypeNames[extension] ?? extension.toUpperCase() : null;
    const includeFileType = Boolean(fileType) && fileNarrationCountRef.current++ % 2 === 1;
    const fileDescription = name === 'list_directory'
      ? `${filename ?? 'this'} directory`
      : fileType && includeFileType
        ? `${displayName ?? 'this'} ${fileType} file`
        : `${displayName ?? 'this'} file`;
    const basePhrase = continuesRead ? `And ${fileDescription}.` : template.replace('{file}', fileDescription);
    const repeatVariations = ['again', 'once more', 'more closely'] as const;
    const repeatVariation = repeatVariations[repeatVariationRef.current % repeatVariations.length];
    if (shouldUseRepeatWording) repeatVariationRef.current++;
    // Keep terminal punctuation at the end: “Let me inspect foo.ts.” → “…foo.ts once more.”
    const phrase = shouldUseRepeatWording
      ? basePhrase.replace(/([.!?])?$/, ` ${repeatVariation}$1`)
      : basePhrase;

    queueRef.current.push({
      fn: async () => {
        const response = await fetch(`${API_BASE}/api/tts/speak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: phrase, provider: speechProviderId }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return URL.createObjectURL(await response.blob());
      },
      skippable,
      approvalId,
    });
    void drain();
  }, [speechProviderId, drain]);

  /** Enqueue a greeting clip at the front of the turn so it plays before any tool narrations. */
  const enqueueGreeting = useCallback((mode: 'hello' | 'welcomeBack') => {
    const phrases = GREETING_PHRASES[mode];
    const text = phrases[Math.floor(Math.random() * phrases.length)];
    queueRef.current.push({
      skippable: false,
      fn: async () => {
        const response = await fetch(`${API_BASE}/api/tts/speak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, provider: speechProviderId }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return URL.createObjectURL(await response.blob());
      },
    });
    void drain();
  }, [speechProviderId, drain]);

  const setBridgeQuestion = useCallback((text: string) => {
    pendingBridgeRef.current = toolNarrationInternals.isBridgeQuestion(text);
  }, []);

  const resetTurn = useCallback(() => {
    narratedRef.current        = new Set();
    saidAgainThisTurnRef.current = false;
    toolNarrationCountRef.current = 0;
    fileNarrationCountRef.current = 0;
    previousFamilyRef.current  = null;
    hadNarrationsRef.current   = false;
    hadUnskippableRef.current  = false;
    unskippableCountRef.current = 0;
    pendingBridgeRef.current   = false;
  }, []);

  return { narrate, stop, drain, evictSkippable, evictApprovalNarration, enqueueGreeting, setBridgeQuestion, queueRef, audioRef, hadNarrationsRef, hadUnskippableRef, unskippableCountRef, onEmptyRef, resetTurn };
}
