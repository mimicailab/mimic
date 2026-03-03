import type {
  DatabaseAdapter,
  AdapterContext,
  AdapterResult,
  InspectResult,
  SchemaModel,
  TableInfo,
  ColumnInfo,
  ColumnType,
  ForeignKey,
  ExpandedData,
  Row,
} from '@mimicai/core';
import { DatabaseConnectionError, SeedingError, logger } from '@mimicai/core';
const { debug, success } = logger;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SQLiteConfig {
  path: string;
  walMode?: boolean;
  seedStrategy?: 'truncate-and-insert' | 'append';
}

// ---------------------------------------------------------------------------
// SQLite type -> canonical type mapping
// ---------------------------------------------------------------------------

const SQLITE_TYPE_MAP: Record<string, ColumnType> = {
  integer: 'integer',
  int: 'integer',
  tinyint: 'smallint',
  smallint: 'smallint',
  mediumint: 'integer',
  bigint: 'bigint',
  real: 'double',
  double: 'double',
  float: 'float',
  numeric: 'decimal',
  decimal: 'decimal',
  text: 'text',
  varchar: 'varchar',
  char: 'char',
  clob: 'text',
  blob: 'bytea',
  boolean: 'boolean',
  date: 'date',
  datetime: 'timestamp',
  timestamp: 'timestamptz',
  json: 'jsonb',
};

function mapSQLiteType(declaredType: string | null): ColumnType {
  if (!declaredType) return 'text'; // SQLite defaults to TEXT affinity
  const lower = declaredType.toLowerCase().replace(/\(.+\)/, '').trim();
  return SQLITE_TYPE_MAP[lower] ?? 'text';
}

// ---------------------------------------------------------------------------
// SQLiteSeeder -- implements DatabaseAdapter<SQLiteConfig>
// ---------------------------------------------------------------------------

export class SQLiteSeeder implements DatabaseAdapter<SQLiteConfig> {
  readonly id = 'sqlite';
  readonly name = 'SQLite';
  readonly type = 'database' as const;

  private db: BetterSQLite3Database | null = null;
  private dbPath: string = ':memory:';
  private walMode: boolean = false;
  private seedStrategy: SQLiteConfig['seedStrategy'] = 'truncate-and-insert';

  // -----------------------------------------------------------------------
  // Adapter interface
  // -----------------------------------------------------------------------

  async init(config: SQLiteConfig, _context: AdapterContext): Promise<void> {
    this.dbPath = config.path;
    this.walMode = config.walMode ?? false;
    this.seedStrategy = config.seedStrategy ?? 'truncate-and-insert';
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
      const db = await this.getDb();
      const result = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
      return result[0]?.integrity_check === 'ok';
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    this.closeDb();
  }

  // -----------------------------------------------------------------------
  // DatabaseAdapter: introspect
  // -----------------------------------------------------------------------

  async introspect(config: SQLiteConfig): Promise<SchemaModel> {
    const BetterSQLite3 = await this.requireSQLite();
    const db = new BetterSQLite3(config.path);

    try {
      return this.introspectWithDb(db);
    } finally {
      db.close();
    }
  }

  private introspectWithDb(db: BetterSQLite3Database): SchemaModel {
    // Get all tables (excluding sqlite internal tables)
    const tableRows = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    ).all() as Array<{ name: string }>;

    const tables: TableInfo[] = [];

    for (const tableRow of tableRows) {
      const tableName = tableRow.name;

      // Get column info
      const columnRows = db.pragma(`table_info("${tableName}")`) as SQLitePragmaColumn[];

      // Get foreign keys
      const fkRows = db.pragma(`foreign_key_list("${tableName}")`) as SQLitePragmaFK[];

      // Get index list for unique constraints
      const indexRows = db.pragma(`index_list("${tableName}")`) as SQLitePragmaIndex[];
      const uniqueConstraints: string[][] = [];
      for (const idx of indexRows) {
        if (idx.unique) {
          const indexInfo = db.pragma(`index_info("${idx.name}")`) as SQLitePragmaIndexInfo[];
          const cols = indexInfo.map((ii) => ii.name);
          if (cols.length > 0) {
            uniqueConstraints.push(cols);
          }
        }
      }

      const columns: ColumnInfo[] = columnRows.map((col) => {
        const isAutoIncrement = col.pk === 1 && (col.type.toUpperCase().includes('INTEGER'));
        return {
          name: col.name,
          type: mapSQLiteType(col.type),
          pgType: col.type || 'TEXT',
          isNullable: col.notnull === 0,
          hasDefault: col.dflt_value !== null,
          defaultValue: col.dflt_value ?? undefined,
          isAutoIncrement,
          isGenerated: false,
          maxLength: undefined,
          precision: undefined,
          scale: undefined,
          enumValues: undefined,
          comment: undefined,
        };
      });

      const primaryKey = columnRows
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);

      // Group foreign keys by id (each FK constraint has a unique id)
      const fkGrouped = new Map<number, { cols: string[]; refCols: string[]; refTable: string; onDelete?: string; onUpdate?: string }>();
      for (const fk of fkRows) {
        if (!fkGrouped.has(fk.id)) {
          fkGrouped.set(fk.id, { cols: [], refCols: [], refTable: fk.table, onDelete: fk.on_delete, onUpdate: fk.on_update });
        }
        fkGrouped.get(fk.id)!.cols.push(fk.from);
        fkGrouped.get(fk.id)!.refCols.push(fk.to);
      }

      const foreignKeys: ForeignKey[] = [...fkGrouped.values()].map((g) => ({
        columns: g.cols,
        referencedTable: g.refTable,
        referencedColumns: g.refCols,
        onDelete: normalizeAction(g.onDelete),
        onUpdate: normalizeAction(g.onUpdate),
      }));

      tables.push({
        name: tableName,
        columns,
        primaryKey,
        foreignKeys,
        uniqueConstraints,
        checkConstraints: [],
        comment: undefined,
      });
    }

    const insertionOrder = topoSort(tables);

    return {
      tables,
      enums: [],
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
    const db = await this.getDb();

    const tableRows = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    ).all() as Array<{ name: string }>;

    const tables: InspectResult['tables'] = {};
    let totalRows = 0;

    for (const row of tableRows) {
      const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM "${row.name}"`).get() as { cnt: number };
      const rowCount = countRow.cnt;
      tables[row.name] = { rowCount };
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
    options: { strategy: 'truncate-and-insert' | 'append' },
  ): Promise<void> {
    const db = await this.getDb();

    // Wrap the entire operation in a transaction
    const seedAll = db.transaction(() => {
      db.pragma('foreign_keys = OFF');

      if (options.strategy === 'truncate-and-insert') {
        this.truncateTables(db, schema);
      }

      const personaKeys = [...data.keys()];

      for (const tableName of schema.insertionOrder) {
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

        const columns = collectColumns(mergedRows, tableInfo);
        if (columns.length === 0) continue;

        const colList = columns.map((c) => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders})`;
        const stmt = db.prepare(sql);

        debug(`INSERT "${tableName}" -- ${mergedRows.length} rows`);

        for (const row of mergedRows) {
          const values = columns.map((col) => serializeValue(row[col]));
          stmt.run(...values);
        }
      }

      db.pragma('foreign_keys = ON');
    });

    try {
      seedAll();
      success(`Seeded ${schema.insertionOrder.length} tables successfully`);
    } catch (err) {
      throw new SeedingError(
        `SQLite seeding failed: ${err instanceof Error ? err.message : String(err)}`,
        'Check constraints and data types',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  // -----------------------------------------------------------------------
  // Clean
  // -----------------------------------------------------------------------

  async clean(context: AdapterContext): Promise<void> {
    if (context.schema) {
      const db = await this.getDb();
      const cleanAll = db.transaction(() => {
        db.pragma('foreign_keys = OFF');
        this.truncateTables(db, context.schema!);
        db.pragma('foreign_keys = ON');
      });

      try {
        cleanAll();
        success('All SQLite tables cleaned');
      } catch (err) {
        throw new SeedingError(
          `SQLite clean failed: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Connection helpers
  // -----------------------------------------------------------------------

  private async getDb(): Promise<BetterSQLite3Database> {
    if (this.db) return this.db;

    try {
      const BetterSQLite3 = await this.requireSQLite();
      this.db = new BetterSQLite3(this.dbPath);

      if (this.walMode) {
        this.db.pragma('journal_mode = WAL');
      }

      debug(`SQLite database opened: ${this.dbPath}`);
      return this.db;
    } catch (err) {
      throw new DatabaseConnectionError(
        `Failed to open SQLite database at "${this.dbPath}"`,
        'Check file path and permissions',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  /** Expose for testing -- opens a db from a given BetterSQLite3 instance */
  setDb(db: BetterSQLite3Database): void {
    this.db = db;
  }

  private closeDb(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      debug('SQLite database closed');
    }
  }

  private async requireSQLite(): Promise<BetterSQLite3Constructor> {
    try {
      // Use variable to prevent TypeScript from statically resolving the optional dep
      const pkg = 'better-sqlite3';
      const mod = await import(/* @vite-ignore */ pkg);
      return (mod.default ?? mod) as BetterSQLite3Constructor;
    } catch {
      throw new DatabaseConnectionError(
        'better-sqlite3 package not installed',
        'Install it: pnpm add better-sqlite3',
      );
    }
  }

  private truncateTables(db: BetterSQLite3Database, schema: SchemaModel): void {
    const reversed = [...schema.insertionOrder].reverse();
    for (const tableName of reversed) {
      debug(`DELETE FROM "${tableName}"`);
      db.prepare(`DELETE FROM "${tableName}"`).run();
    }
  }
}

// ---------------------------------------------------------------------------
// Internal types for better-sqlite3
// ---------------------------------------------------------------------------

interface BetterSQLite3Constructor {
  new (filename: string, options?: Record<string, unknown>): BetterSQLite3Database;
}

export interface BetterSQLite3Database {
  prepare(sql: string): BetterSQLite3Statement;
  pragma(pragma: string): unknown;
  transaction<T>(fn: () => T): () => T;
  close(): void;
  exec(sql: string): void;
}

interface BetterSQLite3Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SQLitePragmaColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface SQLitePragmaFK {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

interface SQLitePragmaIndex {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface SQLitePragmaIndexInfo {
  seqno: number;
  cid: number;
  name: string;
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
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'object') return JSON.stringify(val);
  return val;
}

function collectColumns(rows: Row[], tableInfo: TableInfo): string[] {
  const allCols = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) allCols.add(key);
  }

  const schemaColNames = new Set(tableInfo.columns.map((c) => c.name));
  const autoIncrCols = new Set(
    tableInfo.columns
      .filter((c) => c.isAutoIncrement)
      .map((c) => c.name),
  );
  const generatedCols = new Set(
    tableInfo.columns
      .filter((c) => c.isGenerated)
      .map((c) => c.name),
  );

  const columns: string[] = [];
  for (const col of allCols) {
    if (!schemaColNames.has(col)) continue;
    if (autoIncrCols.has(col)) continue;
    if (generatedCols.has(col)) continue;
    columns.push(col);
  }

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
