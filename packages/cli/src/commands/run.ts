import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'node:path';

import {
  loadConfig,
  logger,
  writeJson,
  ensureDir,
  parseSchema,
  CostTracker,
  createLLMClient,
  compileContract,
  runPipeline,
  formatGateReport,
  formatOwnerLevelFailureReport,
  derivePromptContext,
  deriveDataSpec,
} from '@mimicai/core';
import type {
  PersonaContract,
  PromptContext,
  DataSpec,
  AdapterResourceSpecs,
  ApiMockAdapter,
  SchemaModel,
  MimicConfig,
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

  logger.header('mimic run (V5)');

  const targetPersonas = resolvePersonas(config, opts.persona);
  logger.step(
    `Processing ${targetPersonas.length} persona(s): ${targetPersonas.map((p) => chalk.yellow(p.name)).join(', ')}`,
  );

  const dataDir = join(cwd, '.mimic', 'data');
  const proofDir = join(cwd, '.mimic', 'proof');
  await ensureDir(dataDir);
  await ensureDir(proofDir);

  // ── Parse schema ──────────────────────────────────────────────────────
  const schemaSpin = logger.spinner('Parsing schema...');
  let schema: SchemaModel;
  try {
    schema = await parseSchema(resolveSchemaOptions(config));
    schemaSpin.succeed(`Schema parsed: ${chalk.yellow(String(schema.tables.length))} tables`);
  } catch (err) {
    schemaSpin.fail('Failed to parse schema');
    throw err;
  }

  // ── Resolve adapter resource specs (for contract compiler grounding) ──
  const { promptContexts, resourceSpecs } = await resolveAdapterMetadata(config);
  void deriveDataSpec; // silence unused export warning until disk write wires it

  // ── LLM client (used for contract compilation only in V5) ─────────────
  const costTracker = new CostTracker();
  const runtimeOverride = resolveRuntimeOverride(opts.llmRuntime);
  const llmClient = createLLMClient(config, costTracker, runtimeOverride);

  const seed = opts.seed ?? config.generate.seed;

  let exitCode = 0;
  for (let i = 0; i < targetPersonas.length; i++) {
    const persona = targetPersonas[i]!;
    const personaIndex = i + 1;
    const runId = `${persona.name}-${Date.now()}`;

    // ── 1. Compile contract via LLM ────────────────────────────────────
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
        undefined, // schemaMapping not needed for compiler grounding in V5
        {
          currentDate: new Date().toISOString().split('T')[0]!,
          volume: config.generate.volume,
          personaIndex,
          totalPersonas: targetPersonas.length,
        },
      );
      compileSpin.succeed(`Contract compiled: ${contract.clauses.length} clauses`);
    } catch (err) {
      compileSpin.fail(`Contract compilation failed for ${persona.name}`);
      throw err;
    }

    // ── 2. Run the V5 pipeline ─────────────────────────────────────────
    const result = runPipeline(contract, schema, { runId, seed: `${seed}-${personaIndex}` });

    if (!result.ok) {
      exitCode = 1;
      if (result.reason === 'pre_generation_gate') {
        console.error(chalk.red(formatGateReport(result.report)));
      } else {
        console.error(chalk.red(formatOwnerLevelFailureReport(result.report)));
      }
      logger.warn(`${persona.name}: pipeline aborted — see report above.`);
      continue;
    }

    // ── 3. Persist outputs ─────────────────────────────────────────────
    await writeJson(join(dataDir, `${persona.name}.json`), result.materialised);
    await writeJson(join(proofDir, `${runId}.json`), result.proof);
    logger.success(
      `${persona.name}: ${tableCount(result.materialised)} rows + ${apiCount(result.materialised)} API responses; proof at .mimic/proof/${runId}.json`,
    );
  }

  // ── Cost summary ──────────────────────────────────────────────────────
  const cost = costTracker.getSummary();
  if (cost.total > 0) logger.info(`LLM cost: $${cost.total.toFixed(4)}`);

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolvePersonas(config: MimicConfig, filter: string[] | undefined): PersonaEntry[] {
  const all = config.personas.map((p) => ({ name: p.name, description: p.description }));
  if (!filter || filter.length === 0) return all;
  const set = new Set(filter);
  return all.filter((p) => set.has(p.name));
}

function resolveSchemaOptions(config: MimicConfig): Parameters<typeof parseSchema>[0] {
  // Defer to parseSchema's auto-detection by default; the config schema
  // contract is unchanged from V4.5.
  return { schema: { source: (config as { schema?: { source?: string } }).schema?.source } } as Parameters<typeof parseSchema>[0];
}

async function resolveAdapterMetadata(config: MimicConfig): Promise<{
  promptContexts: Record<string, PromptContext> | undefined;
  resourceSpecs: Record<string, AdapterResourceSpecs> | undefined;
}> {
  const promptContexts: Record<string, PromptContext> = {};
  const resourceSpecs: Record<string, AdapterResourceSpecs> = {};
  if (!config.apis || Object.keys(config.apis).length === 0) {
    return { promptContexts: undefined, resourceSpecs: undefined };
  }

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
      if (adapter.resourceSpecs) {
        resourceSpecs[adapterId] = adapter.resourceSpecs;
        promptContexts[adapterId] = derivePromptContext(adapter.resourceSpecs);
      } else if (adapter.promptContext) {
        promptContexts[adapterId] = adapter.promptContext;
      }
    } catch {
      logger.debug(`Could not resolve adapter "${adapterId}"`);
    }
  }
  return {
    promptContexts: Object.keys(promptContexts).length > 0 ? promptContexts : undefined,
    resourceSpecs: Object.keys(resourceSpecs).length > 0 ? resourceSpecs : undefined,
  };
}

function resolveRuntimeOverride(value: string | undefined): 'api' | 'claude-code' | 'batch' | undefined {
  if (!value) return undefined;
  if (value === 'api' || value === 'claude-code' || value === 'batch') return value;
  throw new Error(`Unknown --llm-runtime "${value}". Expected api | claude-code | batch.`);
}

function tableCount(materialised: { tables: Record<string, unknown[]> }): number {
  return Object.values(materialised.tables).reduce((s, rows) => s + rows.length, 0);
}

function apiCount(materialised: { apiResponses: Record<string, { responses: Record<string, unknown[]> }> }): number {
  let n = 0;
  for (const set of Object.values(materialised.apiResponses)) {
    for (const responses of Object.values(set.responses)) n += responses.length;
  }
  return n;
}

void resolveEnvVars;
