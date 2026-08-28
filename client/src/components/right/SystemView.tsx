import { useState, useEffect, useRef, useCallback, useMemo, useImperativeHandle, forwardRef, type MouseEvent as RMouseEvent } from 'react';
import Editor from '@monaco-editor/react';
import type { SystemGraph, GraphNode, GraphEdge, GraphFileRef } from '../../api/files';
import type { Provider } from '../../providers';
import { SystemGraphCanvas, type SystemGraphCanvasHandle } from './SystemGraphCanvas';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

// ── Node geometry ─────────────────────────────────────────────────────────────
const NW = 132;  // node width
const NH = 54;   // node height

// ── Arrow colours (SVG markers must have fixed fill, context-stroke not universally supported) ──
const COL_DIRECTED   = '#7ab0cc';
const COL_BIDI       = '#c8a870';
const COL_UNDIRECTED = '#6a7a8a';

/** Force-directed layout (Fruchterman-Reingold).
 *  Nodes repel each other; edges act as springs. Runs 400 iterations with
 *  a cooling schedule and gentle gravity toward the canvas centre.
 *  Naturally reduces edge crossings without imposing a rigid hierarchy. */
function autoLayout(nodes: GraphNode[], edges: GraphEdge[]): Record<string, { x: number; y: number }> {
  if (!nodes.length) return {};

  const CW = 900, CH = 640;   // virtual canvas size
  const IDEAL = 230;           // ideal spring length (~1.7× node width)
  const ITERS = 400;

  // Initialise in a circle so the simulation starts from a reasonable spread
  const pos: Record<string, { x: number; y: number }> = {};
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const r = Math.min(CW, CH) * 0.30;
    pos[n.id] = { x: CW / 2 + r * Math.cos(angle), y: CH / 2 + r * Math.sin(angle) };
  });

  for (let iter = 0; iter < ITERS; iter++) {
    const temp = IDEAL * Math.max(0.02, 1 - iter / ITERS);
    const disp: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) disp[n.id] = { x: 0, y: 0 };

    // Repulsion between every pair of nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].id, b = nodes[j].id;
        const dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const f = (IDEAL * IDEAL) / dist;
        disp[a].x -= f * dx / dist;  disp[a].y -= f * dy / dist;
        disp[b].x += f * dx / dist;  disp[b].y += f * dy / dist;
      }
    }

    // Attraction along edges (both directed and undirected)
    for (const e of edges) {
      const a = e.source, b = e.target;
      if (!pos[a] || !pos[b]) continue;
      const dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = (dist * dist) / IDEAL;
      disp[a].x += f * dx / dist;  disp[a].y += f * dy / dist;
      disp[b].x -= f * dx / dist;  disp[b].y -= f * dy / dist;
    }

    // Apply displacement with temperature cap + weak gravity toward centre
    for (const n of nodes) {
      const fx = disp[n.id].x + (CW / 2 - pos[n.id].x) * 0.008;
      const fy = disp[n.id].y + (CH / 2 - pos[n.id].y) * 0.008;
      const mag = Math.sqrt(fx * fx + fy * fy);
      if (mag > 0) {
        const move = Math.min(mag, temp);
        pos[n.id].x += (fx / mag) * move;
        pos[n.id].y += (fy / mag) * move;
      }
      // Keep within canvas bounds
      pos[n.id].x = Math.max(NW / 2 + 24, Math.min(CW - NW / 2 - 24, pos[n.id].x));
      pos[n.id].y = Math.max(NH / 2 + 24, Math.min(CH - NH / 2 - 24, pos[n.id].y));
    }
  }

  return pos;
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

function EdgeSvg({ edge, posMap, isSelected, onClick }: {
  edge: GraphEdge; posMap: PosMap;
  isSelected?: boolean;
  onClick?: () => void;
}) {
  const src = posMap[edge.source], tgt = posMap[edge.target];
  if (!src || !tgt || edge.source === edge.target) return null;

  const isUnd  = edge.type === 'undirected';
  const isBidi = edge.type === 'bidirectional';
  const isDir  = !isUnd && !isBidi;
  const color  = isBidi ? COL_BIDI : isUnd ? COL_UNDIRECTED : COL_DIRECTED;
  const markId = isBidi ? 'arrow-bidi' : 'arrow-dir';

  // Orthogonal elbow routing: choose horizontal or vertical exit based on
  // which axis has the greater separation between the two node centres.
  const dx = tgt.x - src.x, dy = tgt.y - src.y;
  const useHoriz = Math.abs(dx) >= Math.abs(dy);

  let p1: { x: number; y: number }, p2: { x: number; y: number }, pathD: string;

  if (useHoriz) {
    const sign = dx >= 0 ? 1 : -1;
    p1 = { x: src.x + sign * NW / 2, y: src.y };
    p2 = { x: tgt.x - sign * NW / 2, y: tgt.y };
    const midX = (p1.x + p2.x) / 2;
    pathD = `M ${p1.x},${p1.y} H ${midX} V ${p2.y} H ${p2.x}`;
  } else {
    const sign = dy >= 0 ? 1 : -1;
    p1 = { x: src.x, y: src.y + sign * NH / 2 };
    p2 = { x: tgt.x, y: tgt.y - sign * NH / 2 };
    const midY = (p1.y + p2.y) / 2;
    pathD = `M ${p1.x},${p1.y} V ${midY} H ${p2.x} V ${p2.y}`;
  }

  const lx = (p1.x + p2.x) / 2, ly = (p1.y + p2.y) / 2;

  return (
    <g>
      {/* Selection highlight rendered behind the main path */}
      {isSelected && (
        <path d={pathD} fill="none" stroke="var(--color-accent)" strokeWidth={5} opacity={0.35}
          strokeLinejoin="miter" style={{ pointerEvents: 'none' }} />
      )}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="miter"
        strokeDasharray={isUnd ? '6,4' : isDir ? '12,8' : undefined}
        style={isDir ? { animation: 'edge-flow 0.7s linear infinite' } : undefined}
        markerEnd={!isUnd ? `url(#${markId})` : undefined}
        markerStart={isBidi ? `url(#${markId}-rev)` : undefined}
      />
      {edge.label && (() => {
        const labelW = edge.label.length * 6.2 + 8;
        return (
          <>
            <rect x={lx - labelW / 2} y={ly - 8} width={labelW} height={15}
              fill="var(--color-bg-editor)" rx={3} opacity={0.85} />
            <text x={lx} y={ly + 3.5} textAnchor="middle" fill={color}
              fontSize={9} fontFamily="monospace" style={{ pointerEvents: 'none' }}>
              {edge.label}
            </text>
          </>
        );
      })()}
      {/* Transparent wide hit area for easy clicking */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        strokeLinejoin="miter"
        style={{ cursor: 'pointer' }}
        onMouseDown={e => e.stopPropagation()}
        onClick={onClick}
      />
    </g>
  );
}

function NodeSvg({
  node, pos, isDragging, isSelected,
  onMouseDown,
}: {
  node: GraphNode; pos: { x: number; y: number }; isDragging: boolean; isSelected?: boolean;
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
      {/* Selection ring */}
      {isSelected && (
        <rect x={x - 3} y={y - 3} width={NW + 6} height={NH + 6} rx={8}
          fill="none" stroke="var(--color-accent)" strokeWidth={2} opacity={0.8}
          style={{ pointerEvents: 'none' }} />
      )}
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
    { id: 'client', name: 'Client',   subname: 'Browser',      color: '#1e5e2e' },
    { id: 'api',    name: 'API',      subname: 'Express/3001', color: '#1e4e6e' },
    { id: 'db',     name: 'Database', subname: 'PostgreSQL',   color: '#5e2e2e' },
  ],
  edges: [
    { source: 'client', target: 'api', type: 'bidirectional', label: 'HTTP' },
    { source: 'api',    target: 'db',  type: 'directed',      label: 'SQL'  },
  ],
}, null, 2);

export interface SystemViewHandle {
  /** True when the graph has at least one node or edge. */
  hasGraph: () => boolean;
  /** Reverse lookup by cursor position: find the best-matching node/edge by file + line.
   *  Score 3 = line within ref range, 2 = within 2 lines, 1 = file-only match.
   *  Returns true if a match was found. */
  lookupByPosition: (absoluteFilePath: string, line: number) => boolean;
  /** Reverse lookup by path: find the best-matching node/edge by file or folder path.
   *  Score 2 = exact file match, 1 = file is inside the given folder.
   *  Returns true if a match was found. */
  lookupByPath: (path: string) => string | null;
  /** Like lookupByPath but only updates the selection — no pan/zoom. Safe to call
   *  while the SVG is hidden (display:none) since it doesn't read clientWidth.
   *  Returns the matched node/edge name, or null if nothing matched. */
  selectByPath: (path: string) => string | null;
  /** Pan/zoom to the currently selected node using the SVG's live dimensions.
   *  Must be called while the SVG is visible so clientWidth is non-zero. */
  focusSelected: () => void;
}

interface SystemViewProps {
  workspacePath: string | null;
  provider: Provider;
  model: string;
  graph: SystemGraph;
  graphLoaded: boolean;
  saving: boolean;
  saveError: string | null;
  onGraphChange: (graph: SystemGraph) => void;
  onSave: (graph: SystemGraph) => Promise<void>;
  onNavigateToLine?: (filePath: string, line: number, endLine?: number, startCol?: number, endCol?: number) => void;
}

type Selected = { type: 'node'; id: string } | { type: 'edge'; idx: number } | null;

const fileBasename = (p: string) => p.split('/').pop() ?? p;

export const SystemView = forwardRef<SystemViewHandle, SystemViewProps>(
function SystemView({ workspacePath, provider, model, graph: savedGraph, graphLoaded: loaded, saving, saveError, onGraphChange, onSave, onNavigateToLine }, ref) {

  const [localGraph, setLocalGraph] = useState<SystemGraph>({ nodes: [], edges: [] });
  const [view, setView]             = useState<'graph' | 'json'>('graph');
  const [jsonText, setJsonText]     = useState(SAMPLE_JSON);
  const [jsonError, setJsonError]   = useState<string | null>(null);
  const [dirty, setDirty]           = useState(false);
  const [selected, setSelected]     = useState<Selected>(null);

  // Generate state
  const [generating, setGenerating] = useState(false);
  const [genActivity, setGenActivity] = useState<string>('');

  // The shared canvas owns its viewport; this ref preserves imperative focus
  // for reverse lookup and the active-file chip.
  const canvasRef = useRef<SystemGraphCanvasHandle>(null);

  // ── Initialise from server ─────────────────────────────────────────────────
  useEffect(() => {
    if (!loaded) return;
    const g = ensurePositions(savedGraph);
    setLocalGraph(g);
    setJsonText(JSON.stringify(g, null, 2));
    setDirty(false);
    // Propagate the positioned graph so InlineSystemGraph starts in sync.
    onGraphChange(g);
  // The shared graph is loaded once per workspace. Subsequent local edits are
  // immediately published to the owner and must not reset this editor's dirty state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

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
      onGraphChange(g);
      setJsonError(null);
      setView('graph');
    } catch (e) {
      setJsonError((e as Error).message);
    }
  }, [jsonText]);

  // ── Auto-layout ────────────────────────────────────────────────────────────
  const doAutoLayout = useCallback(() => {
    const lp = autoLayout(localGraph.nodes, localGraph.edges);
    const graph = withPositions(localGraph, lp);
    setLocalGraph(graph);
    onGraphChange(graph);
    setDirty(true);
  }, [localGraph, onGraphChange]);

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
    onGraphChange(g);
    await onSave(g);
    setDirty(false);
  }, [localGraph, view, jsonText, onGraphChange, onSave]);

  // ── Generate graph by exploring the workspace ─────────────────────────────
  const handleGenerate = useCallback(async (): Promise<SystemGraph | null> => {
    if (generating || !workspacePath) return null;
    setGenerating(true);
    setGenActivity('Starting…');
    setJsonError(null);
    let accumulated = '';
    let result: SystemGraph | null = null;

    try {
      const resp = await fetch(`${API_BASE}/api/system-graph/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, provider: provider.id }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      if (!resp.body) throw new Error('No response body');

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
              onGraphChange(g);
              setJsonText(JSON.stringify(g, null, 2));
              setView('graph');
              setDirty(true);
              setJsonError(null);
              result = g;
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
    return result;
  }, [generating, workspacePath, model, provider, onGraphChange]);

  // ── File reference navigation ──────────────────────────────────────────────
  const handleFileRefClick = useCallback((f: GraphFileRef) => {
    if (!onNavigateToLine) return;
    const filePath = f.path.startsWith('/') ? f.path : `${workspacePath ?? ''}/${f.path}`;
    onNavigateToLine(filePath, f.line ?? 1, f.endLine);
  }, [onNavigateToLine, workspacePath]);

  // ── Build posMap for rendering (memoised so lookupByPosition can close over it) ──
  const posMap = useMemo<PosMap>(() => {
    const m: PosMap = {};
    for (const n of localGraph.nodes) m[n.id] = { x: n.x ?? 0, y: n.y ?? 0 };
    return m;
  }, [localGraph.nodes]);

  // ── Reverse lookup: editor position → node/edge ───────────────────────────
  useImperativeHandle(ref, () => ({
    hasGraph: (): boolean => localGraph.nodes.length > 0 || localGraph.edges.length > 0,

    lookupByPosition: (absoluteFilePath: string, currentLine: number): boolean => {
      if (!localGraph.nodes.length && !localGraph.edges.length) return false;

      // Score how well a set of file refs matches the current cursor position.
      // 3 = line is within the ref's range  (narrowest)
      // 2 = line is within 2 lines of the ref's start line
      // 1 = file path matches but no useful line info  (broadest)
      // 0 = no match
      const scoreRefs = (files: GraphFileRef[] | undefined): number => {
        if (!files?.length) return 0;
        let best = 0;
        for (const f of files) {
          const refAbs = f.path.startsWith('/') ? f.path : `${workspacePath ?? ''}/${f.path}`;
          const pathOk = absoluteFilePath === refAbs || absoluteFilePath.endsWith('/' + f.path);
          if (!pathOk) continue;
          if (f.line != null) {
            const end = f.endLine ?? f.line;
            if (currentLine >= f.line && currentLine <= end) { best = Math.max(best, 3); continue; }
            if (Math.abs(currentLine - f.line) <= 2)         { best = Math.max(best, 2); continue; }
          }
          best = Math.max(best, 1);
        }
        return best;
      };

      type Hit = { type: 'node'; id: string; score: number } | { type: 'edge'; idx: number; score: number };
      const hits: Hit[] = [];

      for (const node of localGraph.nodes) {
        const s = scoreRefs(node.files);
        if (s > 0) hits.push({ type: 'node', id: node.id, score: s });
      }
      for (let i = 0; i < localGraph.edges.length; i++) {
        const s = scoreRefs(localGraph.edges[i].files);
        if (s > 0) hits.push({ type: 'edge', idx: i, score: s });
      }

      if (!hits.length) return false;

      hits.sort((a, b) => b.score - a.score);
      const best = hits[0];
      setSelected(best.type === 'node' ? { type: 'node', id: best.id } : { type: 'edge', idx: best.idx });

      canvasRef.current?.focusItem(best.type === 'node' ? { type: 'node', id: best.id } : { type: 'edge', idx: best.idx });

      return true;
    },

    lookupByPath: (path: string): string | null => {
      if (!localGraph.nodes.length && !localGraph.edges.length) return null;

      // Score 2 = exact file match, 1 = file lives inside the given folder path
      const scoreRefs = (files: GraphFileRef[] | undefined): number => {
        if (!files?.length) return 0;
        let best = 0;
        for (const f of files) {
          const refAbs = f.path.startsWith('/') ? f.path : `${workspacePath ?? ''}/${f.path}`;
          if (refAbs === path || path.endsWith('/' + f.path)) { best = Math.max(best, 2); continue; }
          if (refAbs.startsWith(path + '/'))                  { best = Math.max(best, 1); continue; }
        }
        return best;
      };

      type Hit = { type: 'node'; id: string; score: number } | { type: 'edge'; idx: number; score: number };
      const hits: Hit[] = [];

      for (const node of localGraph.nodes) {
        const s = scoreRefs(node.files);
        if (s > 0) hits.push({ type: 'node', id: node.id, score: s });
      }
      for (let i = 0; i < localGraph.edges.length; i++) {
        const s = scoreRefs(localGraph.edges[i].files);
        if (s > 0) hits.push({ type: 'edge', idx: i, score: s });
      }

      if (!hits.length) return null;

      hits.sort((a, b) => b.score - a.score);
      const best = hits[0];
      setSelected(best.type === 'node' ? { type: 'node', id: best.id } : { type: 'edge', idx: best.idx });

      if (best.type === 'node') {
        canvasRef.current?.focusItem({ type: 'node', id: best.id });
        return localGraph.nodes.find(n => n.id === best.id)?.name ?? null;
      } else {
        const edge = localGraph.edges[best.idx];
        canvasRef.current?.focusItem({ type: 'edge', idx: best.idx });
        return edge?.label ?? null;
      }
    },

    selectByPath: (path: string): string | null => {
      if (!localGraph.nodes.length && !localGraph.edges.length) return null;
      const scoreRefs = (files: GraphFileRef[] | undefined): number => {
        if (!files?.length) return 0;
        let best = 0;
        for (const f of files) {
          const refAbs = f.path.startsWith('/') ? f.path : `${workspacePath ?? ''}/${f.path}`;
          if (refAbs === path || path.endsWith('/' + f.path)) { best = Math.max(best, 2); continue; }
          if (refAbs.startsWith(path + '/'))                  { best = Math.max(best, 1); continue; }
        }
        return best;
      };
      type Hit = { type: 'node'; id: string; score: number } | { type: 'edge'; idx: number; score: number };
      const hits: Hit[] = [];
      for (const node of localGraph.nodes) {
        const s = scoreRefs(node.files);
        if (s > 0) hits.push({ type: 'node', id: node.id, score: s });
      }
      for (let i = 0; i < localGraph.edges.length; i++) {
        const s = scoreRefs(localGraph.edges[i].files);
        if (s > 0) hits.push({ type: 'edge', idx: i, score: s });
      }
      if (!hits.length) return null;
      hits.sort((a, b) => b.score - a.score);
      const best = hits[0];
      setSelected(best.type === 'node' ? { type: 'node', id: best.id } : { type: 'edge', idx: best.idx });
      if (best.type === 'node') {
        return localGraph.nodes.find(n => n.id === best.id)?.name ?? null;
      } else {
        const edge = localGraph.edges[best.idx];
        return edge?.label || null;
      }
    },

    focusSelected: (): void => {
      canvasRef.current?.focusItem(selected);
    },

  }), [localGraph, posMap, workspacePath, handleGenerate, selected]);

  // ── Selected item info for the file-references drawer ─────────────────────
  const selectedItem: GraphNode | GraphEdge | null = selected === null ? null
    : selected.type === 'node'
      ? (localGraph.nodes.find(n => n.id === selected.id) ?? null)
      : (localGraph.edges[selected.idx] ?? null);

  const selectedFiles: GraphFileRef[] = selectedItem?.files ?? [];

  const selectedLabel = selected === null ? ''
    : selected.type === 'node'
      ? ((selectedItem as GraphNode | null)?.name ?? selected.id)
      : (() => {
          const e = selectedItem as GraphEdge | null;
          return e ? `${e.source} → ${e.target}` : '';
        })();

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
          <button style={btnBase} onClick={doAutoLayout} title="Re-run force-directed layout">
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
        /* ── SVG graph canvas + file-references drawer ────────────────────── */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <SystemGraphCanvas
            ref={canvasRef}
            graph={localGraph}
            editable
            selected={selected}
            onSelectionChange={setSelected}
            onGraphChange={graph => { setLocalGraph(graph); onGraphChange(graph); setDirty(true); }}
            style={{ flex: 1 }}
          />
          {localGraph.nodes.length === 0 && (
            <div style={{ position: 'absolute', alignSelf: 'center', marginTop: 30, color: 'var(--color-text-secondary)', textAlign: 'center', fontSize: 12 }}>
              No nodes yet. Switch to JSON view to add nodes and edges.
            </div>
          )}

          {/* ── File-references drawer ───────────────────────────────────── */}
          {selected && selectedItem && (
            <div style={{
              borderTop: '1px solid var(--color-border)',
              background: 'var(--color-bg-right-panel)',
              flexShrink: 0,
              maxHeight: 160,
              display: 'flex',
              flexDirection: 'column',
            }}>
              {/* Drawer header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '5px 10px',
                borderBottom: selectedFiles.length ? '1px solid var(--color-border)' : 'none',
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 6 }}>
                  {selectedLabel}
                </span>
                <button
                  onClick={() => setSelected(null)}
                  title="Close"
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-text-secondary)', fontSize: 14, lineHeight: 1,
                    padding: '0 2px', flexShrink: 0 }}
                >
                  ✕
                </button>
              </div>

              {/* File list */}
              {selectedFiles.length === 0 ? (
                <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  No file references
                </div>
              ) : (
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {selectedFiles.map((f, i) => (
                    <button
                      key={i}
                      onClick={() => handleFileRefClick(f)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        width: '100%', padding: '4px 10px',
                        background: 'none', border: 'none',
                        cursor: onNavigateToLine ? 'pointer' : 'default',
                        textAlign: 'left', fontSize: 11,
                        color: 'var(--color-text-primary)',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                    >
                      <span style={{ opacity: 0.6, fontSize: 12, flexShrink: 0 }}>📄</span>
                      <span style={{
                        fontFamily: 'var(--font-mono)', flex: 1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {fileBasename(f.path)}
                        {f.line != null && (
                          <span style={{ color: 'var(--color-text-secondary)' }}>:{f.line}</span>
                        )}
                      </span>
                      {f.label && (
                        <span style={{ color: 'var(--color-text-secondary)', flexShrink: 0, fontSize: 10 }}>
                          {f.label}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
SystemView.displayName = 'SystemView';
