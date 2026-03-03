import React, { useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { useStore } from '../store';
import { postMessage } from '../vscode';

interface Props {
  connectionId: string;
  onClose: () => void;
}

export function CreateViewEditor({ connectionId, onClose }: Props) {
  const { connections } = useStore();
  const connInfo = connections.get(connectionId);
  const schemas = connInfo?.schemas.map(s => s.name) ?? ['public'];

  const [schema, setSchema] = useState(schemas[0] ?? 'public');
  const [name, setName] = useState('');
  const [definition, setDefinition] = useState('SELECT\n  -- write your view query here\n  1 AS id');
  const [saving, setSaving] = useState(false);

  function handleCreate() {
    if (!name.trim() || !definition.trim()) return;
    setSaving(true);
    postMessage({
      command: 'createView',
      payload: { connectionId, schema, name: name.trim(), definition },
    });
    onClose();
  }

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={S.header}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Create View</span>
          <button className="secondary" style={{ padding: '2px 8px' }} onClick={onClose}>✕</button>
        </div>

        <div style={S.body}>
          <div style={S.row}>
            <label style={S.label}>Schema</label>
            <select value={schema} onChange={e => setSchema(e.target.value)} style={S.select}>
              {schemas.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={S.row}>
            <label style={S.label}>View name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value.replace(/\s/g, '_').toLowerCase())}
              placeholder="my_view"
              style={S.input}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 6 }}>
            <label style={S.label}>SELECT definition</label>
            <div style={{ marginTop: 4, border: '1px solid var(--pp-border)', borderRadius: 3, overflow: 'hidden' }}>
              <CodeMirror
                value={definition}
                onChange={setDefinition}
                extensions={[sql()]}
                theme={oneDark}
                height="240px"
                style={{ fontSize: 12 }}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--pp-text-muted)', marginTop: 4 }}>
              Will execute: <code style={{ fontFamily: 'monospace' }}>CREATE OR REPLACE VIEW "{schema}"."{name || '…'}" AS {definition.slice(0, 40)}…</code>
            </div>
          </div>
        </div>

        <div style={S.footer}>
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button onClick={handleCreate} disabled={!name.trim() || !definition.trim() || saving}>
            {saving ? 'Creating…' : 'Create View'}
          </button>
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal: { background: 'var(--pp-bg-secondary)', border: '1px solid var(--pp-border)', borderRadius: 6, width: 680, maxWidth: '96vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.6)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid var(--pp-border)', flexShrink: 0 },
  body: { flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 18px', borderTop: '1px solid var(--pp-border)', flexShrink: 0 },
  row: { display: 'flex', alignItems: 'center', gap: 12 },
  label: { fontSize: 12, fontWeight: 500, width: 90, flexShrink: 0 },
  input: { background: 'var(--pp-input-bg)', border: '1px solid var(--pp-input-border)', color: 'var(--pp-text)', borderRadius: 3, padding: '5px 8px', fontSize: 13, flex: 1 },
  select: { background: 'var(--pp-input-bg)', border: '1px solid var(--pp-input-border)', color: 'var(--pp-text)', borderRadius: 3, padding: '5px 8px', fontSize: 13 },
};
