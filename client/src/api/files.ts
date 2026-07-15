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

export async function deleteNode(nodePath: string): Promise<void> {
  await request(`/api/files?path=${encodeURIComponent(nodePath)}`, { method: 'DELETE' });
}

export async function createNode(nodePath: string, type: 'file' | 'directory'): Promise<void> {
  await request('/api/files/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: nodePath, type }),
  });
}

export async function closeWorkspace(): Promise<void> {
  await request('/api/workspace/close', { method: 'POST' });
}

export async function renameNode(oldPath: string, newName: string): Promise<{ newPath: string }> {
  return request<{ newPath: string }>('/api/files/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath, newName }),
  });
}

export async function putFileContent(path: string, content: string): Promise<void> {
  await request('/api/files/content', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
}

/** Returns the URL to stream an image file from the server. */
export function getImageUrl(path: string): string {
  return `/api/files/image?path=${encodeURIComponent(path)}`;
}

export type ModifiedLine = { line: number; originalLine: string };
export type DeletedBlock = { afterLine: number; lines: string[] };
export type DiffData = { added: number[]; modified: ModifiedLine[]; deleted: DeletedBlock[] };

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

export interface GitCommit {
  hash: string;
  shortHash: string;
  parentHashes: string[];
  message: string;
  author: string;
  relativeDate: string;
  refs: string[];   // e.g. ['HEAD', 'main', 'origin/main']
}

export interface GitBranchInfo {
  name: string;
  shortHash: string;
  isCurrent: boolean;
  upstream: string | null;
}

export interface GitBranches {
  local: GitBranchInfo[];
  remote: { name: string; shortHash: string }[];
}

export async function fetchGitLog(): Promise<GitCommit[]> {
  const data = await request<{ commits: GitCommit[] }>('/api/git/log');
  return data.commits;
}

export async function fetchGitBranches(): Promise<GitBranches> {
  return request<GitBranches>('/api/git/branches');
}

export async function checkoutBranch(branch: string, detach = false): Promise<void> {
  await request('/api/git/checkout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch, detach }),
  });
}

export async function stashChanges(): Promise<void> {
  await request('/api/git/stash', { method: 'POST' });
}

export async function pushBranch(): Promise<void> {
  await request('/api/git/push', { method: 'POST' });
}

export interface GraphNode {
  id: string;
  name: string;
  subname?: string;
  color?: string;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'directed' | 'bidirectional' | 'undirected';
  label?: string;
}

export interface SystemGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function fetchSystemGraph(): Promise<SystemGraph | null> {
  const data = await request<{ graph: SystemGraph | null }>('/api/system-graph');
  return data.graph;
}

export async function putSystemGraph(graph: SystemGraph): Promise<void> {
  await request('/api/system-graph', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph }),
  });
}
