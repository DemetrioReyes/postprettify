import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { postMessage } from '../vscode';

interface Props {
  onNewConnection: () => void;
  onCreateTable: () => void;
  onCreateView: () => void;
  width: number;
  onWidthChange: (w: number) => void;
}

export function Sidebar({ onNewConnection, onCreateTable, onCreateView, width, onWidthChange }: Props) {
  const { connections, savedConnections, activeView, setActiveView } = useStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hoveredConn, setHoveredConn] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<Set<string>>(new Set());
  const [schemaDialog, setSchemaDialog] = useState<{ connectionId: string; mode: 'create' | 'drop'; schema?: string } | null>(null);
  const [newSchemaName, setNewSchemaName] = useState('');
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(width);

  // Auto-expand when a new connection is added
  useEffect(() => {
    setExpanded(prev => {
      const next = new Set(prev);
      for (const [id, { schemas }] of connections.entries()) {
        next.add(`conn:${id}`);
        if (schemas.length > 0) next.add(`schema:${id}:${schemas[0].name}`);
      }
      return next;
    });
    setReconnecting(prev => {
      const next = new Set(prev);
      for (const id of connections.keys()) next.delete(id);
      return next;
    });
  }, [connections.size]);

  // ─── Resize drag ───────────────────────────────────────────────────────────

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const newW = Math.max(160, Math.min(400, startW.current + delta));
      onWidthChange(newW);
    }
    function onMouseUp() {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onWidthChange]);

  // ─── Tree helpers ──────────────────────────────────────────────────────────

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function openTable(connectionId: string, schema: string, table: string) {
    setActiveView({ kind: 'table', connectionId, schema, table });
    postMessage({ command: 'fetchTableData', payload: { connectionId, schema, table, page: 1, pageSize: 50 } });
    postMessage({ command: 'fetchColumns', payload: { connectionId, schema, table } });
  }

  function openQueryEditor(connectionId: string) {
    setActiveView({ kind: 'query', connectionId });
  }

  function openERD(connectionId: string) {
    setActiveView({ kind: 'erd', connectionId });
    postMessage({ command: 'fetchForeignKeys', payload: { connectionId } });
  }

  function openFunctions(connectionId: string) {
    setActiveView({ kind: 'functions', connectionId });
  }

  function disconnect(connectionId: string) {
    postMessage({ command: 'disconnect', payload: { connectionId } });
  }

  function reconnect(connectionId: string) {
    setReconnecting(prev => new Set(prev).add(connectionId));
    postMessage({ command: 'reconnect', payload: { connectionId } });
  }

  function deleteConnection(connectionId: string) {
    postMessage({ command: 'deleteConnection', payload: { connectionId } });
  }

  function dropView(connectionId: string, schema: string, name: string) {
    if (!confirm(`Drop view "${schema}.${name}"?`)) return;
    postMessage({ command: 'dropView', payload: { connectionId, schema, name } });
  }

  function dropTable(connectionId: string, schema: string, name: string) {
    if (!confirm(`Drop table "${schema}.${name}"? This cannot be undone.`)) return;
    postMessage({ command: 'dropTable', payload: { connectionId, schema, table: name } });
  }

  function handleCreateSchema() {
    if (!schemaDialog || !newSchemaName.trim()) return;
    postMessage({ command: 'createSchema', payload: { connectionId: schemaDialog.connectionId, name: newSchemaName.trim() } });
    setSchemaDialog(null);
    setNewSchemaName('');
  }

  function handleDropSchema(connectionId: string, schema: string) {
    if (!confirm(`Drop schema "${schema}" and all its objects? This cannot be undone.`)) return;
    postMessage({ command: 'dropSchema', payload: { connectionId, name: schema, cascade: true } });
  }

  const inactiveConnections = savedConnections.filter(c => !connections.has(c.id));
  const hasAnyConnection = connections.size > 0 || inactiveConnections.length > 0;

  return (
    <>
      <aside style={{ ...styles.sidebar, width }}>
        <div style={styles.header}>
          <span style={styles.headerLabel}>Connections</span>
          <div style={{ display: 'flex', gap: 2 }}>
            {connections.size > 0 && (
              <>
                <button style={styles.addBtn} onClick={onCreateView} title="New view">👁</button>
                <button style={styles.addBtn} onClick={onCreateTable} title="New table">▦</button>
              </>
            )}
            <button style={styles.addBtn} onClick={onNewConnection} title="New connection">＋</button>
          </div>
        </div>

        <div style={styles.list}>
          {!hasAnyConnection && (
            <div style={styles.empty}>
              No connections.{' '}
              <span style={styles.link} onClick={onNewConnection}>Add one</span>
            </div>
          )}

          {/* ── Active connections ── */}
          {Array.from(connections.entries()).map(([id, { config, schemas }]) => {
            const connKey = `conn:${id}`;
            const isExpanded = expanded.has(connKey);
            const isActive = activeView.kind !== 'welcome' && 'connectionId' in activeView && activeView.connectionId === id;
            const isHovered = hoveredConn === `conn:${id}`;

            return (
              <div key={id}>
                {/* Connection row */}
                <div
                  style={{ ...styles.connRow, background: isActive ? 'var(--pp-bg-active)' : isHovered ? 'var(--pp-bg-hover)' : undefined }}
                  onClick={() => toggle(connKey)}
                  onMouseEnter={() => setHoveredConn(`conn:${id}`)}
                  onMouseLeave={() => setHoveredConn(null)}
                >
                  <span style={styles.chevron}>{isExpanded ? '▾' : '▸'}</span>
                  <span style={styles.connIcon}>🟢</span>
                  <span style={styles.connName} title={`${config.host}:${config.port}/${config.database}`}>
                    {config.name}
                  </span>
                  <div style={{ ...styles.connActions, opacity: isHovered ? 1 : 0 }}>
                    <ActionBtn title="Query editor" onClick={e => { e.stopPropagation(); openQueryEditor(id); }}>SQL</ActionBtn>
                    <ActionBtn title="ERD diagram" onClick={e => { e.stopPropagation(); openERD(id); }}>ERD</ActionBtn>
                    <ActionBtn title="Functions" onClick={e => { e.stopPropagation(); openFunctions(id); }}>ƒ</ActionBtn>
                    <ActionBtn title="Disconnect" onClick={e => { e.stopPropagation(); disconnect(id); }}>✕</ActionBtn>
                  </div>
                </div>

                {/* Schemas */}
                {isExpanded && schemas.map(schema => {
                  const schemaKey = `schema:${id}:${schema.name}`;
                  const schemaExpanded = expanded.has(schemaKey);
                  const isHovSchema = hoveredConn === schemaKey;
                  const tables = schema.tables.filter(t => t.type === 'table');
                  const views = schema.tables.filter(t => t.type === 'view');

                  return (
                    <div key={schema.name}>
                      <div
                        style={{ ...styles.schemaRow, background: isHovSchema ? 'var(--pp-bg-hover)' : undefined }}
                        onClick={() => toggle(schemaKey)}
                        onMouseEnter={() => setHoveredConn(schemaKey)}
                        onMouseLeave={() => setHoveredConn(null)}
                      >
                        <span style={{ ...styles.chevron, paddingLeft: 20 }}>{schemaExpanded ? '▾' : '▸'}</span>
                        <span style={styles.schemaIcon}>📁</span>
                        <span style={styles.schemaName}>{schema.name}</span>
                        <span style={styles.countBadge}>{schema.tables.length}</span>
                        <div style={{ ...styles.connActions, opacity: isHovSchema ? 1 : 0, gap: 2, marginLeft: 2 }}>
                          <ActionBtn
                            title="Create schema"
                            onClick={e => { e.stopPropagation(); setSchemaDialog({ connectionId: id, mode: 'create' }); setNewSchemaName(''); }}
                          >+</ActionBtn>
                          {schema.name !== 'public' && (
                            <ActionBtn
                              title="Drop schema"
                              onClick={e => { e.stopPropagation(); handleDropSchema(id, schema.name); }}
                            >🗑</ActionBtn>
                          )}
                        </div>
                      </div>

                      {schemaExpanded && (
                        <>
                          {/* Tables */}
                          {tables.map(table => {
                            const tableKey = `table:${id}:${schema.name}.${table.name}`;
                            const isActiveTable = activeView.kind === 'table' && activeView.schema === schema.name && activeView.table === table.name;
                            const isHovTable = hoveredConn === tableKey;

                            return (
                              <div
                                key={table.name}
                                style={{ ...styles.tableRow, background: isActiveTable ? 'var(--pp-bg-active)' : isHovTable ? 'var(--pp-bg-hover)' : undefined }}
                                onClick={() => openTable(id, schema.name, table.name)}
                                onMouseEnter={() => setHoveredConn(tableKey)}
                                onMouseLeave={() => setHoveredConn(null)}
                                title={table.name}
                              >
                                <span style={{ paddingLeft: 40, color: 'var(--pp-text-muted)', fontSize: 11 }}>▦</span>
                                <span style={styles.tableName}>{table.name}</span>
                                <div style={{ ...styles.connActions, opacity: isHovTable ? 1 : 0 }}>
                                  <ActionBtn title="Drop table" onClick={e => { e.stopPropagation(); dropTable(id, schema.name, table.name); }}>🗑</ActionBtn>
                                </div>
                              </div>
                            );
                          })}

                          {/* Views */}
                          {views.map(view => {
                            const viewKey = `view:${id}:${schema.name}.${view.name}`;
                            const isHovView = hoveredConn === viewKey;

                            return (
                              <div
                                key={view.name}
                                style={{ ...styles.tableRow, background: isHovView ? 'var(--pp-bg-hover)' : undefined }}
                                onClick={() => openTable(id, schema.name, view.name)}
                                onMouseEnter={() => setHoveredConn(viewKey)}
                                onMouseLeave={() => setHoveredConn(null)}
                                title={view.name}
                              >
                                <span style={{ paddingLeft: 40, color: '#c586c0', fontSize: 11 }}>👁</span>
                                <span style={{ ...styles.tableName, color: '#c586c0' }}>{view.name}</span>
                                <div style={{ ...styles.connActions, opacity: isHovView ? 1 : 0 }}>
                                  <ActionBtn title="Drop view" onClick={e => { e.stopPropagation(); dropView(id, schema.name, view.name); }}>🗑</ActionBtn>
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* ── Saved (inactive) connections ── */}
          {inactiveConnections.map(config => {
            const isHovered = hoveredConn === `saved:${config.id}`;
            const isLoading = reconnecting.has(config.id);

            return (
              <div
                key={config.id}
                style={{ ...styles.connRow, background: isHovered ? 'var(--pp-bg-hover)' : undefined, opacity: isLoading ? 0.6 : 1 }}
                onMouseEnter={() => setHoveredConn(`saved:${config.id}`)}
                onMouseLeave={() => setHoveredConn(null)}
              >
                <span style={{ ...styles.chevron, color: 'transparent' }}>▸</span>
                <span style={styles.connIcon}>⚫</span>
                <span style={styles.connName} title={`${config.host}:${config.port}/${config.database}`}>
                  {config.name}
                </span>
                <div style={{ ...styles.connActions, opacity: isHovered ? 1 : 0 }}>
                  {isLoading ? (
                    <span style={{ fontSize: 10, color: 'var(--pp-text-muted)' }}>…</span>
                  ) : (
                    <>
                      <ActionBtn title={`Connect to ${config.host}/${config.database}`} onClick={e => { e.stopPropagation(); reconnect(config.id); }}>▶</ActionBtn>
                      <ActionBtn title="Delete connection" onClick={e => { e.stopPropagation(); deleteConnection(config.id); }}>🗑</ActionBtn>
                    </>
                  )}
                </div>
                {!isHovered && !isLoading && (
                  <span style={{ fontSize: 9, color: 'var(--pp-text-muted)', flexShrink: 0 }}>off</span>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── Resize handle ── */}
      <div
        style={styles.resizeHandle}
        onMouseDown={onMouseDown}
        title="Drag to resize"
      />

      {/* ── Create schema dialog ── */}
      {schemaDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <div style={{ background: 'var(--pp-bg-secondary)', border: '1px solid var(--pp-border)', borderRadius: 6, padding: 20, width: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>New Schema</div>
            <input
              value={newSchemaName}
              onChange={e => setNewSchemaName(e.target.value.replace(/\s/g, '_').toLowerCase())}
              placeholder="schema_name"
              style={{ width: '100%', marginBottom: 14, fontSize: 13, padding: '6px 8px' }}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleCreateSchema(); if (e.key === 'Escape') setSchemaDialog(null); }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="secondary" onClick={() => setSchemaDialog(null)}>Cancel</button>
              <button onClick={handleCreateSchema} disabled={!newSchemaName.trim()}>Create Schema</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ActionBtn({ title, onClick, children }: { title: string; onClick: React.MouseEventHandler; children: React.ReactNode }) {
  return (
    <button
      className="secondary"
      style={{ padding: '1px 5px', fontSize: 11, opacity: 0.7 }}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    minWidth: 160,
    maxWidth: 400,
    borderRight: 'none',
    background: 'var(--pp-bg-secondary)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    userSelect: 'none',
    flexShrink: 0,
  },
  resizeHandle: {
    width: 4,
    cursor: 'col-resize',
    background: 'transparent',
    borderRight: '1px solid var(--pp-border)',
    flexShrink: 0,
    transition: 'background 0.1s',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 10px 8px',
    borderBottom: '1px solid var(--pp-border)',
  },
  headerLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    color: 'var(--pp-text-muted)',
    fontWeight: 600,
  },
  addBtn: {
    background: 'transparent',
    color: 'var(--pp-text)',
    border: 'none',
    padding: '0 3px',
    fontSize: 15,
    cursor: 'pointer',
    lineHeight: 1,
  },
  list: { flex: 1, overflow: 'auto' },
  empty: { padding: 16, color: 'var(--pp-text-muted)', fontSize: 12, lineHeight: 1.5 },
  link: { color: 'var(--pp-accent)', cursor: 'pointer', textDecoration: 'underline' },
  connRow: {
    display: 'flex', alignItems: 'center',
    padding: '5px 8px', cursor: 'pointer', gap: 4,
  },
  connIcon: { fontSize: 13 },
  connName: { flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  connActions: { display: 'flex', gap: 2, opacity: 0, transition: 'opacity 0.1s' },
  chevron: { fontSize: 10, color: 'var(--pp-text-muted)', width: 12, flexShrink: 0 },
  schemaRow: {
    display: 'flex', alignItems: 'center',
    padding: '3px 8px', cursor: 'pointer', gap: 4,
  },
  schemaIcon: { fontSize: 11 },
  schemaName: { flex: 1, fontSize: 12, color: 'var(--pp-text-muted)' },
  countBadge: { fontSize: 10, background: 'var(--pp-border)', borderRadius: 8, padding: '0 5px', color: 'var(--pp-text-muted)' },
  tableRow: {
    display: 'flex', alignItems: 'center',
    padding: '3px 8px', cursor: 'pointer', gap: 4,
  },
  tableName: { fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
};
