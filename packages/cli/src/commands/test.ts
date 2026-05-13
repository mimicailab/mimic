import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'node:path';
import { writeFile, mkdir, copyFile } from 'node:fs/promises';

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
  CostTracker,
  createLLMClient,
  ScenarioGenerator,
  PromptFooExporter,
  BraintrustExporter,
  LangSmithExporter,
  InspectExporter,
  MimicExporter,
  ClaudeSkillExporter,
} from '@mimicai/core';
import type { LLMRuntime } from '@mimicai/core';
import type {
  MimicConfig,
  ExpandedData,
  TestReport,
  TestResult,
  TestScenario,
  TestExpectation,
  FactManifest,
  ScenarioTier,
  ScenarioExporter,
} from '@mimicai/core';

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
    .option(
      '--tier <tiers...>',
      'filter auto-generated scenarios by tier: smoke, functional, adversarial',
    )
    .option(
      '--export <format>',
      'export scenarios: mimic, promptfoo, braintrust, langsmith, inspect, claude-skill',
    )
    .option('--inspect', 'shortcut for --export inspect')
    .option(
      '--force-install-skill',
      'when --export claude-skill, overwrite an existing skills/mimic-eval/SKILL.md',
    )
    .option(
      '--llm-runtime <runtime>',
      'route LLM calls via api | claude-code | batch (overrides config.llm.runtime)',
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
  tier?: string[];
  export?: string;
  inspect?: boolean;
  forceInstallSkill?: boolean;
  llmRuntime?: string;
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

  // ── Create core test infrastructure ─────────────────────────────────────
  const costTracker = new CostTracker();
  const runtimeOverride = resolveRuntimeOverride(opts.llmRuntime);
  const llmClient = createLLMClient(config, costTracker, runtimeOverride);
  const resolvedRuntime = runtimeOverride ?? config.llm.runtime ?? 'api';
  if (resolvedRuntime === 'claude-code') {
    logger.info(
      chalk.dim(
        'LLM runtime: claude-code — calls billed against your Claude subscription, not per-token API charges',
      ),
    );
  } else if (resolvedRuntime === 'batch') {
    logger.warn(
      'LLM runtime: batch — BatchClient not implemented yet, falling back to api runtime at full price',
    );
  }

  // ── Auto-scenario generation from fact manifest ─────────────────────────
  const exportFormat = opts.inspect ? 'inspect' : (opts.export ?? config.test?.export);
  const autoEnabled = config.test?.auto_scenarios || opts.tier || exportFormat;

  if (autoEnabled) {
    const manifestPath = join(cwd, '.mimic', 'fact-manifest.json');
    if (!(await fileExists(manifestPath))) {
      throw new MimicError(
        'No fact manifest found',
        'CONFIG_INVALID',
        "Run 'mimic run' first to generate data with facts",
      );
    }

    const manifest = await readJson<FactManifest>(manifestPath);
    const tiers = (opts.tier ?? config.test?.scenario_tiers) as ScenarioTier[] | undefined;

    if (format === 'cli') {
      const spin = logger.spinner('Generating scenarios from fact manifest...');
      try {
        const generator = new ScenarioGenerator(llmClient, costTracker);
        const autoScenarios = await generator.generate(manifest, tiers);
        spin.succeed(`Generated ${autoScenarios.length} scenario(s) from ${manifest.facts.length} fact(s)`);

        // Export if requested
        if (exportFormat) {
          const exportDir = join(cwd, '.mimic', 'exports');
          const exporter = createExporter(
            exportFormat,
            config.test?.agent,
            config,
          );
          const files = await exporter.export(autoScenarios, exportDir);
          logger.done(`Exported to ${exportFormat}: ${files.join(', ')}`);

          if (exportFormat === 'claude-skill') {
            await installClaudeSkill(
              files,
              cwd,
              config,
              opts.forceInstallSkill ?? false,
            );
          }

          // If only exporting (no manual scenarios), we're done
          if (testScenarios.length === 0) {
            return;
          }
        }

        // Merge auto-scenarios into test scenarios for running
        for (const s of autoScenarios) {
          testScenarios.push({
            name: s.name,
            persona: s.metadata.persona,
            goal: s.goal,
            input: s.input,
            mode: (config.test?.mode ?? 'text') as 'text' | 'voice',
            expect: {
              response_contains: s.expect.response_contains,
              max_latency_ms: s.expect.max_latency_ms,
            },
          });
        }
      } catch (err) {
        spin.fail('Auto-scenario generation failed');
        logger.warn(`Falling back to manual scenarios only: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // Non-CLI format — no spinner
      const generator = new ScenarioGenerator(llmClient, costTracker);
      const autoScenarios = await generator.generate(manifest, tiers);

      if (exportFormat) {
        const exportDir = join(cwd, '.mimic', 'exports');
        const exporter = createExporter(
          exportFormat,
          config.test?.agent,
          config,
        );
        const files = await exporter.export(autoScenarios, exportDir);

        if (exportFormat === 'claude-skill') {
          await installClaudeSkill(
            files,
            cwd,
            config,
            opts.forceInstallSkill ?? false,
          );
        }

        if (testScenarios.length === 0) return;
      }

      for (const s of autoScenarios) {
        testScenarios.push({
          name: s.name,
          persona: s.metadata.persona,
          goal: s.goal,
          input: s.input,
          mode: (config.test?.mode ?? 'text') as 'text' | 'voice',
          expect: {
            response_contains: s.expect.response_contains,
            max_latency_ms: s.expect.max_latency_ms,
          },
        });
      }
    }
  }

  if (format === 'cli') {
    logger.step(`Running ${chalk.yellow(String(testScenarios.length))} scenario(s)`);
  }
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
// Exporter factory
// ---------------------------------------------------------------------------

function createExporter(
  format: string,
  agentUrl?: string,
  config?: MimicConfig,
): ScenarioExporter {
  switch (format) {
    case 'promptfoo':
      return new PromptFooExporter(agentUrl);
    case 'braintrust':
      return new BraintrustExporter();
    case 'langsmith':
      return new LangSmithExporter();
    case 'inspect':
      return new InspectExporter();
    case 'mimic':
      return new MimicExporter();
    case 'claude-skill':
      return new ClaudeSkillExporter({
        targetSkill: config?.test?.target_skill,
      });
    default:
      throw new MimicError(
        `Unknown export format "${format}"`,
        'CONFIG_INVALID',
        'Use mimic, promptfoo, braintrust, langsmith, inspect, or claude-skill',
      );
  }
}

/**
 * Claude Skill install step — copy the exported `SKILL.md` from
 * `<exportDir>/skills/mimic-eval/SKILL.md` into `<cwd>/skills/mimic-eval/SKILL.md`
 * so Claude Code picks it up with no manual setup.
 *
 * Skips (with a warning) if the destination already exists, unless `force` is true.
 */
async function installClaudeSkill(
  exportedFiles: string[],
  cwd: string,
  config: MimicConfig,
  force: boolean,
): Promise<void> {
  const source = exportedFiles.find((p) =>
    p.endsWith(join('skills', 'mimic-eval', 'SKILL.md')),
  );
  if (!source) return;

  const destDir = join(cwd, 'skills', 'mimic-eval');
  const dest = join(destDir, 'SKILL.md');

  if (!force && (await fileExists(dest))) {
    logger.warn(
      `skills/mimic-eval/SKILL.md already exists — keeping it. ` +
        `Canonical version at ${source}; pass --force-install-skill to overwrite.`,
    );
    return;
  }

  await mkdir(destDir, { recursive: true });
  await copyFile(source, dest);

  if (!config.test?.target_skill) {
    logger.warn(
      `No test.target_skill configured — SKILL.md uses a placeholder. ` +
        `Set test.target_skill in mimic.json to point at the skill being evaluated.`,
    );
  }

  logger.done(
    `Installed skills/mimic-eval/SKILL.md — Claude Code will auto-pick it up.`,
  );
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

function resolveRuntimeOverride(flag: string | undefined): LLMRuntime | undefined {
  if (!flag) return undefined;
  if (flag !== "api" && flag !== "claude-code" && flag !== "batch") {
    throw new MimicError(
      `Unknown --llm-runtime value: "${flag}"`,
      "CONFIG_INVALID",
      "Valid values: api, claude-code, batch",
    );
  }
  return flag;
}
