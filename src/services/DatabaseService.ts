import { Pool, PoolClient } from 'pg';
import type {
  ConnectionWithPassword,
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  FunctionInfo,
  ForeignKeyInfo,
  TableDataPage,
  TableDataSort,
  QueryResult,
  TableDefinition,
  ColumnDefinition,
  AlterOp,
} from '../types';

export class DatabaseService {
  private pools = new Map<string, Pool>();

  // ─── Connection management ───────────────────────────────────────────────

  async connect(config: ConnectionWithPassword): Promise<SchemaInfo[]> {
    if (this.pools.has(config.id)) {
      await this.disconnect(config.id);
    }

    const pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test connection
    const client = await pool.connect();
    client.release();

    this.pools.set(config.id, pool);
    return this.fetchSchemas(config.id);
  }

  async disconnect(connectionId: string): Promise<void> {
    const pool = this.pools.get(connectionId);
    if (pool) {
      await pool.end();
      this.pools.delete(connectionId);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const id of this.pools.keys()) {
      await this.disconnect(id);
    }
  }

  // ─── Schema introspection ────────────────────────────────────────────────

  async fetchSchemas(connectionId: string): Promise<SchemaInfo[]> {
    const result = await this.query(
      connectionId,
      `SELECT schema_name
       FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast','pg_temp_1','pg_toast_temp_1')
       ORDER BY schema_name`
    );

    const schemas: SchemaInfo[] = [];
    for (const row of result.rows) {
      const schemaName = row['schema_name'] as string;
      const tables = await this.fetchTables(connectionId, schemaName);
      schemas.push({ name: schemaName, tables });
    }
    return schemas;
  }

  async fetchTables(connectionId: string, schema: string): Promise<TableInfo[]> {
    const result = await this.query(
      connectionId,
      `SELECT table_name, table_type
       FROM information_schema.tables
       WHERE table_schema = $1
       ORDER BY table_name`,
      [schema]
    );

    return result.rows.map(row => ({
      schema,
      name: row['table_name'] as string,
      type: (row['table_type'] as string) === 'VIEW' ? 'view' : 'table',
    }));
  }

  async fetchColumns(connectionId: string, schema: string, table: string): Promise<ColumnInfo[]> {
    const result = await this.query(
      connectionId,
      `SELECT
         c.column_name,
         c.data_type,
         c.udt_name,
         c.is_nullable,
         c.column_default,
         c.character_maximum_length,
         EXISTS (
           SELECT 1 FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
           WHERE tc.constraint_type = 'PRIMARY KEY'
             AND tc.table_schema = c.table_schema
             AND tc.table_name = c.table_name
             AND kcu.column_name = c.column_name
         ) AS is_primary_key,
         EXISTS (
           SELECT 1 FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
           WHERE tc.constraint_type = 'UNIQUE'
             AND tc.table_schema = c.table_schema
             AND tc.table_name = c.table_name
             AND kcu.column_name = c.column_name
         ) AS is_unique
       FROM information_schema.columns c
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
      [schema, table]
    );

    const fkResult = await this.query(
      connectionId,
      `SELECT
         kcu.column_name,
         ccu.table_schema AS foreign_schema,
         ccu.table_name AS foreign_table,
         ccu.column_name AS foreign_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = $1 AND tc.table_name = $2`,
      [schema, table]
    );

    const fkMap = new Map<string, { table: string; column: string; schema: string }>();
    for (const fk of fkResult.rows) {
      fkMap.set(fk['column_name'] as string, {
        schema: fk['foreign_schema'] as string,
        table: fk['foreign_table'] as string,
        column: fk['foreign_column'] as string,
      });
    }

    return result.rows.map(row => {
      const colName = row['column_name'] as string;
      const fk = fkMap.get(colName);
      return {
        name: colName,
        dataType: row['data_type'] as string,
        udtName: row['udt_name'] as string,
        isNullable: row['is_nullable'] === 'YES',
        columnDefault: (row['column_default'] as string | null) ?? null,
        isPrimaryKey: row['is_primary_key'] as boolean,
        isUnique: row['is_unique'] as boolean,
        isForeignKey: !!fk,
        foreignKeyRef: fk,
        maxLength: row['character_maximum_length'] as number | undefined,
      };
    });
  }

  async fetchForeignKeys(connectionId: string): Promise<ForeignKeyInfo[]> {
    const result = await this.query(
      connectionId,
      `SELECT
         tc.constraint_name,
         tc.table_schema AS from_schema,
         tc.table_name AS from_table,
         kcu.column_name AS from_column,
         ccu.table_schema AS to_schema,
         ccu.table_name AS to_table,
         ccu.column_name AS to_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema NOT IN ('pg_catalog','information_schema')
       ORDER BY from_schema, from_table, from_column`
    );

    return result.rows.map(row => ({
      constraintName: row['constraint_name'] as string,
      fromSchema: row['from_schema'] as string,
      fromTable: row['from_table'] as string,
      fromColumn: row['from_column'] as string,
      toSchema: row['to_schema'] as string,
      toTable: row['to_table'] as string,
      toColumn: row['to_column'] as string,
    }));
  }

  // ─── Indexes ─────────────────────────────────────────────────────────────

  async fetchIndexes(connectionId: string, schema: string, table: string): Promise<IndexInfo[]> {
    const result = await this.query(
      connectionId,
      `SELECT
         i.relname AS index_name,
         ix.indisunique AS is_unique,
         ix.indisprimary AS is_primary,
         pg_get_indexdef(ix.indexrelid) AS definition,
         ARRAY(
           SELECT a.attname
           FROM pg_attribute a
           WHERE a.attrelid = t.oid
             AND a.attnum = ANY(ix.indkey)
             AND a.attnum > 0
           ORDER BY array_position(ix.indkey::int[], a.attnum::int)
         ) AS columns
       FROM pg_class t
       JOIN pg_index ix ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_namespace n ON t.relnamespace = n.oid
       WHERE t.relname = $2 AND n.nspname = $1
       ORDER BY i.relname`,
      [schema, table]
    );

    return result.rows.map(row => ({
      name: row['index_name'] as string,
      columns: row['columns'] as string[],
      isUnique: row['is_unique'] as boolean,
      isPrimary: row['is_primary'] as boolean,
      definition: row['definition'] as string,
    }));
  }

  async createIndex(
    connectionId: string,
    schema: string,
    table: string,
    name: string,
    columns: string[],
    isUnique: boolean
  ): Promise<void> {
    const unique = isUnique ? 'UNIQUE ' : '';
    const cols = columns.map(c => `"${c}"`).join(', ');
    await this.query(connectionId, `CREATE ${unique}INDEX "${name}" ON "${schema}"."${table}" (${cols})`);
  }

  async dropIndex(connectionId: string, schema: string, indexName: string): Promise<void> {
    await this.query(connectionId, `DROP INDEX IF EXISTS "${schema}"."${indexName}"`);
  }

  // ─── Functions / Procedures ──────────────────────────────────────────────

  async fetchFunctions(connectionId: string): Promise<FunctionInfo[]> {
    const result = await this.query(
      connectionId,
      `SELECT
         n.nspname AS schema,
         p.proname AS name,
         l.lanname AS language,
         pg_catalog.pg_get_function_result(p.oid) AS return_type,
         pg_catalog.pg_get_function_arguments(p.oid) AS args,
         pg_catalog.pg_get_functiondef(p.oid) AS definition,
         p.prokind AS kind
       FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_catalog.pg_language l ON l.oid = p.prolang
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       ORDER BY n.nspname, p.proname`
    );

    return result.rows.map(row => ({
      schema: row['schema'] as string,
      name: row['name'] as string,
      language: row['language'] as string,
      returnType: row['return_type'] as string,
      args: row['args'] as string,
      definition: row['definition'] as string,
      kind: (row['kind'] as string) === 'p' ? 'procedure' : 'function',
    }));
  }

  // ─── Schema DDL ──────────────────────────────────────────────────────────

  async createSchema(connectionId: string, name: string): Promise<void> {
    await this.query(connectionId, `CREATE SCHEMA IF NOT EXISTS "${name}"`);
  }

  async dropSchema(connectionId: string, name: string, cascade: boolean): Promise<void> {
    const cascadeClause = cascade ? ' CASCADE' : '';
    await this.query(connectionId, `DROP SCHEMA IF EXISTS "${name}"${cascadeClause}`);
  }

  async createView(connectionId: string, schema: string, name: string, definition: string): Promise<void> {
    await this.query(connectionId, `CREATE OR REPLACE VIEW "${schema}"."${name}" AS ${definition}`);
  }

  async dropView(connectionId: string, schema: string, name: string): Promise<void> {
    await this.query(connectionId, `DROP VIEW IF EXISTS "${schema}"."${name}" CASCADE`);
  }

  // ─── Table data (CRUD) ───────────────────────────────────────────────────

  async fetchTableData(
    connectionId: string,
    schema: string,
    table: string,
    page = 1,
    pageSize = 50,
    sort?: TableDataSort,
    filters?: Record<string, string>
  ): Promise<TableDataPage> {
    const quotedTable = `"${schema}"."${table}"`;

    // Build WHERE clause from filters
    const whereParts: string[] = [];
    const filterValues: unknown[] = [];
    let paramIdx = 1;

    if (filters) {
      for (const [col, val] of Object.entries(filters)) {
        if (val.trim()) {
          whereParts.push(`"${col}"::text ILIKE $${paramIdx++}`);
          filterValues.push(`%${val.trim()}%`);
        }
      }
    }

    const whereClause = whereParts.length > 0 ? ` WHERE ${whereParts.join(' AND ')}` : '';
    const orderClause = sort ? ` ORDER BY "${sort.column}" ${sort.direction === 'asc' ? 'ASC' : 'DESC'}` : '';
    const limitParam = paramIdx;
    const offsetParam = paramIdx + 1;
    const offset = (page - 1) * pageSize;

    const [dataResult, countResult] = await Promise.all([
      this.query(
        connectionId,
        `SELECT * FROM ${quotedTable}${whereClause}${orderClause} LIMIT $${limitParam} OFFSET $${offsetParam}`,
        [...filterValues, pageSize, offset]
      ),
      this.query(
        connectionId,
        `SELECT COUNT(*) AS total FROM ${quotedTable}${whereClause}`,
        filterValues
      ),
    ]);

    return {
      rows: dataResult.rows,
      totalCount: parseInt((countResult.rows[0]?.['total'] as string) ?? '0', 10),
      page,
      pageSize,
    };
  }

  async insertRow(
    connectionId: string,
    schema: string,
    table: string,
    row: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const keys = Object.keys(row);
    const values = Object.values(row);
    const cols = keys.map(k => `"${k}"`).join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const quotedTable = `"${schema}"."${table}"`;

    const result = await this.query(
      connectionId,
      `INSERT INTO ${quotedTable} (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return result.rows[0] ?? {};
  }

  async importRows(
    connectionId: string,
    schema: string,
    table: string,
    rows: Record<string, unknown>[]
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const quotedTable = `"${schema}"."${table}"`;
    const keys = Object.keys(rows[0]);
    const cols = keys.map(k => `"${k}"`).join(', ');

    let imported = 0;
    for (const row of rows) {
      const values = keys.map(k => row[k]);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      await this.query(connectionId, `INSERT INTO ${quotedTable} (${cols}) VALUES (${placeholders})`, values);
      imported++;
    }
    return imported;
  }

  async updateRow(
    connectionId: string,
    schema: string,
    table: string,
    primaryKey: Record<string, unknown>,
    changes: Record<string, unknown>
  ): Promise<void> {
    const changeKeys = Object.keys(changes);
    const pkKeys = Object.keys(primaryKey);
    const allValues: unknown[] = [];

    const setClause = changeKeys
      .map((k, i) => {
        allValues.push(changes[k]);
        return `"${k}" = $${i + 1}`;
      })
      .join(', ');

    const whereClause = pkKeys
      .map((k, i) => {
        allValues.push(primaryKey[k]);
        return `"${k}" = $${changeKeys.length + i + 1}`;
      })
      .join(' AND ');

    const quotedTable = `"${schema}"."${table}"`;
    await this.query(connectionId, `UPDATE ${quotedTable} SET ${setClause} WHERE ${whereClause}`, allValues);
  }

  async deleteRow(
    connectionId: string,
    schema: string,
    table: string,
    primaryKey: Record<string, unknown>
  ): Promise<void> {
    const pkKeys = Object.keys(primaryKey);
    const values = Object.values(primaryKey);
    const whereClause = pkKeys.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ');
    const quotedTable = `"${schema}"."${table}"`;
    await this.query(connectionId, `DELETE FROM ${quotedTable} WHERE ${whereClause}`, values);
  }

  // ─── Raw query ───────────────────────────────────────────────────────────

  async executeQuery(connectionId: string, sql: string): Promise<QueryResult> {
    const start = Date.now();
    const result = await this.query(connectionId, sql);
    const duration = Date.now() - start;
    return {
      rows: result.rows,
      fields: result.fields.map(f => ({ name: f.name, dataTypeID: f.dataTypeID })),
      rowCount: result.rowCount ?? 0,
      duration,
    };
  }

  async explainQuery(connectionId: string, sql: string): Promise<string> {
    const pool = this.pools.get(connectionId);
    if (!pool) throw new Error(`No active connection for id: ${connectionId}`);

    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`);
      await client.query('ROLLBACK');
      return (result.rows as Array<Record<string, unknown>>)
        .map(r => Object.values(r)[0] as string)
        .join('\n');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Table DDL ───────────────────────────────────────────────────────────

  async createTable(connectionId: string, def: TableDefinition): Promise<void> {
    const ddl = this.buildCreateTableDDL(def);
    await this.query(connectionId, ddl);
  }

  async dropTable(connectionId: string, schema: string, table: string): Promise<void> {
    await this.query(connectionId, `DROP TABLE IF EXISTS "${schema}"."${table}" CASCADE`);
  }

  async alterTable(
    connectionId: string,
    schema: string,
    table: string,
    ops: AlterOp[]
  ): Promise<string> {
    let currentTable = table;
    const qt = () => `"${schema}"."${currentTable}"`;

    for (const op of ops) {
      switch (op.op) {
        case 'addColumn': {
          const colDef = this.buildColumnDef(op.column);
          await this.query(connectionId, `ALTER TABLE ${qt()} ADD COLUMN ${colDef}`);
          break;
        }
        case 'dropColumn':
          await this.query(connectionId, `ALTER TABLE ${qt()} DROP COLUMN "${op.name}" CASCADE`);
          break;
        case 'renameColumn':
          await this.query(connectionId, `ALTER TABLE ${qt()} RENAME COLUMN "${op.from}" TO "${op.to}"`);
          break;
        case 'setType':
          await this.query(connectionId, `ALTER TABLE ${qt()} ALTER COLUMN "${op.column}" TYPE ${op.newType} USING "${op.column}"::${op.newType}`);
          break;
        case 'setNotNull':
          if (op.value) {
            await this.query(connectionId, `ALTER TABLE ${qt()} ALTER COLUMN "${op.column}" SET NOT NULL`);
          } else {
            await this.query(connectionId, `ALTER TABLE ${qt()} ALTER COLUMN "${op.column}" DROP NOT NULL`);
          }
          break;
        case 'setDefault':
          if (op.value !== null && op.value !== '') {
            await this.query(connectionId, `ALTER TABLE ${qt()} ALTER COLUMN "${op.column}" SET DEFAULT ${op.value}`);
          } else {
            await this.query(connectionId, `ALTER TABLE ${qt()} ALTER COLUMN "${op.column}" DROP DEFAULT`);
          }
          break;
        case 'setUnique':
          if (op.value) {
            const cname = `uq_${currentTable}_${op.column}`;
            await this.query(connectionId, `ALTER TABLE ${qt()} ADD CONSTRAINT "${cname}" UNIQUE ("${op.column}")`);
          } else if (op.constraintName) {
            await this.query(connectionId, `ALTER TABLE ${qt()} DROP CONSTRAINT "${op.constraintName}"`);
          }
          break;
        case 'addForeignKey': {
          const cname = `fk_${currentTable}_${op.column}`;
          await this.query(connectionId,
            `ALTER TABLE ${qt()} ADD CONSTRAINT "${cname}" FOREIGN KEY ("${op.column}") REFERENCES "${op.refSchema}"."${op.refTable}" ("${op.refColumn}")`
          );
          break;
        }
        case 'dropForeignKey':
          await this.query(connectionId, `ALTER TABLE ${qt()} DROP CONSTRAINT "${op.constraintName}"`);
          break;
        case 'renameTable':
          await this.query(connectionId, `ALTER TABLE ${qt()} RENAME TO "${op.newName}"`);
          currentTable = op.newName;
          break;
      }
    }
    return currentTable;
  }

  private buildColumnDef(col: ColumnDefinition): string {
    const parts = [`"${col.name}"`, col.type];
    if (!col.isNullable && !col.isPrimaryKey) parts.push('NOT NULL');
    if (col.defaultValue?.trim()) parts.push(`DEFAULT ${col.defaultValue}`);
    if (col.isUnique && !col.isPrimaryKey) parts.push('UNIQUE');
    return parts.join(' ');
  }

  buildCreateTableDDL(def: TableDefinition): string {
    const lines: string[] = [];
    const pkCols = def.columns.filter(c => c.isPrimaryKey).map(c => `"${c.name}"`);
    const fkClauses: string[] = [];

    for (const col of def.columns) {
      const parts: string[] = [`"${col.name}"`, col.type];
      if (!col.isNullable && !col.isPrimaryKey) parts.push('NOT NULL');
      if (col.defaultValue.trim()) parts.push(`DEFAULT ${col.defaultValue}`);
      if (col.isUnique && !col.isPrimaryKey) parts.push('UNIQUE');
      lines.push('  ' + parts.join(' '));

      if (col.foreignKey) {
        const fk = col.foreignKey;
        fkClauses.push(
          `  CONSTRAINT fk_${def.name}_${col.name} FOREIGN KEY ("${col.name}") ` +
          `REFERENCES "${fk.schema}"."${fk.table}" ("${fk.column}")`
        );
      }
    }

    if (pkCols.length > 0) {
      lines.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
    }

    lines.push(...fkClauses);

    return `CREATE TABLE "${def.schema}"."${def.name}" (\n${lines.join(',\n')}\n)`;
  }

  // ─── Internal query helper ───────────────────────────────────────────────

  private async query(connectionId: string, sql: string, values?: unknown[]) {
    const pool = this.pools.get(connectionId);
    if (!pool) {
      throw new Error(`No active connection for id: ${connectionId}`);
    }
    return pool.query(sql, values as unknown[]);
  }
}
