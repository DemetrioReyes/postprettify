// ─── Connection types ───────────────────────────────────────────────────────────

export interface ConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
  /** Password is stored separately in SecretStorage */
}

export interface ConnectionWithPassword extends ConnectionConfig {
  password: string;
}

// ─── Database schema types ──────────────────────────────────────────────────

export interface SchemaInfo {
  name: string;
  tables: TableInfo[];
}

export interface TableInfo {
  schema: string;
  name: string;
  type: 'table' | 'view';
  rowCount?: number;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  columnDefault: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isUnique: boolean;
  foreignKeyRef?: {
    table: string;
    column: string;
    schema: string;
  };
  maxLength?: number;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  definition: string;
}

export interface FunctionInfo {
  schema: string;
  name: string;
  language: string;
  returnType: string;
  args: string;
  definition: string;
  kind: 'function' | 'procedure';
}

export interface ForeignKeyInfo {
  constraintName: string;
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
}

// ─── Table data types ────────────────────────────────────────────────────────

export interface TableDataPage {
  rows: Record<string, unknown>[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  fields: { name: string; dataTypeID: number }[];
  rowCount: number;
  duration: number;
}

export interface QueryHistoryEntry {
  sql: string;
  connectionId: string;
  duration: number;
  rowCount: number;
  executedAt: number;
}

// ─── Table creation ──────────────────────────────────────────────────────────

export interface ColumnDefinition {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isNullable: boolean;
  defaultValue: string;
  isUnique: boolean;
  foreignKey?: {
    schema: string;
    table: string;
    column: string;
  };
}

export interface TableDefinition {
  schema: string;
  name: string;
  columns: ColumnDefinition[];
}

// ─── Alter table operations ──────────────────────────────────────────────────

export type AlterOp =
  | { op: 'addColumn'; column: ColumnDefinition }
  | { op: 'dropColumn'; name: string }
  | { op: 'renameColumn'; from: string; to: string }
  | { op: 'setType'; column: string; newType: string }
  | { op: 'setNotNull'; column: string; value: boolean }
  | { op: 'setDefault'; column: string; value: string | null }
  | { op: 'setUnique'; column: string; value: boolean; constraintName?: string }
  | { op: 'addForeignKey'; column: string; refSchema: string; refTable: string; refColumn: string }
  | { op: 'dropForeignKey'; constraintName: string }
  | { op: 'renameTable'; newName: string };

// ─── Message protocol (WebView ↔ Extension) ─────────────────────────────────

export interface TableDataSort {
  column: string;
  direction: 'asc' | 'desc';
}

export type MessageToExtension =
  | { command: 'connect'; payload: ConnectionWithPassword }
  | { command: 'disconnect'; payload: { connectionId: string } }
  | { command: 'fetchTables'; payload: { connectionId: string } }
  | { command: 'fetchTableData'; payload: { connectionId: string; schema: string; table: string; page: number; pageSize: number; sort?: TableDataSort; filters?: Record<string, string> } }
  | { command: 'fetchColumns'; payload: { connectionId: string; schema: string; table: string } }
  | { command: 'insertRow'; payload: { connectionId: string; schema: string; table: string; row: Record<string, unknown> } }
  | { command: 'alterTable'; payload: { connectionId: string; schema: string; table: string; ops: AlterOp[] } }
  | { command: 'reconnect'; payload: { connectionId: string } }
  | { command: 'deleteConnection'; payload: { connectionId: string } }
  | { command: 'updateRow'; payload: { connectionId: string; schema: string; table: string; primaryKey: Record<string, unknown>; changes: Record<string, unknown> } }
  | { command: 'deleteRow'; payload: { connectionId: string; schema: string; table: string; primaryKey: Record<string, unknown> } }
  | { command: 'executeQuery'; payload: { connectionId: string; sql: string } }
  | { command: 'fetchForeignKeys'; payload: { connectionId: string } }
  | { command: 'createTable'; payload: { connectionId: string; definition: TableDefinition } }
  | { command: 'dropTable'; payload: { connectionId: string; schema: string; table: string } }
  | { command: 'getConnections'; payload: Record<string, never> }
  | { command: 'fetchIndexes'; payload: { connectionId: string; schema: string; table: string } }
  | { command: 'createIndex'; payload: { connectionId: string; schema: string; table: string; name: string; columns: string[]; isUnique: boolean } }
  | { command: 'dropIndex'; payload: { connectionId: string; indexName: string; schema: string } }
  | { command: 'fetchFunctions'; payload: { connectionId: string } }
  | { command: 'createSchema'; payload: { connectionId: string; name: string } }
  | { command: 'dropSchema'; payload: { connectionId: string; name: string; cascade: boolean } }
  | { command: 'createView'; payload: { connectionId: string; schema: string; name: string; definition: string } }
  | { command: 'dropView'; payload: { connectionId: string; schema: string; name: string } }
  | { command: 'importRows'; payload: { connectionId: string; schema: string; table: string; rows: Record<string, unknown>[] } }
  | { command: 'explainQuery'; payload: { connectionId: string; sql: string } }
  | { command: 'getQueryHistory'; payload: Record<string, never> }
  | { command: 'saveQueryToHistory'; payload: QueryHistoryEntry };

export type MessageToWebview =
  | { type: 'connected'; payload: { connection: ConnectionConfig; schemas: SchemaInfo[] } }
  | { type: 'disconnected'; payload: { connectionId: string } }
  | { type: 'tableData'; payload: TableDataPage & { schema: string; table: string } }
  | { type: 'columns'; payload: { schema: string; table: string; columns: ColumnInfo[] } }
  | { type: 'queryResult'; payload: QueryResult }
  | { type: 'rowInserted'; payload: { schema: string; table: string; row: Record<string, unknown> } }
  | { type: 'rowUpdated'; payload: { schema: string; table: string } }
  | { type: 'rowDeleted'; payload: { schema: string; table: string } }
  | { type: 'foreignKeys'; payload: ForeignKeyInfo[] }
  | { type: 'connections'; payload: ConnectionConfig[] }
  | { type: 'tableCreated'; payload: { schema: string; table: string; schemas: SchemaInfo[] } }
  | { type: 'tableDropped'; payload: { schema: string; table: string; schemas: SchemaInfo[] } }
  | { type: 'tableAltered'; payload: { schema: string; table: string; newTableName?: string; columns: ColumnInfo[]; schemas: SchemaInfo[] } }
  | { type: 'indexes'; payload: { schema: string; table: string; indexes: IndexInfo[] } }
  | { type: 'functions'; payload: FunctionInfo[] }
  | { type: 'schemaCreated'; payload: { name: string; schemas: SchemaInfo[] } }
  | { type: 'schemaDropped'; payload: { name: string; schemas: SchemaInfo[] } }
  | { type: 'viewCreated'; payload: { schema: string; name: string; schemas: SchemaInfo[] } }
  | { type: 'viewDropped'; payload: { schema: string; name: string; schemas: SchemaInfo[] } }
  | { type: 'rowsImported'; payload: { schema: string; table: string; count: number } }
  | { type: 'explainResult'; payload: { plan: string } }
  | { type: 'queryHistory'; payload: QueryHistoryEntry[] }
  | { type: 'error'; payload: { message: string; command?: string } };
