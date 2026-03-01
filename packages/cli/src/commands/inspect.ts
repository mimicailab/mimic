import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';

import {
  loadConfig,
  logger,
  readJson,
  fileExists,
  MimicError,
  parseSchema,
} from '@mimicailab/core';
import type { ExpandedData, Blueprint, SchemaModel } from '@mimicailab/core';
import { resolveEnvVars } from '../utils/env.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerInspectCommand(program: Command): void {
  const inspect = program
    .command('inspect')
    .description('Show schema, data, or blueprint information');

  // ── mimic inspect schema ────────────────────────────────────────────────
  inspect
    .command('schema')
    .description('Parse and display the database schema')
    .option('--verbose', 'enable verbose logging')
    .action(async (opts) => {
      await inspectSchema(opts);
    });

  // ── mimic inspect data ──────────────────────────────────────────────────
  inspect
    .command('data')
    .description('Show row counts per persona per table')
    .option('-p, --persona <names...>', 'limit to specific personas')
    .option('--verbose', 'enable verbose logging')
    .action(async (opts) => {
      await inspectData(opts);
    });

  // ── mimic inspect blueprints ────────────────────────────────────────────
  inspect
    .command('blueprints')
    .description('List cached blueprints')
    .option('--verbose', 'enable verbose logging')
    .action(async (opts) => {
      await inspectBlueprints(opts);
    });
}

// ---------------------------------------------------------------------------
// inspect schema
// ---------------------------------------------------------------------------

interface SchemaOptions {
  verbose?: boolean;
}

async function inspectSchema(opts: SchemaOptions): Promise<void> {
  if (opts.verbose) {
    logger.setVerbose(true);
  }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);

  logger.header('mimic inspect schema');

  // Resolve schema source from database config
  const databases = config.databases;
  if (!databases || Object.keys(databases).length === 0) {
    throw new MimicError(
      'No database configured',
      'CONFIG_INVALID',
      "Add a 'databases' section to mimic.json",
    );
  }

  const [, dbConfig] = Object.entries(databases)[0]!;
  const schemaConfig = (dbConfig as Record<string, unknown>).schema as
    | { source: string; path?: string }
    | undefined;

  if (!schemaConfig) {
    throw new MimicError(
      'No schema source configured',
      'CONFIG_INVALID',
      "Add a 'schema' section to your database config in mimic.json",
    );
  }

  const spin = logger.spinner('Parsing schema...');

  try {
    // Connect to PG if introspection is needed
    let pool: import('pg').Pool | undefined;
    if (schemaConfig.source === 'introspect') {
      const dbUrl = resolveEnvVars((dbConfig as Record<string, unknown>).url as string);
      const pg = await import('pg');
      pool = new pg.default.Pool({ connectionString: dbUrl });
    }

    const schema = await parseSchema({
      schema: schemaConfig as { source: 'prisma' | 'sql' | 'introspect'; path?: string },
      pool,
      basePath: cwd,
    });

    if (pool) await pool.end();

    spin.succeed(`Parsed ${chalk.yellow(String(schema.tables.length))} table(s), ${chalk.yellow(String(schema.enums.length))} enum(s)`);

    // ── Tables overview ─────────────────────────────────────────────────
    console.log();
    const overviewTable = new Table({
      head: [
        chalk.bold('Table'),
        chalk.bold('Columns'),
        chalk.bold('Primary Key'),
        chalk.bold('Foreign Keys'),
      ],
      style: { head: [], border: [] },
    });

    for (const t of schema.tables) {
      overviewTable.push([
        chalk.yellow(t.name),
        String(t.columns.length),
        t.primaryKey.join(', ') || chalk.dim('(none)'),
        String(t.foreignKeys.length),
      ]);
    }

    console.log(overviewTable.toString());

    // ── Enums ───────────────────────────────────────────────────────────
    if (schema.enums.length > 0) {
      console.log();
      logger.header('Enums');
      for (const e of schema.enums) {
        logger.info(`  ${chalk.bold(e.name)}: ${e.values.join(', ')}`);
      }
    }

    // ── Verbose: per-table column details ───────────────────────────────
    if (opts.verbose) {
      for (const t of schema.tables) {
        console.log();
        logger.header(`Table: ${t.name}`);

        const colTable = new Table({
          head: [
            chalk.bold('Column'),
            chalk.bold('Type'),
            chalk.bold('Nullable'),
            chalk.bold('Generated'),
          ],
          style: { head: [], border: [] },
        });

        for (const col of t.columns) {
          colTable.push([
            col.name,
            col.type + (col.enumValues ? ` (${col.enumValues.join(', ')})` : ''),
            col.isNullable ? 'yes' : chalk.dim('no'),
            col.isGenerated ? 'yes' : chalk.dim('no'),
          ]);
        }

        console.log(colTable.toString());
      }
    }
  } catch (err) {
    spin.fail('Failed to parse schema');
    throw err;
  }

  console.log();
}

// ---------------------------------------------------------------------------
// inspect data
// ---------------------------------------------------------------------------

interface DataOptions {
  persona?: string[];
  verbose?: boolean;
}

async function inspectData(opts: DataOptions): Promise<void> {
  if (opts.verbose) {
    logger.setVerbose(true);
  }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);

  logger.header('mimic inspect data');

  const dataDir = join(cwd, '.mimic', 'data');
  if (!(await fileExists(dataDir))) {
    logger.warn('No data directory found. Run "mimic run" first.');
    return;
  }

  // Discover persona data files
  let files: string[];
  try {
    files = (await readdir(dataDir)).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }

  if (files.length === 0) {
    logger.warn('No expanded data files found. Run "mimic run" first.');
    return;
  }

  // Filter by persona if specified
  const personaFilter = opts.persona ? new Set(opts.persona) : null;

  // Collect all table names across all personas
  const allTables = new Set<string>();
  const personaData: { name: string; tables: Record<string, number> }[] = [];

  for (const file of files) {
    const name = file.replace('.json', '');
    if (personaFilter && !personaFilter.has(name)) {
      continue;
    }

    try {
      const data = await readJson<ExpandedData>(join(dataDir, file));
      const tables: Record<string, number> = {};

      for (const [tableName, rows] of Object.entries(data.tables)) {
        tables[tableName] = (rows as unknown[]).length;
        allTables.add(tableName);
      }

      personaData.push({ name, tables });
    } catch (err) {
      logger.warn(`Failed to read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (personaData.length === 0) {
    logger.warn('No matching persona data found.');
    return;
  }

  // Build table with personas as columns
  const sortedTables = [...allTables].sort();
  const tableHead = [chalk.bold('Table'), ...personaData.map((p) => chalk.bold(p.name))];

  const table = new Table({
    head: tableHead,
    style: { head: [], border: [] },
  });

  for (const tableName of sortedTables) {
    const row = [
      chalk.dim(tableName),
      ...personaData.map((p) => {
        const count = p.tables[tableName] ?? 0;
        return count > 0 ? chalk.yellow(String(count)) : chalk.dim('0');
      }),
    ];
    table.push(row);
  }

  // Totals row
  const totals = [
    chalk.bold('Total'),
    ...personaData.map((p) => {
      const total = Object.values(p.tables).reduce((s, n) => s + n, 0);
      return chalk.bold(chalk.yellow(String(total)));
    }),
  ];
  table.push(totals);

  console.log();
  console.log(table.toString());
  console.log();
}

// ---------------------------------------------------------------------------
// inspect blueprints
// ---------------------------------------------------------------------------

interface BlueprintOptions {
  verbose?: boolean;
}

async function inspectBlueprints(opts: BlueprintOptions): Promise<void> {
  if (opts.verbose) {
    logger.setVerbose(true);
  }

  const cwd = process.cwd();
  await loadConfig(cwd); // Validate config exists

  logger.header('mimic inspect blueprints');

  const bpDir = join(cwd, '.mimic', 'blueprints');
  if (!(await fileExists(bpDir))) {
    logger.warn('No blueprints directory found. Run "mimic run" first.');
    return;
  }

  let files: string[];
  try {
    files = (await readdir(bpDir)).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }

  if (files.length === 0) {
    logger.info('No cached blueprints found.');
    return;
  }

  const table = new Table({
    head: [
      chalk.bold('Persona'),
      chalk.bold('Name'),
      chalk.bold('Occupation'),
      chalk.bold('Generated By'),
      chalk.bold('Generated At'),
    ],
    style: { head: [], border: [] },
  });

  for (const file of files.sort()) {
    try {
      const bp = await readJson<Blueprint>(join(bpDir, file));
      table.push([
        chalk.yellow(bp.personaId),
        bp.persona.name,
        bp.persona.occupation,
        chalk.dim(bp.generatedBy),
        chalk.dim(bp.generatedAt),
      ]);
    } catch (err) {
      table.push([
        chalk.yellow(file.replace('.json', '')),
        chalk.red('(parse error)'),
        '',
        '',
        '',
      ]);
    }
  }

  console.log();
  console.log(table.toString());
  console.log();
}
