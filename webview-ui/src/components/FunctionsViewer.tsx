import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { postMessage } from '../vscode';
import type { FunctionInfo } from '../../../src/types';

interface Props {
  connectionId: string;
}

export function FunctionsViewer({ connectionId }: Props) {
  const { functions, setLoading } = useStore();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<FunctionInfo | null>(null);
  const [filterKind, setFilterKind] = useState<'all' | 'function' | 'procedure'>('all');

  useEffect(() => {
    setLoading(true);
    postMessage({ command: 'fetchFunctions', payload: { connectionId } });
  }, [connectionId]);

  const filtered = functions.filter(f => {
    const matchSearch = !search || f.name.toLowerCase().includes(search.toLowerCase()) || f.schema.toLowerCase().includes(search.toLowerCase());
    const matchKind = filterKind === 'all' || f.kind === filterKind;
    return matchSearch && matchKind;
  });

  // Group by schema
  const bySchema = new Map<string, FunctionInfo[]>();
  for (const fn of filtered) {
    const arr = bySchema.get(fn.schema) ?? [];
    arr.push(fn);
    bySchema.set(fn.schema, arr);
  }

  return (
    <div style={S.root}>
      {/* Toolbar */}
      <div style={S.toolbar}>
        <span style={S.title}>Functions & Procedures</span>
        <span className="badge">{functions.length} total</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          style={S.searchInput}
        />
        <select value={filterKind} onChange={e => setFilterKind(e.target.value as typeof filterKind)} style={S.select}>
          <option value="all">All</option>
          <option value="function">Functions</option>
          <option value="procedure">Procedures</option>
        </select>
        <button className="secondary" onClick={() => {
          setLoading(true);
          postMessage({ command: 'fetchFunctions', payload: { connectionId } });
        }}>↻ Refresh</button>
      </div>

      <div style={S.body}>
        {/* List */}
        <div style={S.list}>
          {filtered.length === 0 && (
            <div style={S.empty}>No functions found{search ? ` matching "${search}"` : ''}</div>
          )}
          {Array.from(bySchema.entries()).map(([schema, fns]) => (
            <div key={schema}>
              <div style={S.schemaHeader}>{schema}</div>
              {fns.map(fn => (
                <div
                  key={`${fn.schema}.${fn.name}`}
                  style={{
                    ...S.fnRow,
                    background: selected?.name === fn.name && selected.schema === fn.schema
                      ? 'var(--pp-bg-active)'
                      : undefined,
                  }}
                  onClick={() => setSelected(fn)}
                >
                  <span style={{ color: fn.kind === 'procedure' ? '#c586c0' : '#4ec9b0', fontSize: 11, fontWeight: 700, width: 14, flexShrink: 0 }}>
                    {fn.kind === 'procedure' ? 'P' : 'ƒ'}
                  </span>
                  <span style={S.fnName}>{fn.name}</span>
                  <span style={S.fnLang}>{fn.language}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Detail */}
        <div style={S.detail}>
          {selected ? (
            <>
              <div style={S.detailHeader}>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{selected.schema}.{selected.name}</span>
                  <div style={{ fontSize: 11, color: 'var(--pp-text-muted)', marginTop: 2 }}>
                    ({selected.args || 'no args'}) → {selected.returnType}
                    {' · '}{selected.language}{' · '}{selected.kind}
                  </div>
                </div>
                <button
                  className="secondary"
                  style={{ fontSize: 11 }}
                  onClick={() => {
                    // Copy definition to clipboard via textarea trick
                    const el = document.createElement('textarea');
                    el.value = selected.definition;
                    document.body.appendChild(el);
                    el.select();
                    document.execCommand('copy');
                    document.body.removeChild(el);
                  }}
                >
                  Copy
                </button>
              </div>
              <pre style={S.code}>{selected.definition}</pre>
            </>
          ) : (
            <div style={S.empty}>Select a function to view its definition</div>
          )}
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  root: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 14px',
    borderBottom: '1px solid var(--pp-border)',
    flexShrink: 0,
    background: 'var(--pp-bg-secondary)',
  },
  title: { fontSize: 12, fontWeight: 600, flexShrink: 0 },
  searchInput: {
    background: 'var(--pp-input-bg)', border: '1px solid var(--pp-input-border)',
    color: 'var(--pp-text)', borderRadius: 3, padding: '3px 8px', fontSize: 12, width: 160,
  },
  select: {
    background: 'var(--pp-input-bg)', border: '1px solid var(--pp-input-border)',
    color: 'var(--pp-text)', borderRadius: 3, padding: '3px 6px', fontSize: 12,
  },
  body: { flex: 1, display: 'flex', overflow: 'hidden' },
  list: { width: 240, borderRight: '1px solid var(--pp-border)', overflow: 'auto', flexShrink: 0 },
  schemaHeader: {
    padding: '4px 10px', fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.06em',
    color: 'var(--pp-text-muted)', background: 'var(--pp-bg)',
    borderBottom: '1px solid var(--pp-border)',
    position: 'sticky', top: 0,
  },
  fnRow: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '5px 10px', cursor: 'pointer', fontSize: 12,
    borderBottom: '1px solid var(--pp-border)',
  },
  fnName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  fnLang: { fontSize: 10, color: 'var(--pp-text-muted)', flexShrink: 0 },
  detail: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  detailHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid var(--pp-border)', flexShrink: 0,
  },
  code: {
    flex: 1, overflow: 'auto', margin: 0,
    padding: '14px 16px', fontSize: 12,
    fontFamily: 'monospace', color: '#9cdcfe',
    background: 'var(--pp-bg)',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  empty: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--pp-text-muted)', fontSize: 12, padding: 20,
  },
};
