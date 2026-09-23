import { useEffect, useRef, useState } from 'react';

const BAR_COUNT = 26;
const USER_COLOR = 'rgba(255,255,255,0.88)';
const AGENT_COLOR = '#4ec9b0';

function MicIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface LiveMeetingCardProps {
  containerRef: React.RefObject<HTMLDivElement>;
  onClose: () => void;
  /** Live AnalyserNode from the active AudioContext. When provided the waveform
   *  reacts to real frequency data instead of the CSS idle animation. */
  analyserNode?: AnalyserNode | null;
  /** Who is currently speaking — controls bar colour. */
  speaking?: 'user' | 'agent' | 'idle';
  /** Controlled mute state. When provided, overrides internal state. */
  isMuted?: boolean;
  /** Called when the user clicks the mute button (for controlled mode). */
  onMuteToggle?: () => void;
}

export function LiveMeetingCard({ containerRef, onClose, analyserNode, speaking = 'idle', isMuted: controlledMuted, onMuteToggle }: LiveMeetingCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startMouseX: number; startMouseY: number; startX: number; startY: number } | null>(null);
  const frameRef = useRef(0);
  const [pos, setPos] = useState({ x: 20, y: 20 });
  const [internalMuted, setInternalMuted] = useState(false);
  const isMuted = controlledMuted ?? internalMuted;
  const [seconds, setSeconds] = useState(0);
  const [barScales, setBarScales] = useState<number[]>(() => Array(BAR_COUNT).fill(0));

  // Timer
  useEffect(() => {
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Drag — window-level listeners so fast mouse moves don't break tracking
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current || !containerRef.current || !cardRef.current) return;
      const { startMouseX, startMouseY, startX, startY } = dragRef.current;
      const cRect = containerRef.current.getBoundingClientRect();
      const cardW = cardRef.current.offsetWidth;
      const cardH = cardRef.current.offsetHeight;
      const newX = Math.max(0, Math.min(startX + e.clientX - startMouseX, cRect.width - cardW));
      const newY = Math.max(0, Math.min(startY + e.clientY - startMouseY, cRect.height - cardH));
      setPos({ x: newX, y: newY });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [containerRef]);

  // rAF loop — reads frequency data from analyserNode each frame
  useEffect(() => {
    if (!analyserNode) {
      setBarScales(Array(BAR_COUNT).fill(0));
      return;
    }
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    const step = Math.max(1, Math.floor(data.length / BAR_COUNT));
    const tick = () => {
      analyserNode.getByteFrequencyData(data);
      setBarScales(Array.from({ length: BAR_COUNT }, (_, i) =>
        Math.max(0.05, data[i * step] / 255),
      ));
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [analyserNode]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const barColor = speaking === 'user' ? USER_COLOR : AGENT_COLOR;

  return (
    <div
      ref={cardRef}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: 240,
        height: 148,
        background: '#0d0d0d',
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 10px 44px rgba(0,0,0,0.75)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 10,
        userSelect: 'none',
      }}
    >
      {/* Header — drag handle */}
      <div
        onMouseDown={e => {
          e.preventDefault();
          dragRef.current = { startMouseX: e.clientX, startMouseY: e.clientY, startX: pos.x, startY: pos.y };
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          cursor: dragRef.current ? 'grabbing' : 'grab',
          flexShrink: 0,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#4ec9b0',
            display: 'inline-block',
            boxShadow: '0 0 7px #4ec9b088',
            animation: 'meeting-dot-pulse 2s ease-in-out infinite',
          }} />
          {formatTime(seconds)}
        </span>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => onMuteToggle ? onMuteToggle() : setInternalMuted(m => !m)}
            title={isMuted ? 'Unmute' : 'Mute'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: isMuted ? '#f48771' : 'rgba(255,255,255,0.38)',
              padding: '4px', lineHeight: 0,
              borderRadius: 4,
            }}
          >
            {isMuted ? <MicOffIcon /> : <MicIcon />}
          </button>
          <button
            type="button"
            onClick={onClose}
            title="End meeting"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.38)',
              padding: '4px', lineHeight: 0,
              borderRadius: 4,
            }}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* Waveform — CSS animation when idle, rAF-driven when analyserNode is live */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', padding: '0 10px 12px', gap: 3 }}>
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: '100%',
              borderRadius: 2,
              background: barColor,
              transformOrigin: 'bottom',
              transition: analyserNode ? 'background 400ms ease' : undefined,
              ...(analyserNode
                ? { transform: `scaleY(${barScales[i]})` }
                : {
                    animation: 'meeting-wave 1.7s ease-in-out infinite',
                    animationDelay: `${-(i * 0.068) % 1.7}s`,
                  }
              ),
            }}
          />
        ))}
      </div>
    </div>
  );
}
