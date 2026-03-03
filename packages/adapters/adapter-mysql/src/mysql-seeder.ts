import type {
  DatabaseAdapter,
  AdapterContext,
  AdapterResult,
  InspectResult,
  SchemaModel,
  TableInfo,
  ColumnInfo,
  ColumnType,
  ExpandedData,
  Row,
} from '@mimicai/core';
import { DatabaseConnectionError, SeedingError, logger } from '@mimicai/core';
const { debug, success, warn } = logger;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MySQLConfig {
  url: string;
  seedStrategy?: 'truncate-and-insert' | 'append' | 'upsert';
  pool?: { max?: number; timeout?: number };
  copyThreshold?: number;
  excludeTables?: string[];
}

// ---------------------------------------------------------------------------
// MySQL type -> canonical type mapping
// ---------------------------------------------------------------------------

const MYSQL_TYPE_MAP: Record<string, ColumnType> = {
  // Integers
  tinyint: 'smallint',
  smallint: 'smallint',
  mediumint: 'integer',
  int: 'integer',
  integer: 'integer',
  bigint: 'bigint',
  // Floats
  float: 'float',
  double: 'double',
  decimal: 'decimal',
  numeric: 'decimal',
  // Strings
  char: 'char',
  varchar: 'varchar',
  tinytext: 'text',
  text: 'text',
  mediumtext: 'text',
  longtext: 'text',
  // Binary
  binary: 'bytea',
  varbinary: 'bytea',
  tinyblob: 'bytea',
  blob: 'bytea',
  mediumblob: 'bytea',
  longblob: 'bytea',
  // Date/Time
  date: 'date',
  datetime: 'timestamp',
  timestamp: 'timestamptz',
  time: 'time',
  year: 'integer',
  // Boolean
  boolean: 'boolean',
  bool: 'boolean',
  // JSON
  json: 'jsonb',
  // Enum/Set
  enum: 'enum',
  set: 'text',
  // UUID (via char(36) or varchar(36) -- handled by length, but also)
  uuid: 'uuid',
};

function mapMySQLType(dataType: string, columnType?: string): { type: ColumnType; enumValues?: string[] } {
  const lower = dataType.toLowerCase();

  // tinyint(1) is boolean in MySQL convention
  if (lower === 'tinyint' && columnType?.includes('tinyint(1)')) {
    return { type: 'boolean' };
  }

  // Parse ENUM values from COLUMN_TYPE
  if (lower === 'enum' && columnType) {
    const match = columnType.match(/^enum\((.+)\)$/i);
    if (match) {
      const values = match[1]!.split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
      return { type: 'enum', enumValues: values };
    }
  }

  return { type: MYSQL_TYPE_MAP[lower] ?? 'unknown' };
}

// ---------------------------------------------------------------------------
// MySQLSeeder -- implements DatabaseAdapter<MySQLConfig>
// ---------------------------------------------------------------------------

export class MySQLSeeder implements DatabaseAdapter<MySQLConfig> {
  readonly id = 'mysql';
  readonly name = 'MySQL';
  readonly type = 'database' as const;

  private pool: unknown = null;
  private connectionUrl: string = '';
  private seedStrategy: MySQLConfig['seedStrategy'] = 'truncate-and-insert';
  private copyThreshold: number = 500;
  private excludeTables: Set<string> = new Set();

  // -----------------------------------------------------------------------
  // Adapter interface
  // -----------------------------------------------------------------------

  async init(config: MySQLConfig, _context: AdapterContext): Promise<void> {
    this.connectionUrl = config.url;
    this.seedStrategy = config.seedStrategy ?? 'truncate-and-insert';
    this.copyThreshold = config.copyThreshold ?? 500;
    this.excludeTables = new Set(config.excludeTables ?? []);
  }

  async apply(data: ExpandedData, context: AdapterContext): Promise<AdapterResult> {
    const schema = context.schema!;
    const start = Date.now();
    const stats: Record<string, number> = {};

    const dataMap = new Map<string, ExpandedData>();
    dataMap.set(data.personaId, data);
    await this.seedBatch(schema, dataMap, { strategy: this.seedStrategy! });

    for (const [tableName, rows] of Object.entries(data.tables)) {
      stats[`${tableName}_rows`] = rows.length;
    }

    return {
      adapterId: this.id,
      success: true,
      stats,
      duration: Date.now() - start,
    };
  }

  async healthcheck(): Promise<boolean> {
    try {
      const pool = await this.getPool();
      await (pool as { query: (sql: string) => Promise<unknown> }).query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    await this.disconnect();
  }

  // -----------------------------------------------------------------------
  // DatabaseAdapter: introspect
  // -----------------------------------------------------------------------

  async introspect(config: MySQLConfig): Promise<SchemaModel> {
    const mysql2 = await this.requireMySQL();
    const pool = mysql2.createPool(config.url);

    try {
      return await this.introspectWithPool(pool);
    } finally {
      await pool.end();
    }
  }

  private async introspectWithPool(pool: MySQLPool): Promise<SchemaModel> {
    // Get database name from connection
    const [dbRows] = await pool.query('SELECT DATABASE() as db') as [Array<{ db: string }>];
    const dbName = dbRows[0]?.db;
    if (!dbName) throw new DatabaseConnectionError('No database selected');

    // Get all tables
    const [tableRows] = await pool.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      [dbName],
    ) as [Array<{ TABLE_NAME: string }>];

    // Get all columns
    const [columnRows] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
              COLUMN_DEFAULT, EXTRA, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION,
              NUMERIC_SCALE, COLUMN_KEY, COLUMN_COMMENT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [dbName],
    ) as [MySQLColumnRow[]];

    // Get all foreign keys
    const [fkRows] = await pool.query(
      `SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME,
              kcu.REFERENCED_COLUMN_NAME, rc.DELETE_RULE, rc.UPDATE_RULE
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
         ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
       WHERE kcu.TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
      [dbName],
    ) as [MySQLForeignKeyRow[]];

    // Get unique constraints
    const [uniqueRows] = await pool.query(
      `SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.COLUMN_NAME
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
       WHERE tc.TABLE_SCHEMA = ? AND tc.CONSTRAINT_TYPE = 'UNIQUE'
       ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
      [dbName],
    ) as [MySQLUniqueRow[]];

    // Build table info
    const tables: TableInfo[] = [];
    const tableNames = tableRows.map((r) => r.TABLE_NAME);
    const fkMap = new Map<string, Map<string, string[]>>();

    for (const fk of fkRows) {
      if (!fkMap.has(fk.TABLE_NAME)) fkMap.set(fk.TABLE_NAME, new Map());
      const refKey = `${fk.REFERENCED_TABLE_NAME}`;
      if (!fkMap.get(fk.TABLE_NAME)!.has(refKey)) {
        fkMap.get(fk.TABLE_NAME)!.set(refKey, []);
      }
    }

    for (const tableName of tableNames) {
      const cols = columnRows.filter((c) => c.TABLE_NAME === tableName);
      const tableFks = fkRows.filter((f) => f.TABLE_NAME === tableName);
      const tableUniques = uniqueRows.filter((u) => u.TABLE_NAME === tableName);

      const columns: ColumnInfo[] = cols.map((col) => {
        const { type, enumValues } = mapMySQLType(col.DATA_TYPE, col.COLUMN_TYPE);
        return {
          name: col.COLUMN_NAME,
          type,
          pgType: col.DATA_TYPE,
          isNullable: col.IS_NULLABLE === 'YES',
          hasDefault: col.COLUMN_DEFAULT !== null,
          defaultValue: col.COLUMN_DEFAULT ?? undefined,
          isAutoIncrement: col.EXTRA.includes('auto_increment'),
          isGenerated: col.EXTRA.includes('GENERATED') || col.EXTRA.includes('VIRTUAL') || col.EXTRA.includes('STORED'),
          maxLength: col.CHARACTER_MAXIMUM_LENGTH ?? undefined,
          precision: col.NUMERIC_PRECISION ?? undefined,
          scale: col.NUMERIC_SCALE ?? undefined,
          enumValues,
          comment: col.COLUMN_COMMENT || undefined,
        };
      });

      const primaryKey = cols
        .filter((c) => c.COLUMN_KEY === 'PRI')
        .map((c) => c.COLUMN_NAME);

      // Group FK rows by constraint (referenced table)
      const fkGrouped = new Map<string, { cols: string[]; refCols: string[]; refTable: string; onDelete?: string; onUpdate?: string }>();
      for (const fk of tableFks) {
        const key = `${fk.REFERENCED_TABLE_NAME}`;
        if (!fkGrouped.has(key)) {
          fkGrouped.set(key, { cols: [], refCols: [], refTable: fk.REFERENCED_TABLE_NAME, onDelete: fk.DELETE_RULE, onUpdate: fk.UPDATE_RULE });
        }
        fkGrouped.get(key)!.cols.push(fk.COLUMN_NAME);
        fkGrouped.get(key)!.refCols.push(fk.REFERENCED_COLUMN_NAME);
      }

      const foreignKeys = [...fkGrouped.values()].map((g) => ({
        columns: g.cols,
        referencedTable: g.refTable,
        referencedColumns: g.refCols,
        onDelete: normalizeAction(g.onDelete),
        onUpdate: normalizeAction(g.onUpdate),
      }));

      // Group unique constraints by constraint name
      const uniqueGrouped = new Map<string, string[]>();
      for (const u of tableUniques) {
        if (!uniqueGrouped.has(u.CONSTRAINT_NAME)) uniqueGrouped.set(u.CONSTRAINT_NAME, []);
        uniqueGrouped.get(u.CONSTRAINT_NAME)!.push(u.COLUMN_NAME);
      }

      tables.push({
        name: tableName,
        columns,
        primaryKey,
        foreignKeys,
        uniqueConstraints: [...uniqueGrouped.values()],
        checkConstraints: [],
        comment: undefined,
      });
    }

    // Build insertion order via topological sort
    const insertionOrder = topoSort(tables);

    // Collect enums
    const enumSet = new Map<string, string[]>();
    for (const t of tables) {
      for (const col of t.columns) {
        if (col.type === 'enum' && col.enumValues) {
          const enumName = `${t.name}_${col.name}`;
          enumSet.set(enumName, col.enumValues);
        }
      }
    }

    return {
      tables,
      enums: [...enumSet.entries()].map(([name, values]) => ({ name, values })),
      insertionOrder,
    };
  }

  // -----------------------------------------------------------------------
  // DatabaseAdapter: seed
  // -----------------------------------------------------------------------

  async seed(data: ExpandedData, context: AdapterContext): Promise<AdapterResult> {
    return this.apply(data, context);
  }

  // -----------------------------------------------------------------------
  // DatabaseAdapter: inspect
  // -----------------------------------------------------------------------

  async inspect(_context: AdapterContext): Promise<InspectResult> {
    const pool = await this.getPool();

    const [dbRows] = await (pool as MySQLPool).query('SELECT DATABASE() as db') as [Array<{ db: string }>];
    const dbName = dbRows[0]?.db;
    if (!dbName) throw new DatabaseConnectionError('No database selected');

    const [tableRows] = await (pool as MySQLPool).query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [dbName],
    ) as [Array<{ TABLE_NAME: string }>];

    const tables: InspectResult['tables'] = {};
    let totalRows = 0;

    for (const row of tableRows) {
      const [countRows] = await (pool as MySQLPool).query(
        `SELECT COUNT(*) as cnt FROM \`${row.TABLE_NAME}\``,
      ) as [Array<{ cnt: number }>];
      const rowCount = countRows[0]?.cnt ?? 0;
      tables[row.TABLE_NAME] = { rowCount };
      totalRows += rowCount;
    }

    return { tables, totalRows, timestamp: new Date() };
  }

  // -----------------------------------------------------------------------
  // Batch seed (multi-persona, schema-aware)
  // -----------------------------------------------------------------------

  async seedBatch(
    schema: SchemaModel,
    data: Map<string, ExpandedData>,
    options: { strategy: 'truncate-and-insert' | 'append' | 'upsert' },
  ): Promise<void> {
    const pool = await this.getPool() as MySQLPool;
    const conn = await pool.getConnection();

    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      await conn.beginTransaction();

      if (options.strategy === 'truncate-and-insert') {
        await this.truncateTables(conn, schema);
      }

      const personaKeys = [...data.keys()];

      for (const tableName of schema.insertionOrder) {
        if (this.excludeTables.has(tableName)) continue;

        const tableInfo = schema.tables.find((t) => t.name === tableName);
        if (!tableInfo) continue;

        const mergedRows: Row[] = [];
        for (const personaKey of personaKeys) {
          const expandedData = data.get(personaKey)!;
          const tableRows = expandedData.tables[tableName];
          if (!tableRows || tableRows.length === 0) continue;
          mergedRows.push(...tableRows.map((r) => ({ ...r })));
        }

        if (mergedRows.length === 0) {
          debug(`Skipping "${tableName}" -- no rows to insert`);
          continue;
        }

        // Normalize columns
        const columns = collectColumns(mergedRows, tableInfo);

        if (options.strategy === 'upsert') {
          await this.upsertRows(conn, tableName, columns, mergedRows, tableInfo);
        } else {
          await this.insertRows(conn, tableName, columns, mergedRows);
        }
      }

      await conn.commit();
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      success(`Seeded ${schema.insertionOrder.length} tables successfully`);
    } catch (err) {
      try { await conn.rollback(); } catch { /* ignore rollback errors */ }
      try { await conn.query('SET FOREIGN_KEY_CHECKS = 1'); } catch { /* ignore */ }

      throw new SeedingError(
        `MySQL seeding failed: ${err instanceof Error ? err.message : String(err)}`,
        'Check FK constraints and data types',
        err instanceof Error ? err : new Error(String(err)),
      );
    } finally {
      conn.release();
    }
  }

  // -----------------------------------------------------------------------
  // Clean
  // -----------------------------------------------------------------------

  async clean(context: AdapterContext): Promise<void> {
    if (context.schema) {
      const pool = await this.getPool() as MySQLPool;
      const conn = await pool.getConnection();

      try {
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        await conn.beginTransaction();
        await this.truncateTables(conn, context.schema);
        await conn.commit();
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        success('All MySQL tables truncated');
      } catch (err) {
        try { await conn.rollback(); } catch { /* ignore */ }
        try { await conn.query('SET FOREIGN_KEY_CHECKS = 1'); } catch { /* ignore */ }
        throw new SeedingError(
          `MySQL clean failed: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          err instanceof Error ? err : new Error(String(err)),
        );
      } finally {
        conn.release();
      }
    }
  }

  // -----------------------------------------------------------------------
  // Connection helpers
  // -----------------------------------------------------------------------

  private async getPool(): Promise<unknown> {
    if (this.pool) return this.pool;

    try {
      const mysql2 = await this.requireMySQL();
      this.pool = mysql2.createPool(this.connectionUrl);
      // Test connectivity
      const conn = await (this.pool as MySQLPool).getConnection();
      conn.release();
      debug('MySQL connection pool established');
      return this.pool;
    } catch (err) {
      throw new DatabaseConnectionError(
        'Failed to connect to MySQL',
        undefined,
        err instanceof Error ? err : new Error(String(err)),
        this.connectionUrl,
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await (this.pool as MySQLPool).end();
      this.pool = null;
      debug('MySQL connection pool closed');
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async requireMySQL(): Promise<MySQL2Module> {
    try {
      // Use variable to prevent TypeScript from statically resolving the optional dep
      const pkg = 'mysql2/promise';
      const mod = await import(/* @vite-ignore */ pkg);
      return (mod.default ?? mod) as MySQL2Module;
    } catch {
      throw new DatabaseConnectionError(
        'mysql2 package not installed',
        'Install it: pnpm add mysql2',
      );
    }
  }

  private async truncateTables(conn: MySQLConnection, schema: SchemaModel): Promise<void> {
    const reversed = [...schema.insertionOrder].reverse();
    for (const tableName of reversed) {
      if (this.excludeTables.has(tableName)) continue;
      debug(`TRUNCATE \`${tableName}\``);
      await conn.query(`TRUNCATE TABLE \`${tableName}\``);
    }
  }

  private async insertRows(
    conn: MySQLConnection,
    tableName: string,
    columns: string[],
    rows: Row[],
  ): Promise<void> {
    const batchSize = this.copyThreshold;
    const colList = columns.map((c) => `\`${c}\``).join(', ');

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const placeholders = batch
        .map(() => `(${columns.map(() => '?').join(', ')})`)
        .join(', ');
      const values = batch.flatMap((row) =>
        columns.map((col) => serializeValue(row[col])),
      );

      debug(`INSERT \`${tableName}\` -- ${batch.length} rows (batch ${Math.floor(i / batchSize) + 1})`);
      await conn.query(
        `INSERT INTO \`${tableName}\` (${colList}) VALUES ${placeholders}`,
        values,
      );
    }
  }

  private async upsertRows(
    conn: MySQLConnection,
    tableName: string,
    columns: string[],
    rows: Row[],
    tableInfo: TableInfo,
  ): Promise<void> {
    const colList = columns.map((c) => `\`${c}\``).join(', ');
    const nonPkCols = columns.filter((c) => !tableInfo.primaryKey.includes(c));
    const updateClause = nonPkCols.length > 0
      ? nonPkCols.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(', ')
      : columns[0] ? `\`${columns[0]}\` = VALUES(\`${columns[0]}\`)` : '';

    const batchSize = this.copyThreshold;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const placeholders = batch
        .map(() => `(${columns.map(() => '?').join(', ')})`)
        .join(', ');
      const values = batch.flatMap((row) =>
        columns.map((col) => serializeValue(row[col])),
      );

      await conn.query(
        `INSERT INTO \`${tableName}\` (${colList}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updateClause}`,
        values,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Internal types for mysql2/promise
// ---------------------------------------------------------------------------

interface MySQL2Module {
  createPool(uri: string): MySQLPool;
}

interface MySQLPool {
  query(sql: string, values?: unknown[]): Promise<unknown[]>;
  getConnection(): Promise<MySQLConnection>;
  end(): Promise<void>;
}

interface MySQLConnection {
  query(sql: string, values?: unknown[]): Promise<unknown[]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

interface MySQLColumnRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: string;
  COLUMN_DEFAULT: string | null;
  EXTRA: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  NUMERIC_PRECISION: number | null;
  NUMERIC_SCALE: number | null;
  COLUMN_KEY: string;
  COLUMN_COMMENT: string;
}

interface MySQLForeignKeyRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
  DELETE_RULE: string;
  UPDATE_RULE: string;
}

interface MySQLUniqueRow {
  TABLE_NAME: string;
  CONSTRAINT_NAME: string;
  COLUMN_NAME: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeAction(action?: string): 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION' | undefined {
  switch (action?.toUpperCase()) {
    case 'CASCADE': return 'CASCADE';
    case 'SET NULL': return 'SET NULL';
    case 'RESTRICT': return 'RESTRICT';
    case 'NO ACTION': return 'NO ACTION';
    default: return undefined;
  }
}

function serializeValue(val: unknown): unknown {
  if (val === undefined || val === null) return null;
  if (val instanceof Date) return val.toISOString().replace('T', ' ').replace('Z', '');
  if (typeof val === 'object') return JSON.stringify(val);
  return val;
}

function collectColumns(rows: Row[], tableInfo: TableInfo): string[] {
  const allCols = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) allCols.add(key);
  }

  // Filter to columns that exist in table schema and aren't auto-increment
  const schemaColNames = new Set(tableInfo.columns.map((c) => c.name));
  const autoIncrCols = new Set(tableInfo.columns.filter((c) => c.isAutoIncrement).map((c) => c.name));
  const generatedCols = new Set(tableInfo.columns.filter((c) => c.isGenerated).map((c) => c.name));

  const columns: string[] = [];
  for (const col of allCols) {
    if (!schemaColNames.has(col)) continue;
    if (autoIncrCols.has(col)) continue;
    if (generatedCols.has(col)) continue;
    columns.push(col);
  }

  // Fill missing values in rows
  for (const row of rows) {
    for (const col of columns) {
      if (row[col] === undefined) {
        row[col] = null;
      }
    }
  }

  return columns;
}

function topoSort(tables: TableInfo[]): string[] {
  const graph = new Map<string, Set<string>>();
  const allNames = new Set(tables.map((t) => t.name));

  for (const t of tables) {
    graph.set(t.name, new Set());
  }
  for (const t of tables) {
    for (const fk of t.foreignKeys) {
      if (allNames.has(fk.referencedTable) && fk.referencedTable !== t.name) {
        graph.get(t.name)!.add(fk.referencedTable);
      }
    }
  }

  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      // Circular dependency -- just add and move on
      sorted.push(name);
      visited.add(name);
      return;
    }
    visiting.add(name);
    for (const dep of graph.get(name) ?? []) {
      visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    sorted.push(name);
  }

  for (const name of allNames) {
    visit(name);
  }

  return sorted;
}
