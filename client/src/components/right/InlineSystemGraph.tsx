import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphEdge, GraphFileRef, GraphNode, SystemGraph } from '../../api/files';
import { SystemGraphCanvas, type GraphSelection, type SystemGraphCanvasHandle } from './SystemGraphCanvas';

const NODE_W = 132, NODE_H = 54;
// Estimated canvas width — close enough for centering; actual SVG may differ slightly.
const EMBED_W = 330, EMBED_H = 180;

function computeInitialView(nodes: SystemGraph['nodes']) {
  if (!nodes.length) return { initialPan: { x: 60, y: 60 }, initialScale: 1 };
  const xs = nodes.map(n => n.x ?? 0), ys = nodes.map(n => n.y ?? 0);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.min(EMBED_W / (maxX - minX + NODE_W + 40), EMBED_H / (maxY - minY + NODE_H + 40), 0.65);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return { initialScale: s, initialPan: { x: EMBED_W / 2 - cx * s, y: EMBED_H / 2 - cy * s } };
}

interface InlineSystemGraphProps {
  graph: SystemGraph;
  workspacePath: string | null;
  onOpenIogram: () => void;
  onNavigateToLine?: (filePath: string, line: number, endLine?: number) => void;
  /** Node name currently active in the full System View (from activeSystemNode state). */
  activeSystemNode?: string | null;
}

export function InlineSystemGraph({ graph, workspacePath, onOpenIogram, onNavigateToLine, activeSystemNode }: InlineSystemGraphProps) {
  const [selected, setSelected] = useState<GraphSelection>(null);
  const canvasRef = useRef<SystemGraphCanvasHandle>(null);

  // Sync selection + pan whenever the active system node changes externally.
  useEffect(() => {
    if (!activeSystemNode) return;
    const node = graph.nodes.find(n => n.name === activeSystemNode);
    if (!node) return;
    const sel: GraphSelection = { type: 'node', id: node.id };
    setSelected(sel);
    requestAnimationFrame(() => canvasRef.current?.panToItem(sel));
  }, [activeSystemNode, graph.nodes]);

  // Compute initial pan/scale synchronously from node positions.
  // useMemo so it only recalculates when the node set actually changes.
  const { initialPan, initialScale } = useMemo(() => computeInitialView(graph.nodes), [graph.nodes]);

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
    <SystemGraphCanvas ref={canvasRef} graph={graph} selected={selected} onSelectionChange={setSelected} initialPan={initialPan} initialScale={initialScale} style={{ width: '100%', height: 180, display: 'block', border: '1px solid var(--color-border)', borderRadius: 5 }} />
    {item && <div style={{ minHeight: 24, padding: '5px 1px 6px', display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto' }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{title}</span>
      {files.map((file, index) => <button key={`${file.path}-${index}`} type="button" onClick={() => openFile(file)} style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-accent)', cursor: 'pointer', fontSize: 10, padding: '2px 5px', whiteSpace: 'nowrap' }}>{file.label ?? file.path.split('/').pop()}</button>)}
      {!files.length && <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>No file references</span>}
    </div>}
  </section>;
}
