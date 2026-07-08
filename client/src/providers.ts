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
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-3-7-sonnet-20250219', label: 'Claude Sonnet 3.7' },
    ],
    setupTitle: 'Anthropic API key',
    setupInstructions:
      'Provide your key using either method:\n\n' +
      '  • File: ~/.anthropic/api_key\n' +
      '  • Env var: ANTHROPIC_API_KEY\n\n' +
      'If you use Claude Code the key is already stored in ~/.anthropic/api_key.',
  },
  // To add a new provider, append an entry here. No other file needs to change
  // until the server-side integration is wired up.
  //
  // {
  //   id: 'openai',
  //   label: 'OpenAI',
  //   models: [{ id: 'gpt-4o', label: 'GPT-4o' }],
  //   setupTitle: 'OpenAI API key',
  //   setupInstructions: 'Set OPENAI_API_KEY in your environment.',
  // },
  // {
  //   id: 'google',
  //   label: 'Google',
  //   models: [{ id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }],
  //   setupTitle: 'Google AI API key',
  //   setupInstructions: 'Set GOOGLE_API_KEY in your environment.',
  // },
];

export const DEFAULT_PROVIDER = PROVIDERS[0];
export const DEFAULT_MODEL = PROVIDERS[0].models[0].id;
