import pg from 'pg';
import type { Pool, PoolClient } from 'pg';
import type {
  Adapter,
  AdapterType,
  AdapterContext,
  AdapterResult,
} from '../types/adapter.js';
import type { SchemaModel, ExpandedData, Row } from '../types/index.js';
import { DatabaseConnectionError, SeedingError } from '../utils/errors.js';
import { debug, success } from '../utils/logger.js';
import { batchInsert } from './batch-insert.js';
import { bulkCopy } from './bulk-copy.js';
import { syncSequences } from './sequence-sync.js';

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
// PgSeeder — implements Adapter<PostgresConfig>
// ---------------------------------------------------------------------------

export class PgSeeder implements Adapter<PostgresConfig> {
  readonly id = 'postgres';
  readonly name = 'PostgreSQL';
  readonly type: AdapterType = 'database';

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
    await this.seed(schema, dataMap, { strategy: this.seedStrategy });

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
  // Seed
  // -----------------------------------------------------------------------

  async seed(
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

      for (const tableName of schema.insertionOrder) {
        const tableInfo = schema.tables.find((t) => t.name === tableName);
        if (!tableInfo) continue;

        const mergedRows: Row[] = [];
        for (const expandedData of data.values()) {
          const tableRows = expandedData.tables[tableName];
          if (tableRows && tableRows.length > 0) {
            mergedRows.push(...tableRows);
          }
        }

        if (mergedRows.length === 0) {
          debug(`Skipping "${tableName}" -- no rows to insert`);
          continue;
        }

        const columns = Object.keys(mergedRows[0]);

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
        undefined,
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
