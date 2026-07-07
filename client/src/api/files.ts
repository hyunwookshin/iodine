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
