import React, { useState, useEffect, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { useStore } from '../store';
import { postMessage } from '../vscode';

interface Props {
  connectionId: string;
}

type ResultTab = 'data' | 'explain';

export function QueryEditor({ connectionId }: Props) {
  const { queryResult, explainResult, setExplainResult, queryHistory, setLoading, connections, columnCache } = useStore();
  const [query, setQuery] = useState('SELECT * FROM ');
  const [resultTab, setResultTab] = useState<ResultTab>('data');
  const [showHistory, setShowHistory] = useState(false);

  // Load persistent history on mount
  useEffect(() => {
    postMessage({ command: 'getQueryHistory', payload: {} });
  }, []);

  // Build schema map for SQL autocomplete
  const schemaMap = useMemo(() => {
    const connInfo = connections.get(connectionId);
    if (!connInfo) return {};
    const map: Record<string, string[]> = {};
    for (const schema of connInfo.schemas) {
      for (const table of schema.tables) {
        const key = `${schema.name}.${table.name}`;
        const cols = columnCache.get(key);
        if (cols) {
          map[table.name] = cols.map(c => c.name);
          map[key] = cols.map(c => c.name);
        } else {
          map[table.name] = [];
          map[key] = [];
        }
      }
    }
    return map;
  }, [connections, columnCache, connectionId]);

  const sqlExtension = useMemo(() =>
    sql({ dialect: PostgreSQL, schema: schemaMap }),
    [schemaMap]
  );

  function runQuery() {
    if (!query.trim()) return;
    setLoading(true);
    setExplainResult(null);
    setResultTab('data');
    postMessage({ command: 'executeQuery', payload: { connectionId, sql: query } });
    postMessage({
      command: 'saveQueryToHistory',
      payload: { sql: query, connectionId, duration: 0, rowCount: 0, executedAt: Date.now() },
    });
  }

  function runExplain() {
    if (!query.trim()) return;
    setLoading(true);
    setResultTab('explain');
    postMessage({ command: 'explainQuery', payload: { connectionId, sql: query } });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        runExplain();
      } else {
        runQuery();
      }
    }
  }

  function exportCSV() {
    if (!queryResult) return;
    const cols = queryResult.fields.map(f => f.name);
    const header = cols.join(',');
    const rows = queryResult.rows.map(row =>
      cols.map(c => {
        const v = row[c];
        if (v === null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    );
    const csv = [header, ...rows].join('\n');
    downloadFile(csv, 'query-result.csv', 'text/csv');
  }

  function exportJSON() {
    if (!queryResult) return;
    downloadFile(JSON.stringify(queryResult.rows, null, 2), 'query-result.json', 'application/json');
  }

  function downloadFile(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cols = queryResult?.fields ?? [];
  const rows = queryResult?.rows ?? [];

  return (
    <div style={styles.container}>
      {/* ── Editor panel ── */}
      <div style={styles.editorPanel} onKeyDown={handleKeyDown}>
        <div style={styles.editorHeader}>
          <span style={styles.label}>SQL Query</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={styles.hint}>⌘+Enter to run · ⌘+Shift+Enter to EXPLAIN</span>
            <button className="secondary" onClick={() => setShowHistory(h => !h)} style={{ fontSize: 11 }}>
              {showHistory ? '▾' : '▸'} History ({queryHistory.length})
            </button>
            <button className="secondary" onClick={runExplain} style={{ fontSize: 11 }}>
              EXPLAIN
            </button>
            <button onClick={runQuery}>▶ Run</button>
          </div>
        </div>
        <CodeMirror
          value={query}
          onChange={setQuery}
          extensions={[sqlExtension]}
          theme={oneDark}
          height="200px"
          style={{ fontSize: 13 }}
        />
      </div>

      {/* ── History panel ── */}
      {showHistory && (
        <div style={styles.historyPanel}>
          <div style={styles.historyHeader}>
            <span style={styles.label}>History</span>
            <button className="secondary" style={{ fontSize: 10, padding: '1px 6px' }}
              onClick={() => setShowHistory(false)}>✕</button>
          </div>
          <div style={{ maxHeight: 160, overflow: 'auto' }}>
            {queryHistory.length === 0 && (
              <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--pp-text-muted)' }}>No history yet</div>
            )}
            {queryHistory.map((entry, i) => (
              <div
                key={i}
                style={styles.historyItem}
                onClick={() => { setQuery(entry.sql); setShowHistory(false); }}
                title={`${new Date(entry.executedAt).toLocaleString()} · ${entry.duration}ms`}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.sql}
                </span>
                <span style={{ color: 'var(--pp-text-muted)', fontSize: 10, flexShrink: 0, marginLeft: 8 }}>
                  {new Date(entry.executedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Result tabs ── */}
      {(queryResult || explainResult) && (
        <div style={styles.resultPanel}>
          <div style={styles.resultHeader}>
            <div style={{ display: 'flex', gap: 0 }}>
              {queryResult && (
                <button
                  className="secondary"
                  style={{ ...styles.tabBtn, borderBottom: resultTab === 'data' ? '2px solid var(--pp-accent)' : '2px solid transparent' }}
                  onClick={() => setResultTab('data')}
                >
                  Results {queryResult && `(${queryResult.rowCount} rows · ${queryResult.duration}ms)`}
                </button>
              )}
              {explainResult && (
                <button
                  className="secondary"
                  style={{ ...styles.tabBtn, borderBottom: resultTab === 'explain' ? '2px solid var(--pp-accent)' : '2px solid transparent' }}
                  onClick={() => setResultTab('explain')}
                >
                  EXPLAIN
                </button>
              )}
            </div>
            {queryResult && resultTab === 'data' && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="secondary" style={{ fontSize: 11 }} onClick={exportCSV}>↓ CSV</button>
                <button className="secondary" style={{ fontSize: 11 }} onClick={exportJSON}>↓ JSON</button>
              </div>
            )}
          </div>

          {resultTab === 'data' && queryResult && (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {cols.map(c => (
                      <th key={c.name} style={styles.th}>{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} style={styles.tr}>
                      {cols.map(c => (
                        <td key={c.name} style={styles.td}>
                          {row[c.name] === null
                            ? <span style={{ color: 'var(--pp-text-muted)', fontStyle: 'italic' }}>NULL</span>
                            : String(row[c.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {resultTab === 'explain' && explainResult && (
            <pre style={styles.explainPre}>{explainResult}</pre>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  editorPanel: { flexShrink: 0, borderBottom: '1px solid var(--pp-border)' },
  editorHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 16px',
  },
  label: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--pp-text-muted)', fontWeight: 600 },
  hint: { fontSize: 11, color: 'var(--pp-text-muted)' },
  historyPanel: { flexShrink: 0, borderBottom: '1px solid var(--pp-border)', background: 'var(--pp-bg-secondary)' },
  historyHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 16px', borderBottom: '1px solid var(--pp-border)',
  },
  historyItem: {
    display: 'flex', alignItems: 'center',
    padding: '5px 16px', fontSize: 12, fontFamily: 'monospace',
    cursor: 'pointer', color: 'var(--pp-text-muted)',
    borderBottom: '1px solid var(--pp-border)',
  },
  resultPanel: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  resultHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    borderBottom: '1px solid var(--pp-border)', flexShrink: 0,
    background: 'var(--pp-bg-secondary)',
  },
  tabBtn: {
    borderRadius: 0, fontSize: 11, padding: '6px 14px',
    border: 'none', borderBottom: '2px solid transparent',
  },
  tableWrapper: { flex: 1, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    position: 'sticky', top: 0,
    background: 'var(--pp-bg-secondary)',
    padding: '5px 10px',
    textAlign: 'left',
    borderBottom: '1px solid var(--pp-border)',
    borderRight: '1px solid var(--pp-border)',
    fontWeight: 600, fontSize: 11,
  },
  tr: { borderBottom: '1px solid var(--pp-border)' },
  td: { padding: '4px 10px', borderRight: '1px solid var(--pp-border)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  explainPre: {
    flex: 1, margin: 0, overflow: 'auto',
    padding: '14px 18px', fontSize: 12, fontFamily: 'monospace',
    color: '#9cdcfe', background: 'var(--pp-bg)',
    whiteSpace: 'pre-wrap',
  },
};
