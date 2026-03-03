import React, { useState, useMemo } from 'react';
import { postMessage } from '../vscode';
import { useStore } from '../store';
import type { ColumnDefinition, TableDefinition } from '../../../src/types';

// ─── PG type options ─────────────────────────────────────────────────────────

const PG_TYPES = [
  { group: 'Integer', types: ['integer', 'smallint', 'bigint', 'serial', 'bigserial'] },
  { group: 'Float', types: ['real', 'double precision', 'numeric'] },
  { group: 'Text', types: ['text', 'varchar(255)', 'varchar(100)', 'char(1)'] },
  { group: 'Date / Time', types: ['date', 'time', 'timestamp', 'timestamptz'] },
  { group: 'Boolean', types: ['boolean'] },
  { group: 'UUID', types: ['uuid'] },
  { group: 'JSON', types: ['json', 'jsonb'] },
  { group: 'Other', types: ['bytea', 'inet', 'cidr'] },
];

const ALL_TYPES = PG_TYPES.flatMap(g => g.types);

const DEFAULT_VALUES_FOR_TYPE: Record<string, string> = {
  uuid: 'gen_random_uuid()',
  timestamptz: 'now()',
  timestamp: 'now()',
  boolean: 'false',
  serial: '',
  bigserial: '',
};

// ─── Empty column factory ────────────────────────────────────────────────────

function newColumn(overrides?: Partial<ColumnDefinition>): ColumnDefinition {
  return {
    name: '',
    type: 'text',
    isPrimaryKey: false,
    isNullable: true,
    defaultValue: '',
    isUnique: false,
    ...overrides,
  };
}

// ─── DDL preview ─────────────────────────────────────────────────────────────

function buildDDLPreview(def: TableDefinition): string {
  if (!def.name) return '-- Fill in table name and columns';
  const lines: string[] = [];
  const pkCols = def.columns.filter(c => c.isPrimaryKey).map(c => `"${c.name}"`);
  const fkClauses: string[] = [];

  for (const col of def.columns) {
    if (!col.name) continue;
    const parts: string[] = [`  "${col.name}"`, col.type];
    if (!col.isNullable && !col.isPrimaryKey) parts.push('NOT NULL');
    if (col.defaultValue.trim()) parts.push(`DEFAULT ${col.defaultValue}`);
    if (col.isUnique && !col.isPrimaryKey) parts.push('UNIQUE');
    lines.push(parts.join(' '));
    if (col.foreignKey) {
      const fk = col.foreignKey;
      fkClauses.push(`  CONSTRAINT fk_${def.name}_${col.name} FOREIGN KEY ("${col.name}") REFERENCES "${fk.schema}"."${fk.table}" ("${fk.column}")`);
    }
  }
  if (pkCols.length > 0) lines.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
  lines.push(...fkClauses);
  if (lines.length === 0) return `CREATE TABLE "${def.schema}"."${def.name}" (\n  -- add columns\n)`;
  return `CREATE TABLE "${def.schema}"."${def.name}" (\n${lines.join(',\n')}\n)`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  connectionId: string;
  onClose: () => void;
}

export function CreateTableWizard({ connectionId, onClose }: Props) {
  const { connections } = useStore();
  const connInfo = connections.get(connectionId);
  const schemas = connInfo?.schemas ?? [];

  const [tableName, setTableName] = useState('');
  const [selectedSchema, setSelectedSchema] = useState(schemas[0]?.name ?? 'public');
  const [columns, setColumns] = useState<ColumnDefinition[]>([
    newColumn({ name: 'id', type: 'serial', isPrimaryKey: true, isNullable: false }),
  ]);
  const [creating, setCreating] = useState(false);
  const [showDDL, setShowDDL] = useState(false);

  // All existing tables for FK references
  const allTables = useMemo(() =>
    schemas.flatMap(s => s.tables.filter(t => t.type === 'table').map(t => ({ schema: s.name, table: t.name }))),
    [schemas]
  );

  const definition: TableDefinition = { schema: selectedSchema, name: tableName, columns };
  const ddl = buildDDLPreview(definition);

  // ─── Column operations ────────────────────────────────────────────────────

  function addColumn() {
    setColumns(prev => [...prev, newColumn()]);
  }

  function removeColumn(i: number) {
    setColumns(prev => prev.filter((_, idx) => idx !== i));
  }

  function updateColumn(i: number, field: keyof ColumnDefinition, value: unknown) {
    setColumns(prev => prev.map((col, idx) => {
      if (idx !== i) return col;
      const updated = { ...col, [field]: value };
      // Auto-set default value when type changes
      if (field === 'type') {
        const t = value as string;
        updated.defaultValue = DEFAULT_VALUES_FOR_TYPE[t] ?? '';
        if (t === 'serial' || t === 'bigserial') {
          updated.isNullable = false;
        }
      }
      // Making a column PK removes nullable
      if (field === 'isPrimaryKey' && value) {
        updated.isNullable = false;
      }
      return updated;
    }));
  }

  function setFK(i: number, ref: { schema: string; table: string; column: string } | undefined) {
    setColumns(prev => prev.map((col, idx) =>
      idx !== i ? col : { ...col, foreignKey: ref }
    ));
  }

  function moveColumn(i: number, dir: -1 | 1) {
    setColumns(prev => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  // ─── Submit ───────────────────────────────────────────────────────────────

  function handleCreate() {
    if (!tableName.trim()) return;
    const validCols = columns.filter(c => c.name.trim());
    if (validCols.length === 0) return;
    setCreating(true);
    postMessage({
      command: 'createTable',
      payload: { connectionId, definition: { ...definition, columns: validCols } },
    });
  }

  const canCreate = tableName.trim() && columns.some(c => c.name.trim());

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        {/* Header */}
        <div style={S.header}>
          <h2 style={S.title}>Create New Table</h2>
          <button className="secondary" style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={S.body}>
          {/* Table name + schema */}
          <div style={S.topRow}>
            <div style={S.field}>
              <label style={S.label}>Schema</label>
              <select value={selectedSchema} onChange={e => setSelectedSchema(e.target.value)} style={S.select}>
                {schemas.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ ...S.field, flex: 2 }}>
              <label style={S.label}>Table Name *</label>
              <input
                autoFocus
                value={tableName}
                onChange={e => setTableName(e.target.value.replace(/\s/g, '_').toLowerCase())}
                placeholder="my_table"
                style={S.input}
              />
            </div>
          </div>

          {/* Columns editor */}
          <div style={S.section}>
            <div style={S.sectionHeader}>
              <span style={S.sectionTitle}>Columns</span>
              <button onClick={addColumn} style={S.addColBtn}>+ Add Column</button>
            </div>

            <div style={S.colTable}>
              {/* Header row */}
              <div style={S.colHeaderRow}>
                <span style={{ ...S.colCell, width: 28 }}></span>
                <span style={{ ...S.colCell, flex: 2 }}>Name</span>
                <span style={{ ...S.colCell, flex: 2 }}>Type</span>
                <span style={{ ...S.colCell, flex: 2 }}>Default</span>
                <span style={{ ...S.colCell, width: 36, textAlign: 'center' }}>PK</span>
                <span style={{ ...S.colCell, width: 36, textAlign: 'center' }}>NN</span>
                <span style={{ ...S.colCell, width: 36, textAlign: 'center' }}>UQ</span>
                <span style={{ ...S.colCell, flex: 2 }}>Foreign Key</span>
                <span style={{ ...S.colCell, width: 28 }}></span>
              </div>

              {columns.map((col, i) => (
                <ColumnRow
                  key={i}
                  col={col}
                  index={i}
                  total={columns.length}
                  allTables={allTables}
                  onUpdate={(field, val) => updateColumn(i, field, val)}
                  onRemove={() => removeColumn(i)}
                  onMove={(dir) => moveColumn(i, dir)}
                  onSetFK={(ref) => setFK(i, ref)}
                />
              ))}

              {columns.length === 0 && (
                <div style={{ padding: '16px', color: 'var(--pp-text-muted)', textAlign: 'center', fontSize: 12 }}>
                  No columns. Click "+ Add Column" to start.
                </div>
              )}
            </div>
          </div>

          {/* DDL Preview */}
          <div style={S.ddlSection}>
            <button
              className="secondary"
              style={{ fontSize: 11 }}
              onClick={() => setShowDDL(v => !v)}
            >
              {showDDL ? '▾' : '▸'} Preview SQL
            </button>
            {showDDL && (
              <pre style={S.ddlPre}>{ddl}</pre>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={S.footer}>
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button onClick={handleCreate} disabled={!canCreate || creating}>
            {creating ? 'Creating…' : '✓ Create Table'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Column Row ───────────────────────────────────────────────────────────────

interface ColumnRowProps {
  col: ColumnDefinition;
  index: number;
  total: number;
  allTables: { schema: string; table: string }[];
  onUpdate: (field: keyof ColumnDefinition, value: unknown) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onSetFK: (ref: { schema: string; table: string; column: string } | undefined) => void;
}

function ColumnRow({ col, index, total, allTables, onUpdate, onRemove, onMove, onSetFK }: ColumnRowProps) {
  const [showFKPicker, setShowFKPicker] = useState(false);
  const [fkTable, setFkTable] = useState(col.foreignKey ? `${col.foreignKey.schema}.${col.foreignKey.table}` : '');
  const [fkColumn, setFkColumn] = useState(col.foreignKey?.column ?? '');

  function applyFK() {
    if (fkTable) {
      const [schema, table] = fkTable.split('.');
      onSetFK({ schema, table, column: fkColumn || 'id' });
    } else {
      onSetFK(undefined);
    }
    setShowFKPicker(false);
  }

  return (
    <div style={{ ...S.colRow, background: index % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
      {/* Order buttons */}
      <div style={{ ...S.colCell, width: 28, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <button className="secondary" style={S.miniBtn} onClick={() => onMove(-1)} disabled={index === 0} title="Move up">↑</button>
        <button className="secondary" style={S.miniBtn} onClick={() => onMove(1)} disabled={index === total - 1} title="Move down">↓</button>
      </div>

      {/* Name */}
      <div style={{ ...S.colCell, flex: 2 }}>
        <input
          value={col.name}
          onChange={e => onUpdate('name', e.target.value.replace(/\s/g, '_').toLowerCase())}
          placeholder="column_name"
          style={{ ...S.input, width: '100%' }}
        />
      </div>

      {/* Type */}
      <div style={{ ...S.colCell, flex: 2 }}>
        <select
          value={col.type}
          onChange={e => onUpdate('type', e.target.value)}
          style={{ ...S.select, width: '100%' }}
        >
          {PG_TYPES.map(group => (
            <optgroup key={group.group} label={group.group}>
              {group.types.map(t => <option key={t} value={t}>{t}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Default */}
      <div style={{ ...S.colCell, flex: 2 }}>
        <input
          value={col.defaultValue}
          onChange={e => onUpdate('defaultValue', e.target.value)}
          placeholder="none"
          style={{ ...S.input, width: '100%' }}
          disabled={col.type === 'serial' || col.type === 'bigserial'}
        />
      </div>

      {/* PK */}
      <div style={{ ...S.colCell, width: 36, textAlign: 'center' }}>
        <CheckBox
          checked={col.isPrimaryKey}
          color="#dcdcaa"
          onChange={v => onUpdate('isPrimaryKey', v)}
        />
      </div>

      {/* Not Null */}
      <div style={{ ...S.colCell, width: 36, textAlign: 'center' }}>
        <CheckBox
          checked={!col.isNullable}
          color="#9cdcfe"
          onChange={v => onUpdate('isNullable', !v)}
          disabled={col.isPrimaryKey}
        />
      </div>

      {/* Unique */}
      <div style={{ ...S.colCell, width: 36, textAlign: 'center' }}>
        <CheckBox
          checked={col.isUnique}
          color="#c586c0"
          onChange={v => onUpdate('isUnique', v)}
          disabled={col.isPrimaryKey}
        />
      </div>

      {/* FK */}
      <div style={{ ...S.colCell, flex: 2 }}>
        {!showFKPicker ? (
          <button
            className="secondary"
            style={{ fontSize: 11, width: '100%', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}
            onClick={() => setShowFKPicker(true)}
          >
            {col.foreignKey
              ? `→ ${col.foreignKey.table}.${col.foreignKey.column}`
              : <span style={{ color: 'var(--pp-text-muted)' }}>none</span>}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 4 }}>
            <select
              value={fkTable}
              onChange={e => setFkTable(e.target.value)}
              style={{ ...S.select, flex: 1, fontSize: 11 }}
            >
              <option value="">— none —</option>
              {allTables.map(t => (
                <option key={`${t.schema}.${t.table}`} value={`${t.schema}.${t.table}`}>
                  {t.schema}.{t.table}
                </option>
              ))}
            </select>
            <input
              value={fkColumn}
              onChange={e => setFkColumn(e.target.value)}
              placeholder="col"
              style={{ ...S.input, width: 60, fontSize: 11 }}
            />
            <button style={{ padding: '2px 6px', fontSize: 11 }} onClick={applyFK}>✓</button>
          </div>
        )}
      </div>

      {/* Remove */}
      <div style={{ ...S.colCell, width: 28 }}>
        <button className="danger" style={S.miniBtn} onClick={onRemove} title="Remove column">✕</button>
      </div>
    </div>
  );
}

function CheckBox({ checked, color, onChange, disabled }: {
  checked: boolean;
  color: string;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 18, height: 18,
        border: `2px solid ${checked ? color : 'var(--pp-border)'}`,
        borderRadius: 3,
        background: checked ? color + '33' : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        color,
        opacity: disabled ? 0.4 : 1,
        userSelect: 'none',
      }}
    >
      {checked && '✓'}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200,
  },
  modal: {
    background: 'var(--pp-bg-secondary)',
    border: '1px solid var(--pp-border)',
    borderRadius: 6,
    width: 860,
    maxWidth: '98vw',
    maxHeight: '92vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px',
    borderBottom: '1px solid var(--pp-border)',
    flexShrink: 0,
  },
  title: { margin: 0, fontSize: 16, fontWeight: 600 },
  closeBtn: { padding: '2px 8px' },
  body: { flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 },
  topRow: { display: 'flex', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--pp-text-muted)', fontWeight: 600 },
  input: { background: 'var(--pp-input-bg)', border: '1px solid var(--pp-input-border)', color: 'var(--pp-text)', borderRadius: 2, padding: '4px 8px', fontSize: 12 },
  select: { background: 'var(--pp-input-bg)', border: '1px solid var(--pp-input-border)', color: 'var(--pp-text)', borderRadius: 2, padding: '4px 6px', fontSize: 12 },
  section: { display: 'flex', flexDirection: 'column', gap: 6 },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--pp-text-muted)', fontWeight: 600 },
  addColBtn: { padding: '3px 10px', fontSize: 12 },
  colTable: { border: '1px solid var(--pp-border)', borderRadius: 4, overflow: 'hidden' },
  colHeaderRow: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '5px 8px',
    background: 'var(--pp-bg)',
    borderBottom: '1px solid var(--pp-border)',
    fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.05em', color: 'var(--pp-text-muted)',
  },
  colRow: { display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', borderBottom: '1px solid var(--pp-border)' },
  colCell: { display: 'flex', alignItems: 'center', flexShrink: 0 },
  miniBtn: { padding: '1px 4px', fontSize: 10, lineHeight: 1.2 },
  ddlSection: { display: 'flex', flexDirection: 'column', gap: 6 },
  ddlPre: {
    margin: 0, padding: '10px 14px',
    background: 'var(--pp-bg)',
    border: '1px solid var(--pp-border)',
    borderRadius: 4,
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#9cdcfe',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '12px 20px',
    borderTop: '1px solid var(--pp-border)',
    flexShrink: 0,
  },
};
