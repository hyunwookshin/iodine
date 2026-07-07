export function WelcomeScreen() {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-secondary)',
        gap: 16,
        userSelect: 'none',
      }}
    >
      <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.15 }}>
        <path d="M14.5 2.5c0 1.5-1.5 4-1.5 4h-2S9.5 4 9.5 2.5a2.5 2.5 0 0 1 5 0zM12 8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12-4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 13.5C4.3 14.4 3 16.1 3 18v1h6v-1c0-1.9-1.3-3.6-3-4.5zM18 13.5c-1.7.9-3 2.6-3 4.5v1h6v-1c0-1.9-1.3-3.6-3-4.5zM12 13c-2.2 0-4 1.8-4 4v2h8v-2c0-2.2-1.8-4-4-4z" />
      </svg>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 18, fontWeight: 300, color: 'var(--color-text-primary)', marginBottom: 8 }}>
          Iodine
        </p>
        <p style={{ fontSize: 13 }}>Open a folder and select a file to start editing.</p>
      </div>
    </div>
  );
}
