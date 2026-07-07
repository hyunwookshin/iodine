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
