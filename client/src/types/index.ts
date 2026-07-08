export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children: FileNode[] | null;
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  language: string;
}

export type SidebarView = 'explorer' | 'scm';

export interface WorkspaceInfo {
  path: string | null;
  name: string | null;
}

export type UIBlock =
  | { type: 'text'; content: string }
  | { type: 'tool'; id: string; name: string; input: Record<string, unknown>;
      result?: string; error?: boolean; pending: boolean };

export type UIMessage =
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; blocks: UIBlock[]; isStreaming: boolean };

export interface HistoryMessage { role: 'user' | 'assistant'; content: string; }

export const SONNET_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { id: 'claude-3-7-sonnet-20250219', label: 'Claude Sonnet 3.7' },
] as const;
