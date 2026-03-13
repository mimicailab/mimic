import { Command } from 'commander';
import chalk from 'chalk';
import { createRequire } from 'node:module';
import { platform, release, arch } from 'node:os';
import { join, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { fileExists } from '@mimicai/core';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Known adapter package names
// ---------------------------------------------------------------------------

const ADAPTER_PACKAGES = [
  '@mimicai/core',
  '@mimicai/cli',
  '@mimicai/adapter-sdk',
  '@mimicai/blueprints',
  '@mimicai/adapter-postgres',
  '@mimicai/adapter-mysql',
  '@mimicai/adapter-sqlite',
  '@mimicai/adapter-mongodb',
  '@mimicai/adapter-stripe',
  '@mimicai/adapter-plaid',
  '@mimicai/adapter-paddle',
  '@mimicai/adapter-chargebee',
  '@mimicai/adapter-gocardless',
  '@mimicai/adapter-recurly',
  '@mimicai/adapter-revenuecat',
  '@mimicai/adapter-lemonsqueezy',
  '@mimicai/adapter-zuora',
] as const;

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerInfoCommand(program: Command): void {
  program
    .command('info')
    .description('Print environment and package info for bug reports')
    .option('--json', 'output as JSON')
    .action(async (opts) => {
      await printInfo(opts);
    });
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface InfoOutput {
  platform: string;
  arch: string;
  osVersion: string;
  nodeVersion: string;
  packageManager: string;
  packages: Record<string, string>;
  configFound: boolean;
}

async function resolveVersion(pkg: string): Promise<string | null> {
  // In a user project, packages are in cwd's node_modules.
  // In the monorepo dev environment, they're symlinked in the CLI package's node_modules.
  // We also walk up from cwd for pnpm hoisting.
  const searchRoots = [
    process.cwd(),
    join(process.cwd(), '..'),
    join(process.cwd(), '..', '..'),
  ];

  // Also try from the CLI package's own location (handles workspace symlinks).
  // In the built CLI, __dirname is dist/src/ or dist/bin/, so walk up to package root.
  const cliPkgRoot = join(__dirname, '..', '..');
  searchRoots.push(cliPkgRoot);

  for (const root of searchRoots) {
    const candidate = join(root, 'node_modules', pkg, 'package.json');
    try {
      const raw = await readFile(candidate, 'utf-8');
      const parsed = JSON.parse(raw) as { version: string };
      return parsed.version;
    } catch {
      // continue
    }
  }

  return null;
}

function detectPM(): string {
  const ua = process.env.npm_config_user_agent;
  if (ua) {
    if (ua.startsWith('pnpm')) return 'pnpm';
    if (ua.startsWith('yarn')) return 'yarn';
    if (ua.startsWith('bun')) return 'bun';
    if (ua.startsWith('npm')) return 'npm';
  }
  return 'unknown';
}

async function printInfo(opts: { json?: boolean }): Promise<void> {
  const packages: Record<string, string> = {};
  for (const pkg of ADAPTER_PACKAGES) {
    const ver = await resolveVersion(pkg);
    if (ver) packages[pkg] = ver;
  }

  const configPath = join(process.cwd(), 'mimic.json');
  const configFound = await fileExists(configPath);

  const info: InfoOutput = {
    platform: `${platform()} (${release()})`,
    arch: arch(),
    osVersion: release(),
    nodeVersion: process.version,
    packageManager: detectPM(),
    packages,
    configFound,
  };

  if (opts.json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  console.log();
  console.log(chalk.bold('  Mimic Environment Info'));
  console.log();

  console.log(chalk.bold('  System:'));
  console.log(`    OS:              ${info.platform}`);
  console.log(`    Arch:            ${info.arch}`);
  console.log(`    Node:            ${info.nodeVersion}`);
  console.log(`    Package Manager: ${info.packageManager}`);
  console.log();

  console.log(chalk.bold('  Packages:'));
  if (Object.keys(packages).length === 0) {
    console.log(chalk.dim('    (none found)'));
  } else {
    const maxLen = Math.max(...Object.keys(packages).map((k) => k.length));
    for (const [pkg, ver] of Object.entries(packages)) {
      console.log(`    ${pkg.padEnd(maxLen)}  ${chalk.yellow(ver)}`);
    }
  }
  console.log();

  console.log(chalk.bold('  Config:'));
  console.log(`    mimic.json:      ${configFound ? chalk.green('found') : chalk.dim('not found')}`);
  console.log();

  console.log(chalk.dim('  Copy the above into your bug report.'));
  console.log();
}
