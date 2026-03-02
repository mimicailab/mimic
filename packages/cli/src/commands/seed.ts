import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'node:path';

import {
  loadConfig,
  logger,
  readJson,
  fileExists,
  MimicError,
  PgSeeder,
  parseSchema,
} from '@mimicailab/core';
import type { MimicConfig, ExpandedData, SchemaModel } from '@mimicailab/core';

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
  const strategy = (opts.strategy ?? dbConfig.seedStrategy ?? 'truncate-and-insert') as
    | 'truncate-and-insert'
    | 'append'
    | 'upsert';

  logger.debug(`Database URL: ${maskUrl(dbConfig.url)}`);
  logger.debug(`Strategy: ${strategy}`);

  // ── Resolve schema ────────────────────────────────────────────────────────
  const schema = await resolveSchema(cwd, config, dbConfig.url);

  // ── Load expanded data ──────────────────────────────────────────────────
  const dataDir = join(cwd, '.mimic', 'data');
  const personaNames = resolvePersonaNames(config, opts.persona);
  const dataMap = new Map<string, ExpandedData>();

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
    dataMap.set(name, data);
  }

  if (!opts.json) {
    logger.step(
      `Seeding ${dataMap.size} persona(s) with strategy "${chalk.yellow(strategy)}"`,
    );
  }

  // ── Seed via PgSeeder adapter ──────────────────────────────────────────
  const seeder = new PgSeeder(dbConfig.url);
  const results: SeedResult[] = [];

  try {
    // Verify connectivity
    const healthy = await seeder.healthcheck();
    if (!healthy) {
      throw new MimicError(
        'Cannot connect to PostgreSQL',
        'DB_CONNECTION_ERROR',
        'Check your database URL and ensure the server is running',
      );
    }
    logger.debug('Database connection verified');

    const start = performance.now();

    await seeder.seedBatch(schema, dataMap, { strategy });

    const duration = Math.round(performance.now() - start);

    // Build results from the data map
    for (const [name, data] of dataMap) {
      const tableCounts: Record<string, number> = {};
      for (const [table, rows] of Object.entries(data.tables)) {
        tableCounts[table] = (rows as Record<string, unknown>[]).length;
      }
      results.push({ persona: name, tables: tableCounts, duration });
    }
  } finally {
    await seeder.dispose();
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

async function resolveSchema(cwd: string, config: MimicConfig, dbUrl: string): Promise<SchemaModel> {
  // Try loading from cached schema first
  const cachedSchemaPath = join(cwd, '.mimic', 'schema.json');
  if (await fileExists(cachedSchemaPath)) {
    logger.debug('Loading schema from .mimic/schema.json');
    return readJson<SchemaModel>(cachedSchemaPath);
  }

  // Resolve schema config from the database entry
  const databases = config.databases;
  if (!databases || Object.keys(databases).length === 0) {
    throw new MimicError(
      'No database configured',
      'CONFIG_INVALID',
      "Add a 'databases' section to mimic.json with a schema source",
    );
  }

  const [, dbConfig] = Object.entries(databases)[0]!;
  const schemaConfig = (dbConfig as Record<string, unknown>).schema as
    | { source: 'prisma' | 'sql' | 'introspect'; path?: string }
    | undefined;

  const source = schemaConfig?.source ?? 'introspect';

  if (source === 'introspect') {
    let pg: typeof import('pg');
    try {
      pg = await import('pg');
    } catch {
      throw new MimicError(
        'pg module not available for introspection',
        'DB_CONNECTION_ERROR',
        'Ensure "pg" is installed: pnpm add pg',
      );
    }
    const pool = new pg.default.Pool({ connectionString: dbUrl });
    try {
      return await parseSchema({ schema: schemaConfig, pool, basePath: cwd });
    } finally {
      await pool.end();
    }
  }

  return parseSchema({ schema: schemaConfig, basePath: cwd });
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
