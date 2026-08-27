import { useState } from 'react';
import type { GraphEdge, GraphFileRef, GraphNode, SystemGraph } from '../../api/files';
import { SystemGraphCanvas, type GraphSelection } from './SystemGraphCanvas';

interface InlineSystemGraphProps {
  graph: SystemGraph;
  workspacePath: string | null;
  onOpenIogram: () => void;
  onNavigateToLine?: (filePath: string, line: number, endLine?: number) => void;
}

export function InlineSystemGraph({ graph, workspacePath, onOpenIogram, onNavigateToLine }: InlineSystemGraphProps) {
  const [selected, setSelected] = useState<GraphSelection>(null);
  if (!graph.nodes.length && !graph.edges.length) return null;
  const item: GraphNode | GraphEdge | null = selected === null ? null : selected.type === 'node'
    ? graph.nodes.find(node => node.id === selected.id) ?? null
    : graph.edges[selected.idx] ?? null;
  const title = selected?.type === 'node' ? (item as GraphNode | null)?.name : item ? `${(item as GraphEdge).source} → ${(item as GraphEdge).target}` : '';
  const files = item?.files ?? [];
  const openFile = (file: GraphFileRef) => {
    if (!onNavigateToLine) return;
    const path = file.path.startsWith('/') ? file.path : `${workspacePath ?? ''}/${file.path}`;
    onNavigateToLine(path, file.line ?? 1, file.endLine);
  };
  return <section aria-label="Iogram architecture graph" style={{ borderTop: '1px solid var(--color-border)', padding: '7px 10px 0', flexShrink: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-primary)' }}>◈ Iogram</span>
      <button type="button" onClick={onOpenIogram} style={{ background: 'transparent', color: 'var(--color-accent)', border: '1px solid var(--color-accent)', borderRadius: 999, cursor: 'pointer', fontSize: 10, padding: '3px 8px' }}>Open Iogram</button>
    </div>
    <SystemGraphCanvas graph={graph} selected={selected} onSelectionChange={setSelected} style={{ width: '100%', height: 180, display: 'block', border: '1px solid var(--color-border)', borderRadius: 5 }} />
    {item && <div style={{ minHeight: 24, padding: '5px 1px 6px', display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto' }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{title}</span>
      {files.map((file, index) => <button key={`${file.path}-${index}`} type="button" onClick={() => openFile(file)} style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-accent)', cursor: 'pointer', fontSize: 10, padding: '2px 5px', whiteSpace: 'nowrap' }}>{file.label ?? file.path.split('/').pop()}</button>)}
      {!files.length && <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>No file references</span>}
    </div>}
  </section>;
}
