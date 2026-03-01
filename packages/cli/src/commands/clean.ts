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
  DatabaseConnectionError,
} from '@mimicailab/core';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerCleanCommand(program: Command): void {
  program
    .command('clean')
    .description('Truncate database tables and remove generated data')
    .option('-y, --yes', 'skip confirmation prompt')
    .option('--keep-blueprints', 'keep cached blueprints in .mimic/blueprints/')
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
    logger.info('  - Truncate all Mimic-seeded tables in the database');
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
    const [dbName, dbConfig] = Object.entries(databases)[0]!;
    const dbUrl = (dbConfig as Record<string, unknown>).url as string;

    logger.step(`Truncating tables in database "${dbName}"...`);

    let pg: typeof import('pg');
    try {
      pg = await import('pg');
    } catch {
      throw new DatabaseConnectionError(
        'pg module not available',
        'Ensure "pg" is installed: pnpm add pg',
      );
    }

    const pool = new pg.default.Pool({ connectionString: dbUrl });

    try {
      const client = await pool.connect();

      try {
        // Discover tables that Mimic may have seeded
        const tableResult = await client.query<{ tablename: string }>(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
        );
        const tableNames = tableResult.rows.map((r) => r.tablename);

        if (tableNames.length === 0) {
          logger.info('No tables found in public schema');
        } else {
          await client.query('BEGIN');
          // Truncate all tables with CASCADE
          for (const table of tableNames) {
            await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
            logger.debug(`Truncated ${table}`);
          }
          await client.query('COMMIT');
          logger.success(
            `Truncated ${chalk.yellow(String(tableNames.length))} table(s)`,
          );
        }
      } finally {
        client.release();
      }

      await pool.end();
    } catch (err) {
      await pool.end().catch(() => {});

      // Non-fatal: warn but continue with local cleanup
      if (err instanceof MimicError) {
        throw err;
      }
      logger.warn(
        `Database truncation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      logger.info('Continuing with local file cleanup...');
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
