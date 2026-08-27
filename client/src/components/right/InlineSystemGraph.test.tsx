// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SystemGraph } from '../../api/files';
import { InlineSystemGraph } from './InlineSystemGraph';
import { SystemGraphCanvas } from './SystemGraphCanvas';

const graph: SystemGraph = {
  nodes: [{ id: 'api', name: 'API', x: 100, y: 100, files: [{ path: 'server/src/app.ts', line: 12, endLine: 18, label: 'app' }] }],
  edges: [],
};

afterEach(cleanup);

describe('InlineSystemGraph', () => {
  it('is hidden when no graph exists and opens Iogram on request', () => {
    const open = vi.fn();
    const { container, rerender } = render(<InlineSystemGraph graph={{ nodes: [], edges: [] }} workspacePath="/project" onOpenIogram={open} />);
    expect(container.innerHTML).toBe('');
    rerender(<InlineSystemGraph graph={graph} workspacePath="/project" onOpenIogram={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Iogram' }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('navigates to a selected item file reference', () => {
    const navigate = vi.fn();
    const { container } = render(<InlineSystemGraph graph={graph} workspacePath="/project" onOpenIogram={vi.fn()} onNavigateToLine={navigate} />);
    const svg = container.querySelector('svg')!;
    fireEvent.mouseDown(container.querySelector('text')!, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(svg, { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByRole('button', { name: 'app' }));
    expect(navigate).toHaveBeenCalledWith('/project/server/src/app.ts', 12, 18);
  });

  it('does not mutate graph data in read-only canvas mode', () => {
    const change = vi.fn();
    const { container } = render(<SystemGraphCanvas graph={graph} selected={null} onSelectionChange={vi.fn()} onGraphChange={change} />);
    const svg = container.querySelector('svg')!;
    fireEvent.mouseDown(container.querySelector('text')!, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 160, clientY: 160 });
    fireEvent.mouseUp(svg, { clientX: 160, clientY: 160 });
    expect(change).not.toHaveBeenCalled();
  });

  it('renders updates from the shared graph owner', () => {
    const { rerender } = render(<InlineSystemGraph graph={graph} workspacePath="/project" onOpenIogram={vi.fn()} />);
    expect(screen.getByText('API')).toBeTruthy();
    rerender(<InlineSystemGraph graph={{ nodes: [{ id: 'worker', name: 'Worker', x: 150, y: 80 }], edges: [] }} workspacePath="/project" onOpenIogram={vi.fn()} />);
    expect(screen.getByText('Worker')).toBeTruthy();
  });
});
