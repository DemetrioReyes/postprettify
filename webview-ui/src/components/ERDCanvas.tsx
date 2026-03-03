import React, { useEffect, useCallback, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  MarkerType,
  Handle,
  Position,
  type NodeProps,
  ConnectionMode,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useStore } from '../store';
import { postMessage } from '../vscode';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TableNodeData {
  schema: string;
  name: string;
  columns: Array<{ name: string; type: string; pk: boolean; fk: boolean; nullable: boolean }>;
}

interface NewFKState {
  sourceNode: string; // "schema.table"
  targetNode: string; // "schema.table"
  fromCol: string;
  toCol: string;
  constraintName: string;
}

// ─── Custom Table Node ────────────────────────────────────────────────────────

function TableNode({ data, selected }: NodeProps<TableNodeData>) {
  return (
    <div style={{
      ...TN.root,
      border: selected ? '1.5px solid var(--pp-accent)' : '1px solid var(--pp-border)',
    }}>
      {/* Handles on all four sides — all type="source" with ConnectionMode.Loose */}
      <Handle type="source" position={Position.Left}   id="left"   style={TN.handleL} />
      <Handle type="source" position={Position.Right}  id="right"  style={TN.handleR} />
      <Handle type="source" position={Position.Top}    id="top"    style={TN.handleTop} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={TN.handleBot} />

      {/* Header */}
      <div style={TN.header}>
        <span style={TN.schema}>{data.schema}.</span>
        <span style={TN.name}>{data.name}</span>
      </div>

      {/* Columns */}
      <div style={TN.body}>
        {data.columns.map((col, i) => (
          <div key={col.name} style={{
            ...TN.row,
            background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
          }}>
            <div style={TN.colLeft}>
              {col.pk && <span style={{ color: '#dcdcaa', fontSize: 9, fontWeight: 700, marginRight: 3 }}>PK</span>}
              {col.fk && !col.pk && <span style={{ color: '#9cdcfe', fontSize: 9, fontWeight: 700, marginRight: 3 }}>FK</span>}
              <span style={{ fontWeight: col.pk ? 600 : 400 }}>{col.name}</span>
              {col.nullable && <span style={{ color: 'var(--pp-text-muted)', fontSize: 9, marginLeft: 3 }}>?</span>}
            </div>
            <span style={{ color: typeColor(col.type), fontSize: 10, flexShrink: 0 }}>{col.type}</span>
          </div>
        ))}
        {data.columns.length === 0 && (
          <div style={{ padding: '6px 10px', color: 'var(--pp-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
            loading columns…
          </div>
        )}
      </div>
    </div>
  );
}

function typeColor(type: string): string {
  if (['integer','bigint','smallint','serial','bigserial','numeric','real'].includes(type)) return '#b5cea8';
  if (type === 'boolean') return '#569cd6';
  if (type === 'uuid') return '#4ec9b0';
  if (type === 'json' || type === 'jsonb') return '#dcdcaa';
  if (type.includes('timestamp') || type === 'date' || type === 'time') return '#c586c0';
  return '#ce9178';
}

const TN: Record<string, React.CSSProperties> = {
  root: {
    background: 'var(--pp-bg-secondary)',
    borderRadius: 5,
    minWidth: 200,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    overflow: 'hidden',
  },
  header: {
    padding: '7px 10px',
    background: 'rgba(0,127,212,0.15)',
    borderBottom: '1px solid var(--pp-border)',
    display: 'flex',
    alignItems: 'baseline',
    gap: 1,
  },
  schema: { fontSize: 10, color: 'var(--pp-text-muted)' },
  name: { fontSize: 13, fontWeight: 700, color: 'var(--pp-text)' },
  body: { display: 'flex', flexDirection: 'column' },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '3px 10px',
    fontSize: 11,
    position: 'relative',
    gap: 6,
  },
  colLeft: { display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, overflow: 'hidden' },
  handleL:   { left: -5,   top: '50%', width: 10, height: 10, background: 'var(--pp-accent)', border: '2px solid var(--pp-bg-secondary)', borderRadius: '50%' },
  handleR:   { right: -5,  top: '50%', width: 10, height: 10, background: '#9cdcfe',          border: '2px solid var(--pp-bg-secondary)', borderRadius: '50%' },
  handleTop: { top: -5,    left: '50%', width: 10, height: 10, background: 'var(--pp-accent)', border: '2px solid var(--pp-bg-secondary)', borderRadius: '50%' },
  handleBot: { bottom: -5, left: '50%', width: 10, height: 10, background: '#9cdcfe',          border: '2px solid var(--pp-bg-secondary)', borderRadius: '50%' },
};

const nodeTypes = { tableNode: TableNode };

// ─── Main ERD Canvas ──────────────────────────────────────────────────────────

interface Props {
  connectionId: string;
}

export function ERDCanvas({ connectionId }: Props) {
  const { foreignKeys, connections, columnCache } = useStore();
  const connInfo = connections.get(connectionId);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // FK creation modal state
  const [newFK, setNewFK] = useState<NewFKState | null>(null);

  // ── Fetch data on mount ──────────────────────────────────────────────────

  useEffect(() => {
    postMessage({ command: 'fetchForeignKeys', payload: { connectionId } });
  }, [connectionId]);

  useEffect(() => {
    if (!connInfo) return;
    for (const schema of connInfo.schemas) {
      for (const table of schema.tables) {
        if (table.type === 'table' && !columnCache.has(`${schema.name}.${table.name}`)) {
          postMessage({ command: 'fetchColumns', payload: { connectionId, schema: schema.name, table: table.name } });
        }
      }
    }
  }, [connInfo?.schemas.length]);

  // ── Build nodes + edges ─────────────────────────────────────────────────

  const columnCacheSize = columnCache.size;

  useEffect(() => {
    if (!connInfo) return;

    const allTables: Array<{ schema: string; name: string }> = [];
    for (const schema of connInfo.schemas) {
      for (const table of schema.tables) {
        if (table.type === 'table') allTables.push({ schema: schema.name, name: table.name });
      }
    }
    if (allTables.length === 0) return;

    const COLS = 3, COL_W = 240, ROW_H = 220;
    let idx = 0;

    const newNodes: Node[] = allTables.map(t => {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      idx++;
      const cols = columnCache.get(`${t.schema}.${t.name}`) ?? [];
      return {
        id: `${t.schema}.${t.name}`,
        type: 'tableNode',
        position: { x: col * (COL_W + 80), y: row * (ROW_H + 40) },
        data: {
          schema: t.schema,
          name: t.name,
          columns: cols.map(c => ({
            name: c.name,
            type: c.udtName || c.dataType,
            pk: c.isPrimaryKey,
            fk: c.isForeignKey,
            nullable: c.isNullable,
          })),
        },
      };
    });

    // Edge ID includes constraint name so we can look it up on click
    const newEdges: Edge[] = foreignKeys.map(fk => ({
      id: `fk-${fk.constraintName}`,
      source: `${fk.fromSchema}.${fk.fromTable}`,
      sourceHandle: 'right',
      target: `${fk.toSchema}.${fk.toTable}`,
      targetHandle: 'left',
      label: `${fk.fromColumn} → ${fk.toColumn}`,
      labelStyle: { fontSize: 10, fill: '#cccccc', fontFamily: 'monospace' },
      labelBgStyle: { fill: '#1e1e1e', fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      style: { stroke: '#007fd4', strokeWidth: 2, cursor: 'pointer' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#007fd4', width: 16, height: 16 },
      type: 'smoothstep',
    }));

    setNodes(newNodes);
    setEdges(newEdges);
  }, [foreignKeys, connInfo, columnCacheSize, setNodes, setEdges]);

  // ── onConnect — user drags from one handle to another ───────────────────

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;

    const srcTable = connection.source.split('.')[1] ?? connection.source;
    const tgtTable = connection.target.split('.')[1] ?? connection.target;

    // Auto-generate constraint name (user can edit in modal)
    const autoName = `fk_${srcTable}_${tgtTable}`;

    setNewFK({
      sourceNode: connection.source,
      targetNode: connection.target,
      fromCol: '',
      toCol: '',
      constraintName: autoName,
    });
  }, []);

  // ── onEdgeClick — user clicks an edge to delete the FK ──────────────────

  const onEdgeClick = useCallback((_evt: React.MouseEvent, edge: Edge) => {
    const constraintName = edge.id.startsWith('fk-') ? edge.id.slice(3) : edge.id;
    const fk = foreignKeys.find(f => f.constraintName === constraintName);
    if (!fk) {
      // FK may have been added via drag (not yet in store); fall back to constraint name only
      if (!confirm(`Drop foreign key constraint "${constraintName}"?`)) return;
      // We don't know the table — can't proceed without it
      return;
    }

    const label = `${fk.fromSchema}.${fk.fromTable}(${fk.fromColumn}) → ${fk.toSchema}.${fk.toTable}(${fk.toColumn})`;
    if (!confirm(`Drop foreign key "${constraintName}"?\n${label}`)) return;

    postMessage({
      command: 'alterTable',
      payload: {
        connectionId,
        schema: fk.fromSchema,
        table: fk.fromTable,
        ops: [{ op: 'dropForeignKey', constraintName }],
      },
    });
    // Extension will send back fresh foreignKeys after the FK op (see MainWebviewProvider)
  }, [foreignKeys, connectionId]);

  // ── Create FK from modal ─────────────────────────────────────────────────

  function handleCreateFK() {
    if (!newFK || !newFK.fromCol || !newFK.toCol || !newFK.constraintName.trim()) return;

    const [fromSchema, fromTable] = newFK.sourceNode.split('.');
    const [refSchema, refTable] = newFK.targetNode.split('.');

    postMessage({
      command: 'alterTable',
      payload: {
        connectionId,
        schema: fromSchema,
        table: fromTable,
        ops: [{
          op: 'addForeignKey',
          column: newFK.fromCol,
          refSchema,
          refTable,
          refColumn: newFK.toCol,
        }],
      },
    });
    setNewFK(null);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getColumns(nodeId: string) {
    const cols = columnCache.get(nodeId) ?? [];
    return cols.map(c => c.name);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (!connInfo) return null;

  const tableCount = connInfo.schemas.reduce((n, s) => n + s.tables.filter(t => t.type === 'table').length, 0);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={S.toolbar}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>ERD Diagram</span>
        <span className="badge">{tableCount} tables · {foreignKeys.length} relations</span>
        <span style={{ fontSize: 11, color: 'var(--pp-text-muted)', marginLeft: 8 }}>
          Drag between table handles to add a FK · Click a relation line to delete it
        </span>
        <button className="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}
          onClick={() => postMessage({ command: 'fetchForeignKeys', payload: { connectionId } })}>
          ↻ Refresh
        </button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, background: 'var(--pp-bg)' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          connectionMode={ConnectionMode.Loose}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--pp-border)" gap={24} size={1} />
          <Controls
            style={{ background: 'var(--pp-bg-secondary)', border: '1px solid var(--pp-border)', borderRadius: 4 }}
            showInteractive={false}
          />
          <MiniMap
            style={{ background: 'var(--pp-bg-secondary)', border: '1px solid var(--pp-border)' }}
            nodeColor={() => 'rgba(0,127,212,0.4)'}
            maskColor="rgba(0,0,0,0.4)"
          />
        </ReactFlow>
      </div>

      {/* ── Add FK Modal ── */}
      {newFK && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={S.modalTitle}>Add Foreign Key</div>

            <div style={S.fkRow}>
              {/* Source side */}
              <div style={S.fkSide}>
                <div style={S.fkTableLabel}>{newFK.sourceNode}</div>
                <label style={S.label}>Column (FK)</label>
                <select
                  style={S.select}
                  value={newFK.fromCol}
                  onChange={e => setNewFK(prev => prev ? { ...prev, fromCol: e.target.value } : null)}
                >
                  <option value="">-- select column --</option>
                  {getColumns(newFK.sourceNode).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div style={S.fkArrow}>→</div>

              {/* Target side */}
              <div style={S.fkSide}>
                <div style={S.fkTableLabel}>{newFK.targetNode}</div>
                <label style={S.label}>Referenced Column</label>
                <select
                  style={S.select}
                  value={newFK.toCol}
                  onChange={e => setNewFK(prev => prev ? { ...prev, toCol: e.target.value } : null)}
                >
                  <option value="">-- select column --</option>
                  {getColumns(newFK.targetNode).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={S.label}>Constraint Name</label>
              <input
                style={S.input}
                value={newFK.constraintName}
                onChange={e => setNewFK(prev => prev ? { ...prev, constraintName: e.target.value } : null)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateFK(); if (e.key === 'Escape') setNewFK(null); }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button className="secondary" onClick={() => setNewFK(null)}>Cancel</button>
              <button
                onClick={handleCreateFK}
                disabled={!newFK.fromCol || !newFK.toCol || !newFK.constraintName.trim()}
              >
                Add FK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  toolbar: {
    padding: '6px 14px',
    borderBottom: '1px solid var(--pp-border)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
    background: 'var(--pp-bg-secondary)',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 500,
  },
  modal: {
    background: 'var(--pp-bg-secondary)',
    border: '1px solid var(--pp-border)',
    borderRadius: 7,
    padding: 22,
    width: 500,
    boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
  },
  modalTitle: {
    fontWeight: 700,
    fontSize: 14,
    marginBottom: 18,
    color: 'var(--pp-text)',
  },
  fkRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 12,
  },
  fkSide: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  fkArrow: {
    fontSize: 20,
    color: 'var(--pp-accent)',
    paddingBottom: 4,
    flexShrink: 0,
  },
  fkTableLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--pp-accent)',
    marginBottom: 6,
    fontFamily: 'monospace',
  },
  label: {
    fontSize: 11,
    color: 'var(--pp-text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    fontWeight: 600,
  },
  select: {
    width: '100%',
    fontSize: 13,
    padding: '5px 8px',
    background: 'var(--pp-bg)',
    color: 'var(--pp-text)',
    border: '1px solid var(--pp-border)',
    borderRadius: 4,
  },
  input: {
    width: '100%',
    fontSize: 13,
    padding: '5px 8px',
    marginTop: 5,
    background: 'var(--pp-bg)',
    color: 'var(--pp-text)',
    border: '1px solid var(--pp-border)',
    borderRadius: 4,
  },
};
