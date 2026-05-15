import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'node:path';

import {
  loadConfig,
  logger,
  writeJson,
  ensureDir,
  MimicError,
  parseSchema,
  CostTracker,
  createLLMClient,
  compileContract,
  runPipeline,
  formatGateReport,
  formatOwnerLevelFailureReport,
  derivePromptContext,
  deriveDataSpec,
  registerAdapter,
} from '@mimicai/core';
import type {
  LLMRuntime,
  PersonaContract,
  PromptContext,
  DataSpec,
  AdapterResourceSpecs,
  ApiMockAdapter,
  SchemaModel,
  MimicConfig,
  ExpandedData,
  MaterialisedDataset,
} from '@mimicai/core';
import { resolveEnvVars } from '../utils/env.js';
import { importFromProject } from '../utils/import.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Compile each persona contract and run the V5 pipeline')
    .option('-d, --dry-run', 'compile + run the pipeline but do not write data/proof to disk')
    .option('-p, --persona <names...>', 'limit to specific personas')
    .option('-s, --seed <number>', 'override random seed', parseInt)
    .option(
      '--llm-runtime <runtime>',
      'route LLM calls via api | claude-code | batch (overrides config.llm.runtime)',
    )
    .option('--verbose', 'enable verbose logging')
    .action(async (opts: RunOptions) => {
      await runGenerate(opts);
    });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunOptions {
  dryRun?: boolean;
  persona?: string[];
  seed?: number;
  llmRuntime?: string;
  verbose?: boolean;
}

interface PersonaEntry {
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Run logic — V5 pipeline
// ---------------------------------------------------------------------------

async function runGenerate(opts: RunOptions): Promise<void> {
  if (opts.verbose) logger.setVerbose(true);

  const cwd = process.cwd();
  const config = await loadConfig(cwd);

  const debugDir = join(cwd, '.mimic', 'debug');
  const debugLogFile = join(debugDir, `run-${Date.now()}.log`);
  logger.initDebugLog(debugLogFile);
  logger.debugFile('CONFIG', config);

  logger.header('mimic run (V5)');

  const targetPersonas = resolvePersonas(config, opts.persona);
  logger.step(
    `Processing ${targetPersonas.length} persona(s): ${targetPersonas.map((p) => chalk.yellow(p.name)).join(', ')}`,
  );

  const dataDir = join(cwd, '.mimic', 'data');
  const proofDir = join(cwd, '.mimic', 'proof');
  const reportDir = join(cwd, '.mimic', 'reports');
  await ensureDir(dataDir);
  await ensureDir(proofDir);
  await ensureDir(reportDir);

  const schemaSpin = logger.spinner('Parsing schema...');
  let schema: SchemaModel;
  try {
    schema = await resolveSchema(config, cwd);
    logger.debugFile('SCHEMA', {
      tableCount: schema.tables.length,
      tables: schema.tables.map((table) => table.name),
    });
    schemaSpin.succeed(`Schema parsed: ${chalk.yellow(String(schema.tables.length))} tables`);
  } catch (err) {
    schemaSpin.fail('Failed to parse schema');
    throw err;
  }

  const { promptContexts, resourceSpecs } = await resolveAdapterMetadata(config);
  logger.debugFile('ADAPTER METADATA', {
    promptContexts: promptContexts ? Object.keys(promptContexts) : [],
    resourceSpecs: resourceSpecs ? Object.keys(resourceSpecs) : [],
  });

  const costTracker = new CostTracker();
  const runtimeOverride = resolveRuntimeOverride(opts.llmRuntime);
  const llmClient = createLLMClient(config, costTracker, runtimeOverride);
  const resolvedRuntime = runtimeOverride ?? config.llm.runtime ?? 'api';
  if (resolvedRuntime === 'claude-code') {
    logger.info(
      chalk.dim(
        'LLM runtime: claude-code — billed to your Claude subscription, not per-token API charges',
      ),
    );
  } else if (resolvedRuntime === 'batch') {
    logger.warn(
      'LLM runtime: batch — BatchClient not implemented yet, falling back to api runtime at full price',
    );
  }

  const seed = opts.seed ?? config.generate.seed;

  type SummaryRow = { persona: string; ok: boolean; tables: Record<string, number>; apis?: Record<string, number> };
  const summary: SummaryRow[] = [];
  let exitCode = 0;

  for (let i = 0; i < targetPersonas.length; i++) {
    const persona = targetPersonas[i]!;
    const personaIndex = i + 1;
    const runId = `${persona.name}-${Date.now()}`;

    const compileSpin = logger.spinner(`Compiling contract for ${chalk.yellow(persona.name)}...`);
    let contract: PersonaContract;
    try {
      contract = await compileContract(
        llmClient,
        persona,
        config.domain,
        schema,
        promptContexts,
        resourceSpecs,
        {
          currentDate: new Date().toISOString().split('T')[0]!,
          volume: config.generate.volume,
          personaIndex,
          totalPersonas: targetPersonas.length,
        },
      );
      logger.debugFile(`CONTRACT COMPILED [${persona.name}]`, contract);
      compileSpin.succeed(`Contract compiled: ${contract.clauses.length} clauses`);
    } catch (err) {
      compileSpin.fail(`Contract compilation failed for ${persona.name}`);
      throw err;
    }

    const pipeSpin = logger.spinner('Running V5 pipeline...');
    logger.debugFile(`PIPELINE INPUT [${runId}]`, {
      persona: persona.name,
      runId,
      seed: `${seed}-${personaIndex}`,
      personaIndex,
    });
    const result = runPipeline(contract, schema, {
      runId,
      seed: `${seed}-${personaIndex}`,
      personaIndex,
    });

    if (!result.ok) {
      pipeSpin.fail('Pipeline aborted');
      exitCode = 1;
      const rendered =
        result.reason === 'pre_generation_gate'
          ? formatGateReport(result.report)
          : formatOwnerLevelFailureReport(result.report);
      const suffix = result.reason === 'pre_generation_gate' ? 'pre-gate' : 'owner-level';
      const reportPath = join(reportDir, `${runId}.${suffix}.md`);
      logger.debugFile(`PIPELINE RESULT [${runId}]`, {
        ok: false,
        persona: persona.name,
        reason: result.reason,
        reportPath,
        report: result.report,
      });
      if (!opts.dryRun) {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(reportPath, rendered, 'utf8');
      }
      console.error();
      console.error(chalk.red(rendered));
      logger.warn(`${persona.name}: see ${chalk.cyan(reportPath)}`);
      summary.push({ persona: persona.name, ok: false, tables: {} });
      continue;
    }

    pipeSpin.succeed(`Pipeline OK · proof: ${result.proof.records.length} record(s)`);
    logger.debugFile(`PIPELINE RESULT [${runId}]`, {
      ok: true,
      persona: persona.name,
      proofRecords: result.proof.records.length,
      tables: Object.fromEntries(
        Object.entries(result.materialised.tables).map(([table, rows]) => [table, rows.length]),
      ),
      apis: Object.fromEntries(
        Object.entries(result.materialised.apiResponses).map(([adapterId, responseSet]) => [
          adapterId,
          Object.fromEntries(
            Object.entries(responseSet.responses).map(([resource, responses]) => [resource, responses.length]),
          ),
        ]),
      ),
    });

    const expanded = toExpandedData(contract, result.materialised);
    if (!opts.dryRun) {
      await writeJson(join(dataDir, `${persona.name}.json`), expanded);
      await writeJson(join(proofDir, `${runId}.json`), result.proof);
    }

    const tableCounts: Record<string, number> = {};
    for (const [t, rows] of Object.entries(result.materialised.tables)) {
      tableCounts[t] = rows.length;
    }
    const apiCounts: Record<string, number> = {};
    for (const [adapterId, set] of Object.entries(result.materialised.apiResponses)) {
      const total = Object.values(set.responses).reduce((s, arr) => s + arr.length, 0);
      if (total > 0) apiCounts[adapterId] = total;
    }
    summary.push({ persona: persona.name, ok: true, tables: tableCounts, apis: apiCounts });
  }

  const cost = costTracker.getSummary();
  if (cost.total > 0) {
    console.log();
    logger.info(`LLM cost: ${chalk.yellow(`$${cost.total.toFixed(4)}`)}`);
  }

  console.log();
  logger.header('Summary');
  for (const entry of summary) {
    console.log();
    const status = entry.ok ? chalk.green('OK') : chalk.red('FAIL');
    console.log(`  ${chalk.bold(entry.persona)} · ${status}`);
    if (!entry.ok) continue;
    const tableNames = Object.keys(entry.tables);
    if (tableNames.length === 0 && !entry.apis) {
      logger.info('  (no rows)');
    } else {
      for (const t of tableNames) {
        logger.info(`  ${chalk.dim(t)}: ${chalk.yellow(String(entry.tables[t]))} rows`);
      }
      if (entry.apis) {
        for (const [adapterId, count] of Object.entries(entry.apis)) {
          logger.info(`  ${chalk.dim(`api:${adapterId}`)}: ${chalk.yellow(String(count))} entities`);
        }
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
  } else if (exitCode === 0) {
    logger.done(`Generated ${totalRows} rows across ${summary.length} persona(s)`);
    logger.info(`Data written to ${chalk.cyan(dataDir)}`);
    logger.info(`Proof artifacts in ${chalk.cyan(proofDir)}`);
  } else {
    logger.error(`One or more personas failed validation — see ${chalk.cyan(reportDir)}`);
    process.exitCode = exitCode;
  }
  logger.info(`Debug log: ${chalk.cyan(debugLogFile)}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Helpers (exported so plan/explain subcommands can reuse them)
// ---------------------------------------------------------------------------

export function resolvePersonas(
  config: MimicConfig,
  filter: string[] | undefined,
): PersonaEntry[] {
  const all = config.personas.map((p) => ({ name: p.name, description: p.description }));
  if (!filter || filter.length === 0) return all;
  const set = new Set(filter);
  const subset = all.filter((p) => set.has(p.name));
  const missing = filter.filter((n) => !subset.some((p) => p.name === n));
  if (missing.length > 0) {
    throw new MimicError(
      `Unknown persona(s): ${missing.join(', ')}`,
      'CONFIG_INVALID',
      `Available personas: ${all.map((p) => p.name).join(', ')}`,
    );
  }
  return subset;
}

export async function resolveAdapterMetadata(config: MimicConfig): Promise<{
  promptContexts: Record<string, PromptContext> | undefined;
  resourceSpecs: Record<string, AdapterResourceSpecs> | undefined;
  dataSpecs: Record<string, DataSpec> | undefined;
}> {
  if (!config.apis || Object.keys(config.apis).length === 0) {
    return { promptContexts: undefined, resourceSpecs: undefined, dataSpecs: undefined };
  }
  const promptContexts: Record<string, PromptContext> = {};
  const resourceSpecs: Record<string, AdapterResourceSpecs> = {};
  const dataSpecs: Record<string, DataSpec> = {};
  for (const [name, apiConfig] of Object.entries(config.apis)) {
    const adapterId = (apiConfig as { adapter?: string }).adapter ?? name;
    try {
      const pkg = `@mimicai/adapter-${adapterId}`;
      const mod = await importFromProject(pkg, process.cwd());
      const AdapterClass = Object.values(mod).find((v) => {
        if (typeof v !== 'function') return false;
        try {
          const instance = new (v as new () => unknown)() as { type?: string };
          return instance.type === 'api-mock';
        } catch {
          return false;
        }
      }) as (new () => ApiMockAdapter) | undefined;
      if (!AdapterClass) continue;
      const adapter = new AdapterClass();
      // Register the adapter with core — derives ProjectorHints from the
      // adapter's resourceSpecs/promptContext so the V5 projectors mint
      // surface-formatted IDs (cus_, sub_, ...) instead of the generic
      // 3-char fallback.
      const manifest = (mod as { manifest?: import('@mimicai/core').AdapterManifest })
        .manifest;
      if (manifest) registerAdapter(adapter, manifest);
      if (adapter.resourceSpecs) {
        resourceSpecs[adapterId] = adapter.resourceSpecs;
        promptContexts[adapterId] = derivePromptContext(adapter.resourceSpecs);
        dataSpecs[adapterId] = deriveDataSpec(adapter.resourceSpecs);
      } else {
        if (adapter.promptContext) promptContexts[adapterId] = adapter.promptContext;
        if (adapter.dataSpec) dataSpecs[adapterId] = adapter.dataSpec;
      }
    } catch {
      logger.debug(`Could not resolve adapter "${adapterId}" for prompt context`);
    }
  }
  return {
    promptContexts: Object.keys(promptContexts).length > 0 ? promptContexts : undefined,
    resourceSpecs: Object.keys(resourceSpecs).length > 0 ? resourceSpecs : undefined,
    dataSpecs: Object.keys(dataSpecs).length > 0 ? dataSpecs : undefined,
  };
}

export async function resolveSchema(config: MimicConfig, cwd: string): Promise<SchemaModel> {
  const databases = config.databases;
  if (!databases || Object.keys(databases).length === 0) {
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
        await seeder.init({ url }, { config, logger });
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
        await seeder.init({ path }, { config, logger });
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
        await seeder.init({ url, database }, { config, logger });
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

  return parseSchema({ schema: schemaConfig, basePath: cwd });
}

function resolveRuntimeOverride(value: string | undefined): LLMRuntime | undefined {
  if (!value) return undefined;
  if (value !== 'api' && value !== 'claude-code' && value !== 'batch') {
    throw new MimicError(
      `Unknown --llm-runtime value: "${value}"`,
      'CONFIG_INVALID',
      'Valid values: api, claude-code, batch',
    );
  }
  return value;
}

function toExpandedData(
  contract: PersonaContract,
  materialised: MaterialisedDataset,
): ExpandedData {
  // V5 ExpandedData carrier: just personaId + persona profile + the
  // materialised dataset slots. No V4.5 Blueprint envelope.
  return {
    personaId: contract.personaId,
    persona: contract.persona,
    tables: materialised.tables,
    documents: {},
    apiResponses: materialised.apiResponses,
    files: [],
    events: [],
    facts: [],
  };
}
