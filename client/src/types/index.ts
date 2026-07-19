export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children: FileNode[] | null;
  /** Whether this node is a symbolic link */
  isSymlink?: boolean;
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  language: string;
  isImage?: boolean;
  isDirectory?: boolean;
}

export type SidebarView = 'explorer' | 'scm';

export interface WorkspaceInfo {
  path: string | null;
  name: string | null;
}

export type UIBlock =
  | { type: 'text'; content: string }
  | { type: 'thought'; content: string }
  | { type: 'tool'; id: string; name: string; input: Record<string, unknown>;
      result?: string; error?: boolean; pending: boolean }
  | { type: 'command-approval'; id: string; command: string; reason: string; cwd: string | null;
      longRunning: boolean; status: 'pending' | 'approved' | 'rejected'; output: string };

export type UIMessage =
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; blocks: UIBlock[]; isStreaming: boolean };

export interface HistoryMessage { role: 'user' | 'assistant'; content: string; }

export const SONNET_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { id: 'claude-3-7-sonnet-20250219', label: 'Claude Sonnet 3.7' },
] as const;
