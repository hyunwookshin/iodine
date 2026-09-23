import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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
   *  reacts to real PCM data instead of the idle sine animation. */
  analyserNode?: AnalyserNode | null;
  /** Who is currently speaking — unused for colour (monochrome) but kept for future use. */
  speaking?: 'user' | 'agent' | 'idle';
  /** Controlled mute state. When provided, overrides internal state. */
  isMuted?: boolean;
  /** Called when the user clicks the mute button (for controlled mode). */
  onMuteToggle?: () => void;
}

export function LiveMeetingCard({ containerRef, onClose, analyserNode, isMuted: controlledMuted, onMuteToggle }: LiveMeetingCardProps) {
  const cardRef    = useRef<HTMLDivElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const dragRef    = useRef<{ startMouseX: number; startMouseY: number; startX: number; startY: number } | null>(null);
  const frameRef   = useRef(0);
  const CARD_W = 240, CARD_H = 148, MARGIN = 20;
  const [pos, setPos] = useState({ x: 20, y: 20 });

  // Position at bottom-right of the container on first render.
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    setPos({
      x: Math.max(0, width  - CARD_W - MARGIN),
      y: Math.max(0, height - CARD_H - MARGIN),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [internalMuted, setInternalMuted] = useState(false);
  const isMuted = controlledMuted ?? internalMuted;
  const [seconds, setSeconds] = useState(0);

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

  // rAF loop — draws a smooth bezier waveform on canvas each frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const timeDomain = analyserNode ? new Uint8Array(analyserNode.fftSize) : null;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth  * dpr;
      const H = canvas.clientHeight * dpr;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width  = W;
        canvas.height = H;
      }
      ctx.clearRect(0, 0, W, H);

      // Monochrome vertical gradient — bright at the centreline, fading to transparent
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0,    'rgba(255,255,255,0.0)');
      grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      grad.addColorStop(0.5,  'rgba(255,255,255,0.92)');
      grad.addColorStop(0.75, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1,    'rgba(255,255,255,0.0)');

      ctx.strokeStyle = grad;
      ctx.lineWidth   = 1.5 * dpr;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';

      // Build sample points
      let points: [number, number][];
      if (analyserNode && timeDomain) {
        analyserNode.getByteTimeDomainData(timeDomain);
        // Downsample to ~80 points for smooth rendering
        const stride = Math.max(1, Math.floor(timeDomain.length / 80));
        const samples: number[] = [];
        for (let i = 0; i < timeDomain.length; i += stride) samples.push(timeDomain[i]);
        const N = samples.length;
        points = samples.map((v, i) => [
          (i / (N - 1)) * W,
          H / 2 + ((v - 128) / 128) * H * 0.42,
        ]);
      } else {
        // Idle: gentle animated sine
        const t = Date.now() / 1000;
        const N = 80;
        points = Array.from({ length: N }, (_, i) => {
          const x = (i / (N - 1)) * W;
          const phase = (i / N) * Math.PI * 6 + t * 1.2;
          const y = H / 2 + Math.sin(phase) * H * 0.08;
          return [x, y];
        });
      }

      // Smooth bezier using midpoint method (cardinal spline approximation)
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length - 1; i++) {
        const mx = (points[i][0] + points[i + 1][0]) / 2;
        const my = (points[i][1] + points[i + 1][1]) / 2;
        ctx.quadraticCurveTo(points[i][0], points[i][1], mx, my);
      }
      ctx.lineTo(points[points.length - 1][0], points[points.length - 1][1]);
      ctx.stroke();

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [analyserNode]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

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

      {/* Waveform canvas */}
      <div style={{ flex: 1, padding: '0 12px 12px' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
}
