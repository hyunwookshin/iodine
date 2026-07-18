import { useState, useEffect, useRef, useCallback, MouseEvent as RMouseEvent, WheelEvent as RWheelEvent } from 'react';
import Editor from '@monaco-editor/react';
import { useSystemGraph } from '../../hooks/useSystemGraph';
import type { SystemGraph, GraphNode, GraphEdge } from '../../api/files';
import type { Provider } from '../../providers';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

// ── Node geometry ─────────────────────────────────────────────────────────────
const NW = 132;  // node width
const NH = 54;   // node height

// ── Arrow colours (SVG markers must have fixed fill, context-stroke not universally supported) ──
const COL_DIRECTED   = '#7ab0cc';
const COL_BIDI       = '#c8a870';
const COL_UNDIRECTED = '#6a7a8a';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the point on the boundary of the rectangle centered at (tx,ty) that
 *  lies on the line from (fx,fy) → (tx,ty), offset inward by `pad` pixels. */
function rectEdgePt(fx: number, fy: number, tx: number, ty: number, pad = 5) {
  const hw = NW / 2 + pad, hh = NH / 2 + pad;
  const dx = tx - fx, dy = ty - fy;
  if (Math.abs(dx) + Math.abs(dy) < 0.1) return { x: tx, y: ty };
  const cands: number[] = [];
  if (Math.abs(dx) > 0.01) { cands.push((tx - hw - fx) / dx); cands.push((tx + hw - fx) / dx); }
  if (Math.abs(dy) > 0.01) { cands.push((ty - hh - fy) / dy); cands.push((ty + hh - fy) / dy); }
  let best = 1;
  for (const t of cands) {
    if (t <= 0 || t >= best) continue;
    const x = fx + t * dx, y = fy + t * dy;
    if (x >= tx - hw - 1 && x <= tx + hw + 1 && y >= ty - hh - 1 && y <= ty + hh + 1) best = t;
  }
  return { x: fx + best * dx, y: fy + best * dy };
}

/** Hierarchical layout. Groups nodes by their `layer` field (0=clients … 4=external).
 *  For nodes without an explicit layer, infers depth via BFS on directed edges.
 *  Each layer occupies a horizontal row; nodes within a row are evenly spread. */
function autoLayout(nodes: GraphNode[], edges: GraphEdge[]): Record<string, { x: number; y: number }> {
  if (!nodes.length) return {};

  const layerMap = new Map<string, number>();

  // 1. Use explicit layer values where provided
  for (const n of nodes) {
    if (n.layer != null) layerMap.set(n.id, n.layer);
  }

  // 2. Infer layers for remaining nodes via longest-path BFS on directed edges
  const unplaced = nodes.filter(n => !layerMap.has(n.id));
  if (unplaced.length) {
    const ids = new Set(unplaced.map(n => n.id));
    const dirEdges = edges.filter(e => e.type === 'directed' && ids.has(e.source) && ids.has(e.target));
    const inDeg = new Map<string, number>();
    for (const n of unplaced) inDeg.set(n.id, 0);
    for (const e of dirEdges) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);

    const queue: string[] = [];
    for (const [id, deg] of inDeg) {
      if (deg === 0) { queue.push(id); layerMap.set(id, 0); }
    }
    while (queue.length) {
      const id = queue.shift()!;
      const cur = layerMap.get(id) ?? 0;
      for (const e of dirEdges) {
        if (e.source !== id) continue;
        const next = cur + 1;
        if (next > (layerMap.get(e.target) ?? -1)) {
          layerMap.set(e.target, next);
          queue.push(e.target);
        }
      }
    }
    // Any remaining (cycles, isolated) land on layer 0
    for (const n of unplaced) {
      if (!layerMap.has(n.id)) layerMap.set(n.id, 0);
    }
  }

  // 3. Group ids by layer and compute positions
  const byLayer = new Map<number, string[]>();
  for (const [id, layer] of layerMap) {
    const arr = byLayer.get(layer) ?? [];
    arr.push(id);
    byLayer.set(layer, arr);
  }

  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  const LAYER_H = 150;  // vertical gap between layer centres
  const NODE_W  = 210;  // horizontal gap between node centres
  const CX      = 400;  // horizontal centre of canvas

  const result: Record<string, { x: number; y: number }> = {};
  layers.forEach((layer, li) => {
    const ids = byLayer.get(layer)!;
    const totalW = (ids.length - 1) * NODE_W;
    ids.forEach((id, i) => {
      result[id] = { x: CX - totalW / 2 + i * NODE_W, y: 100 + li * LAYER_H };
    });
  });
  return result;
}

/** Merge auto-layout positions into graph nodes. */
function withPositions(g: SystemGraph, lp: Record<string, { x: number; y: number }>): SystemGraph {
  return { ...g, nodes: g.nodes.map(n => ({ ...n, ...lp[n.id] })) };
}

/** Ensure every node has a position; auto-layout those that are missing. */
function ensurePositions(g: SystemGraph): SystemGraph {
  const needsLayout = g.nodes.some(n => n.x == null || n.y == null);
  if (!needsLayout || !g.nodes.length) return g;
  return withPositions(g, autoLayout(g.nodes, g.edges));
}

// ── Sub-components ────────────────────────────────────────────────────────────

type PosMap = Record<string, { x: number; y: number }>;

function EdgeSvg({ edge, posMap }: { edge: GraphEdge; posMap: PosMap }) {
  const src = posMap[edge.source], tgt = posMap[edge.target];
  if (!src || !tgt || edge.source === edge.target) return null;

  const p1 = rectEdgePt(tgt.x, tgt.y, src.x, src.y);  // point on source boundary
  const p2 = rectEdgePt(src.x, src.y, tgt.x, tgt.y);  // point on target boundary
  const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;

  const isUnd  = edge.type === 'undirected';
  const isBidi = edge.type === 'bidirectional';
  const color  = isBidi ? COL_BIDI : isUnd ? COL_UNDIRECTED : COL_DIRECTED;
  const markId = isBidi ? 'arrow-bidi' : 'arrow-dir';

  return (
    <g>
      <line
        x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
        stroke={color} strokeWidth={1.5}
        strokeDasharray={isUnd ? '6,4' : undefined}
        markerEnd={!isUnd ? `url(#${markId})` : undefined}
        markerStart={isBidi ? `url(#${markId}-rev)` : undefined}
      />
      {edge.label && (() => {
        const labelW = edge.label.length * 6.2 + 8;
        return (
          <>
            <rect x={mx - labelW / 2} y={my - 8} width={labelW} height={15}
              fill="var(--color-bg-editor)" rx={3} opacity={0.85} />
            <text x={mx} y={my + 3.5} textAnchor="middle" fill={color}
              fontSize={9} fontFamily="monospace" style={{ pointerEvents: 'none' }}>
              {edge.label}
            </text>
          </>
        );
      })()}
    </g>
  );
}

function NodeSvg({
  node, pos, isDragging,
  onMouseDown,
}: {
  node: GraphNode; pos: { x: number; y: number }; isDragging: boolean;
  onMouseDown: (e: RMouseEvent<SVGGElement>) => void;
}) {
  const fill = node.color ?? '#1e4e6e';
  const x = pos.x - NW / 2, y = pos.y - NH / 2;
  const hasSubname = !!node.subname;

  return (
    <g
      onMouseDown={onMouseDown}
      style={{ cursor: isDragging ? 'grabbing' : 'grab', userSelect: 'none' }}
    >
      <rect x={x} y={y} width={NW} height={NH} rx={6}
        fill={fill} stroke="#ffffff28" strokeWidth={1}
        filter={isDragging ? 'drop-shadow(0 2px 6px #0007)' : undefined}
      />
      <text
        x={pos.x} y={pos.y + (hasSubname ? -5 : 5)}
        textAnchor="middle" dominantBaseline="middle"
        fill="#ffffffe8" fontSize={12} fontWeight="600"
        style={{ pointerEvents: 'none' }}
      >
        {node.name}
      </text>
      {hasSubname && (
        <text
          x={pos.x} y={pos.y + 11}
          textAnchor="middle" dominantBaseline="middle"
          fill="#ffffff70" fontSize={10}
          style={{ pointerEvents: 'none' }}
        >
          {node.subname}
        </text>
      )}
    </g>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const SAMPLE_JSON = JSON.stringify({
  nodes: [
    { id: 'client', name: 'Client',   subname: 'Browser',      color: '#1e5e2e', layer: 0 },
    { id: 'api',    name: 'API',      subname: 'Express/3001', color: '#1e4e6e', layer: 1 },
    { id: 'db',     name: 'Database', subname: 'PostgreSQL',   color: '#5e2e2e', layer: 2 },
  ],
  edges: [
    { source: 'client', target: 'api', type: 'bidirectional', label: 'HTTP' },
    { source: 'api',    target: 'db',  type: 'directed',      label: 'SQL'  },
  ],
}, null, 2);

interface SystemViewProps {
  workspacePath: string | null;
  provider: Provider;
  model: string;
}

export function SystemView({ workspacePath, provider, model }: SystemViewProps) {
  const { graph: savedGraph, loaded, saving, saveError, save } = useSystemGraph(workspacePath);

  const [localGraph, setLocalGraph] = useState<SystemGraph>({ nodes: [], edges: [] });
  const [view, setView]             = useState<'graph' | 'json'>('graph');
  const [jsonText, setJsonText]     = useState(SAMPLE_JSON);
  const [jsonError, setJsonError]   = useState<string | null>(null);
  const [dirty, setDirty]           = useState(false);

  // Generate state
  const [generating, setGenerating] = useState(false);
  const [genActivity, setGenActivity] = useState<string>('');

  // SVG pan / zoom / drag
  const svgRef  = useRef<SVGSVGElement>(null);
  const [pan,   setPan]   = useState({ x: 60, y: 60 });
  const [scale, setScale] = useState(1);

  type DragState = { id: string; mx: number; my: number; nx: number; ny: number };
  type PanState  = { px: number; py: number; mx: number; my: number };
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [panState,  setPanState]  = useState<PanState | null>(null);

  // ── Initialise from server ─────────────────────────────────────────────────
  useEffect(() => {
    if (!loaded) return;
    const g = ensurePositions(savedGraph);
    setLocalGraph(g);
    setJsonText(JSON.stringify(g, null, 2));
    setDirty(false);
  }, [savedGraph, loaded]);

  // ── View switching ─────────────────────────────────────────────────────────
  const switchToJson = useCallback(() => {
    setJsonText(JSON.stringify(localGraph, null, 2));
    setJsonError(null);
    setView('json');
  }, [localGraph]);

  const switchToGraph = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText) as SystemGraph;
      const g = ensurePositions(parsed);
      setLocalGraph(g);
      setJsonError(null);
      setView('graph');
    } catch (e) {
      setJsonError((e as Error).message);
    }
  }, [jsonText]);

  // ── Auto-layout ────────────────────────────────────────────────────────────
  const doAutoLayout = useCallback(() => {
    const lp = autoLayout(localGraph.nodes, localGraph.edges);
    setLocalGraph(g => withPositions(g, lp));
    setDirty(true);
  }, [localGraph]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const doSave = useCallback(async () => {
    let g = localGraph;
    if (view === 'json') {
      try {
        g = JSON.parse(jsonText) as SystemGraph;
        setLocalGraph(g);
        setJsonError(null);
      } catch (e) {
        setJsonError((e as Error).message);
        return;
      }
    }
    await save(g);
    setDirty(false);
  }, [localGraph, view, jsonText, save]);

  // ── SVG mouse events ───────────────────────────────────────────────────────
  const svgCoord = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const r = svgRef.current.getBoundingClientRect();
    return { x: (clientX - r.left - pan.x) / scale, y: (clientY - r.top - pan.y) / scale };
  }, [pan, scale]);

  const handleSvgMouseDown = (e: RMouseEvent<SVGSVGElement>) => {
    setPanState({ px: pan.x, py: pan.y, mx: e.clientX, my: e.clientY });
  };

  const handleNodeMouseDown = (e: RMouseEvent<SVGGElement>, id: string) => {
    e.stopPropagation();
    const node = localGraph.nodes.find(n => n.id === id);
    if (!node) return;
    setDragState({ id, mx: e.clientX, my: e.clientY, nx: node.x ?? 0, ny: node.y ?? 0 });
  };

  const handleMouseMove = (e: RMouseEvent<SVGSVGElement>) => {
    if (dragState) {
      const dx = (e.clientX - dragState.mx) / scale;
      const dy = (e.clientY - dragState.my) / scale;
      setLocalGraph(g => ({
        ...g,
        nodes: g.nodes.map(n =>
          n.id === dragState.id ? { ...n, x: dragState.nx + dx, y: dragState.ny + dy } : n,
        ),
      }));
      setDirty(true);
    } else if (panState) {
      setPan({ x: panState.px + e.clientX - panState.mx, y: panState.py + e.clientY - panState.my });
    }
  };

  const handleMouseUp = () => { setDragState(null); setPanState(null); };

  const handleWheel = (e: RWheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.111;
    // Zoom toward cursor
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    setScale(s => {
      const ns = Math.max(0.15, Math.min(5, s * factor));
      setPan(p => ({ x: mx - (mx - p.x) * (ns / s), y: my - (my - p.y) * (ns / s) }));
      return ns;
    });
  };

  // ── Generate graph by exploring the workspace ─────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (generating || !workspacePath) return;
    setGenerating(true);
    setGenActivity('Starting…');
    setJsonError(null);
    let accumulated = '';

    try {
      const resp = await fetch(`${API_BASE}/api/system-graph/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, provider: provider.id }),
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          let eventName = '', dataStr = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
          }
          if (!dataStr) continue;
          let payload: Record<string, unknown>;
          try { payload = JSON.parse(dataStr); } catch { continue; }

          if (eventName === 'text_delta') {
            accumulated += payload.text as string;
          } else if (eventName === 'tool_call') {
            const name = payload.name as string;
            const input = payload.input as Record<string, unknown>;
            const arg = (Object.values(input)[0] as string) ?? '';
            const icon = name === 'list_directory' ? '📂' : name === 'read_file' ? '📄' : '🔍';
            setGenActivity(`${icon} ${arg || name}`);
          } else if (eventName === 'done') {
            // Strip markdown fences, then extract the outermost JSON object,
            // ignoring any prose the model prepends/appends ("Sure, here is…")
            const stripped = accumulated.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
            const start = stripped.indexOf('{');
            const end = stripped.lastIndexOf('}');
            const clean = start !== -1 && end > start ? stripped.slice(start, end + 1) : stripped;
            try {
              const parsed = JSON.parse(clean) as SystemGraph;
              const g = ensurePositions(parsed);
              setLocalGraph(g);
              setJsonText(JSON.stringify(g, null, 2));
              setView('graph');
              setDirty(true);
              setJsonError(null);
            } catch (e) {
              setJsonError(`Generated JSON is invalid: ${(e as Error).message}`);
            }
          } else if (eventName === 'error') {
            setJsonError(payload.message as string);
          }
        }
      }
    } catch (e) {
      setJsonError((e as Error).message);
    } finally {
      setGenerating(false);
      setGenActivity('');
    }
  }, [generating, workspacePath, model, provider]);

  // ── Build posMap for rendering ─────────────────────────────────────────────
  const posMap: PosMap = {};
  for (const n of localGraph.nodes) posMap[n.id] = { x: n.x ?? 0, y: n.y ?? 0 };

  // ── Render ─────────────────────────────────────────────────────────────────
  const btnBase: React.CSSProperties = {
    background: 'none', border: '1px solid var(--color-border)', borderRadius: 3,
    color: 'var(--color-text-secondary)', fontSize: 11, padding: '2px 8px',
    cursor: 'pointer', flexShrink: 0,
  };
  const btnActive: React.CSSProperties = {
    ...btnBase, background: 'var(--color-bg-hover)', color: 'var(--color-text-primary)',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Toolbar */}
      <div style={{
        height: 35, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
        borderBottom: '1px solid var(--color-border)', flexShrink: 0,
      }}>
        <button style={view === 'graph' ? btnActive : btnBase}
          onClick={view === 'json' ? switchToGraph : undefined}>
          ◈ Graph
        </button>
        <button style={view === 'json' ? btnActive : btnBase}
          onClick={view === 'graph' ? switchToJson : undefined}>
          {'{ }'} JSON
        </button>

        <div style={{ flex: 1 }} />

        {view === 'graph' && (
          <button style={btnBase} onClick={doAutoLayout} title="Re-run hierarchical layout">
            ↺ Layout
          </button>
        )}

        <button
          style={{ ...btnBase, color: generating ? undefined : '#c8a870', borderColor: generating ? undefined : '#c8a87040' }}
          onClick={handleGenerate}
          disabled={generating || !workspacePath}
          title={workspacePath ? 'Explore workspace and generate graph with AI' : 'Open a workspace first'}
        >
          {generating ? '… Analyzing' : '⚡ Generate'}
        </button>

        <button
          style={{ ...btnBase, color: dirty ? '#4ec9b0' : undefined, borderColor: dirty ? '#4ec9b040' : undefined }}
          onClick={doSave}
          disabled={saving || (!dirty && view !== 'json')}
          title="Save graph to disk"
        >
          {saving ? '…' : '✓ Save'}
        </button>
      </div>

      {/* Activity status while generating */}
      {generating && genActivity && (
        <div style={{
          padding: '4px 10px', borderBottom: '1px solid var(--color-border)',
          background: '#c8a87008', flexShrink: 0,
          fontSize: 11, color: 'var(--color-text-secondary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {genActivity}
        </div>
      )}

      {/* JSON error banner */}
      {jsonError && (
        <div style={{ padding: '6px 10px', background: '#f487710a', color: '#f48771', fontSize: 11, flexShrink: 0 }}>
          {jsonError}
        </div>
      )}
      {saveError && (
        <div style={{ padding: '6px 10px', background: '#f487710a', color: '#f48771', fontSize: 11, flexShrink: 0 }}>
          Save failed: {saveError}
        </div>
      )}

      {/* No workspace */}
      {!workspacePath ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--color-text-secondary)', fontSize: 12, padding: 20, textAlign: 'center' }}>
          No workspace open. Open a folder to use the System View.
        </div>
      ) : view === 'json' ? (
        /* ── JSON editor ──────────────────────────────────────────────────── */
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Editor
            height="100%"
            defaultLanguage="json"
            theme={document.documentElement.dataset.theme === 'light' ? 'light' : 'vs-dark'}
            value={jsonText}
            onChange={v => { setJsonText(v ?? ''); setDirty(true); }}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              tabSize: 2,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
            }}
          />
        </div>
      ) : (
        /* ── SVG graph canvas ─────────────────────────────────────────────── */
        <svg
          ref={svgRef}
          style={{ flex: 1, background: 'var(--color-bg-canvas)', cursor: panState ? 'grabbing' : 'default' }}
          onMouseDown={handleSvgMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <defs>
            {/* Forward arrowhead for directed edges */}
            <marker id="arrow-dir" viewBox="0 0 10 10" refX="10" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 Z" fill={COL_DIRECTED} />
            </marker>
            {/* Forward arrowhead for bidirectional edges */}
            <marker id="arrow-bidi" viewBox="0 0 10 10" refX="10" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 Z" fill={COL_BIDI} />
            </marker>
            {/* Reverse arrowhead (marker-start) for bidirectional edges.
                orient="auto" keeps the body aligned along the line toward the target,
                so the tip sits at the source node boundary pointing inward. */}
            <marker id="arrow-bidi-rev" viewBox="0 0 10 10" refX="0" refY="5"
              markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 10 0 L 0 5 L 10 10 Z" fill={COL_BIDI} />
            </marker>
          </defs>

          <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
            {/* Edges first so nodes render on top */}
            {localGraph.edges.map((e, i) => (
              <EdgeSvg key={i} edge={e} posMap={posMap} />
            ))}
            {localGraph.nodes.map(n => (
              <NodeSvg
                key={n.id}
                node={n}
                pos={posMap[n.id] ?? { x: 0, y: 0 }}
                isDragging={dragState?.id === n.id}
                onMouseDown={ev => handleNodeMouseDown(ev, n.id)}
              />
            ))}
          </g>

          {/* Empty state overlay */}
          {localGraph.nodes.length === 0 && (
            <g transform="translate(0,0)">
              <foreignObject x="0" y="0" width="100%" height="100%">
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', height: '100%', gap: 10,
                  color: 'var(--color-text-secondary)', textAlign: 'center', padding: '0 20px',
                } as React.CSSProperties}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.2" style={{ opacity: 0.35 }}>
                    <circle cx="5"  cy="12" r="3" /><circle cx="19" cy="5"  r="3" />
                    <circle cx="19" cy="19" r="3" />
                    <line x1="8" y1="11" x2="16" y2="7" /><line x1="8" y1="13" x2="16" y2="17" />
                  </svg>
                  <div style={{ fontSize: 12 }}>No nodes yet</div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>
                    Switch to JSON view to add nodes and edges.
                  </div>
                </div>
              </foreignObject>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
