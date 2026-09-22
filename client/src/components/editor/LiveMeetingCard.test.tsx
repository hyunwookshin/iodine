// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveMeetingCard } from './LiveMeetingCard';

afterEach(cleanup);

function makeContainerRef(width = 800, height = 600) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  return { current: el } as React.RefObject<HTMLDivElement>;
}

describe('LiveMeetingCard', () => {
  it('renders timer at 0:00 on mount', () => {
    render(<LiveMeetingCard containerRef={makeContainerRef()} onClose={vi.fn()} />);
    expect(screen.getByText('0:00')).toBeTruthy();
  });

  it('mute button toggles between Mute and Unmute', () => {
    render(<LiveMeetingCard containerRef={makeContainerRef()} onClose={vi.fn()} />);
    const btn = screen.getByTitle('Mute');
    fireEvent.click(btn);
    expect(screen.getByTitle('Unmute')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Unmute'));
    expect(screen.getByTitle('Mute')).toBeTruthy();
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    render(<LiveMeetingCard containerRef={makeContainerRef()} onClose={onClose} />);
    fireEvent.click(screen.getByTitle('End meeting'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('drag moves card position within container bounds', () => {
    const containerRef = makeContainerRef(800, 600);
    const { container } = render(<LiveMeetingCard containerRef={containerRef} onClose={vi.fn()} />);
    const card = container.firstChild as HTMLElement;

    // Card starts at { x: 20, y: 20 }
    expect(card.style.left).toBe('20px');
    expect(card.style.top).toBe('20px');

    // Mousedown on header to start drag at origin (0, 0)
    const header = card.firstChild as HTMLElement;
    fireEvent.mouseDown(header, { clientX: 0, clientY: 0 });

    // Drag +100, +50 from start — wrap in act() so React flushes the setPos update
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 50, bubbles: true })); });

    // New position: startX(20) + dx(100) = 120, startY(20) + dy(50) = 70
    expect(card.style.left).toBe('120px');
    expect(card.style.top).toBe('70px');

    // Release
    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  });

  it('clamps drag to container right and bottom edges', () => {
    const containerRef = makeContainerRef(200, 150);
    const { container } = render(<LiveMeetingCard containerRef={containerRef} onClose={vi.fn()} />);
    const card = container.firstChild as HTMLElement;
    const header = card.firstChild as HTMLElement;

    fireEvent.mouseDown(header, { clientX: 0, clientY: 0 });
    // Try to drag far outside bounds
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 9999, clientY: 9999, bubbles: true })); });

    // Card width/height are 0 in happy-dom so max is containerWidth - 0 = 200, containerHeight - 0 = 150
    expect(parseInt(card.style.left)).toBeLessThanOrEqual(200);
    expect(parseInt(card.style.top)).toBeLessThanOrEqual(150);

    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  });
});
