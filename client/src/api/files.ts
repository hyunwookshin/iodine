import type { FileNode, WorkspaceInfo } from '../types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed: ${res.status}`);
  }
  return data as T;
}

export async function openWorkspace(path: string): Promise<WorkspaceInfo> {
  return request<WorkspaceInfo>('/api/workspace/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

export async function getWorkspace(): Promise<WorkspaceInfo> {
  return request<WorkspaceInfo>('/api/workspace');
}

export async function findWorkspace(name: string): Promise<WorkspaceInfo> {
  return request<WorkspaceInfo>('/api/workspace/find', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function fetchFileTree(): Promise<FileNode> {
  const data = await request<{ tree: FileNode }>('/api/files/tree');
  return data.tree;
}

export async function fetchFileContent(path: string): Promise<string> {
  const data = await request<{ content: string }>(`/api/files/content?path=${encodeURIComponent(path)}`);
  return data.content;
}

export async function putFileContent(path: string, content: string): Promise<void> {
  await request('/api/files/content', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
}

export type DeletedBlock = { afterLine: number; lines: string[] };
export type DiffData = { added: number[]; modified: number[]; deleted: DeletedBlock[] };

export async function fetchFileDiff(filePath: string): Promise<DiffData> {
  return request<DiffData>(`/api/git/diff?path=${encodeURIComponent(filePath)}`);
}

export type GitFileStatus = 'unstaged' | 'staged' | 'both';

export async function fetchGitStatus(): Promise<Record<string, GitFileStatus>> {
  const data = await request<{ status: Record<string, GitFileStatus> }>('/api/git/status');
  return data.status;
}

export type ChangeStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '??';
export interface GitChange { path: string; relPath: string; status: ChangeStatus; }
export interface GitChanges { branch: string; staged: GitChange[]; unstaged: GitChange[]; }

export async function fetchGitChanges(): Promise<GitChanges> {
  return request<GitChanges>('/api/git/changes');
}

export async function stageFile(relPath: string): Promise<void> {
  await request('/api/git/stage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relPath }),
  });
}

export async function unstageFile(relPath: string): Promise<void> {
  await request('/api/git/unstage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relPath }),
  });
}

export async function stageAll(): Promise<void> {
  await request('/api/git/stage-all', { method: 'POST' });
}

export async function discardFile(relPath: string, isUntracked: boolean): Promise<void> {
  await request('/api/git/discard', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relPath, isUntracked }),
  });
}

export async function commitChanges(message: string): Promise<void> {
  await request('/api/git/commit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}
