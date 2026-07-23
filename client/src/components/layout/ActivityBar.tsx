import type { SidebarView } from '../../types';

interface ActivityBarProps {
  activeView: SidebarView | null;
  onViewChange: (view: SidebarView) => void;
  gitChangeCount?: number;
}

interface NavItem {
  id: SidebarView;
  label: string;
  icon: React.ReactNode;
}

const FolderIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
  </svg>
);

const BranchIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM6 15a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm12-11a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
    <path d="M6 8v8M18 8v2a4 4 0 0 1-4 4H9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
  </svg>
);

const NAV_ITEMS: NavItem[] = [
  { id: 'explorer', label: 'Explorer', icon: <FolderIcon /> },
  { id: 'scm', label: 'Source Control', icon: <BranchIcon /> },
];

export function ActivityBar({ activeView, onViewChange, gitChangeCount = 0 }: ActivityBarProps) {
  return (
    <div
      style={{
        width: 'var(--activity-bar-width)',
        background: 'var(--color-bg-activity-bar)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 4,
        borderRight: '1px solid var(--color-border)',
        flexShrink: 0,
      }}
    >
      {NAV_ITEMS.map(item => {
        const isActive = activeView === item.id;
        const isGitIcon = item.id === 'scm';
        return (
          <button
            key={item.id}
            title={item.label}
            onClick={() => onViewChange(item.id)}
            style={{
              width: '100%',
              height: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isActive ? 'var(--color-icon-active)' : 'var(--color-icon)',
              position: 'relative',
              borderLeft: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
              opacity: isActive ? 1 : 0.7,
              transition: 'opacity 0.1s, color 0.1s',
            }}
            onMouseEnter={e => {
              if (!isActive) (e.currentTarget as HTMLButtonElement).style.opacity = '1';
            }}
            onMouseLeave={e => {
              if (!isActive) (e.currentTarget as HTMLButtonElement).style.opacity = '0.7';
            }}
          >
            {item.icon}
            {isGitIcon && gitChangeCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -4,
                  right: 4,
                  background: 'var(--color-accent)',
                  color: '#fff',
                  borderRadius: '50%',
                  width: 18,
                  height: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                  minWidth: 18,
                }}
              >
                {gitChangeCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
