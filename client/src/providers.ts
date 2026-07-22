export interface Model {
  id: string;
  label: string;
}

export interface Provider {
  id: string;
  label: string;
  models: Model[];
  /** Short title shown in the help popover header. */
  setupTitle: string;
  /** Plain-text setup instructions shown in the help popover. */
  setupInstructions: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    models: [
      { id: 'claude-opus-4-8',          label: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-5',          label: 'Claude Sonnet 5' },
      { id: 'claude-haiku-4-5',         label: 'Claude Haiku 4.5' },
      { id: 'claude-sonnet-4-6',        label: 'Claude Sonnet 4.6' },
    ],
    setupTitle: 'Anthropic API key',
    setupInstructions:
      'Provide your key using either method:\n\n' +
      '  • File: ~/.anthropic/api_key\n' +
      '  • Env var: ANTHROPIC_API_KEY\n\n' +
      'If you use Claude Code the key is already stored in ~/.anthropic/api_key.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'gpt-5.6-sol',   label: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      { id: 'gpt-5.6-luna',  label: 'GPT-5.6 Luna' },
      { id: 'gpt-4o',        label: 'GPT-4o' },
      { id: 'o4-mini',       label: 'o4-mini' },
    ],
    setupTitle: 'OpenAI API key',
    setupInstructions: 'Set OPENAI_TOKEN in your environment:\n\n  export OPENAI_TOKEN=sk-...',
  },
  {
    id: 'google',
    label: 'Google',
    models: [
      { id: 'gemini-3.5-flash',      label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)' },
      { id: 'gemini-3.1-flash-lite',  label: 'Gemini 3.1 Flash Lite' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
      { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash' },
    ],
    setupTitle: 'Google AI API key',
    setupInstructions: 'Set GEMINI_API_KEY in your environment:\n\n  export GEMINI_API_KEY=AIza...',
  },
];

export const DEFAULT_PROVIDER = PROVIDERS[0];
export const DEFAULT_MODEL = PROVIDERS[0].models[2].id;
