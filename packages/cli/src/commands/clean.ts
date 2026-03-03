import { Command } from 'commander';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

import {
  loadConfig,
  logger,
  fileExists,
  MimicError,
  parseSchema,
  readJson,
} from '@mimicai/core';
import type { MimicConfig, SchemaModel } from '@mimicai/core';
import { PgSeeder } from '@mimicai/adapter-postgres';
import { MySQLSeeder } from '@mimicai/adapter-mysql';
import { SQLiteSeeder } from '@mimicai/adapter-sqlite';
import { MongoSeeder } from '@mimicai/adapter-mongodb';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerCleanCommand(program: Command): void {
  program
    .command('clean')
    .description('Truncate database tables and remove generated data')
    .option('-y, --yes', 'skip confirmation prompt')
    .option('--keep-blueprints', 'keep cached blueprints in .mimic/blueprints/')
    .option('-d, --database <name>', 'clean a specific database entry')
    .option('--verbose', 'enable verbose logging')
    .action(async (opts) => {
      await runClean(opts);
    });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CleanOptions {
  yes?: boolean;
  keepBlueprints?: boolean;
  database?: string;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Clean logic
// ---------------------------------------------------------------------------

async function runClean(opts: CleanOptions): Promise<void> {
  if (opts.verbose) {
    logger.setVerbose(true);
  }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);

  logger.header('mimic clean');

  // ── Confirm ─────────────────────────────────────────────────────────────
  if (!opts.yes) {
    console.log();
    logger.warn('This will:');
    logger.info('  - Truncate all Mimic-seeded tables in configured database(s)');
    logger.info('  - Remove all files from .mimic/data/');
    if (!opts.keepBlueprints) {
      logger.info('  - Remove all files from .mimic/blueprints/');
    }
    console.log();

    const proceed = await confirm({
      message: 'Are you sure you want to proceed?',
      default: false,
    });

    if (!proceed) {
      logger.info('Aborted.');
      return;
    }
  }

  // ── Truncate database tables ────────────────────────────────────────────
  const databases = config.databases;
  if (databases && Object.keys(databases).length > 0) {
    const dbEntries = opts.database
      ? Object.entries(databases).filter(([name]) => name === opts.database)
      : Object.entries(databases);

    for (const [dbName, dbConfig] of dbEntries) {
      const dbType = dbConfig.type;
      logger.step(`Cleaning database "${dbName}" (${chalk.yellow(dbType)})...`);

      try {
        await cleanDatabase(dbName, dbType, dbConfig as Record<string, unknown>, cwd, config);
      } catch (err) {
        if (err instanceof MimicError) throw err;
        logger.warn(
          `Database "${dbName}" cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        logger.info('Continuing with local file cleanup...');
      }
    }
  } else {
    logger.info('No database configured — skipping truncation');
  }

  // ── Remove .mimic/data/ ─────────────────────────────────────────────────
  const dataDir = join(cwd, '.mimic', 'data');
  if (await fileExists(dataDir)) {
    const spin = logger.spinner('Removing .mimic/data/...');
    try {
      await rm(dataDir, { recursive: true, force: true });
      spin.succeed('Removed .mimic/data/');
    } catch (err) {
      spin.fail('Failed to remove .mimic/data/');
      logger.warn(`${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    logger.info('.mimic/data/ does not exist — nothing to remove');
  }

  // ── Remove .mimic/blueprints/ (unless --keep-blueprints) ────────────────
  if (!opts.keepBlueprints) {
    const bpDir = join(cwd, '.mimic', 'blueprints');
    if (await fileExists(bpDir)) {
      const spin = logger.spinner('Removing .mimic/blueprints/...');
      try {
        await rm(bpDir, { recursive: true, force: true });
        spin.succeed('Removed .mimic/blueprints/');
      } catch (err) {
        spin.fail('Failed to remove .mimic/blueprints/');
        logger.warn(`${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      logger.info('.mimic/blueprints/ does not exist — nothing to remove');
    }
  } else {
    logger.info('Keeping .mimic/blueprints/ (--keep-blueprints)');
  }

  console.log();
  logger.done('Clean complete');
  console.log();
}

// ---------------------------------------------------------------------------
// Multi-DB clean routing
// ---------------------------------------------------------------------------

async function cleanDatabase(
  dbName: string,
  dbType: string,
  dbConfig: Record<string, unknown>,
  cwd: string,
  config: MimicConfig,
): Promise<void> {
  switch (dbType) {
    case 'postgres': {
      const url = dbConfig.url as string;
      const seeder = new PgSeeder(url);
      try {
        const schema = await resolveSchemaForClean(cwd, config, dbConfig);
        if (schema) {
          await seeder.cleanTables(schema);
          logger.success(`Truncated ${chalk.yellow(String(schema.insertionOrder.length))} table(s) in "${dbName}"`);
        } else {
          await cleanPgDirectly(url);
        }
      } finally {
        await seeder.dispose();
      }
      break;
    }
    case 'mysql': {
      const url = dbConfig.url as string;
      const seeder = new MySQLSeeder();
      try {
        await seeder.init({ url }, { config, blueprints: new Map(), logger });
        const schema = await seeder.introspect({ url });
        await seeder.clean({ config, blueprints: new Map(), logger, schema });
        logger.success(`Truncated MySQL tables in "${dbName}"`);
      } finally {
        await seeder.dispose();
      }
      break;
    }
    case 'sqlite': {
      const path = dbConfig.path as string;
      const seeder = new SQLiteSeeder();
      try {
        await seeder.init(
          { path, walMode: dbConfig.walMode as boolean | undefined },
          { config, blueprints: new Map(), logger },
        );
        const schema = await seeder.introspect({ path });
        await seeder.clean({ config, blueprints: new Map(), logger, schema });
        logger.success(`Cleaned SQLite tables in "${dbName}"`);
      } finally {
        await seeder.dispose();
      }
      break;
    }
    case 'mongodb': {
      const url = dbConfig.url as string;
      const seeder = new MongoSeeder();
      try {
        await seeder.init(
          {
            url,
            database: dbConfig.database as string | undefined,
            collections: dbConfig.collections as string[] | undefined,
          },
          { config, blueprints: new Map(), logger },
        );
        await seeder.clean({ config, blueprints: new Map(), logger });
        logger.success(`Cleaned MongoDB collections in "${dbName}"`);
      } finally {
        await seeder.dispose();
      }
      break;
    }
    default:
      logger.warn(`Unsupported database type "${dbType}" for clean — skipping "${dbName}"`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveSchemaForClean(
  cwd: string,
  _config: MimicConfig,
  dbConfig: Record<string, unknown>,
): Promise<SchemaModel | null> {
  const cachedSchemaPath = join(cwd, '.mimic', 'schema.json');
  if (await fileExists(cachedSchemaPath)) {
    return readJson<SchemaModel>(cachedSchemaPath);
  }

  const schemaConfig = dbConfig.schema as
    | { source: 'prisma' | 'sql' | 'introspect'; path?: string }
    | undefined;

  if (!schemaConfig) return null;
  const source = schemaConfig.source ?? 'introspect';

  try {
    if (source === 'introspect') {
      const pg = await import('pg');
      const pool = new pg.default.Pool({ connectionString: dbConfig.url as string });
      try {
        return await parseSchema({ schema: schemaConfig, pool, basePath: cwd });
      } finally {
        await pool.end();
      }
    }
    return await parseSchema({ schema: schemaConfig, basePath: cwd });
  } catch {
    return null;
  }
}

async function cleanPgDirectly(dbUrl: string): Promise<void> {
  let pg: typeof import('pg');
  try {
    pg = await import('pg');
  } catch {
    logger.warn('pg module not available — cannot truncate database');
    return;
  }

  const pool = new pg.default.Pool({ connectionString: dbUrl });

  try {
    const client = await pool.connect();
    try {
      const tableResult = await client.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      const tableNames = tableResult.rows.map((r: { tablename: string }) => r.tablename);

      if (tableNames.length === 0) {
        logger.info('No tables found in public schema');
      } else {
        await client.query('BEGIN');
        for (const table of tableNames) {
          await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
          logger.debug(`Truncated ${table}`);
        }
        await client.query('COMMIT');
        logger.success(`Truncated ${chalk.yellow(String(tableNames.length))} table(s)`);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
