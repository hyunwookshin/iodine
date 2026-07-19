import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import type { Provider } from '../../providers';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

type SectionKey = 'test' | 'build' | 'run';

interface SectionState {
  command: string;
  generating: boolean;
  error: string | null;
}

interface BuildAssistantProps {
  workspacePath: string | null;
  provider: Provider;
  model: string;
  runCommandInTerminal: (cmd: string) => void;
}

const SECTION_META: Array<{ key: SectionKey; label: string; icon: string; placeholder: string }> = [
  { key: 'test',  label: 'Test',         icon: '▶ Test',  placeholder: 'e.g. npm test' },
  { key: 'build', label: 'Build',        icon: '▶ Build', placeholder: 'e.g. npm run build' },
  { key: 'run',   label: 'Build & Run',  icon: '▶ Run',   placeholder: 'e.g. npm run dev' },
];

const sectionStyle: CSSProperties = {
  background: 'var(--color-bg-subtle, rgba(255,255,255,0.03))',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-secondary)',
};

const inputStyle: CSSProperties = {
  width: '100%',
  background: 'var(--color-bg-input, rgba(0,0,0,0.25))',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  color: 'var(--color-text-primary)',
  fontFamily: "'Cascadia Code', 'Fira Code', Menlo, monospace",
  fontSize: 12,
  padding: '6px 8px',
  outline: 'none',
  boxSizing: 'border-box',
};

const btnBase: CSSProperties = {
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  padding: '5px 10px',
  userSelect: 'none',
  flexShrink: 0,
};

function Section({
  meta,
  state,
  onChange,
  onGenerate,
  onExecute,
}: {
  meta: typeof SECTION_META[number];
  state: SectionState;
  onChange: (val: string) => void;
  onGenerate: () => void;
  onExecute: () => void;
}) {
  return (
    <div style={sectionStyle}>
      <span style={labelStyle}>{meta.label}</span>

      <input
        style={inputStyle}
        value={state.command}
        onChange={e => onChange(e.target.value)}
        placeholder={state.generating ? 'Generating…' : meta.placeholder}
        spellCheck={false}
      />

      {state.error && (
        <div style={{ fontSize: 11, color: '#f48771' }}>{state.error}</div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={onGenerate}
          disabled={state.generating}
          style={{
            ...btnBase,
            flex: 1,
            background: state.generating ? 'var(--color-bg-subtle)' : 'var(--color-bg-subtle)',
            color: state.generating ? 'var(--color-text-secondary)' : 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          {state.generating ? '⟳ Generating…' : '✨ Generate'}
        </button>

        <button
          onClick={onExecute}
          disabled={!state.command.trim()}
          style={{
            ...btnBase,
            flex: 1,
            background: state.command.trim() ? '#0e639c' : 'var(--color-bg-subtle)',
            color: state.command.trim() ? '#fff' : 'var(--color-text-secondary)',
            border: state.command.trim() ? 'none' : '1px solid var(--color-border)',
          }}
        >
          {meta.icon}
        </button>
      </div>
    </div>
  );
}

function empty(): SectionState {
  return { command: '', generating: false, error: null };
}

export function BuildAssistant({ workspacePath, provider, model, runCommandInTerminal }: BuildAssistantProps) {
  const [sections, setSections] = useState<Record<SectionKey, SectionState>>({
    test:  empty(),
    build: empty(),
    run:   empty(),
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Load saved config when workspace changes
  useEffect(() => {
    if (!workspacePath) return;
    fetch(`${API_BASE}/api/build-config`)
      .then(r => r.json())
      .then((data: { test?: string; build?: string; run?: string }) => {
        setSections({
          test:  { command: data.test  ?? '', generating: false, error: null },
          build: { command: data.build ?? '', generating: false, error: null },
          run:   { command: data.run   ?? '', generating: false, error: null },
        });
      })
      .catch(() => {});
  }, [workspacePath]);

  const setCommand = useCallback((key: SectionKey, val: string) => {
    setSections(prev => ({ ...prev, [key]: { ...prev[key], command: val } }));
  }, []);

  const generate = useCallback(async (key: SectionKey) => {
    setSections(prev => ({ ...prev, [key]: { ...prev[key], generating: true, error: null, command: '' } }));

    try {
      const resp = await fetch(`${API_BASE}/api/build-config/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: key, provider: provider.id, model }),
      });

      if (!resp.ok || !resp.body) {
        setSections(prev => ({
          ...prev,
          [key]: { ...prev[key], generating: false, error: 'Failed to start generation' },
        }));
        return;
      }

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          let eventName = '', dataStr = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
          }
          if (!dataStr) continue;
          try {
            const payload = JSON.parse(dataStr) as Record<string, unknown>;
            if (eventName === 'text_delta') {
              setSections(prev => ({
                ...prev,
                [key]: { ...prev[key], command: prev[key].command + (payload.text as string) },
              }));
            } else if (eventName === 'done') {
              setSections(prev => ({ ...prev, [key]: { ...prev[key], generating: false } }));
            } else if (eventName === 'error') {
              setSections(prev => ({
                ...prev,
                [key]: { ...prev[key], generating: false, error: payload.message as string },
              }));
            }
          } catch { /* skip malformed */ }
        }
      }
      // Safety: clear generating if stream ended without a done/error event
      setSections(prev => prev[key].generating
        ? { ...prev, [key]: { ...prev[key], generating: false } }
        : prev);
    } catch (e) {
      setSections(prev => ({
        ...prev,
        [key]: { ...prev[key], generating: false, error: (e as Error).message },
      }));
    }
  }, [provider, model]);

  const execute = useCallback((key: SectionKey) => {
    const cmd = sections[key].command.trim();
    if (!cmd) return;
    runCommandInTerminal(cmd);
  }, [sections, runCommandInTerminal]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const resp = await fetch(`${API_BASE}/api/build-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test:  sections.test.command,
          build: sections.build.command,
          run:   sections.run.command,
        }),
      });
      if (resp.ok) {
        setSaveMsg('Saved');
        setTimeout(() => setSaveMsg(null), 2000);
      } else {
        setSaveMsg('Save failed');
      }
    } catch {
      setSaveMsg('Save failed');
    } finally {
      setSaving(false);
    }
  }, [sections]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '10px 14px 8px',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
          Build Assistant
        </div>
        {!workspacePath && (
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Open a workspace to generate commands.
          </div>
        )}
      </div>

      {/* Sections */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 12px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {SECTION_META.map(meta => (
          <Section
            key={meta.key}
            meta={meta}
            state={sections[meta.key]}
            onChange={val => setCommand(meta.key, val)}
            onGenerate={() => generate(meta.key)}
            onExecute={() => execute(meta.key)}
          />
        ))}
      </div>

      {/* Save button */}
      <div style={{
        padding: '12px',
        borderTop: '1px solid var(--color-border)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <button
          onClick={save}
          disabled={saving || !workspacePath}
          style={{
            ...btnBase,
            flex: 1,
            padding: '7px 12px',
            fontSize: 12,
            background: workspacePath ? '#0e639c' : 'var(--color-bg-subtle)',
            color: workspacePath ? '#fff' : 'var(--color-text-secondary)',
            border: workspacePath ? 'none' : '1px solid var(--color-border)',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveMsg && (
          <span style={{ fontSize: 11, color: saveMsg === 'Saved' ? '#4ec9b0' : '#f48771' }}>
            {saveMsg}
          </span>
        )}
      </div>
    </div>
  );
}
