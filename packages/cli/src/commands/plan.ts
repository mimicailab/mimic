import { Command } from 'commander';
import chalk from 'chalk';

import {
  loadConfig,
  logger,
  parseSchema,
  CostTracker,
  createLLMClient,
  compileContract,
  canonicaliseContract,
  runPreGenerationGate,
  formatGateReport,
} from '@mimicai/core';
import type { MimicConfig, SchemaModel } from '@mimicai/core';

export function registerPlanCommand(program: Command): void {
  program
    .command('plan')
    .description('Run the V5 pre-generation gate only — print the obligation graph or the contradiction report')
    .option('-p, --persona <names...>', 'limit to specific personas')
    .option('--verbose', 'enable verbose logging')
    .action(async (opts: { persona?: string[]; verbose?: boolean }) => {
      if (opts.verbose) logger.setVerbose(true);
      const cwd = process.cwd();
      const config = await loadConfig(cwd);
      const targets = resolvePersonas(config, opts.persona);

      let schema: SchemaModel;
      try {
        schema = await parseSchema({} as Parameters<typeof parseSchema>[0]);
      } catch (err) {
        logger.error('Failed to parse schema');
        throw err;
      }

      const costTracker = new CostTracker();
      const llm = createLLMClient(config, costTracker);

      let exitCode = 0;
      for (let i = 0; i < targets.length; i++) {
        const persona = targets[i]!;
        const contract = await compileContract(
          llm,
          persona,
          config.domain,
          schema,
          undefined,
          undefined,
          undefined,
          { personaIndex: i + 1, totalPersonas: targets.length },
        );
        canonicaliseContract(contract);
        const gate = runPreGenerationGate(contract);
        if (!gate.ok) {
          exitCode = 1;
          console.error(chalk.red(formatGateReport(gate.report)));
          continue;
        }
        logger.success(`${persona.name}: obligation graph covers ${gate.obligationGraph.nodes.length} hard clause(s).`);
        for (const node of gate.obligationGraph.nodes) {
          logger.info(`  · ${chalk.cyan(node.clauseId)} → ${chalk.yellow(node.ownerId)} — "${node.quote}"`);
        }
      }

      if (exitCode !== 0) process.exitCode = exitCode;
    });
}

function resolvePersonas(
  config: MimicConfig,
  filter: string[] | undefined,
): Array<{ name: string; description: string }> {
  const all = config.personas.map((p) => ({ name: p.name, description: p.description }));
  if (!filter || filter.length === 0) return all;
  const set = new Set(filter);
  return all.filter((p) => set.has(p.name));
}
