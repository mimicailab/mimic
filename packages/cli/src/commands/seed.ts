import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'node:path';

import {
  loadConfig,
  logger,
  readJson,
  fileExists,
  MimicError,
  DatabaseConnectionError,
  SeedingError,
} from '@mimicailab/core';
import type { MimicConfig, ExpandedData } from '@mimicailab/core';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerSeedCommand(program: Command): void {
  program
    .command('seed')
    .description('Push expanded data to PostgreSQL')
    .option('-p, --persona <names...>', 'limit to specific personas')
    .option(
      '-s, --strategy <strategy>',
      'seed strategy: truncate-and-insert, append, upsert',
    )
    .option('--verbose', 'enable verbose logging')
    .option('--json', 'output results as JSON')
    .action(async (opts) => {
      await runSeed(opts);
    });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeedOptions {
  persona?: string[];
  strategy?: string;
  verbose?: boolean;
  json?: boolean;
}

interface SeedResult {
  persona: string;
  tables: Record<string, number>;
  duration: number;
}

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------

async function runSeed(opts: SeedOptions): Promise<void> {
  if (opts.verbose) {
    logger.setVerbose(true);
  }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);

  if (!opts.json) {
    logger.header('mimic seed');
  }

  // ── Resolve database config ─────────────────────────────────────────────
  const dbConfig = resolveDatabase(config);
  const strategy = opts.strategy ?? dbConfig.seedStrategy ?? 'truncate-and-insert';

  logger.debug(`Database URL: ${maskUrl(dbConfig.url)}`);
  logger.debug(`Strategy: ${strategy}`);

  // ── Load expanded data ──────────────────────────────────────────────────
  const dataDir = join(cwd, '.mimic', 'data');
  const personaNames = resolvePersonaNames(config, opts.persona);
  const datasets: { name: string; data: ExpandedData }[] = [];

  for (const name of personaNames) {
    const dataPath = join(dataDir, `${name}.json`);
    if (!(await fileExists(dataPath))) {
      throw new MimicError(
        `No expanded data found for persona "${name}"`,
        'CONFIG_INVALID',
        `Run 'mimic run' first to generate data for this persona`,
      );
    }
    const data = await readJson<ExpandedData>(dataPath);
    datasets.push({ name, data });
  }

  if (!opts.json) {
    logger.step(
      `Seeding ${datasets.length} persona(s) with strategy "${chalk.yellow(strategy)}"`,
    );
  }

  // ── Connect and seed ────────────────────────────────────────────────────
  let pg: typeof import('pg');
  try {
    pg = await import('pg');
  } catch {
    throw new DatabaseConnectionError(
      'pg module not available',
      'Ensure "pg" is installed: pnpm add pg',
    );
  }

  const pool = new pg.default.Pool({ connectionString: dbConfig.url });
  const results: SeedResult[] = [];

  try {
    // Verify connectivity
    const testClient = await pool.connect();
    testClient.release();
    logger.debug('Database connection verified');

    for (const { name, data } of datasets) {
      const start = performance.now();
      const tableCounts: Record<string, number> = {};
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // If strategy is truncate-and-insert, truncate first
        if (strategy === 'truncate-and-insert') {
          const tableNames = Object.keys(data.tables);
          if (tableNames.length > 0) {
            // Truncate in reverse order to respect FK constraints
            const reversed = [...tableNames].reverse();
            for (const table of reversed) {
              await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
              logger.debug(`Truncated ${table}`);
            }
          }
        }

        // Insert data table by table
        for (const [table, rows] of Object.entries(data.tables)) {
          const typedRows = rows as Record<string, unknown>[];
          if (typedRows.length === 0) {
            tableCounts[table] = 0;
            continue;
          }

          const columns = Object.keys(typedRows[0]!);
          const spin = opts.json ? null : logger.spinner(`Seeding ${table}...`);

          try {
            // Batch insert using multi-row parameterised INSERTs
            const BATCH_SIZE = 100;
            for (let offset = 0; offset < typedRows.length; offset += BATCH_SIZE) {
              const batch = typedRows.slice(offset, offset + BATCH_SIZE);
              const quotedCols = columns.map((c) => `"${c}"`).join(', ');
              const valueTuples: string[] = [];
              const params: unknown[] = [];
              const colCount = columns.length;

              for (let rowIdx = 0; rowIdx < batch.length; rowIdx++) {
                const placeholders: string[] = [];
                for (let colIdx = 0; colIdx < colCount; colIdx++) {
                  placeholders.push(`$${rowIdx * colCount + colIdx + 1}`);
                  const val = batch[rowIdx]![columns[colIdx]!];
                  params.push(serialiseValue(val));
                }
                valueTuples.push(`(${placeholders.join(', ')})`);
              }

              const sql = `INSERT INTO "${table}" (${quotedCols}) VALUES ${valueTuples.join(', ')}`;
              await client.query(sql, params);
            }

            tableCounts[table] = typedRows.length;
            spin?.succeed(`${table}: ${chalk.yellow(String(typedRows.length))} rows`);
          } catch (err) {
            spin?.fail(`Failed to seed ${table}`);
            throw new SeedingError(
              `Failed to insert into "${table}": ${err instanceof Error ? err.message : String(err)}`,
              `Check that table "${table}" exists and column types match`,
              err instanceof Error ? err : undefined,
            );
          }
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
        throw err;
      }

      client.release();

      const duration = Math.round(performance.now() - start);
      results.push({ persona: name, tables: tableCounts, duration });
    }
  } finally {
    await pool.end();
  }

  // ── Output ──────────────────────────────────────────────────────────────
  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log();
  logger.header('Seed Results');

  for (const result of results) {
    console.log();
    console.log(`  ${chalk.bold(result.persona)} ${chalk.dim(`(${result.duration}ms)`)}`);
    for (const [table, count] of Object.entries(result.tables)) {
      logger.info(`  ${chalk.dim(table)}: ${chalk.yellow(String(count))} rows`);
    }
  }

  const totalRows = results.reduce(
    (sum, r) => sum + Object.values(r.tables).reduce((s, n) => s + n, 0),
    0,
  );
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log();
  logger.done(`Seeded ${totalRows} rows in ${totalTime}ms`);
  console.log();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DbEntry {
  type: string;
  url: string;
  seedStrategy?: string;
}

function resolveDatabase(config: MimicConfig): DbEntry {
  const databases = config.databases;
  if (!databases || Object.keys(databases).length === 0) {
    throw new MimicError(
      'No database configured',
      'CONFIG_INVALID',
      "Add a 'databases' section to mimic.json or run 'mimic init'",
    );
  }

  // Use the first database (typically "default")
  const [, db] = Object.entries(databases)[0]!;
  return db as DbEntry;
}

function resolvePersonaNames(
  config: MimicConfig,
  filter?: string[],
): string[] {
  const all = config.personas.map((p) => p.name);

  if (filter && filter.length > 0) {
    const missing = filter.filter((n) => !all.includes(n));
    if (missing.length > 0) {
      throw new MimicError(
        `Unknown persona(s): ${missing.join(', ')}`,
        'CONFIG_INVALID',
        `Available: ${all.join(', ')}`,
      );
    }
    return filter;
  }

  return all;
}

function serialiseValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    return url.slice(0, 30) + '...';
  }
}
