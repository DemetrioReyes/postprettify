import { create } from 'zustand';
import type {
  ConnectionConfig,
  SchemaInfo,
  TableDataPage,
  ColumnInfo,
  IndexInfo,
  FunctionInfo,
  ForeignKeyInfo,
  QueryResult,
  QueryHistoryEntry,
} from '../../../src/types';

// ─── Active view routing ──────────────────────────────────────────────────────

export type ActiveView =
  | { kind: 'welcome' }
  | { kind: 'table'; connectionId: string; schema: string; table: string }
  | { kind: 'query'; connectionId: string }
  | { kind: 'erd'; connectionId: string }
  | { kind: 'functions'; connectionId: string };

// ─── Tabs ─────────────────────────────────────────────────────────────────────

export interface Tab {
  id: string;
  label: string;
  icon: string;
  view: ActiveView;
}

function viewToTabId(view: ActiveView): string {
  if (view.kind === 'table') return `table:${view.connectionId}:${view.schema}.${view.table}`;
  if (view.kind === 'query') return `query:${view.connectionId}`;
  if (view.kind === 'erd') return `erd:${view.connectionId}`;
  if (view.kind === 'functions') return `functions:${view.connectionId}`;
  return 'welcome';
}

function viewToLabel(view: ActiveView): string {
  if (view.kind === 'table') return view.table;
  if (view.kind === 'query') return 'SQL';
  if (view.kind === 'erd') return 'ERD';
  if (view.kind === 'functions') return 'Functions';
  return 'Home';
}

function viewToIcon(view: ActiveView): string {
  if (view.kind === 'table') return '▦';
  if (view.kind === 'query') return '⌨';
  if (view.kind === 'erd') return '⬡';
  if (view.kind === 'functions') return 'ƒ';
  return '🏠';
}

// ─── Toasts ───────────────────────────────────────────────────────────────────

export interface Toast {
  id: string;
  message: string;
  kind: 'success' | 'error' | 'info';
}

// ─── Connection state ─────────────────────────────────────────────────────────

interface ConnectedInfo {
  config: ConnectionConfig;
  schemas: SchemaInfo[];
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface AppStore {
  // All saved connections (from extension host)
  savedConnections: ConnectionConfig[];
  setSavedConnections: (conns: ConnectionConfig[]) => void;

  // Active DB connections
  connections: Map<string, ConnectedInfo>;
  addConnection: (config: ConnectionConfig, schemas: SchemaInfo[]) => void;
  removeConnection: (id: string) => void;

  // Current view
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;

  // Tabs
  tabs: Tab[];
  activeTabId: string | null;
  closeTab: (id: string) => void;

  // Toasts
  toasts: Toast[];
  addToast: (message: string, kind: Toast['kind']) => void;
  removeToast: (id: string) => void;

  // Table data cache (key: `schema.table`)
  tableData: Map<string, TableDataPage>;
  setTableData: (schema: string, table: string, data: TableDataPage) => void;

  // Column cache
  columnCache: Map<string, ColumnInfo[]>;
  setColumns: (schema: string, table: string, cols: ColumnInfo[]) => void;

  // Index cache (key: `schema.table`)
  indexCache: Map<string, IndexInfo[]>;
  setIndexes: (schema: string, table: string, indexes: IndexInfo[]) => void;

  // Functions
  functions: FunctionInfo[];
  setFunctions: (fns: FunctionInfo[]) => void;

  // Foreign keys
  foreignKeys: ForeignKeyInfo[];
  setForeignKeys: (fks: ForeignKeyInfo[]) => void;

  // Query results
  queryResult: QueryResult | null;
  setQueryResult: (result: QueryResult | null) => void;

  // Explain result
  explainResult: string | null;
  setExplainResult: (plan: string | null) => void;

  // Query history
  queryHistory: QueryHistoryEntry[];
  setQueryHistory: (history: QueryHistoryEntry[]) => void;

  // Loading/error state
  loading: boolean;
  setLoading: (v: boolean) => void;
  error: string | null;
  setError: (msg: string | null) => void;
}

export const useStore = create<AppStore>((set, get) => ({
  savedConnections: [],
  setSavedConnections: (conns) => set({ savedConnections: conns }),

  connections: new Map(),
  addConnection: (config, schemas) => {
    const connections = new Map(get().connections);
    connections.set(config.id, { config, schemas });
    set({ connections });
  },
  removeConnection: (id) => {
    const connections = new Map(get().connections);
    connections.delete(id);
    // Close all tabs for this connection
    const tabs = get().tabs.filter(t => {
      const v = t.view;
      return v.kind === 'welcome' || !('connectionId' in v) || v.connectionId !== id;
    });
    const activeTabId = tabs.find(t => t.id === get().activeTabId)?.id ?? (tabs[tabs.length - 1]?.id ?? null);
    const activeView = tabs.find(t => t.id === activeTabId)?.view ?? { kind: 'welcome' as const };
    set({ connections, tabs, activeTabId, activeView });
  },

  activeView: { kind: 'welcome' },
  setActiveView: (view) => {
    if (view.kind === 'welcome') {
      set({ activeView: view });
      return;
    }
    const tabId = viewToTabId(view);
    const { tabs } = get();
    const existing = tabs.find(t => t.id === tabId);
    if (existing) {
      set({ activeView: view, activeTabId: tabId });
    } else {
      const newTab: Tab = { id: tabId, label: viewToLabel(view), icon: viewToIcon(view), view };
      set({ activeView: view, activeTabId: tabId, tabs: [...tabs, newTab] });
    }
  },

  tabs: [],
  activeTabId: null,
  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex(t => t.id === id);
    const newTabs = tabs.filter(t => t.id !== id);
    let newActiveId = activeTabId;
    let newActiveView: ActiveView = { kind: 'welcome' };

    if (activeTabId === id) {
      // Activate adjacent tab
      const nextTab = newTabs[idx] ?? newTabs[idx - 1] ?? null;
      newActiveId = nextTab?.id ?? null;
      newActiveView = nextTab?.view ?? { kind: 'welcome' };
    } else {
      newActiveView = newTabs.find(t => t.id === newActiveId)?.view ?? { kind: 'welcome' };
    }

    set({ tabs: newTabs, activeTabId: newActiveId, activeView: newActiveView });
  },

  toasts: [],
  addToast: (message, kind) => {
    const id = Math.random().toString(36).slice(2);
    set(s => ({ toasts: [...s.toasts, { id, message, kind }] }));
    // Auto-dismiss after 4s (success/info) or 8s (error)
    setTimeout(() => {
      get().removeToast(id);
    }, kind === 'error' ? 8000 : 4000);
  },
  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

  tableData: new Map(),
  setTableData: (schema, table, data) => {
    const tableData = new Map(get().tableData);
    tableData.set(`${schema}.${table}`, data);
    set({ tableData });
  },

  columnCache: new Map(),
  setColumns: (schema, table, cols) => {
    const columnCache = new Map(get().columnCache);
    columnCache.set(`${schema}.${table}`, cols);
    set({ columnCache });
  },

  indexCache: new Map(),
  setIndexes: (schema, table, indexes) => {
    const indexCache = new Map(get().indexCache);
    indexCache.set(`${schema}.${table}`, indexes);
    set({ indexCache });
  },

  functions: [],
  setFunctions: (fns) => set({ functions: fns }),

  foreignKeys: [],
  setForeignKeys: (fks) => set({ foreignKeys: fks }),

  queryResult: null,
  setQueryResult: (result) => set({ queryResult: result }),

  explainResult: null,
  setExplainResult: (plan) => set({ explainResult: plan }),

  queryHistory: [],
  setQueryHistory: (history) => set({ queryHistory: history }),

  loading: false,
  setLoading: (v) => set({ loading: v }),

  error: null,
  setError: (msg) => set({ error: msg }),
}));
