import { useEffect, useRef } from 'react';

interface HeadingEntry {
  level: number;
  text: string;
  id: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`~[\]()!]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function parseHeadings(content: string): HeadingEntry[] {
  const seen = new Map<string, number>();
  let codeFence: string | null = null;
  return content.split(/\r?\n/).flatMap(line => {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (codeFence) {
      if (fence
        && fence[1][0] === codeFence[0]
        && fence[1].length >= codeFence.length
        && /^[ \t]*$/.test(fence[2])) {
        codeFence = null;
      }
      return [];
    }
    if (fence && (fence[1][0] === '~' || !fence[2].includes('`'))) {
      codeFence = fence[1];
      return [];
    }
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (!m) return [];
    const text = m[2].trim().replace(/[*_`~[\]()]/g, '');
    const base = slugify(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const id = n === 0 ? base : `${base}-${n}`;
    return [{ level: m[1].length, text, id }];
  });
}

interface OutlinePanelProps {
  content: string | null;
  activeHeadingId?: string | null;
  onNavigate?: (id: string) => void;
}

export function OutlinePanel({ content, activeHeadingId, onNavigate }: OutlinePanelProps) {
  const headings = content ? parseHeadings(content) : [];
  const minLevel = headings.length > 0 ? Math.min(...headings.map(h => h.level)) : 1;
  const activeHeadingRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeHeadingRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeHeadingId]);

  // Find ancestor IDs for the active heading
  const ancestorIds = new Set<string>();
  if (activeHeadingId) {
    const activeIdx = headings.findIndex(h => h.id === activeHeadingId);
    if (activeIdx >= 0) {
      const activeLevel = headings[activeIdx].level;
      const levelsSeen = new Set<number>();
      for (let i = activeIdx - 1; i >= 0; i--) {
        const h = headings[i];
        if (h.level < activeLevel && !levelsSeen.has(h.level)) {
          ancestorIds.add(h.id);
          levelsSeen.add(h.level);
        }
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px 6px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.12em',
        color: 'var(--color-text-secondary)',
        textTransform: 'uppercase',
        userSelect: 'none',
        flexShrink: 0,
        borderBottom: '1px solid var(--color-border)',
        opacity: 0.6,
      }}>
        IOPEDIA
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {headings.length === 0 ? (
          <div style={{
            padding: '16px',
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            fontStyle: 'italic',
            opacity: 0.6,
          }}>
            No headings found.
          </div>
        ) : (
          headings.map((heading, idx) => {
            const isActive = heading.id === activeHeadingId;
            const isAncestor = ancestorIds.has(heading.id);
            const depth = heading.level - minLevel;
            const indent = depth * 13 + 8;

            return (
              <button
                key={`${heading.id}-${idx}`}
                ref={isActive ? activeHeadingRef : null}
                onClick={() => onNavigate?.(heading.id)}
                title={heading.text}
                style={{
                  display: 'block',
                  width: '100%',
                  paddingLeft: indent,
                  paddingRight: 10,
                  paddingTop: 5,
                  paddingBottom: 5,
                  fontSize: 12,
                  textAlign: 'left',
                  background: isActive ? 'var(--color-accent)22' : 'transparent',
                  boxShadow: isActive ? 'inset 3px 0 0 var(--color-accent)' : 'none',
                  color: isActive
                    ? 'var(--color-text-active)'
                    : 'var(--color-text-primary)',
                  fontWeight: isActive ? 700 : isAncestor ? 500 : 400,
                  cursor: 'pointer',
                  border: 'none',
                  borderRadius: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  transition: 'background 0.1s, color 0.1s, box-shadow 0.1s',
                  lineHeight: 1.6,
                  userSelect: 'none',
                }}
                onMouseEnter={e => {
                  if (!isActive) e.currentTarget.style.background = 'var(--color-bg-hover)';
                }}
                onMouseLeave={e => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                {heading.text}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
