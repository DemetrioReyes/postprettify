import React, { useState, useMemo, useEffect } from 'react';
import { postMessage } from '../vscode';
import { useStore } from '../store';
import type { ColumnInfo, ColumnDefinition, AlterOp, IndexInfo } from '../../../src/types';

// ─── PG types ─────────────────────────────────────────────────────────────────

const PG_TYPES = [
  { group: 'Integer', types: ['integer', 'smallint', 'bigint', 'serial', 'bigserial'] },
  { group: 'Float', types: ['real', 'double precision', 'numeric'] },
  { group: 'Text', types: ['text', 'varchar(255)', 'varchar(100)', 'char(1)'] },
  { group: 'Date / Time', types: ['date', 'time', 'timestamp', 'timestamptz'] },
  { group: 'Boolean', types: ['boolean'] },
  { group: 'UUID', types: ['uuid'] },
  { group: 'JSON', types: ['json', 'jsonb'] },
  { group: 'Other', types: ['bytea', 'inet'] },
];

// ─── Column row in edit mode ──────────────────────────────────────────────────

interface EditableCol {
  original: ColumnInfo | null;
  name: string;
  type: string;
  isNullable: boolean;
  defaultValue: string;
  isUnique: boolean;
  isPrimaryKey: boolean;
  foreignKey?: { schema: string; table: string; column: string };
  state: 'existing' | 'added' | 'dropped';
  renamed?: string;
}

function typeColor(t: string) {
  if (['integer','bigint','smallint','serial','bigserial','numeric','real','double precision'].includes(t)) return '#b5cea8';
  if (t === 'boolean') return '#569cd6';
  if (t === 'uuid') return '#4ec9b0';
  if (t.includes('json')) return '#dcdcaa';
  if (t.includes('timestamp') || t === 'date' || t === 'time') return '#c586c0';
  return '#ce9178';
}

// ─── Diff: compute AlterOps ───────────────────────────────────────────────────

function computeOps(originalCols: ColumnInfo[], editedCols: EditableCol[], tableName: string, newTableName: string): AlterOp[] {
  const ops: AlterOp[] = [];

  if (newTableName.trim() && newTableName !== tableName) {
    ops.push({ op: 'renameTable', newName: newTableName.trim() });
  }

  for (const col of editedCols) {
    const orig = col.original;

    if (col.state === 'dropped' && orig) { ops.push({ op: 'dropColumn', name: orig.name }); continue; }
    if (col.state === 'added') {
      const def: ColumnDefinition = { name: col.name, type: col.type, isPrimaryKey: false, isNullable: col.isNullable, defaultValue: col.defaultValue, isUnique: col.isUnique, foreignKey: col.foreignKey };
      ops.push({ op: 'addColumn', column: def });
      if (col.foreignKey) ops.push({ op: 'addForeignKey', column: col.name, refSchema: col.foreignKey.schema, refTable: col.foreignKey.table, refColumn: col.foreignKey.column });
      continue;
    }
    if (!orig) continue;

    if (col.renamed && col.renamed !== orig.name) ops.push({ op: 'renameColumn', from: orig.name, to: col.renamed });
    const currentName = col.renamed ?? orig.name;
    if (col.type !== orig.udtName && col.type !== orig.dataType) ops.push({ op: 'setType', column: currentName, newType: col.type });
    if (!orig.isNullable !== !col.isNullable && !col.isPrimaryKey) ops.push({ op: 'setNotNull', column: currentName, value: !col.isNullable });
    const origDefault = orig.columnDefault ?? '';
    if (col.defaultValue !== origDefault) ops.push({ op: 'setDefault', column: currentName, value: col.defaultValue || null });
    if (col.isUnique !== (orig.isUnique ?? false) && !col.isPrimaryKey) {
      if (col.isUnique) ops.push({ op: 'setUnique', column: currentName, value: true });
      else ops.push({ op: 'setUnique', column: currentName, value: false, constraintName: `uq_${tableName}_${orig.name}` });
    }
    const origFK = orig.isForeignKey ? orig.foreignKeyRef : undefined;
    const newFK = col.foreignKey;
    if (JSON.stringify(origFK) !== JSON.stringify(newFK)) {
      if (origFK) ops.push({ op: 'dropForeignKey', constraintName: `fk_${tableName}_${orig.name}` });
      if (newFK) ops.push({ op: 'addForeignKey', column: currentName, refSchema: newFK.schema, refTable: newFK.table, refColumn: newFK.column });
    }
  }
  return ops;
}

function opsToSQL(schema: string, table: string, ops: AlterOp[]): string {
  const qt = `"${schema}"."${table}"`;
  return ops.map(op => {
    switch (op.op) {
      case 'addColumn': return `ALTER TABLE ${qt}\n  ADD COLUMN "${op.column.name}" ${op.column.type}${!op.column.isNullable ? ' NOT NULL' : ''}${op.column.defaultValue ? ` DEFAULT ${op.column.defaultValue}` : ''};`;
      case 'dropColumn': return `ALTER TABLE ${qt}\n  DROP COLUMN "${op.name}" CASCADE;`;
      case 'renameColumn': return `ALTER TABLE ${qt}\n  RENAME COLUMN "${op.from}" TO "${op.to}";`;
      case 'setType': return `ALTER TABLE ${qt}\n  ALTER COLUMN "${op.column}" TYPE ${op.newType} USING "${op.column}"::${op.newType};`;
      case 'setNotNull': return `ALTER TABLE ${qt}\n  ALTER COLUMN "${op.column}" ${op.value ? 'SET' : 'DROP'} NOT NULL;`;
      case 'setDefault': return op.value ? `ALTER TABLE ${qt}\n  ALTER COLUMN "${op.column}" SET DEFAULT ${op.value};` : `ALTER TABLE ${qt}\n  ALTER COLUMN "${op.column}" DROP DEFAULT;`;
      case 'setUnique': return op.value ? `ALTER TABLE ${qt}\n  ADD CONSTRAINT "uq_${table}_${op.column}" UNIQUE ("${op.column}");` : `ALTER TABLE ${qt}\n  DROP CONSTRAINT "${op.constraintName}";`;
      case 'addForeignKey': return `ALTER TABLE ${qt}\n  ADD CONSTRAINT "fk_${table}_${op.column}" FOREIGN KEY ("${op.column}") REFERENCES "${op.refSchema}"."${op.refTable}" ("${op.refColumn}");`;
      case 'dropForeignKey': return `ALTER TABLE ${qt}\n  DROP CONSTRAINT "${op.constraintName}";`;
      case 'renameTable': return `ALTER TABLE ${qt}\n  RENAME TO "${op.newName}";`;
      default: return '';
    }
  }).filter(Boolean).join('\n\n');
}

// ─── Index Manager ────────────────────────────────────────────────────────────

interface IndexManagerProps {
  connectionId: string;
  schema: string;
  table: string;
  columns: ColumnInfo[];
}

function IndexManager({ connectionId, schema, table, columns }: IndexManagerProps) {
  const { indexCache, setIndexes } = useStore();
  const indexes = indexCache.get(`${schema}.${table}`) ?? [];
  const [newName, setNewName] = useState('');
  const [newCols, setNewCols] = useState<string[]>([]);
  const [newUnique, setNewUnique] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    postMessage({ command: 'fetchIndexes', payload: { connectionId, schema, table } });
  }, [connectionId, schema, table]);

  function createIndex() {
    if (!newName.trim() || newCols.length === 0) return;
    postMessage({ command: 'createIndex', payload: { connectionId, schema, table, name: newName.trim(), columns: newCols, isUnique: newUnique } });
    setNewName('');
    setNewCols([]);
    setNewUnique(false);
    setAdding(false);
  }

  function dropIndex(idx: IndexInfo) {
    if (!confirm(`Drop index "${idx.name}"?`)) return;
    // Optimistic UI update
    setIndexes(schema, table, indexes.filter(i => i.name !== idx.name));
    postMessage({ command: 'dropIndex', payload: { connectionId, schema, indexName: idx.name } });
    setTimeout(() => postMessage({ command: 'fetchIndexes', payload: { connectionId, schema, table } }), 400);
  }

  function toggleCol(col: string) {
    setNewCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  }

  return (
    <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Existing indexes */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--pp-text-muted)', marginBottom: 6 }}>
          Existing Indexes
        </div>
        {indexes.length === 0 && (
          <div style={{ color: 'var(--pp-text-muted)', fontSize: 12 }}>No indexes (other than primary key)</div>
        )}
        {indexes.map(idx => (
          <div key={idx.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--pp-border)' }}>
            <span style={{ fontWeight: 700, fontSize: 10, color: idx.isPrimary ? '#dcdcaa' : idx.isUnique ? '#c586c0' : 'var(--pp-text-muted)', width: 32 }}>
              {idx.isPrimary ? 'PK' : idx.isUnique ? 'UQ' : 'IDX'}
            </span>
            <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{idx.name}</span>
            <span style={{ fontSize: 11, color: 'var(--pp-text-muted)' }}>{idx.columns.join(', ')}</span>
            {!idx.isPrimary && (
              <button className="danger" style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => dropIndex(idx)}>Drop</button>
            )}
          </div>
        ))}
      </div>

      {/* Add index */}
      {adding ? (
        <div style={{ background: 'var(--pp-bg)', border: '1px solid var(--pp-border)', borderRadius: 4, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>New Index</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 11, width: 60 }}>Name</label>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value.replace(/\s/g, '_').toLowerCase())}
              placeholder={`idx_${table}_`}
              style={{ flex: 1, fontSize: 12, padding: '3px 7px' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Columns</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {columns.filter(c => !c.isPrimaryKey).map(c => (
                <button
                  key={c.name}
                  className="secondary"
                  style={{ fontSize: 11, padding: '2px 8px', background: newCols.includes(c.name) ? 'rgba(0,127,212,0.2)' : undefined, borderColor: newCols.includes(c.name) ? 'var(--pp-accent)' : undefined }}
                  onClick={() => toggleCol(c.name)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={newUnique} onChange={e => setNewUnique(e.target.checked)} />
            UNIQUE index
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="secondary" onClick={() => setAdding(false)}>Cancel</button>
            <button onClick={createIndex} disabled={!newName.trim() || newCols.length === 0}>Create Index</button>
          </div>
        </div>
      ) : (
        <button style={{ alignSelf: 'flex-start', fontSize: 12 }} onClick={() => setAdding(true)}>+ Add Index</button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  connectionId: string;
  schema: string;
  table: string;
  onClose: () => void;
  onAltered: (newTableName?: string) => void;
}

type EditorTab = 'columns' | 'indexes';

export function AlterTableEditor({ connectionId, schema, table, onClose, onAltered }: Props) {
  const { columnCache, connections } = useStore();
  const originalCols = columnCache.get(`${schema}.${table}`) ?? [];
  const connInfo = connections.get(connectionId);
  const allTables = useMemo(() =>
    (connInfo?.schemas ?? []).flatMap(s =>
      s.tables.filter(t => t.type === 'table').map(t => ({ schema: s.name, table: t.name }))
    ), [connInfo]);

  const [activeTab, setActiveTab] = useState<EditorTab>('columns');
  const [tableName, setTableName] = useState(table);
  const [cols, setCols] = useState<EditableCol[]>(() =>
    originalCols.map(c => ({
      original: c, name: c.name, type: c.udtName || c.dataType,
      isNullable: c.isNullable, defaultValue: c.columnDefault ?? '',
      isUnique: c.isUnique ?? false, isPrimaryKey: c.isPrimaryKey,
      foreignKey: c.foreignKeyRef ? { ...c.foreignKeyRef } : undefined,
      state: 'existing' as const,
    }))
  );
  const [showSQL, setShowSQL] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fkPicker, setFkPicker] = useState<number | null>(null);
  const [fkTable, setFkTable] = useState('');
  const [fkColumn, setFkColumn] = useState('id');

  const ops = computeOps(originalCols, cols, table, tableName);
  const sqlPreview = opsToSQL(schema, table, ops);
  const hasChanges = ops.length > 0;

  function updateCol(i: number, patch: Partial<EditableCol>) {
    setCols(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }

  function addColumn() {
    setCols(prev => [...prev, { original: null, name: '', type: 'text', isNullable: true, defaultValue: '', isUnique: false, isPrimaryKey: false, state: 'added' }]);
  }

  function dropColumn(i: number) {
    setCols(prev => {
      const next: EditableCol[] = [];
      for (let idx = 0; idx < prev.length; idx++) {
        if (idx !== i) { next.push(prev[idx]); continue; }
        if (prev[idx].state === 'added') continue;
        next.push({ ...prev[idx], state: 'dropped' });
      }
      return next;
    });
  }

  function restoreColumn(i: number) {
    setCols(prev => prev.map((c, idx) => idx === i ? { ...c, state: 'existing' } : c));
  }

  function applyFK(colIndex: number) {
    if (fkTable) {
      const [s, t] = fkTable.split('.');
      updateCol(colIndex, { foreignKey: { schema: s, table: t, column: fkColumn || 'id' } });
    } else {
      updateCol(colIndex, { foreignKey: undefined });
    }
    setFkPicker(null);
  }

  function handleSave() {
    if (!hasChanges) return;
    setSaving(true);
    postMessage({ command: 'alterTable', payload: { connectionId, schema, table, ops } });
  }

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        {/* Header */}
        <div style={S.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--pp-text-muted)' }}>Modify table</span>
            <input
              value={tableName}
              onChange={e => setTableName(e.target.value.replace(/\s/g, '_').toLowerCase())}
              style={{ ...S.tableNameInput, borderColor: tableName !== table ? 'var(--pp-accent)' : 'var(--pp-border)' }}
            />
            {tableName !== table && <span style={{ fontSize: 11, color: 'var(--pp-accent)' }}>← will rename</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {hasChanges && <span className="badge" style={{ color: 'var(--pp-accent)', borderColor: 'var(--pp-accent)' }}>{ops.length} change{ops.length > 1 ? 's' : ''}</span>}
            <button className="secondary" style={{ padding: '2px 8px' }} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--pp-border)', flexShrink: 0 }}>
          {(['columns', 'indexes'] as EditorTab[]).map(tab => (
            <button
              key={tab}
              className="secondary"
              style={{ borderRadius: 0, border: 'none', borderBottom: `2px solid ${activeTab === tab ? 'var(--pp-accent)' : 'transparent'}`, padding: '8px 16px', fontSize: 12, fontWeight: activeTab === tab ? 600 : 400 }}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Body */}
        {activeTab === 'columns' ? (
          <div style={S.body}>
            {/* Column header */}
            <div style={S.colHeader}>
              <span style={{ ...S.hcell, width: 28 }}></span>
              <span style={{ ...S.hcell, flex: 2 }}>Column</span>
              <span style={{ ...S.hcell, flex: 2 }}>Type</span>
              <span style={{ ...S.hcell, flex: 2 }}>Default</span>
              <span style={{ ...S.hcell, width: 38, textAlign: 'center' }}>PK</span>
              <span style={{ ...S.hcell, width: 38, textAlign: 'center' }}>NN</span>
              <span style={{ ...S.hcell, width: 38, textAlign: 'center' }}>UQ</span>
              <span style={{ ...S.hcell, flex: 2 }}>Foreign Key</span>
              <span style={{ ...S.hcell, width: 44 }}></span>
            </div>

            <div style={S.colList}>
              {cols.map((col, i) => {
                if (col.state === 'dropped') {
                  return (
                    <div key={i} style={{ ...S.colRow, opacity: 0.4, textDecoration: 'line-through', background: 'rgba(244,71,71,0.08)' }}>
                      <span style={{ flex: 1, padding: '4px 10px', fontSize: 12 }}>{col.name}</span>
                      <span style={{ padding: '4px 8px', fontSize: 11, color: 'var(--pp-error)' }}>WILL DROP</span>
                      <button className="secondary" style={S.miniBtn} onClick={() => restoreColumn(i)}>↩</button>
                    </div>
                  );
                }

                const isDirty = col.state === 'added' || (col.original && (
                  (col.renamed ?? col.name) !== col.original.name
                  || col.type !== (col.original.udtName || col.original.dataType)
                  || col.isNullable !== col.original.isNullable
                  || col.defaultValue !== (col.original.columnDefault ?? '')
                  || col.isUnique !== (col.original.isUnique ?? false)
                  || JSON.stringify(col.foreignKey) !== JSON.stringify(col.original.foreignKeyRef)
                ));

                return (
                  <div key={i} style={{
                    ...S.colRow,
                    background: col.state === 'added' ? 'rgba(78,201,176,0.08)' : isDirty ? 'rgba(0,127,212,0.08)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                    borderLeft: col.state === 'added' ? '2px solid #4ec9b0' : isDirty ? '2px solid var(--pp-accent)' : '2px solid transparent',
                  }}>
                    <span style={{ ...S.cell, width: 28, color: 'var(--pp-text-muted)', fontSize: 10, textAlign: 'center' }}>
                      {col.isPrimaryKey ? '🔑' : String(i + 1)}
                    </span>
                    <div style={{ ...S.cell, flex: 2 }}>
                      <input
                        value={col.renamed ?? col.name}
                        onChange={e => {
                          const v = e.target.value.replace(/\s/g, '_').toLowerCase();
                          if (col.state === 'added') updateCol(i, { name: v });
                          else updateCol(i, { renamed: v !== col.original?.name ? v : undefined });
                        }}
                        style={{ ...S.input, width: '100%' }}
                        disabled={col.isPrimaryKey && col.state === 'existing'}
                      />
                    </div>
                    <div style={{ ...S.cell, flex: 2 }}>
                      <select
                        value={col.type}
                        onChange={e => updateCol(i, { type: e.target.value })}
                        style={{ ...S.select, width: '100%', color: typeColor(col.type) }}
                        disabled={col.isPrimaryKey && col.state === 'existing'}
                      >
                        {PG_TYPES.map(g => (
                          <optgroup key={g.group} label={g.group}>
                            {g.types.map(t => <option key={t} value={t} style={{ color: typeColor(t) }}>{t}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    <div style={{ ...S.cell, flex: 2 }}>
                      <input
                        value={col.defaultValue}
                        onChange={e => updateCol(i, { defaultValue: e.target.value })}
                        placeholder={col.isNullable ? 'NULL' : 'none'}
                        style={{ ...S.input, width: '100%' }}
                        disabled={col.isPrimaryKey}
                      />
                    </div>
                    <div style={{ ...S.cell, width: 38, justifyContent: 'center' }}>
                      <Chip active={col.isPrimaryKey} color="#dcdcaa" label="PK" />
                    </div>
                    <div style={{ ...S.cell, width: 38, justifyContent: 'center' }}>
                      <Toggle checked={!col.isNullable} color="#9cdcfe" disabled={col.isPrimaryKey} onChange={v => updateCol(i, { isNullable: !v })} />
                    </div>
                    <div style={{ ...S.cell, width: 38, justifyContent: 'center' }}>
                      <Toggle checked={col.isUnique} color="#c586c0" disabled={col.isPrimaryKey} onChange={v => updateCol(i, { isUnique: v })} />
                    </div>
                    <div style={{ ...S.cell, flex: 2 }}>
                      {fkPicker === i ? (
                        <div style={{ display: 'flex', gap: 3 }}>
                          <select value={fkTable} onChange={e => setFkTable(e.target.value)} style={{ ...S.select, flex: 1, fontSize: 11 }}>
                            <option value="">— none —</option>
                            {allTables.map(t => (
                              <option key={`${t.schema}.${t.table}`} value={`${t.schema}.${t.table}`}>{t.table}</option>
                            ))}
                          </select>
                          <input value={fkColumn} onChange={e => setFkColumn(e.target.value)} placeholder="id" style={{ ...S.input, width: 52, fontSize: 11 }} />
                          <button style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => applyFK(i)}>✓</button>
                          <button className="secondary" style={{ padding: '2px 4px', fontSize: 11 }} onClick={() => setFkPicker(null)}>✕</button>
                        </div>
                      ) : (
                        <button
                          className="secondary"
                          style={{ fontSize: 11, width: '100%', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          onClick={() => {
                            setFkTable(col.foreignKey ? `${col.foreignKey.schema}.${col.foreignKey.table}` : '');
                            setFkColumn(col.foreignKey?.column ?? 'id');
                            setFkPicker(i);
                          }}
                        >
                          {col.foreignKey
                            ? <span style={{ color: '#9cdcfe' }}>→ {col.foreignKey.table}.{col.foreignKey.column}</span>
                            : <span style={{ color: 'var(--pp-text-muted)' }}>none</span>}
                        </button>
                      )}
                    </div>
                    <div style={{ ...S.cell, width: 44, justifyContent: 'center' }}>
                      {!col.isPrimaryKey && (
                        <button className="danger" style={S.miniBtn} onClick={() => dropColumn(i)} title="Drop column">Drop</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ paddingTop: 8 }}>
              <button onClick={addColumn} style={{ fontSize: 12 }}>+ Add Column</button>
            </div>

            {/* SQL Preview */}
            <div style={{ marginTop: 8 }}>
              <button className="secondary" style={{ fontSize: 11 }} onClick={() => setShowSQL(v => !v)} disabled={!hasChanges}>
                {showSQL ? '▾' : '▸'} Preview SQL ({ops.length} statement{ops.length !== 1 ? 's' : ''})
              </button>
              {showSQL && hasChanges && <pre style={S.sqlPre}>{sqlPreview}</pre>}
              {!hasChanges && <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--pp-text-muted)' }}>No changes yet</span>}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <IndexManager connectionId={connectionId} schema={schema} table={table} columns={originalCols} />
          </div>
        )}

        {/* Footer */}
        {activeTab === 'columns' && (
          <div style={S.footer}>
            <button className="secondary" onClick={onClose}>Cancel</button>
            <button onClick={handleSave} disabled={!hasChanges || saving}>
              {saving ? 'Applying…' : `Apply ${ops.length} Change${ops.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}
        {activeTab === 'indexes' && (
          <div style={S.footer}>
            <button className="secondary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function Toggle({ checked, color, disabled, onChange }: { checked: boolean; color: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      style={{ width: 20, height: 20, border: `2px solid ${checked ? color : 'var(--pp-border)'}`, borderRadius: 3, background: checked ? color + '22' : 'transparent', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color, opacity: disabled ? 0.3 : 1, userSelect: 'none', flexShrink: 0 }}
    >{checked && '✓'}</div>
  );
}

function Chip({ active, color, label }: { active: boolean; color: string; label: string }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, border: `1px solid ${active ? color : 'var(--pp-border)'}`, color: active ? color : 'var(--pp-text-muted)', background: active ? color + '15' : 'transparent', userSelect: 'none' }}>{label}</span>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal: { background: 'var(--pp-bg-secondary)', border: '1px solid var(--pp-border)', borderRadius: 6, width: 900, maxWidth: '98vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.6)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid var(--pp-border)', flexShrink: 0, gap: 10 },
  tableNameInput: { background: 'var(--pp-input-bg)', border: '1px solid', color: 'var(--pp-text)', borderRadius: 3, padding: '4px 8px', fontSize: 14, fontWeight: 600, width: 200 },
  body: { flex: 1, overflow: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 0 },
  colHeader: { display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'var(--pp-bg)', borderRadius: '4px 4px 0 0', borderBottom: '1px solid var(--pp-border)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--pp-text-muted)' },
  hcell: { display: 'flex', alignItems: 'center', flexShrink: 0 },
  colList: { border: '1px solid var(--pp-border)', borderTop: 'none', borderRadius: '0 0 4px 4px', overflow: 'hidden' },
  colRow: { display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', borderBottom: '1px solid var(--pp-border)', minHeight: 36 },
  cell: { display: 'flex', alignItems: 'center', flexShrink: 0 },
  input: { background: 'var(--pp-input-bg)', border: '1px solid var(--pp-input-border)', color: 'var(--pp-text)', borderRadius: 2, padding: '3px 6px', fontSize: 12 },
  select: { background: 'var(--pp-input-bg)', border: '1px solid var(--pp-input-border)', color: 'var(--pp-text)', borderRadius: 2, padding: '3px 5px', fontSize: 12 },
  miniBtn: { padding: '2px 6px', fontSize: 10 },
  sqlPre: { margin: '6px 0 0', padding: '10px 14px', background: 'var(--pp-bg)', border: '1px solid var(--pp-border)', borderRadius: 4, fontSize: 11, fontFamily: 'monospace', color: '#9cdcfe', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 18px', borderTop: '1px solid var(--pp-border)', flexShrink: 0 },
};
