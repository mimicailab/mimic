import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'node:path';

import {
  loadConfig,
  logger,
  readJson,
  fileExists,
  MimicError,
  parseSchema,
} from '@mimicai/core';
import type { MimicConfig, ExpandedData, SchemaModel, DatabaseAdapter } from '@mimicai/core';
import { PgSeeder } from '@mimicai/adapter-postgres';
import { MySQLSeeder } from '@mimicai/adapter-mysql';
import { SQLiteSeeder } from '@mimicai/adapter-sqlite';
import { MongoSeeder } from '@mimicai/adapter-mongodb';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerSeedCommand(program: Command): void {
  program
    .command('seed')
    .description('Push expanded data to configured databases')
    .option('-p, --persona <names...>', 'limit to specific personas')
    .option(
      '-s, --strategy <strategy>',
      'seed strategy (depends on database type)',
    )
    .option('-d, --database <name>', 'seed a specific database entry')
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
  database?: string;
  verbose?: boolean;
  json?: boolean;
}

interface SeedResult {
  database: string;
  type: string;
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

  // ── Resolve databases ─────────────────────────────────────────────────
  const databases = config.databases;
  if (!databases || Object.keys(databases).length === 0) {
    throw new MimicError(
      'No database configured',
      'CONFIG_INVALID',
      "Add a 'databases' section to mimic.json or run 'mimic init'",
    );
  }

  // Filter to specific database if --database flag is used
  const dbEntries = opts.database
    ? Object.entries(databases).filter(([name]) => name === opts.database)
    : Object.entries(databases);

  if (dbEntries.length === 0) {
    throw new MimicError(
      `Database "${opts.database}" not found in config`,
      'CONFIG_INVALID',
      `Available databases: ${Object.keys(databases).join(', ')}`,
    );
  }

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

  const results: SeedResult[] = [];

  // ── Seed each database ──────────────────────────────────────────────────
  for (const [dbName, dbConfig] of dbEntries) {
    const dbType = dbConfig.type;

    if (!opts.json) {
      logger.step(
        `Seeding ${chalk.cyan(dbName)} (${chalk.yellow(dbType)}) with ${dataMap.size} persona(s)`,
      );
    }

    const { seeder, strategy, schema } = await createSeeder(dbType, dbConfig, opts.strategy, cwd, config);

    try {
      // Verify connectivity
      const healthy = await seeder.healthcheck();
      if (!healthy) {
        throw new MimicError(
          `Cannot connect to ${dbType} database "${dbName}"`,
          'DB_CONNECTION_ERROR',
          'Check your database URL/path and ensure the server is running',
        );
      }
      logger.debug(`${dbType} connection verified for "${dbName}"`);

      const start = performance.now();

      // Route to the correct seed method
      switch (dbType) {
        case 'postgres': {
          const pgSeeder = seeder as InstanceType<typeof PgSeeder>;
          await pgSeeder.seedBatch(schema!, dataMap, { strategy: strategy as 'truncate-and-insert' | 'append' | 'upsert' });
          break;
        }
        case 'mysql': {
          const mysqlSeeder = seeder as InstanceType<typeof MySQLSeeder>;
          await mysqlSeeder.seedBatch(schema!, dataMap, { strategy: strategy as 'truncate-and-insert' | 'append' | 'upsert' });
          break;
        }
        case 'sqlite': {
          const sqliteSeeder = seeder as InstanceType<typeof SQLiteSeeder>;
          await sqliteSeeder.seedBatch(schema!, dataMap, { strategy: strategy as 'truncate-and-insert' | 'append' });
          break;
        }
        case 'mongodb': {
          const mongoSeeder = seeder as InstanceType<typeof MongoSeeder>;
          await mongoSeeder.seedBatch(dataMap);
          break;
        }
        default:
          throw new MimicError(
            `Unsupported database type: ${dbType}`,
            'CONFIG_INVALID',
            'Supported types: postgres, mysql, sqlite, mongodb',
          );
      }

      const duration = Math.round(performance.now() - start);

      for (const [name, data] of dataMap) {
        const tableCounts: Record<string, number> = {};
        for (const [table, rows] of Object.entries(data.tables)) {
          tableCounts[table] = (rows as Record<string, unknown>[]).length;
        }
        results.push({ database: dbName, type: dbType, persona: name, tables: tableCounts, duration });
      }
    } finally {
      await seeder.dispose();
    }
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
    console.log(`  ${chalk.bold(result.persona)} → ${chalk.cyan(result.database)} ${chalk.dim(`(${result.duration}ms)`)}`);
    for (const [table, count] of Object.entries(result.tables)) {
      logger.info(`  ${chalk.dim(table)}: ${chalk.yellow(String(count))} rows`);
    }
  }

  const totalRows = results.reduce(
    (sum, r) => sum + Object.values(r.tables).reduce((s, n) => s + n, 0),
    0,
  );

  console.log();
  logger.done(`Seeded ${totalRows} rows across ${dbEntries.length} database(s)`);
  console.log();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createSeeder(
  dbType: string,
  dbConfig: Record<string, unknown>,
  strategyOverride: string | undefined,
  cwd: string,
  config: MimicConfig,
): Promise<{ seeder: DatabaseAdapter & { dispose: () => Promise<void>; healthcheck: () => Promise<boolean> }; strategy: string; schema: SchemaModel | null }> {
  switch (dbType) {
    case 'postgres': {
      const url = dbConfig.url as string;
      const strategy = strategyOverride ?? (dbConfig.seedStrategy as string) ?? 'truncate-and-insert';
      const seeder = new PgSeeder(url);
      const schema = await resolveSchema(cwd, config, dbConfig);
      return { seeder, strategy, schema };
    }
    case 'mysql': {
      const url = dbConfig.url as string;
      const strategy = strategyOverride ?? (dbConfig.seedStrategy as string) ?? 'truncate-and-insert';
      const seeder = new MySQLSeeder();
      await seeder.init(
        { url, seedStrategy: strategy as 'truncate-and-insert' | 'append' | 'upsert', copyThreshold: dbConfig.copyThreshold as number | undefined, excludeTables: dbConfig.excludeTables as string[] | undefined },
        { config, blueprints: new Map(), logger },
      );
      const schema = await resolveSchema(cwd, config, dbConfig);
      return { seeder, strategy, schema };
    }
    case 'sqlite': {
      const path = dbConfig.path as string;
      const strategy = strategyOverride ?? (dbConfig.seedStrategy as string) ?? 'truncate-and-insert';
      const seeder = new SQLiteSeeder();
      await seeder.init(
        { path, walMode: dbConfig.walMode as boolean | undefined, seedStrategy: strategy as 'truncate-and-insert' | 'append' },
        { config, blueprints: new Map(), logger },
      );
      // For SQLite, introspect from the live database
      const schema = await seeder.introspect({ path, walMode: dbConfig.walMode as boolean | undefined });
      return { seeder, strategy, schema };
    }
    case 'mongodb': {
      const url = dbConfig.url as string;
      const strategy = strategyOverride ?? (dbConfig.seedStrategy as string) ?? 'delete-and-insert';
      const seeder = new MongoSeeder();
      await seeder.init(
        {
          url,
          database: dbConfig.database as string | undefined,
          collections: dbConfig.collections as string[] | undefined,
          seedStrategy: strategy as 'drop-and-insert' | 'delete-and-insert' | 'append' | 'upsert',
          autoCreateIndexes: dbConfig.autoCreateIndexes as boolean | undefined,
          tls: dbConfig.tls as boolean | undefined,
        },
        { config, blueprints: new Map(), logger },
      );
      return { seeder, strategy, schema: null };
    }
    default:
      throw new MimicError(
        `Unsupported database type: ${dbType}`,
        'CONFIG_INVALID',
        'Supported types: postgres, mysql, sqlite, mongodb',
      );
  }
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

async function resolveSchema(
  cwd: string,
  config: MimicConfig,
  dbConfig: Record<string, unknown>,
): Promise<SchemaModel> {
  // Try loading from cached schema first
  const cachedSchemaPath = join(cwd, '.mimic', 'schema.json');
  if (await fileExists(cachedSchemaPath)) {
    logger.debug('Loading schema from .mimic/schema.json');
    return readJson<SchemaModel>(cachedSchemaPath);
  }

  const schemaConfig = dbConfig.schema as
    | { source: 'prisma' | 'sql' | 'introspect'; path?: string }
    | undefined;

  const source = schemaConfig?.source ?? 'introspect';

  if (source === 'introspect') {
    const url = dbConfig.url as string;
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
    const pool = new pg.default.Pool({ connectionString: url });
    try {
      return await parseSchema({ schema: schemaConfig, pool, basePath: cwd });
    } finally {
      await pool.end();
    }
  }

  return parseSchema({ schema: schemaConfig, basePath: cwd });
}
