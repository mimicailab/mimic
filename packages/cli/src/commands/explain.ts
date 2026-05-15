import { Command } from 'commander';
import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from '@mimicai/core';
import type { ProofArtifact, ProofRecord } from '@mimicai/core';

export function registerExplainCommand(program: Command): void {
  program
    .command('explain <runId> [clauseId]')
    .description('Show the V5 proof record(s) for a previous run. Omit clauseId to list every record.')
    .action(async (runId: string, clauseId?: string) => {
      const cwd = process.cwd();
      const proofPath = join(cwd, '.mimic', 'proof', `${runId}.json`);
      let artifact: ProofArtifact;
      try {
        const raw = await readFile(proofPath, 'utf8');
        artifact = JSON.parse(raw) as ProofArtifact;
      } catch (err) {
        logger.error(`Could not read proof at ${proofPath}`);
        throw err;
      }
      logger.info(
        `Proof artifact ${chalk.yellow(artifact.runId)} (v${String(artifact.proofVersion)}) emitted ${chalk.dim(artifact.emittedAt)}.`,
      );
      const records: ProofRecord[] = clauseId
        ? artifact.records.filter((r) => r.clauseId === clauseId)
        : artifact.records;
      if (records.length === 0) {
        logger.warn(`No proof record(s) matched ${clauseId ?? '<all>'}.`);
        process.exitCode = 1;
        return;
      }
      for (const r of records) {
        console.log(chalk.cyan(`\n${r.clauseId}`));
        console.log(`  quote:             "${r.quote}"`);
        console.log(`  ownerId:           ${chalk.yellow(r.ownerId)}`);
        console.log(`  worldQuery:        ${r.evidence.worldQuery}`);
        console.log(`  materialisedQuery: ${r.evidence.materialisedQuery}`);
        console.log(`  observed:          ${JSON.stringify(r.evidence.observed)}`);
      }
    });
}
