import pg from 'pg';
import type { Pool, PoolClient } from 'pg';
import type {
  DatabaseAdapter,
  AdapterContext,
  AdapterResult,
  InspectResult,
} from '@mimicailab/core';
import type { SchemaModel, TableInfo, ColumnInfo, ExpandedData, Row } from '@mimicailab/core';
import { DatabaseConnectionError, SeedingError, logger } from '@mimicailab/core';
import { introspectDatabase } from '@mimicailab/core';
import { batchInsert } from './batch-insert.js';
import { bulkCopy } from './bulk-copy.js';
import { syncSequences } from './sequence-sync.js';

const { debug, success, warn } = logger;

// ---------------------------------------------------------------------------
// PG type parser overrides (module-level, applied once on import)
// ---------------------------------------------------------------------------
pg.types.setTypeParser(1700, (val: string) => parseFloat(val));  // numeric / decimal
pg.types.setTypeParser(20, (val: string) => parseInt(val, 10));  // int8 / bigint

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SeedOptions {
  strategy: 'truncate-and-insert' | 'append' | 'upsert';
  verbose?: boolean;
}

export interface PostgresConfig {
  url: string;
  seedStrategy?: 'truncate-and-insert' | 'append' | 'upsert';
}

// ---------------------------------------------------------------------------
// Threshold: rows beyond this count use COPY instead of batch INSERT.
// ---------------------------------------------------------------------------
const COPY_THRESHOLD = 500;

// ---------------------------------------------------------------------------
// PgSeeder — implements DatabaseAdapter<PostgresConfig>
// ---------------------------------------------------------------------------

export class PgSeeder implements DatabaseAdapter<PostgresConfig> {
  readonly id = 'postgres';
  readonly name = 'PostgreSQL';
  readonly type = 'database' as const;

  private pool: Pool | null = null;
  private connectionString: string = '';
  private seedStrategy: SeedOptions['strategy'] = 'truncate-and-insert';

  constructor(connectionString?: string) {
    if (connectionString) {
      this.connectionString = connectionString;
    }
  }

  // -----------------------------------------------------------------------
  // Adapter interface
  // -----------------------------------------------------------------------

  async init(config: PostgresConfig, _context: AdapterContext): Promise<void> {
    this.connectionString = config.url;
    this.seedStrategy = config.seedStrategy ?? 'truncate-and-insert';
  }

  async apply(data: ExpandedData, context: AdapterContext): Promise<AdapterResult> {
    const schema = context.schema!;
    const start = Date.now();
    const stats: Record<string, number> = {};

    const dataMap = new Map<string, ExpandedData>();
    dataMap.set(data.personaId, data);
    await this.seedBatch(schema, dataMap, { strategy: this.seedStrategy });

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
      await pool.query('SELECT 1');
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

  async introspect(config: PostgresConfig): Promise<SchemaModel> {
    const pool = new pg.Pool({ connectionString: config.url });
    try {
      return await introspectDatabase(pool);
    } finally {
      await pool.end();
    }
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
    const result = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );

    const tables: InspectResult['tables'] = {};
    let totalRows = 0;

    for (const row of result.rows) {
      const countResult = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${row.tablename}"`,
      );
      const rowCount = parseInt(countResult.rows[0]?.count ?? '0', 10);
      tables[row.tablename] = { rowCount };
      totalRows += rowCount;
    }

    return { tables, totalRows, timestamp: new Date() };
  }

  // -----------------------------------------------------------------------
  // Connection helpers
  // -----------------------------------------------------------------------

  private async getPool(): Promise<Pool> {
    if (this.pool) return this.pool;

    try {
      this.pool = new pg.Pool({ connectionString: this.connectionString });
      const testClient = await this.pool.connect();
      testClient.release();
      debug('PostgreSQL connection pool established');
      return this.pool;
    } catch (err) {
      throw new DatabaseConnectionError(
        'Failed to connect to PostgreSQL',
        undefined,
        err instanceof Error ? err : new Error(String(err)),
        this.connectionString,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Batch seed (internal — multi-persona, schema-aware)
  // -----------------------------------------------------------------------

  async seedBatch(
    schema: SchemaModel,
    data: Map<string, ExpandedData>,
    options: SeedOptions,
  ): Promise<void> {
    const pool = await this.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');

      if (options.strategy === 'truncate-and-insert') {
        await this.truncateTables(client, schema);
      }

      // When multiple personas exist, offset auto-increment IDs so they don't
      // collide. Build a map of table.column → offset per persona.
      const personaKeys = [...data.keys()];
      const idOffsets = computeIdOffsets(schema, data, personaKeys);

      for (const tableName of schema.insertionOrder) {
        const tableInfo = schema.tables.find((t) => t.name === tableName);
        if (!tableInfo) continue;

        const mergedRows: Row[] = [];
        for (let pi = 0; pi < personaKeys.length; pi++) {
          const expandedData = data.get(personaKeys[pi]!)!;
          const tableRows = expandedData.tables[tableName];
          if (!tableRows || tableRows.length === 0) continue;

          for (const originalRow of tableRows) {
            // Deep-clone so we don't mutate the source data
            const row = { ...originalRow };

            // Offset auto-increment PKs and their FK references
            if (personaKeys.length > 1) {
              applyIdOffsets(row, tableName, tableInfo, schema, idOffsets, pi);
            }

            mergedRows.push(row);
          }
        }

        if (mergedRows.length === 0) {
          debug(`Skipping "${tableName}" -- no rows to insert`);
          continue;
        }

        // Fill missing required columns with type-appropriate defaults
        fillMissingColumns(mergedRows, tableInfo);

        // Normalize columns across all rows. When personas have different
        // columns (e.g. one includes "status", another doesn't), we must
        // either include the column for all rows or exclude it entirely.
        const columns = normalizeRowColumns(mergedRows, tableInfo);

        if (mergedRows.length > COPY_THRESHOLD) {
          debug(`COPY "${tableName}" -- ${mergedRows.length} rows`);
          await bulkCopy(client, tableName, columns, mergedRows);
        } else {
          debug(`INSERT "${tableName}" -- ${mergedRows.length} rows`);
          await batchInsert(client, tableName, columns, mergedRows);
        }
      }

      await syncSequences(client, schema);
      await client.query('COMMIT');
      success(`Seeded ${schema.insertionOrder.length} tables successfully`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});

      throw new SeedingError(
        `Seeding failed: ${err instanceof Error ? err.message : String(err)}`,
        'Check FK constraints and data types',
        err instanceof Error ? err : new Error(String(err)),
      );
    } finally {
      client.release();
    }
  }

  // -----------------------------------------------------------------------
  // Clean
  // -----------------------------------------------------------------------

  async clean(context: AdapterContext): Promise<void> {
    if (context.schema) {
      await this.cleanTables(context.schema);
    }
  }

  async cleanTables(schema: SchemaModel): Promise<void> {
    const pool = await this.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await this.truncateTables(client, schema);
      await client.query('COMMIT');
      success('All tables truncated');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});

      throw new SeedingError(
        `Clean failed: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        err instanceof Error ? err : new Error(String(err)),
      );
    } finally {
      client.release();
    }
  }

  // -----------------------------------------------------------------------
  // Disconnect
  // -----------------------------------------------------------------------

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      debug('PostgreSQL connection pool closed');
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async truncateTables(client: PoolClient, schema: SchemaModel): Promise<void> {
    const reversed = [...schema.insertionOrder].reverse();

    for (const tableName of reversed) {
      debug(`TRUNCATE "${tableName}" CASCADE`);
      await client.query(`TRUNCATE "${tableName}" CASCADE`);
    }
  }
}

// ---------------------------------------------------------------------------
// Multi-persona ID offset helpers
// ---------------------------------------------------------------------------

interface IdOffsetMap {
  /** table.column → max ID value per persona index */
  maxIds: Map<string, number[]>;
  /** table.column → cumulative offset per persona index */
  offsets: Map<string, number[]>;
}

/**
 * Compute ID offsets for multi-persona merges. When two personas both
 * generate `users.id = 1,2,3`, the second persona's IDs become 4,5,6.
 */
function computeIdOffsets(
  schema: SchemaModel,
  data: Map<string, ExpandedData>,
  personaKeys: string[],
): IdOffsetMap {
  const maxIds = new Map<string, number[]>();
  const offsets = new Map<string, number[]>();

  for (const tableInfo of schema.tables) {
    for (const col of tableInfo.columns) {
      if (!col.isAutoIncrement) continue;

      const key = `${tableInfo.name}.${col.name}`;
      const perPersonaMax: number[] = [];

      for (const personaKey of personaKeys) {
        const expanded = data.get(personaKey);
        const rows = expanded?.tables[tableInfo.name];
        let maxVal = 0;
        if (rows) {
          for (const row of rows) {
            const val = row[col.name];
            if (typeof val === 'number' && val > maxVal) maxVal = val;
          }
        }
        perPersonaMax.push(maxVal);
      }

      maxIds.set(key, perPersonaMax);

      // Cumulative offsets: persona 0 gets offset 0, persona 1 gets max of persona 0, etc.
      const cumulativeOffsets: number[] = [0];
      for (let i = 1; i < perPersonaMax.length; i++) {
        cumulativeOffsets.push(cumulativeOffsets[i - 1]! + perPersonaMax[i - 1]!);
      }
      offsets.set(key, cumulativeOffsets);
    }
  }

  return { maxIds, offsets };
}

/**
 * Apply ID offsets to a row: shift auto-increment PKs and any FK references
 * that point to offset tables.
 */
function applyIdOffsets(
  row: Row,
  tableName: string,
  tableInfo: TableInfo,
  schema: SchemaModel,
  idOffsets: IdOffsetMap,
  personaIndex: number,
): void {
  // Offset auto-increment PK columns
  for (const col of tableInfo.columns) {
    if (!col.isAutoIncrement) continue;
    const key = `${tableName}.${col.name}`;
    const offsets = idOffsets.offsets.get(key);
    if (!offsets) continue;

    const offset = offsets[personaIndex] ?? 0;
    if (offset === 0) continue;

    const val = row[col.name];
    if (typeof val === 'number') {
      row[col.name] = val + offset;
    }
  }

  // Offset FK columns that reference offset tables
  for (const fk of tableInfo.foreignKeys) {
    for (let i = 0; i < fk.columns.length; i++) {
      const fkCol = fk.columns[i]!;
      const refKey = `${fk.referencedTable}.${fk.referencedColumns[i]!}`;
      const offsets = idOffsets.offsets.get(refKey);
      if (!offsets) continue;

      const offset = offsets[personaIndex] ?? 0;
      if (offset === 0) continue;

      const val = row[fkCol];
      if (typeof val === 'number') {
        row[fkCol] = val + offset;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Missing column defaults
// ---------------------------------------------------------------------------

/**
 * Fill in missing NOT NULL columns that have no DB default with sensible
 * type-appropriate values. This handles common cases like Prisma @updatedAt
 * (no SQL default) and LLM omissions (e.g. missing `balance`).
 */
function fillMissingColumns(rows: Row[], tableInfo: TableInfo): void {
  for (const col of tableInfo.columns) {
    // Skip columns that have DB defaults, are nullable, auto-increment, or generated
    if (col.hasDefault || col.isNullable || col.isAutoIncrement || col.isGenerated) {
      continue;
    }

    // Check if any row is missing this column
    const missing = rows.some((row) => row[col.name] === undefined || row[col.name] === null);
    if (!missing) continue;

    const defaultVal = getTypeDefault(col);
    if (defaultVal === undefined) continue;

    warn(`Auto-filling missing NOT NULL column "${tableInfo.name}.${col.name}" with default ${JSON.stringify(defaultVal)}`);

    for (const row of rows) {
      if (row[col.name] === undefined || row[col.name] === null) {
        row[col.name] = defaultVal;
      }
    }
  }
}

/**
 * Build a consistent column list for all rows. If a column is present in
 * some rows but not others:
 *  - If the DB has a default → drop the column (let DB fill it)
 *  - If NOT NULL with no default → fill with type-appropriate value
 *  - If nullable → fill with null
 */
function normalizeRowColumns(rows: Row[], tableInfo: TableInfo): string[] {
  // Collect all columns across all rows
  const allCols = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) allCols.add(key);
  }

  const colInfoMap = new Map<string, ColumnInfo>();
  for (const col of tableInfo.columns) {
    colInfoMap.set(col.name, col);
  }

  // For each column, check if every row has it
  const finalColumns: string[] = [];
  for (const colName of allCols) {
    const allPresent = rows.every(
      (row) => row[colName] !== undefined,
    );

    if (allPresent) {
      finalColumns.push(colName);
      continue;
    }

    // Column is missing in some rows
    const colInfo = colInfoMap.get(colName);

    if (colInfo?.hasDefault) {
      // DB has a default — drop this column entirely, remove from rows that have it
      for (const row of rows) {
        delete row[colName];
      }
      debug(`Dropping column "${tableInfo.name}.${colName}" (has DB default, missing in some rows)`);
      continue;
    }

    // No default — fill missing rows
    finalColumns.push(colName);
    for (const row of rows) {
      if (row[colName] === undefined) {
        if (colInfo?.isNullable) {
          row[colName] = null;
        } else {
          row[colName] = colInfo ? getTypeDefault(colInfo) ?? null : null;
        }
      }
    }
  }

  return finalColumns;
}

function getTypeDefault(col: ColumnInfo): unknown {
  switch (col.type) {
    case 'integer':
    case 'bigint':
    case 'smallint':
      return 0;
    case 'decimal':
    case 'float':
    case 'double':
      return 0;
    case 'text':
    case 'varchar':
    case 'char':
      return '';
    case 'boolean':
      return false;
    case 'timestamptz':
    case 'timestamp':
      return new Date().toISOString();
    case 'date':
      return new Date().toISOString().split('T')[0];
    case 'time':
      return '00:00:00';
    case 'uuid':
      return '00000000-0000-0000-0000-000000000000';
    case 'json':
    case 'jsonb':
      return '{}';
    default:
      return undefined;
  }
}
