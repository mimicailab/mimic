import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

import {
  loadConfig,
  logger,
  readJson,
  fileExists,
  MimicError,
  TestAgentError,
  ScenarioRunner,
  Evaluator,
  Reporter,
  LLMClient,
  CostTracker,
  providerConfigFromMimic,
} from '@mimicailab/core';
import type {
  MimicConfig,
  ExpandedData,
  TestReport,
  TestResult,
  TestScenario,
  TestExpectation,
} from '@mimicailab/core';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerTestCommand(program: Command): void {
  program
    .command('test')
    .description('Run test scenarios against your AI agent')
    .option('-S, --scenario <names...>', 'limit to specific scenarios')
    .option('-p, --persona <names...>', 'limit to specific personas')
    .option(
      '-f, --format <format>',
      'output format: cli, json, junit',
      'cli',
    )
    .option('-o, --output <path>', 'write report to file')
    .option('--ci', 'CI mode: exit code 1 on failure')
    .option('-t, --timeout <ms>', 'per-scenario timeout in ms', parseInt)
    .option('--verbose', 'enable verbose logging')
    .option(
      '--full',
      'full pipeline: run -> seed -> serve (background) -> test -> stop',
    )
    .action(async (opts) => {
      await runTest(opts);
    });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestOptions {
  scenario?: string[];
  persona?: string[];
  format?: string;
  output?: string;
  ci?: boolean;
  timeout?: number;
  verbose?: boolean;
  full?: boolean;
}

interface ScenarioConfig {
  name: string;
  persona?: string;
  goal: string;
  input?: string;
  expect?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Test logic
// ---------------------------------------------------------------------------

async function runTest(opts: TestOptions): Promise<void> {
  if (opts.verbose) {
    logger.setVerbose(true);
  }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);

  if (!config.test) {
    throw new MimicError(
      'No test configuration found',
      'CONFIG_INVALID',
      "Add a 'test' section to mimic.json with agent URL and scenarios",
    );
  }

  const format = opts.format ?? 'cli';
  if (!['cli', 'json', 'junit'].includes(format)) {
    throw new MimicError(
      `Invalid format "${format}"`,
      'CONFIG_INVALID',
      'Use cli, json, or junit',
    );
  }

  if (format === 'cli') {
    logger.header('mimic test');
  }

  // ── Full pipeline mode ──────────────────────────────────────────────────
  if (opts.full) {
    await runFullPipeline(opts, cwd, config);
    return;
  }

  // ── Load persona data ───────────────────────────────────────────────────
  const dataDir = join(cwd, '.mimic', 'data');
  const personaNames = resolvePersonaNames(config, opts.persona);

  const datasets = new Map<string, ExpandedData>();
  for (const name of personaNames) {
    const dataPath = join(dataDir, `${name}.json`);
    if (await fileExists(dataPath)) {
      datasets.set(name, await readJson<ExpandedData>(dataPath));
    } else {
      logger.warn(`No data found for persona "${name}" — skipping`);
    }
  }

  if (datasets.size === 0) {
    throw new MimicError(
      'No persona data available',
      'CONFIG_INVALID',
      "Run 'mimic run' first to generate data",
    );
  }

  // ── Resolve scenarios ───────────────────────────────────────────────────
  const rawScenarios = resolveScenarios(config, opts.scenario, opts.persona);
  const testScenarios = rawScenarios.map((s) => toTestScenario(s, config));

  if (format === 'cli') {
    logger.step(`Running ${chalk.yellow(String(testScenarios.length))} scenario(s)`);
  }

  // ── Create core test infrastructure ─────────────────────────────────────
  const costTracker = new CostTracker();
  const llmClient = new LLMClient(providerConfigFromMimic(config), costTracker);
  const evaluator = new Evaluator(llmClient, costTracker);
  const reporter = new Reporter();
  const runner = new ScenarioRunner(llmClient, evaluator, reporter, costTracker);

  // ── Run scenarios ───────────────────────────────────────────────────────
  const spin = format === 'cli' ? logger.spinner('Running scenarios...') : null;

  let report: TestReport;
  try {
    const target = {
      type: 'http' as const,
      url: config.test.agent,
      timeout: opts.timeout,
    };

    report = await runner.run(testScenarios, target, datasets);
    spin?.succeed(`Completed ${report.totalScenarios} scenario(s)`);
  } catch (err) {
    spin?.fail('Test execution failed');
    throw new TestAgentError(
      `Test runner failed: ${err instanceof Error ? err.message : String(err)}`,
      config.test.agent,
      err instanceof Error ? err : undefined,
    );
  }

  // ── Output ──────────────────────────────────────────────────────────────
  if (format === 'json') {
    const output = JSON.stringify(report, null, 2);
    if (opts.output) {
      await writeFile(opts.output, output, 'utf-8');
      logger.info(`Report written to ${opts.output}`);
    } else {
      console.log(output);
    }
  } else if (format === 'junit') {
    const xml = reporter.formatJunit(report);
    if (opts.output) {
      await writeFile(opts.output, xml, 'utf-8');
      logger.info(`JUnit report written to ${opts.output}`);
    } else {
      console.log(xml);
    }
  } else {
    // CLI format — use core's Reporter for consistent output
    console.log(reporter.formatCli(report));

    if (report.failed > 0) {
      console.log();
      logger.header('Failures');
      for (const result of report.results.filter((r) => !r.passed)) {
        console.log();
        console.log(`  ${chalk.red('FAIL')} ${chalk.bold(result.scenario)}`);
        for (const ev of result.evaluations.filter((e) => !e.passed)) {
          logger.info(`  ${chalk.red('x')} ${ev.check}: ${ev.explanation ?? 'failed'}`);
        }
      }
    }

    console.log();
    if (report.failed === 0) {
      logger.done('All scenarios passed');
    } else {
      logger.error(`${report.failed} scenario(s) failed`);
    }

    if (opts.output) {
      await writeFile(opts.output, JSON.stringify(report, null, 2), 'utf-8');
      logger.info(`Report written to ${opts.output}`);
    }
    console.log();
  }

  // ── CI exit code ────────────────────────────────────────────────────────
  if (opts.ci && report.failed > 0) {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

async function runFullPipeline(
  opts: TestOptions,
  cwd: string,
  _config: MimicConfig,
): Promise<void> {
  logger.header('mimic test --full');
  logger.info('Running full pipeline: run -> seed -> serve -> test -> stop');
  console.log();

  // Step 1: Run
  const { registerRunCommand } = await import('./run.js');
  const { Command: Cmd } = await import('commander');
  const runProgram = new Cmd();
  registerRunCommand(runProgram);

  logger.step('Step 1/4: Generating blueprint data...');
  await runProgram.parseAsync(['node', 'mimic', 'run'], { from: 'user' });

  // Step 2: Seed
  const { registerSeedCommand } = await import('./seed.js');
  const seedProgram = new Cmd();
  registerSeedCommand(seedProgram);

  logger.step('Step 2/4: Seeding database...');
  await seedProgram.parseAsync(['node', 'mimic', 'seed'], { from: 'user' });

  // Step 3: Serve (would run in background)
  logger.step('Step 3/4: Starting MCP server in background...');
  logger.warn('Full pipeline serve step is not yet fully automated');

  // Step 4: Test (re-enter without --full)
  logger.step('Step 4/4: Running test scenarios...');
  const testOpts = { ...opts, full: false };
  await runTest(testOpts);

  logger.done('Full pipeline complete');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolvePersonaNames(
  config: MimicConfig,
  filter?: string[],
): string[] {
  const all = config.personas.map((p) => p.name);
  if (filter && filter.length > 0) {
    return filter.filter((n) => all.includes(n));
  }
  return all;
}

function resolveScenarios(
  config: MimicConfig,
  scenarioFilter?: string[],
  personaFilter?: string[],
): (string | ScenarioConfig)[] {
  const scenarios = config.test?.scenarios ?? [];

  let filtered = scenarios.map((s) => {
    if (typeof s === 'string') return s;
    return s as ScenarioConfig;
  });

  if (scenarioFilter && scenarioFilter.length > 0) {
    const filterSet = new Set(scenarioFilter);
    filtered = filtered.filter((s) => {
      const name = typeof s === 'string' ? s : s.name;
      return filterSet.has(name);
    });
  }

  if (personaFilter && personaFilter.length > 0) {
    const filterSet = new Set(personaFilter);
    filtered = filtered.filter((s) => {
      if (typeof s === 'string') return true;
      return !s.persona || filterSet.has(s.persona);
    });
  }

  return filtered;
}

/**
 * Convert a CLI scenario config to the core TestScenario format.
 */
function toTestScenario(
  s: string | ScenarioConfig,
  config: MimicConfig,
): TestScenario {
  const defaultPersona = config.personas[0]?.name ?? 'default';
  const mode = (config.test?.mode ?? 'text') as 'text' | 'voice';

  if (typeof s === 'string') {
    return {
      name: s,
      persona: defaultPersona,
      goal: s,
      mode,
      expect: {},
    };
  }

  return {
    name: s.name,
    persona: s.persona ?? defaultPersona,
    goal: s.goal,
    input: s.input,
    mode,
    expect: (s.expect ?? {}) as TestExpectation,
  };
}

// ---------------------------------------------------------------------------
// JUnit XML formatter (kept as fallback — prefer core Reporter.formatJunit)
// ---------------------------------------------------------------------------

function toJUnit(report: TestReport): string {
  const escapeXml = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${report.totalScenarios}" failures="${report.failed}" time="${(report.duration / 1000).toFixed(3)}">`,
    `  <testsuite name="mimic" tests="${report.totalScenarios}" failures="${report.failed}" time="${(report.duration / 1000).toFixed(3)}">`,
  ];

  for (const result of report.results) {
    lines.push(
      `    <testcase name="${escapeXml(result.scenario)}" classname="mimic.${escapeXml(result.persona)}" time="${(result.duration / 1000).toFixed(3)}">`,
    );
    if (!result.passed) {
      const failedChecks = result.evaluations
        .filter((e) => !e.passed)
        .map((e) => `${e.check}: ${e.explanation ?? 'failed'}`)
        .join('; ');
      lines.push(
        `      <failure message="${escapeXml(failedChecks)}">${escapeXml(failedChecks)}</failure>`,
      );
    }
    lines.push('    </testcase>');
  }

  lines.push('  </testsuite>');
  lines.push('</testsuites>');
  return lines.join('\n');
}
