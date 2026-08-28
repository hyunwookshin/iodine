import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { MouseEvent as RMouseEvent, WheelEvent as RWheelEvent } from 'react';
import type { GraphEdge, GraphNode, SystemGraph } from '../../api/files';

const NODE_WIDTH = 132;
const NODE_HEIGHT = 54;
const DIRECTED = '#7ab0cc';
const BIDIRECTIONAL = '#c8a870';
const UNDIRECTED = '#6a7a8a';

export type GraphSelection = { type: 'node'; id: string } | { type: 'edge'; idx: number } | null;
type PosMap = Record<string, { x: number; y: number }>;

export interface SystemGraphCanvasHandle {
  focusItem: (selection: GraphSelection) => void;
}

interface Props {
  graph: SystemGraph;
  editable?: boolean;
  selected: GraphSelection;
  onSelectionChange: (selection: GraphSelection) => void;
  onGraphChange?: (graph: SystemGraph) => void;
  className?: string;
  style?: React.CSSProperties;
}

function Edge({ edge, posMap, selected, onSelect, markerPrefix }: { edge: GraphEdge; posMap: PosMap; selected: boolean; onSelect: () => void; markerPrefix: string }) {
  const source = posMap[edge.source], target = posMap[edge.target];
  if (!source || !target || edge.source === edge.target) return null;
  const undirected = edge.type === 'undirected';
  const bidirectional = edge.type === 'bidirectional';
  const directed = !undirected && !bidirectional;
  const color = bidirectional ? BIDIRECTIONAL : undirected ? UNDIRECTED : DIRECTED;
  const marker = bidirectional ? `${markerPrefix}-bidi` : `${markerPrefix}-dir`;
  const horizontal = Math.abs(target.x - source.x) >= Math.abs(target.y - source.y);
  let from: { x: number; y: number }, to: { x: number; y: number }, path: string;
  if (horizontal) {
    const sign = target.x >= source.x ? 1 : -1;
    from = { x: source.x + sign * NODE_WIDTH / 2, y: source.y };
    to = { x: target.x - sign * NODE_WIDTH / 2, y: target.y };
    const middle = (from.x + to.x) / 2;
    path = `M ${from.x},${from.y} H ${middle} V ${to.y} H ${to.x}`;
  } else {
    const sign = target.y >= source.y ? 1 : -1;
    from = { x: source.x, y: source.y + sign * NODE_HEIGHT / 2 };
    to = { x: target.x, y: target.y - sign * NODE_HEIGHT / 2 };
    const middle = (from.y + to.y) / 2;
    path = `M ${from.x},${from.y} V ${middle} H ${to.x} V ${to.y}`;
  }
  const labelX = (from.x + to.x) / 2, labelY = (from.y + to.y) / 2;
  return <g>
    {selected && <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={5} opacity={0.35} style={{ pointerEvents: 'none' }} />}
    <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray={undirected ? '6,4' : directed ? '12,8' : undefined}
      style={directed ? { animation: 'edge-flow 0.7s linear infinite' } : undefined}
      markerEnd={!undirected ? `url(#${marker})` : undefined} markerStart={bidirectional ? `url(#${markerPrefix}-bidi-rev)` : undefined} />
    {edge.label && <><rect x={labelX - (edge.label.length * 6.2 + 8) / 2} y={labelY - 8} width={edge.label.length * 6.2 + 8} height={15} fill="var(--color-bg-editor)" rx={3} opacity={0.85} />
      <text x={labelX} y={labelY + 3.5} textAnchor="middle" fill={color} fontSize={9} fontFamily="monospace">{edge.label}</text></>}
    <path d={path} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} onMouseDown={e => e.stopPropagation()} onClick={onSelect} />
  </g>;
}

function Node({ node, pos, dragging, selected, onMouseDown }: { node: GraphNode; pos: { x: number; y: number }; dragging: boolean; selected: boolean; onMouseDown: (event: RMouseEvent<SVGGElement>) => void }) {
  const x = pos.x - NODE_WIDTH / 2, y = pos.y - NODE_HEIGHT / 2;
  return <g onMouseDown={onMouseDown} style={{ cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}>
    {selected && <rect x={x - 3} y={y - 3} width={NODE_WIDTH + 6} height={NODE_HEIGHT + 6} rx={8} fill="none" stroke="var(--color-accent)" strokeWidth={2} opacity={0.8} />}
    <rect x={x} y={y} width={NODE_WIDTH} height={NODE_HEIGHT} rx={6} fill={node.color ?? '#1e4e6e'} stroke="#ffffff28" />
    <text x={pos.x} y={pos.y + (node.subname ? -5 : 5)} textAnchor="middle" dominantBaseline="middle" fill="#ffffffe8" fontSize={12} fontWeight="600">{node.name}</text>
    {node.subname && <text x={pos.x} y={pos.y + 11} textAnchor="middle" dominantBaseline="middle" fill="#ffffff70" fontSize={10}>{node.subname}</text>}
  </g>;
}

export const SystemGraphCanvas = forwardRef<SystemGraphCanvasHandle, Props>(function SystemGraphCanvas({ graph, editable = false, selected, onSelectionChange, onGraphChange, className, style }, ref) {
  const svgRef = useRef<SVGSVGElement>(null);
  const markerPrefix = `graph-arrow-${useId().replace(/:/g, '')}`;
  const [pan, setPan] = useState({ x: 60, y: 60 });
  const [scale, setScale] = useState(1);
  const [drag, setDrag] = useState<{ id: string; mouseX: number; mouseY: number; x: number; y: number } | null>(null);
  const [panStart, setPanStart] = useState<{ mouseX: number; mouseY: number; x: number; y: number } | null>(null);
  const nodePress = useRef<{ id: string; x: number; y: number } | null>(null);
  const panPress = useRef<{ x: number; y: number } | null>(null);
  const posMap = useMemo<PosMap>(() => Object.fromEntries(graph.nodes.map(node => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }])), [graph.nodes]);

  const focusItem = (item: GraphSelection) => {
    if (!item) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const center = { x: rect?.width ? rect.width / 2 : 450, y: rect?.height ? rect.height / 2 : 320 };
    const point = item.type === 'node' ? posMap[item.id] : (() => { const edge = graph.edges[item.idx]; const a = edge && posMap[edge.source], b = edge && posMap[edge.target]; return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : undefined; })();
    if (!point) return;
    setScale(1.2);
    setPan({ x: center.x - point.x * 1.2, y: center.y - point.y * 1.2 });
  };
  useImperativeHandle(ref, () => ({ focusItem }));

  const handleMouseMove = (event: RMouseEvent<SVGSVGElement>) => {
    if (drag && editable && onGraphChange) {
      const dx = (event.clientX - drag.mouseX) / scale, dy = (event.clientY - drag.mouseY) / scale;
      onGraphChange({ ...graph, nodes: graph.nodes.map(node => node.id === drag.id ? { ...node, x: drag.x + dx, y: drag.y + dy } : node) });
    } else if (panStart) setPan({ x: panStart.x + event.clientX - panStart.mouseX, y: panStart.y + event.clientY - panStart.mouseY });
  };
  const handleMouseUp = (event: RMouseEvent<SVGSVGElement>) => {
    if (nodePress.current) {
      const press = nodePress.current;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5) onSelectionChange(selected?.type === 'node' && selected.id === press.id ? null : { type: 'node', id: press.id });
      nodePress.current = null;
    }
    if (panPress.current && Math.hypot(event.clientX - panPress.current.x, event.clientY - panPress.current.y) < 5) onSelectionChange(null);
    panPress.current = null;
    setDrag(null); setPanStart(null);
  };
  const handleWheel = (event: RWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect(); if (!rect) return;
    const mouseX = event.clientX - rect.left, mouseY = event.clientY - rect.top, factor = event.deltaY > 0 ? 0.9 : 1.111;
    setScale(current => { const next = Math.max(0.15, Math.min(5, current * factor)); setPan(previous => ({ x: mouseX - (mouseX - previous.x) * (next / current), y: mouseY - (mouseY - previous.y) * (next / current) })); return next; });
  };

  return <svg ref={svgRef} className={className} style={{ background: 'var(--color-bg-canvas)', cursor: panStart ? 'grabbing' : 'default', ...style }} onMouseDown={event => { panPress.current = { x: event.clientX, y: event.clientY }; setPanStart({ mouseX: event.clientX, mouseY: event.clientY, x: pan.x, y: pan.y }); }} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={handleWheel}>
    <defs><marker id={`${markerPrefix}-dir`} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 Z" fill={DIRECTED} /></marker><marker id={`${markerPrefix}-bidi`} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 Z" fill={BIDIRECTIONAL} /></marker><marker id={`${markerPrefix}-bidi-rev`} viewBox="0 0 10 10" refX="0" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 10 0 L 0 5 L 10 10 Z" fill={BIDIRECTIONAL} /></marker></defs>
    <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
      {graph.edges.map((edge, idx) => <Edge key={idx} edge={edge} posMap={posMap} markerPrefix={markerPrefix} selected={selected?.type === 'edge' && selected.idx === idx} onSelect={() => onSelectionChange(selected?.type === 'edge' && selected.idx === idx ? null : { type: 'edge', idx })} />)}
      {graph.nodes.map(node => <Node key={node.id} node={node} pos={posMap[node.id] ?? { x: 0, y: 0 }} dragging={drag?.id === node.id} selected={selected?.type === 'node' && selected.id === node.id} onMouseDown={event => { event.stopPropagation(); nodePress.current = { id: node.id, x: event.clientX, y: event.clientY }; if (editable) setDrag({ id: node.id, mouseX: event.clientX, mouseY: event.clientY, x: node.x ?? 0, y: node.y ?? 0 }); }} />)}
    </g>
  </svg>;
});
