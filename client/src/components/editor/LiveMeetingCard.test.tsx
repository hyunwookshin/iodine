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

function makeAnalyserNode(fillValue = 128): AnalyserNode {
  return {
    frequencyBinCount: 1024,
    getByteFrequencyData: vi.fn((arr: Uint8Array) => arr.fill(fillValue)),
  } as unknown as AnalyserNode;
}

describe('LiveMeetingCard', () => {
  it('renders timer at 0:00 on mount', () => {
    render(<LiveMeetingCard containerRef={makeContainerRef()} onClose={vi.fn()} />);
    expect(screen.getByText('0:00')).toBeTruthy();
  });

  it('mute button toggles between Mute and Unmute', () => {
    render(<LiveMeetingCard containerRef={makeContainerRef()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Mute'));
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
    const { container } = render(<LiveMeetingCard containerRef={makeContainerRef()} onClose={vi.fn()} />);
    const card = container.firstChild as HTMLElement;
    expect(card.style.left).toBe('20px');
    expect(card.style.top).toBe('20px');

    fireEvent.mouseDown(card.firstChild as HTMLElement, { clientX: 0, clientY: 0 });
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 50, bubbles: true })); });

    // startX(20) + dx(100) = 120, startY(20) + dy(50) = 70
    expect(card.style.left).toBe('120px');
    expect(card.style.top).toBe('70px');

    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  });

  it('clamps drag to container right and bottom edges', () => {
    const { container } = render(<LiveMeetingCard containerRef={makeContainerRef(200, 150)} onClose={vi.fn()} />);
    const card = container.firstChild as HTMLElement;

    fireEvent.mouseDown(card.firstChild as HTMLElement, { clientX: 0, clientY: 0 });
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 9999, clientY: 9999, bubbles: true })); });

    expect(parseInt(card.style.left)).toBeLessThanOrEqual(200);
    expect(parseInt(card.style.top)).toBeLessThanOrEqual(150);

    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  });

  it('uses CSS animation when no analyserNode is provided', () => {
    const { container } = render(<LiveMeetingCard containerRef={makeContainerRef()} onClose={vi.fn()} />);
    const firstBar = container.querySelector('[style*="meeting-wave"]');
    expect(firstBar).toBeTruthy();
  });

  it('switches to rAF-driven inline transforms when analyserNode is provided', () => {
    let rafCb: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafCb = cb; return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const { container } = render(
      <LiveMeetingCard containerRef={makeContainerRef()} onClose={vi.fn()} analyserNode={makeAnalyserNode(200)} />,
    );

    // Fire one rAF tick — fillValue 200/255 ≈ 0.78, clamped to max(0.05, 0.78)
    act(() => { rafCb?.(0); });

    // Bars should now use inline scaleY transforms, not the CSS animation
    const bars = container.querySelectorAll('[style*="scaleY"]');
    expect(bars.length).toBe(26);
    expect((bars[0] as HTMLElement).style.animation).toBe('');

    vi.unstubAllGlobals();
  });

  it('colours bars white when user is speaking and teal when agent is speaking', () => {
    const { container, rerender } = render(
      <LiveMeetingCard containerRef={makeContainerRef()} onClose={vi.fn()} speaking="user" />,
    );
    const firstBar = () => container.querySelector('.waveform-bar') as HTMLElement
      ?? container.querySelectorAll('[style*="flex: 1"]')[0] as HTMLElement;

    // Get all bar divs (inside the waveform container)
    const getFirstBar = () => {
      const waveform = container.firstChild?.lastChild as HTMLElement;
      return waveform?.firstChild as HTMLElement;
    };

    expect(getFirstBar().style.background).toContain('255, 255, 255');

    rerender(<LiveMeetingCard containerRef={makeContainerRef()} onClose={vi.fn()} speaking="agent" />);
    expect(getFirstBar().style.background).toBe('#4ec9b0');
  });
});
