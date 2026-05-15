import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'node:path';

import {
  loadConfig,
  logger,
  ensureDir,
  CostTracker,
  createLLMClient,
  compileContract,
  canonicaliseContract,
  runPreGenerationGate,
  formatGateReport,
} from '@mimicai/core';
import type {
  LLMRuntime,
  PersonaContract,
  SchemaModel,
} from '@mimicai/core';
import {
  resolvePersonas,
  resolveSchema,
  resolveAdapterMetadata,
} from './run.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerPlanCommand(program: Command): void {
  program
    .command('plan')
    .description('Compile each persona contract and run the V5 pre-generation gate only')
    .option('-p, --persona <names...>', 'limit to specific personas')
    .option(
      '--llm-runtime <runtime>',
      'route LLM calls via api | claude-code | batch (overrides config.llm.runtime)',
    )
    .option('--verbose', 'enable verbose logging')
    .action(async (opts: PlanOptions) => {
      await runPlan(opts);
    });
}

interface PlanOptions {
  persona?: string[];
  llmRuntime?: string;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Plan logic
// ---------------------------------------------------------------------------

async function runPlan(opts: PlanOptions): Promise<void> {
  if (opts.verbose) logger.setVerbose(true);

  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const reportDir = join(cwd, '.mimic', 'reports');
  await ensureDir(reportDir);

  logger.header('mimic plan');

  const targetPersonas = resolvePersonas(config, opts.persona);
  logger.step(
    `Planning ${targetPersonas.length} persona(s): ${targetPersonas.map((p) => chalk.yellow(p.name)).join(', ')}`,
  );

  const schemaSpin = logger.spinner('Parsing schema...');
  let schema: SchemaModel;
  try {
    schema = await resolveSchema(config, cwd);
    schemaSpin.succeed(`Schema parsed: ${chalk.yellow(String(schema.tables.length))} tables`);
  } catch (err) {
    schemaSpin.fail('Failed to parse schema');
    throw err;
  }

  const { promptContexts, resourceSpecs } = await resolveAdapterMetadata(config);
  const costTracker = new CostTracker();
  const runtimeOverride = resolveRuntimeOverride(opts.llmRuntime);
  const llm = createLLMClient(config, costTracker, runtimeOverride);

  let exitCode = 0;
  for (let i = 0; i < targetPersonas.length; i++) {
    const persona = targetPersonas[i]!;
    const personaIndex = i + 1;
    const runId = `${persona.name}-${Date.now()}`;

    const compileSpin = logger.spinner(`Compiling contract for ${chalk.yellow(persona.name)}...`);
    let contract: PersonaContract;
    try {
      contract = await compileContract(
        llm,
        persona,
        config.domain,
        schema,
        promptContexts,
        resourceSpecs,
        undefined,
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

    canonicaliseContract(contract);
    const gate = runPreGenerationGate(contract);

    if (!gate.ok) {
      exitCode = 1;
      const rendered = formatGateReport(gate.report);
      const reportPath = join(reportDir, `${runId}.plan.md`);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(reportPath, rendered, 'utf8');
      console.error();
      console.error(chalk.red(rendered));
      logger.warn(`${persona.name}: pre-generation gate FAILED — see ${chalk.cyan(reportPath)}`);
      continue;
    }

    const counts = countOwners(gate.ownerDecisions);
    logger.success(
      `${persona.name}: gate PASSED · ${gate.obligationGraph.nodes.length} obligations across ${ownerSummary(counts)}`,
    );
    for (const node of gate.obligationGraph.nodes) {
      logger.info(`  · ${chalk.cyan(node.clauseId)} → ${chalk.yellow(node.ownerId)} — "${node.quote}"`);
    }
  }

  const cost = costTracker.getSummary();
  if (cost.total > 0) logger.info(`LLM cost: ${chalk.yellow(`$${cost.total.toFixed(4)}`)}`);

  if (exitCode !== 0) process.exitCode = exitCode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveRuntimeOverride(value: string | undefined): LLMRuntime | undefined {
  if (!value) return undefined;
  if (value === 'api' || value === 'claude-code' || value === 'batch') return value;
  throw new Error(`Unknown --llm-runtime "${value}". Expected api | claude-code | batch.`);
}

function countOwners(
  decisions: import('@mimicai/core').OwnerAssignmentDecision[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const d of decisions) {
    const key = d.ownerId ?? 'narrative';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function ownerSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${chalk.dim(k)}=${chalk.yellow(String(v))}`);
  return parts.join(' ');
}
