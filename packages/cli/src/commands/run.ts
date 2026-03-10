import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import {
  loadConfig,
  logger,
  writeJson,
  ensureDir,
  fileExists,
  readJson,
  MimicError,
  parseSchema,
  BlueprintEngine,
  BlueprintExpander,
  BlueprintCache,
  LLMClient,
  CostTracker,
  providerConfigFromMimic,
  DataValidator,
} from '@mimicai/core';
import type { Blueprint, MimicConfig, ExpandedData, SchemaModel, Fact, FactManifest, PromptContext, DataSpec, ApiMockAdapter } from '@mimicai/core';
import { loadBlueprint, isBuiltinBlueprint } from '@mimicai/blueprints';
import { resolveEnvVars } from '../utils/env.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Generate blueprints and expand persona data')
    .option('-g, --generate', 'force LLM regeneration of blueprints')
    .option('-d, --dry-run', 'show what would be generated without writing files')
    .option('-p, --persona <names...>', 'limit to specific personas')
    .option('-s, --seed <number>', 'override random seed', parseInt)
    .option('--verbose', 'enable verbose logging')
    .action(async (opts) => {
      await runGenerate(opts);
    });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunOptions {
  generate?: boolean;
  dryRun?: boolean;
  persona?: string[];
  seed?: number;
  verbose?: boolean;
}

interface PersonaEntry {
  name: string;
  description: string;
  blueprint?: string;
}

// ---------------------------------------------------------------------------
// Run logic
// ---------------------------------------------------------------------------

async function runGenerate(opts: RunOptions): Promise<void> {
  if (opts.verbose) {
    logger.setVerbose(true);
  }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);

  // Initialize file-based debug log under .mimic/debug/
  const debugDir = join(cwd, '.mimic', 'debug');
  const debugLogFile = join(debugDir, `run-${Date.now()}.log`);
  logger.initDebugLog(debugLogFile);
  logger.debugFile('CONFIG', config);

  logger.header('mimic run');

  // ── Resolve personas ────────────────────────────────────────────────────
  const targetPersonas = resolvePersonas(config, opts.persona);
  logger.step(
    `Processing ${targetPersonas.length} persona(s): ${targetPersonas.map((p) => chalk.yellow(p.name)).join(', ')}`,
  );

  const dataDir = join(cwd, '.mimic', 'data');
  const blueprintDir = join(cwd, '.mimic', 'blueprints');
  await ensureDir(dataDir);
  await ensureDir(blueprintDir);

  const seed = opts.seed ?? config.generate.seed;

  // ── Parse schema (needed for LLM generation and expansion) ─────────────
  const schemaSpin = logger.spinner('Parsing schema...');
  let schema: SchemaModel;
  try {
    schema = await resolveSchema(config, cwd);
    schemaSpin.succeed(`Schema parsed: ${chalk.yellow(String(schema.tables.length))} tables`);
  } catch (err) {
    schemaSpin.fail('Failed to parse schema');
    throw err;
  }

  // ── Resolve API adapter prompt contexts + data specs ─────────────────────
  let promptContexts: Record<string, PromptContext> | undefined;
  let dataSpecs: Record<string, DataSpec> | undefined;
  if (config.apis && Object.keys(config.apis).length > 0) {
    promptContexts = {};
    dataSpecs = {};
    for (const [name, apiConfig] of Object.entries(config.apis)) {
      const adapterId = (apiConfig as { adapter?: string }).adapter ?? name;
      try {
        const pkg = `@mimicai/adapter-${adapterId}`;
        // Resolve from user's CWD so adapters installed in the project (not the CLI) are found
        const cwdRequire = createRequire(join(process.cwd(), 'package.json'));
        const resolved = cwdRequire.resolve(pkg);
        const mod = await import(resolved);
        // Find the adapter class by scanning exports (same pattern as host command)
        const AdapterClass = Object.values(mod).find((v) => {
          if (typeof v !== 'function') return false;
          try {
            const instance = new (v as new () => unknown)() as { type?: string };
            return instance.type === 'api-mock';
          } catch { return false; }
        }) as (new () => ApiMockAdapter) | undefined;
        if (AdapterClass) {
          const adapter = new AdapterClass();
          if (adapter.promptContext) {
            promptContexts![adapterId] = adapter.promptContext;
          }
          if (adapter.dataSpec) {
            dataSpecs![adapterId] = adapter.dataSpec;
          }
        }
      } catch {
        // Adapter not installed — skip prompt context (formatApis will still list it)
        logger.debug(`Could not resolve adapter "${adapterId}" for prompt context`);
      }
    }
    if (Object.keys(promptContexts).length === 0) promptContexts = undefined;
    if (Object.keys(dataSpecs!).length === 0) dataSpecs = undefined;
  }

  // ── Create shared core instances ───────────────────────────────────────
  const costTracker = new CostTracker();
  const llmClient = new LLMClient(providerConfigFromMimic(config), costTracker);
  const cache = new BlueprintCache(blueprintDir);
  const engine = new BlueprintEngine(llmClient, cache, costTracker);

  const summary: { persona: string; tables: Record<string, number>; apis?: Record<string, number> }[] = [];
  const allFacts: Fact[] = [];

  // ── Phase 1: Obtain all blueprints (parallel for LLM calls) ──────────
  const blueprintSpin = logger.spinner(
    `Generating blueprints for ${targetPersonas.length} persona(s)...`,
  );

  const blueprintResults: { persona: PersonaEntry; blueprint: Blueprint; personaIndex: number }[] = [];

  try {
    const blueprintPromises = targetPersonas.map(async (persona, i) => {
      const personaIndex = i + 1;
      const cachedPath = join(blueprintDir, `${persona.name}.json`);

      let blueprint: Blueprint;

      if (persona.blueprint && isBuiltinBlueprint(persona.blueprint)) {
        blueprint = await loadBlueprint(persona.blueprint);
      } else if (!opts.generate && (await fileExists(cachedPath))) {
        blueprint = await readJson<Blueprint>(cachedPath);
      } else {
        blueprint = await engine.generateBatched(
          schema,
          { name: persona.name, description: persona.description },
          config.domain,
          {
            force: opts.generate,
            personaIndex,
            totalPersonas: targetPersonas.length,
            volume: config.generate.volume,
            adapterBatchSize: config.generate.adapterBatchSize,
            adapterBatchConcurrency: config.generate.adapterBatchConcurrency,
          },
          config.apis as Record<string, { adapter?: string; config?: Record<string, unknown> }> | undefined,
          promptContexts,
        );

        if (!opts.dryRun) {
          await writeJson(cachedPath, blueprint);
          logger.debug(`Cached blueprint to ${cachedPath}`);
        }
      }

      return { persona, blueprint, personaIndex };
    });

    const results = await Promise.all(blueprintPromises);
    blueprintResults.push(...results);
    blueprintSpin.succeed(
      `Blueprints ready for ${targetPersonas.length} persona(s)`,
    );
  } catch (err) {
    blueprintSpin.fail('Blueprint generation failed');
    throw err;
  }

  // ── Phase 2: Expand blueprints (sequential, deterministic) ───────────
  for (const { persona, blueprint, personaIndex } of blueprintResults) {
    logger.step(`Expanding: ${chalk.bold(persona.name)}`);

    // Each persona gets its own expander with a derived seed for independence
    const expander = new BlueprintExpander(seed + personaIndex);

    const expandSpin = logger.spinner('Expanding blueprint into rows...');
    try {
      const expanded = expander.expand(blueprint, schema, config.generate.volume, promptContexts);

      // Log expansion output summary
      const expandedTableSummary: Record<string, number> = {};
      for (const [t, rows] of Object.entries(expanded.tables)) {
        expandedTableSummary[t] = (rows as unknown[]).length;
      }
      const expandedApiSummary: Record<string, Record<string, number>> = {};
      for (const [adapterId, rs] of Object.entries(expanded.apiResponses)) {
        expandedApiSummary[adapterId] = {};
        for (const [resource, rows] of Object.entries(rs.responses)) {
          expandedApiSummary[adapterId]![resource] = (rows as unknown[]).length;
        }
      }
      logger.debugFile(`EXPANDER OUTPUT [${persona.name}]`, {
        tables: expandedTableSummary,
        apiResponses: expandedApiSummary,
        facts: expanded.facts?.length ?? 0,
      });

      // Post-expansion validation and repair using adapter specs
      if (promptContexts) {
        const validator = new DataValidator(promptContexts, dataSpecs);
        const repairStats = validator.validateAndRepair(expanded, schema);
        logger.debugFile(`VALIDATOR REPAIRS [${persona.name}]`, repairStats);
      }

      if (!opts.dryRun) {
        const outPath = join(dataDir, `${persona.name}.json`);
        await writeJson(outPath, expanded);
        logger.debug(`Wrote expanded data to ${outPath}`);
      }

      const tableCounts: Record<string, number> = {};
      for (const [table, rows] of Object.entries(expanded.tables)) {
        tableCounts[table] = (rows as unknown[]).length;
      }

      const apiCounts: Record<string, number> = {};
      for (const [adapterId, responseSet] of Object.entries(expanded.apiResponses)) {
        const total = Object.values(responseSet.responses)
          .reduce((sum: number, arr) => sum + (arr as unknown[]).length, 0);
        if (total > 0) apiCounts[adapterId] = total;
      }

      // Collect facts for fact manifest
      if (expanded.facts && expanded.facts.length > 0) {
        allFacts.push(...expanded.facts);
      }

      summary.push({ persona: persona.name, tables: tableCounts, apis: apiCounts });

      expandSpin.succeed('Data expanded');
    } catch (err) {
      expandSpin.fail('Expansion failed');
      throw err;
    }
  }

  // ── Write fact manifest ─────────────────────────────────────────────────
  if (!opts.dryRun && allFacts.length > 0) {
    const manifest: FactManifest = {
      persona: targetPersonas.map((p) => p.name).join(', '),
      domain: config.domain,
      generated: new Date().toISOString(),
      seed,
      facts: allFacts,
    };
    const manifestPath = join(cwd, '.mimic', 'fact-manifest.json');
    await writeJson(manifestPath, manifest);
    logger.success(`Fact manifest written → ${chalk.cyan(manifestPath)} (${allFacts.length} facts)`);
  }

  // ── Cost summary ───────────────────────────────────────────────────────
  const costSummary = costTracker.getSummary();
  if (costSummary.total > 0) {
    console.log();
    logger.info(`LLM cost: ${chalk.yellow(`$${costSummary.total.toFixed(4)}`)}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log();
  logger.header('Summary');

  for (const entry of summary) {
    console.log();
    console.log(`  ${chalk.bold(entry.persona)}`);
    const tableNames = Object.keys(entry.tables);
    if (tableNames.length === 0 && !entry.apis) {
      logger.info('  (no tables)');
    } else {
      for (const table of tableNames) {
        logger.info(`  ${chalk.dim(table)}: ${chalk.yellow(String(entry.tables[table]))} rows`);
      }
    }

    // Show API entity counts
    if (entry.apis) {
      for (const [adapterId, count] of Object.entries(entry.apis)) {
        logger.info(`  ${chalk.dim(`api:${adapterId}`)}: ${chalk.yellow(String(count))} entities`);
      }
    }
  }

  const totalRows = summary.reduce(
    (sum, e) => sum + Object.values(e.tables).reduce((s, n) => s + n, 0),
    0,
  );

  console.log();
  if (opts.dryRun) {
    logger.done(`Dry run complete — ${totalRows} rows would be generated`);
  } else {
    logger.done(`Generated ${totalRows} rows across ${summary.length} persona(s)`);
    logger.info(`Data written to ${chalk.cyan(dataDir)}`);
  }
  logger.info(`Debug log: ${chalk.cyan(debugLogFile)}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolvePersonas(
  config: MimicConfig,
  filter?: string[],
): PersonaEntry[] {
  let personas = config.personas as PersonaEntry[];

  if (filter && filter.length > 0) {
    const filterSet = new Set(filter);
    personas = personas.filter((p) => filterSet.has(p.name));

    const missing = filter.filter((n) => !personas.some((p) => p.name === n));
    if (missing.length > 0) {
      throw new MimicError(
        `Unknown persona(s): ${missing.join(', ')}`,
        'CONFIG_INVALID',
        `Available personas: ${config.personas.map((p) => p.name).join(', ')}`,
      );
    }
  }

  return personas;
}

/**
 * Resolve the schema from config — supports prisma, sql, introspect sources,
 * and routes introspection to the correct adapter for MySQL/SQLite/MongoDB.
 */
async function resolveSchema(config: MimicConfig, cwd: string): Promise<SchemaModel> {
  const databases = config.databases;
  if (!databases || Object.keys(databases).length === 0) {
    // API-only setup — return empty schema so LLM generates only apiEntities
    if (config.apis && Object.keys(config.apis).length > 0) {
      return { tables: [], enums: [], insertionOrder: [] };
    }
    throw new MimicError(
      'No database or API configured',
      'CONFIG_INVALID',
      "Add a 'databases' or 'apis' section to mimic.json",
    );
  }

  const [, dbConfig] = Object.entries(databases)[0]!;
  const dbType = dbConfig.type;
  const schemaConfig = (dbConfig as Record<string, unknown>).schema as
    | { source: 'prisma' | 'sql' | 'introspect'; path?: string }
    | undefined;

  const source = schemaConfig?.source ?? 'introspect';

  if (source === 'introspect') {
    // Route introspection to the correct adapter
    switch (dbType) {
      case 'postgres': {
        const dbUrl = resolveEnvVars((dbConfig as Record<string, unknown>).url as string);
        const pg = await import('pg');
        const pool = new pg.default.Pool({ connectionString: dbUrl });
        try {
          return await parseSchema({ schema: schemaConfig, pool, basePath: cwd });
        } finally {
          await pool.end();
        }
      }
      case 'mysql': {
        const { MySQLSeeder } = await import('@mimicai/adapter-mysql');
        const seeder = new MySQLSeeder();
        const url = resolveEnvVars((dbConfig as Record<string, unknown>).url as string);
        await seeder.init({ url }, { config, blueprints: new Map(), logger });
        try {
          return await seeder.introspect({ url });
        } finally {
          await seeder.dispose();
        }
      }
      case 'sqlite': {
        const { SQLiteSeeder } = await import('@mimicai/adapter-sqlite');
        const seeder = new SQLiteSeeder();
        const path = (dbConfig as Record<string, unknown>).path as string;
        await seeder.init({ path }, { config, blueprints: new Map(), logger });
        try {
          return await seeder.introspect({ path });
        } finally {
          await seeder.dispose();
        }
      }
      case 'mongodb': {
        const { MongoSeeder } = await import('@mimicai/adapter-mongodb');
        const seeder = new MongoSeeder();
        const url = resolveEnvVars((dbConfig as Record<string, unknown>).url as string);
        const database = (dbConfig as Record<string, unknown>).database as string | undefined;
        await seeder.init({ url, database }, { config, blueprints: new Map(), logger });
        try {
          return await seeder.introspect({ url, database });
        } finally {
          await seeder.dispose();
        }
      }
      default:
        throw new MimicError(
          `Unsupported database type "${dbType}" for introspection`,
          'CONFIG_INVALID',
          'Supported: postgres, mysql, sqlite, mongodb',
        );
    }
  }

  // prisma or sql — no pool needed
  return parseSchema({ schema: schemaConfig, basePath: cwd });
}
