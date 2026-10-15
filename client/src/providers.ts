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
      { id: 'claude-sonnet-5-5',        label: 'Claude Sonnet 5.5'},
      { id: 'claude-opus-5-5',          label: 'Claude Opus 5.5'},
      { id: 'claude-fable-5-1',         label: 'Claude Fable 5.1' },
      { id: 'claude-fable-5',           label: 'Claude Fable 5' },
      { id: 'claude-opus-5',            label: 'Claude Opus 5' },
      { id: 'claude-opus-4-8',          label: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-5',          label: 'Claude Sonnet 5' },
    ],
    setupTitle: 'Anthropic API key',
    setupInstructions:
      'Add your key to .env in the project root, then restart the server:\n\n' +
      '  ANTHROPIC_API_KEY=sk-ant-...\n\n' +
      'Copy .env.example to .env if you do not have one yet.\n\n' +
      'Also works: the file ~/.anthropic/api_key, where Claude Code already stores it, ' +
      'or ANTHROPIC_API_KEY exported in your shell (on Windows: %USERPROFILE%\\.anthropic\\api_key).\n\n' +
      'Windows (PowerShell): set it permanently, then restart your terminal and the server:\n\n' +
      '  [Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "<your-key>", "User")',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    // When adding a new OpenAI model family, update REASONING_MODEL_PREFIXES
    // and RESPONSES_API_MODEL_PREFIXES in server/src/services/openaiAgent.ts,
    // otherwise the model may be routed to the wrong API or miss reasoning handling.
    models: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol'},
      { id: 'gpt-6-astra', label: 'GPT-6 Astra'},
      { id: 'gpt-5.6-sol',   label: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      { id: 'gpt-5.6-luna',  label: 'GPT-5.6 Luna' },
    ],
    setupTitle: 'OpenAI API key',
    setupInstructions:
      'Add your key to .env in the project root, then restart the server:\n\n' +
      '  OPENAI_TOKEN=sk-...\n\n' +
      'Copy .env.example to .env if you do not have one yet. ' +
      'An OPENAI_TOKEN exported in your shell works too.\n\n' +
      'Windows (PowerShell): set it permanently, then restart your terminal and the server:\n\n' +
      '  [Environment]::SetEnvironmentVariable("OPENAI_TOKEN", "<your-key>", "User")',
  },
  {
    id: 'google',
    label: 'Google',
    models: [
      { id: 'gemini-4-argon',        label: 'Gemini 4 Argon' },
      { id: 'gemini-3.8-flash',      label: 'Gemini 3.8 Flash'},
      { id: 'gemini-3.7-flash',      label: 'Gemini 3.7 Flash' },
      { id: 'gemini-3.5-flash',      label: 'Gemini 3.5 Flash' },
    ],
    setupTitle: 'Google AI API key',
    setupInstructions:
      'Add your key to .env in the project root, then restart the server:\n\n' +
      '  GEMINI_API_KEY=AIza...\n\n' +
      'Copy .env.example to .env if you do not have one yet. ' +
      'A GEMINI_API_KEY exported in your shell works too.\n\n' +
      'Windows (PowerShell): set it permanently, then restart your terminal and the server:\n\n' +
      '  [Environment]::SetEnvironmentVariable("GEMINI_API_KEY", "<your-key>", "User")',
  },
];

export const DEFAULT_PROVIDER = PROVIDERS.find((provider) => provider.id === 'anthropic')!;
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
