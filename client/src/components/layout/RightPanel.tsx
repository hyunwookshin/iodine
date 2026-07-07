export function RightPanel({ width }: { width: number }) {
  return (
    <div
      style={{
        width,
        background: 'var(--color-bg-right-panel)',
        borderLeft: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 'var(--sidebar-header-height)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-text-primary)',
          }}
        >
          Simulation
        </span>
      </div>

      {/* Placeholder content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
          gap: 16,
          textAlign: 'center',
          color: 'var(--color-text-secondary)',
        }}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ opacity: 0.35 }}
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
          <path d="M8 22l4-4 4 4" />
          <path d="M4.93 4.93l2.83 2.83" />
          <path d="M19.07 4.93l-2.83 2.83" />
        </svg>

        <div>
          <p style={{ fontSize: 13, marginBottom: 6 }}>
            AI-powered performance simulation
          </p>
          <p style={{ fontSize: 12, lineHeight: 1.6 }}>
            Mock network delays, throttling, and errors for your frontend project.
            Coming soon.
          </p>
        </div>

        <div
          style={{
            background: '#ffffff08',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '10px 14px',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: 'var(--color-text-primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Planned Features
          </p>
          {['HTTP/HTTPS mocking', 'gRPC support', 'LLM API simulation', 'Environment checkpoints', 'Delay & throttle controls'].map(f => (
            <p key={f} style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ color: '#4ec9b0', fontSize: 10 }}>◆</span> {f}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
