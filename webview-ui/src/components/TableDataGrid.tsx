import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type RowSelectionState,
} from '@tanstack/react-table';
import { useStore } from '../store';
import { postMessage } from '../vscode';
import type { ColumnInfo, TableDataSort } from '../../../src/types';

// ─── Type badge colors ────────────────────────────────────────────────────────

function typeColor(type: string): string {
  if (['integer','bigint','smallint','serial','bigserial','numeric','real','double precision'].includes(type)) return '#b5cea8';
  if (['text','varchar','char','name'].includes(type) || type.startsWith('varchar') || type.startsWith('char')) return '#ce9178';
  if (['boolean'].includes(type)) return '#569cd6';
  if (['date','time','timestamp','timestamptz'].includes(type) || type.includes('timestamp')) return '#c586c0';
  if (['uuid'].includes(type)) return '#4ec9b0';
  if (['json','jsonb'].includes(type)) return '#dcdcaa';
  return '#9cdcfe';
}

// ─── Cell renderer ────────────────────────────────────────────────────────────

function CellValue({ val }: { val: unknown }) {
  if (val === null) return <span style={{ color: 'var(--pp-text-muted)', fontStyle: 'italic', fontSize: 11 }}>NULL</span>;
  if (typeof val === 'boolean') return <span style={{ color: '#569cd6' }}>{String(val)}</span>;
  const str = String(val);
  if (str.length > 120) return <span title={str}>{str.slice(0, 120)}…</span>;
  return <span>{str}</span>;
}

// ─── Insert / Edit Row Panel ──────────────────────────────────────────────────

interface RowPanelProps {
  columns: ColumnInfo[];
  initialValues?: Record<string, unknown>;
  mode: 'insert' | 'edit';
  onSubmit: (values: Record<string, unknown>) => void;
  onClose: () => void;
}

function RowPanel({ columns, initialValues = {}, mode, onSubmit, onClose }: RowPanelProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const col of columns) {
      const v = initialValues[col.name];
      init[col.name] = v === null || v === undefined ? '' : String(v);
    }
    return init;
  });

  const editableCols = columns.filter(col => {
    if (mode === 'insert' && col.isPrimaryKey && (col.udtName === 'int4' || col.udtName === 'int8')) return false;
    if (mode === 'insert' && (col.columnDefault?.startsWith('nextval') || col.columnDefault?.startsWith('gen_random'))) return false;
    return true;
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result: Record<string, unknown> = {};
    for (const col of editableCols) {
      const v = values[col.name];
      result[col.name] = v === '' ? (col.isNullable ? null : '') : v;
    }
    onSubmit(result);
  }

  return (
    <div style={PS.panel}>
      <div style={PS.header}>
        <span style={PS.title}>{mode === 'insert' ? '+ Insert Row' : '✎ Edit Row'}</span>
        <button className="secondary" style={{ padding: '2px 7px' }} onClick={onClose}>✕</button>
      </div>
      <form onSubmit={handleSubmit} style={PS.form}>
        {editableCols.map(col => (
          <div key={col.name} style={PS.field}>
            <div style={PS.fieldLabel}>
              <span>{col.name}</span>
              <span style={{ color: typeColor(col.dataType), fontSize: 10, marginLeft: 4 }}>{col.dataType}</span>
              {col.isPrimaryKey && <span className="tag-pk" style={{ marginLeft: 4 }}>PK</span>}
              {col.isForeignKey && <span className="tag-fk" style={{ marginLeft: 4 }}>FK</span>}
              {!col.isNullable && <span style={{ color: 'var(--pp-error)', fontSize: 10, marginLeft: 4 }}>*</span>}
            </div>
            <ColumnInput
              col={col}
              value={values[col.name] ?? ''}
              onChange={v => setValues(prev => ({ ...prev, [col.name]: v }))}
            />
          </div>
        ))}
        {editableCols.length === 0 && (
          <p style={{ color: 'var(--pp-text-muted)', fontSize: 12, textAlign: 'center' }}>
            No editable columns (all auto-generated)
          </p>
        )}
        <div style={PS.actions}>
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit">{mode === 'insert' ? 'Insert' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

function ColumnInput({ col, value, onChange }: { col: ColumnInfo; value: string; onChange: (v: string) => void }) {
  const t = col.dataType;
  const placeholder = col.columnDefault ? `default: ${col.columnDefault}` : col.isNullable ? 'NULL' : '';

  if (t === 'boolean') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} style={PS.input}>
        {col.isNullable && <option value="">NULL</option>}
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (t === 'json' || t === 'jsonb') {
    return (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || '{"key": "value"}'}
        style={{ ...PS.input, height: 80, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
      />
    );
  }
  if (t === 'date') return <input type="date" value={value} onChange={e => onChange(e.target.value)} style={PS.input} />;
  if (t === 'time') return <input type="time" value={value} onChange={e => onChange(e.target.value)} style={PS.input} />;
  if (t.includes('timestamp')) return <input type="datetime-local" value={value} onChange={e => onChange(e.target.value)} style={PS.input} />;
  if (['integer','smallint','bigint','real','numeric','double precision'].includes(t)) {
    return <input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={PS.input} />;
  }
  return <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={PS.input} />;
}

const PS: Record<string, React.CSSProperties> = {
  panel: { width: 300, borderLeft: '1px solid var(--pp-border)', background: 'var(--pp-bg-secondary)', display: 'flex', flexDirection: 'column', flexShrink: 0 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--pp-border)', flexShrink: 0 },
  title: { fontWeight: 600, fontSize: 13 },
  form: { flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 3 },
  fieldLabel: { display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 500 },
  input: { background: 'var(--pp-input-bg)', border: '1px solid var(--pp-input-border)', color: 'var(--pp-text)', borderRadius: 2, padding: '4px 7px', fontSize: 12, width: '100%' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 },
};

// ─── Context Menu ─────────────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number; y: number;
  row: Record<string, unknown>;
  tableName: string;
  onClose: () => void;
}

function ContextMenu({ x, y, row, tableName, onClose }: ContextMenuProps) {
  function copyAsJSON() {
    navigator.clipboard?.writeText(JSON.stringify(row, null, 2)).catch(() => {
      const el = document.createElement('textarea');
      el.value = JSON.stringify(row, null, 2);
      document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    });
    onClose();
  }

  function copyAsInsert() {
    const cols = Object.keys(row).map(k => `"${k}"`).join(', ');
    const vals = Object.values(row).map(v => {
      if (v === null) return 'NULL';
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return `'${String(v).replace(/'/g, "''")}'`;
    }).join(', ');
    const sql = `INSERT INTO "${tableName}" (${cols}) VALUES (${vals});`;
    navigator.clipboard?.writeText(sql).catch(() => {
      const el = document.createElement('textarea');
      el.value = sql;
      document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    });
    onClose();
  }

  function copyAsSingleValue(key: string) {
    const val = row[key];
    const str = val === null ? 'NULL' : String(val);
    navigator.clipboard?.writeText(str).catch(() => {});
    onClose();
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={onClose} />
      <div style={{ position: 'fixed', left: x, top: y, zIndex: 300, background: 'var(--pp-bg-secondary)', border: '1px solid var(--pp-border)', borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', minWidth: 180, overflow: 'hidden', fontSize: 12 }}>
        <MenuItem label="Copy row as JSON" onClick={copyAsJSON} />
        <MenuItem label="Copy as INSERT SQL" onClick={copyAsInsert} />
        <div style={{ borderTop: '1px solid var(--pp-border)', margin: '2px 0' }} />
        {Object.keys(row).slice(0, 8).map(k => (
          <MenuItem key={k} label={`Copy "${k}"`} onClick={() => copyAsSingleValue(k)} muted />
        ))}
      </div>
    </>
  );
}

function MenuItem({ label, onClick, muted }: { label: string; onClick: () => void; muted?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      style={{ padding: '6px 12px', cursor: 'pointer', background: hov ? 'var(--pp-bg-hover)' : 'transparent', color: muted ? 'var(--pp-text-muted)' : 'var(--pp-text)' }}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {label}
    </div>
  );
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) {
        cells.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

// ─── Main Grid ────────────────────────────────────────────────────────────────

interface Props {
  connectionId: string;
  schema: string;
  table: string;
  onModifyTable?: () => void;
}

type PanelMode = { kind: 'insert' } | { kind: 'edit'; row: Record<string, unknown> } | null;

export function TableDataGrid({ connectionId, schema, table, onModifyTable }: Props) {
  const { tableData, columnCache, addToast } = useStore();
  const key = `${schema}.${table}`;
  const data = tableData.get(key);
  const columns = columnCache.get(key) ?? [];

  const [sort, setSort] = useState<TableDataSort | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [panel, setPanel] = useState<PanelMode>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: Record<string, unknown> } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pageSize = data?.pageSize ?? 50;
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const activeFilters = Object.entries(filters).filter(([, v]) => v.trim());

  useEffect(() => {
    loadPage(1);
    setRowSelection({});
    setPanel(null);
    setFilters({});
    setSort(null);
    setPage(1);
  }, [schema, table, connectionId]);

  const loadPage = useCallback((p: number, overrideSort?: TableDataSort | null, overrideFilters?: Record<string, string>) => {
    const s = overrideSort !== undefined ? overrideSort : sort;
    const f = overrideFilters !== undefined ? overrideFilters : filters;
    const cleanFilters: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) {
      if (v.trim()) cleanFilters[k] = v;
    }
    setPage(p);
    postMessage({
      command: 'fetchTableData',
      payload: {
        connectionId, schema, table, page: p, pageSize,
        sort: s ?? undefined,
        filters: Object.keys(cleanFilters).length ? cleanFilters : undefined,
      },
    });
  }, [connectionId, schema, table, pageSize, sort, filters]);

  function handleSortColumn(colKey: string) {
    const newSort: TableDataSort | null =
      sort?.column === colKey
        ? sort.direction === 'asc' ? { column: colKey, direction: 'desc' } : null
        : { column: colKey, direction: 'asc' };
    setSort(newSort);
    loadPage(1, newSort);
  }

  function applyFilter(col: string, val: string) {
    const next = { ...filters, [col]: val };
    setFilters(next);
    loadPage(1, undefined, next);
  }

  function clearAllFilters() {
    setFilters({});
    loadPage(1, undefined, {});
  }

  const pkColumns = columns.filter(c => c.isPrimaryKey).map(c => c.name);

  function buildPK(row: Record<string, unknown>) {
    if (pkColumns.length === 0) return row;
    return Object.fromEntries(pkColumns.map(k => [k, row[k]]));
  }

  // Client-side global search on loaded rows
  const rawRows = data?.rows ?? [];
  const displayRows = search.trim()
    ? rawRows.filter(row => Object.values(row).some(v => v !== null && String(v).toLowerCase().includes(search.toLowerCase())))
    : rawRows;

  // ─── Column defs ───────────────────────────────────────────────────────────

  const checkboxCol: ColumnDef<Record<string, unknown>> = {
    id: '__select', size: 36,
    header: ({ table: t }) => (
      <input type="checkbox" checked={t.getIsAllRowsSelected()} onChange={t.getToggleAllRowsSelectedHandler()} style={{ cursor: 'pointer' }} />
    ),
    cell: ({ row }) => (
      <input type="checkbox" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} style={{ cursor: 'pointer' }} />
    ),
  };

  const rowNumCol: ColumnDef<Record<string, unknown>> = {
    id: '__rownum', size: 44,
    header: () => <span style={{ color: 'var(--pp-text-muted)', fontSize: 10 }}>#</span>,
    cell: ({ row }) => (
      <span style={{ color: 'var(--pp-text-muted)', fontSize: 11, userSelect: 'none' }}>
        {(page - 1) * pageSize + row.index + 1}
      </span>
    ),
  };

  const colKeys = columns.length > 0
    ? columns.map(c => c.name)
    : rawRows.length > 0 ? Object.keys(rawRows[0]) : [];

  const dataCols: ColumnDef<Record<string, unknown>>[] = colKeys.map(colKey => {
    const colInfo = columns.find(c => c.name === colKey);
    const isSorted = sort?.column === colKey;
    return {
      id: colKey, accessorKey: colKey,
      header: () => (
        <div>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => handleSortColumn(colKey)}
          >
            {colInfo?.isPrimaryKey && <span style={{ color: '#dcdcaa', fontSize: 9, fontWeight: 700 }}>PK</span>}
            {colInfo?.isForeignKey && <span style={{ color: '#9cdcfe', fontSize: 9, fontWeight: 700 }}>FK</span>}
            <span style={{ fontWeight: 600 }}>{colKey}</span>
            {isSorted && <span style={{ color: 'var(--pp-accent)' }}>{sort?.direction === 'asc' ? '↑' : '↓'}</span>}
            {!isSorted && <span style={{ color: 'var(--pp-border)', fontSize: 9 }}>↕</span>}
          </div>
          {colInfo && (
            <span style={{ color: typeColor(colInfo.dataType), fontSize: 9, fontWeight: 400 }}>
              {colInfo.dataType}{!colInfo.isNullable && <span style={{ color: 'var(--pp-error)' }}> *</span>}
            </span>
          )}
          {showFilters && (
            <input
              value={filters[colKey] ?? ''}
              onChange={e => applyFilter(colKey, e.target.value)}
              placeholder="filter…"
              style={{ width: '100%', marginTop: 3, fontSize: 11, padding: '2px 4px', background: 'var(--pp-input-bg)', border: `1px solid ${filters[colKey] ? 'var(--pp-accent)' : 'var(--pp-input-border)'}`, color: 'var(--pp-text)', borderRadius: 2 }}
              onClick={e => e.stopPropagation()}
            />
          )}
        </div>
      ),
      cell: info => <CellValue val={info.getValue()} />,
    };
  });

  const actionCol: ColumnDef<Record<string, unknown>> = {
    id: '__actions', size: 64,
    header: () => null,
    cell: ({ row }) => (
      <div style={{ display: 'flex', gap: 3 }}>
        <button className="secondary" style={{ padding: '1px 6px', fontSize: 10 }} title="Edit row"
          onClick={() => setPanel({ kind: 'edit', row: row.original })}>✎</button>
        <button className="danger" style={{ padding: '1px 6px', fontSize: 10 }} title="Delete row"
          onClick={() => deleteRows([row.original])}>✕</button>
      </div>
    ),
  };

  const tableInstance = useReactTable({
    data: displayRows,
    columns: [checkboxCol, rowNumCol, ...dataCols, actionCol],
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
  });

  // ─── CRUD operations ────────────────────────────────────────────────────────

  function insertRow(values: Record<string, unknown>) {
    postMessage({ command: 'insertRow', payload: { connectionId, schema, table, row: values } });
    setPanel(null);
    setTimeout(() => loadPage(page), 400);
  }

  function updateRow(originalRow: Record<string, unknown>, changes: Record<string, unknown>) {
    const pk = buildPK(originalRow);
    postMessage({ command: 'updateRow', payload: { connectionId, schema, table, primaryKey: pk, changes } });
    setPanel(null);
    setTimeout(() => loadPage(page), 400);
  }

  function deleteRows(rows: Record<string, unknown>[]) {
    if (!confirm(`Delete ${rows.length} row${rows.length > 1 ? 's' : ''}?`)) return;
    for (const row of rows) {
      postMessage({ command: 'deleteRow', payload: { connectionId, schema, table, primaryKey: buildPK(row) } });
    }
    setRowSelection({});
    setTimeout(() => loadPage(page), 400);
  }

  function deleteSelected() {
    const selected = tableInstance.getSelectedRowModel().rows.map(r => r.original);
    deleteRows(selected);
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  function exportCSV() {
    const rows = tableInstance.getRowModel().rows.map(r => r.original);
    const headers = colKeys;
    const lines = [
      headers.join(','),
      ...rows.map(row => headers.map(h => {
        const v = row[h];
        if (v === null || v === undefined) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','))
    ];
    downloadFile(lines.join('\n'), `${table}.csv`, 'text/csv');
  }

  function exportJSON() {
    const rows = tableInstance.getRowModel().rows.map(r => r.original);
    downloadFile(JSON.stringify(rows, null, 2), `${table}.json`, 'application/json');
  }

  function downloadFile(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Import CSV ──────────────────────────────────────────────────────────────

  function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const text = evt.target?.result as string;
        const parsed = parseCSV(text);
        if (parsed.length < 2) { addToast('CSV must have at least a header row and one data row', 'error'); return; }
        const headers = parsed[0];
        const rows: Record<string, unknown>[] = parsed.slice(1).map(cells =>
          Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? null]))
        );
        postMessage({ command: 'importRows', payload: { connectionId, schema, table, rows } });
        setTimeout(() => loadPage(1), 600);
      } catch {
        addToast('Failed to parse CSV file', 'error');
      }
    };
    reader.readAsText(file);
    // Reset so same file can be re-selected
    e.target.value = '';
  }

  const selectedCount = Object.keys(rowSelection).length;
  const isEmpty = rawRows.length === 0 && !data;
  const isEmptyTable = rawRows.length === 0 && data;

  return (
    <div style={G.root}>
      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y} row={contextMenu.row} tableName={table}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Hidden file input for CSV import */}
      <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileImport} />

      {/* ── Toolbar ── */}
      <div style={G.toolbar}>
        <div style={G.tableTitle}>
          <span style={{ color: 'var(--pp-text-muted)', fontSize: 12 }}>{schema}.</span>
          <strong style={{ fontSize: 14 }}>{table}</strong>
          <span className="badge">{totalCount.toLocaleString()} rows</span>
          {activeFilters.length > 0 && (
            <span className="badge" style={{ background: 'rgba(0,127,212,0.2)', color: 'var(--pp-accent)', cursor: 'pointer' }}
              onClick={clearAllFilters} title="Clear all filters">
              {activeFilters.length} filter{activeFilters.length > 1 ? 's' : ''} ✕
            </span>
          )}
        </div>

        <div style={G.toolbarCenter}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Quick search loaded rows…"
            style={{ ...G.searchInput, width: 200 }}
          />
        </div>

        <div style={G.toolbarRight}>
          {selectedCount > 0 && (
            <button className="danger" onClick={deleteSelected}>
              🗑 Delete {selectedCount} row{selectedCount > 1 ? 's' : ''}
            </button>
          )}
          <button
            className="secondary"
            style={{ fontSize: 11, background: showFilters ? 'rgba(0,127,212,0.15)' : undefined }}
            onClick={() => setShowFilters(v => !v)}
            title="Toggle column filters"
          >
            ⊟ Filter
          </button>
          <button className="secondary" style={{ fontSize: 11 }} onClick={exportCSV} title="Export CSV">↓ CSV</button>
          <button className="secondary" style={{ fontSize: 11 }} onClick={exportJSON} title="Export JSON">↓ JSON</button>
          <button className="secondary" style={{ fontSize: 11 }} onClick={() => fileInputRef.current?.click()} title="Import CSV">↑ Import</button>
          <button className="secondary" onClick={() => loadPage(page)} title="Refresh">↻</button>
          {onModifyTable && (
            <button className="secondary" onClick={onModifyTable} title="Modify table structure">⚙ Modify</button>
          )}
          <button onClick={() => setPanel({ kind: 'insert' })}>+ Insert Row</button>
        </div>
      </div>

      {/* ── Main area (grid + panel) ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={G.gridWrapper}>
          {isEmptyTable ? (
            <div style={G.emptyState}>
              <div style={{ fontSize: 40 }}>📭</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>No rows yet</div>
              <div style={{ color: 'var(--pp-text-muted)', fontSize: 12 }}>Click "+ Insert Row" to add the first row</div>
              <button onClick={() => setPanel({ kind: 'insert' })} style={{ marginTop: 8 }}>+ Insert Row</button>
            </div>
          ) : isEmpty ? (
            <div style={G.emptyState}>
              <div style={{ fontSize: 32, opacity: 0.3 }}>⏳</div>
              <div style={{ color: 'var(--pp-text-muted)', fontSize: 12 }}>Loading…</div>
            </div>
          ) : (
            <table style={G.table}>
              <thead>
                {tableInstance.getHeaderGroups().map(hg => (
                  <tr key={hg.id}>
                    {hg.headers.map(header => (
                      <th key={header.id} style={{ ...G.th, width: header.getSize() }}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {tableInstance.getRowModel().rows.map(row => {
                  const isSelected = row.getIsSelected();
                  return (
                    <tr
                      key={row.id}
                      style={{ ...G.tr, background: isSelected ? 'rgba(0,127,212,0.12)' : undefined }}
                      onContextMenu={e => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, row: row.original });
                      }}
                    >
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} style={G.td}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {panel && (
          <RowPanel
            columns={columns}
            mode={panel.kind}
            initialValues={panel.kind === 'edit' ? panel.row : {}}
            onSubmit={values => {
              if (panel.kind === 'insert') insertRow(values);
              else updateRow(panel.row, values);
            }}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      {/* ── Pagination ── */}
      <div style={G.pagination}>
        <button className="secondary" onClick={() => loadPage(1)} disabled={page <= 1}>«</button>
        <button className="secondary" onClick={() => loadPage(page - 1)} disabled={page <= 1}>‹</button>
        <span style={{ padding: '0 10px', color: 'var(--pp-text-muted)', fontSize: 12 }}>
          Page <strong>{page}</strong> / {totalPages}
        </span>
        <button className="secondary" onClick={() => loadPage(page + 1)} disabled={page >= totalPages}>›</button>
        <button className="secondary" onClick={() => loadPage(totalPages)} disabled={page >= totalPages}>»</button>
        <span style={{ marginLeft: 'auto', color: 'var(--pp-text-muted)', fontSize: 12 }}>
          {totalCount.toLocaleString()} total · showing {displayRows.length}
          {sort && <span style={{ color: 'var(--pp-accent)', marginLeft: 8 }}>sorted by {sort.column} {sort.direction}</span>}
        </span>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const G: Record<string, React.CSSProperties> = {
  root: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 14px',
    borderBottom: '1px solid var(--pp-border)',
    flexShrink: 0,
    background: 'var(--pp-bg-secondary)',
    flexWrap: 'wrap',
  },
  tableTitle: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  toolbarCenter: { flex: 1, minWidth: 140 },
  toolbarRight: { display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' },
  searchInput: {
    background: 'var(--pp-input-bg)', border: '1px solid var(--pp-input-border)',
    color: 'var(--pp-text)', borderRadius: 3, padding: '3px 8px', fontSize: 12,
  },
  gridWrapper: { flex: 1, overflow: 'auto' },
  emptyState: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, height: '100%', padding: 40, textAlign: 'center' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'auto' },
  th: {
    position: 'sticky', top: 0,
    background: 'var(--pp-bg-secondary)',
    padding: '7px 10px',
    textAlign: 'left',
    borderBottom: '2px solid var(--pp-border)',
    borderRight: '1px solid var(--pp-border)',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    verticalAlign: 'top',
  },
  tr: { borderBottom: '1px solid var(--pp-border)' },
  td: { padding: '5px 10px', borderRight: '1px solid var(--pp-border)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' },
  pagination: { display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderTop: '1px solid var(--pp-border)', flexShrink: 0, background: 'var(--pp-bg-secondary)' },
};
