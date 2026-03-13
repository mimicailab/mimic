import { execSync } from 'node:child_process';
import { Command } from 'commander';
import chalk from 'chalk';

import { loadConfig, logger } from '@mimicai/core';
import type { ApiMockAdapter, AdapterManifest } from '@mimicai/core';
import { readConfig, writeConfig } from '../utils/config-writer.js';
import { detectPackageManager, installCmd, uninstallCmd } from '../utils/package-manager.js';
import { importFromProject } from '../utils/import.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerAdaptersCommand(program: Command): void {
  const adapters = program
    .command('adapters')
    .description('Manage API mock adapters');

  adapters
    .command('add <name>')
    .description('Install an adapter package and add it to mimic.json')
    .option('--port <number>', 'port for the mock server', parseInt)
    .option('--no-install', 'skip npm install (just add to config)')
    .action(async (name: string, opts) => {
      await addAdapter(name, opts);
    });

  adapters
    .command('remove <name>')
    .description('Remove an adapter from mimic.json and uninstall the package')
    .option('--no-uninstall', 'skip npm uninstall (just remove from config)')
    .action(async (name: string, opts) => {
      await removeAdapter(name, opts);
    });

  adapters
    .command('enable <name>')
    .description('Enable a configured adapter')
    .action(async (name: string) => {
      await toggleAdapter(name, true);
    });

  adapters
    .command('disable <name>')
    .description('Disable an adapter without removing it')
    .action(async (name: string) => {
      await toggleAdapter(name, false);
    });

  adapters
    .command('list')
    .description('List all configured adapters')
    .action(async () => {
      await listAdapters();
    });

  adapters
    .command('inspect <name>')
    .description('Show details and endpoints for an adapter')
    .action(async (name: string) => {
      await inspectAdapter(name);
    });
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

async function addAdapter(
  id: string,
  opts: { port?: number; install?: boolean },
): Promise<void> {
  const cwd = process.cwd();
  const pkg = `@mimicai/adapter-${id}`;

  // 1. Install the npm package
  if (opts.install !== false) {
    const pm = detectPackageManager(cwd);
    const cmd = installCmd(pm, pkg);
    logger.step(`Installing ${chalk.cyan(pkg)}...`);
    try {
      execSync(cmd, { cwd, stdio: 'inherit' });
      logger.success(`Installed ${pkg}`);
    } catch {
      logger.error(`Failed to install ${pkg}`);
      logger.info(`You can install it manually: ${chalk.yellow(cmd)}`);
      return;
    }
  }

  // 2. Add to mimic.json
  let config: Record<string, unknown>;
  try {
    config = await readConfig(cwd);
  } catch {
    logger.error('No mimic.json found in current directory');
    logger.info(`Run ${chalk.yellow('mimic init')} first`);
    return;
  }

  const apis = (config.apis ?? {}) as Record<string, unknown>;
  if (apis[id]) {
    logger.info(`Adapter "${id}" already in mimic.json — updating`);
  }

  const entry: Record<string, unknown> = { enabled: true };
  if (opts.port) entry.port = opts.port;
  apis[id] = entry;
  config.apis = apis;

  await writeConfig(cwd, config);
  logger.success(`Added ${chalk.cyan(id)} to mimic.json`);

  // 3. Show endpoints
  try {
    const mod = await importFromProject(pkg, cwd);
    const AdapterClass = findAdapterClass(mod);
    if (AdapterClass) {
      const adapter = new AdapterClass();
      const endpoints = adapter.getEndpoints();
      console.log();
      logger.info(`${chalk.bold(endpoints.length)} endpoints available:`);
      for (const ep of endpoints.slice(0, 5)) {
        logger.info(`  ${chalk.bold(ep.method.padEnd(7))} ${chalk.cyan(ep.path)}`);
      }
      if (endpoints.length > 5) {
        logger.info(chalk.dim(`  ... and ${endpoints.length - 5} more (run mimic adapters inspect ${id})`));
      }
    }
  } catch {
    // Package might not be importable yet if install was skipped
  }
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

async function removeAdapter(
  id: string,
  opts: { uninstall?: boolean },
): Promise<void> {
  const cwd = process.cwd();
  const pkg = `@mimicai/adapter-${id}`;

  // 1. Remove from mimic.json
  let config: Record<string, unknown>;
  try {
    config = await readConfig(cwd);
  } catch {
    logger.error('No mimic.json found in current directory');
    return;
  }

  const apis = (config.apis ?? {}) as Record<string, unknown>;
  if (!apis[id]) {
    logger.warn(`Adapter "${id}" is not in mimic.json`);
  } else {
    delete apis[id];
    config.apis = Object.keys(apis).length > 0 ? apis : undefined;
    await writeConfig(cwd, config);
    logger.success(`Removed ${chalk.cyan(id)} from mimic.json`);
  }

  // 2. Uninstall the npm package
  if (opts.uninstall !== false) {
    const pm = detectPackageManager(cwd);
    const cmd = uninstallCmd(pm, pkg);
    logger.step(`Uninstalling ${chalk.cyan(pkg)}...`);
    try {
      execSync(cmd, { cwd, stdio: 'inherit' });
      logger.success(`Uninstalled ${pkg}`);
    } catch {
      logger.warn(`Could not uninstall ${pkg} — you may need to remove it manually`);
    }
  }
}

// ---------------------------------------------------------------------------
// Enable / Disable
// ---------------------------------------------------------------------------

async function toggleAdapter(id: string, enabled: boolean): Promise<void> {
  const cwd = process.cwd();

  let config: Record<string, unknown>;
  try {
    config = await readConfig(cwd);
  } catch {
    logger.error('No mimic.json found in current directory');
    return;
  }

  const apis = (config.apis ?? {}) as Record<string, Record<string, unknown>>;
  if (!apis[id]) {
    logger.error(`Adapter "${id}" is not configured. Add it first: ${chalk.yellow(`mimic adapters add ${id}`)}`);
    return;
  }

  apis[id].enabled = enabled;
  config.apis = apis;
  await writeConfig(cwd, config);

  if (enabled) {
    logger.success(`Enabled adapter ${chalk.cyan(id)}`);
  } else {
    logger.success(`Disabled adapter ${chalk.cyan(id)} — it will be skipped by mimic host`);
  }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

async function listAdapters(): Promise<void> {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);

  logger.header('Configured Adapters');

  // Database adapters
  if (config.databases && Object.keys(config.databases).length > 0) {
    console.log();
    logger.info(chalk.bold('Databases:'));
    for (const [name, dbConfig] of Object.entries(config.databases)) {
      const type = (dbConfig as Record<string, unknown>).type as string || 'postgres';
      logger.info(`  ${chalk.cyan(name)}  ${chalk.dim(`(${type})`)}`);
    }
  }

  // API mock adapters
  if (config.apis && Object.keys(config.apis).length > 0) {
    console.log();
    logger.info(chalk.bold('API Mocks:'));
    for (const [name, apiConfig] of Object.entries(config.apis)) {
      const cfg = apiConfig as Record<string, unknown>;
      const adapterId = cfg.adapter as string || name;
      const pkg = `@mimicai/adapter-${adapterId}`;
      const enabled = cfg.enabled !== false;

      let installStatus: string;
      let adapterName = adapterId;
      try {
        const mod = await importFromProject(pkg, cwd);
        const manifest = mod.manifest as AdapterManifest | undefined;
        adapterName = manifest?.name ?? adapterId;
        installStatus = chalk.green('installed');
      } catch {
        installStatus = chalk.red('not installed');
      }

      const enabledStatus = enabled ? chalk.green('on') : chalk.yellow('off');

      logger.info(
        `  ${chalk.cyan(name.padEnd(12))} ${adapterName.padEnd(18)} ${enabledStatus.padEnd(14)} ${installStatus}  ${chalk.dim(pkg)}`,
      );
    }
  }

  if (!config.apis && !config.databases) {
    logger.info(chalk.dim('No adapters configured in mimic.json'));
    logger.info(`Add one with: ${chalk.yellow('mimic adapters add stripe')}`);
  } else if (!config.apis || Object.keys(config.apis).length === 0) {
    console.log();
    logger.info(chalk.dim('No API mock adapters configured'));
    logger.info(`Add one with: ${chalk.yellow('mimic adapters add stripe')}`);
  }
}

// ---------------------------------------------------------------------------
// Inspect
// ---------------------------------------------------------------------------

async function inspectAdapter(id: string): Promise<void> {
  const cwd = process.cwd();
  const pm = detectPackageManager(cwd);
  const pkg = `@mimicai/adapter-${id}`;

  let mod: Record<string, unknown>;
  try {
    mod = await importFromProject(pkg, cwd);
  } catch {
    logger.error(`Adapter ${chalk.cyan(pkg)} is not installed`);
    logger.info(`Install it with: ${chalk.yellow(installCmd(pm, pkg))}`);
    return;
  }

  const manifest = mod.manifest as AdapterManifest | undefined;

  logger.header(`Adapter: ${manifest?.name ?? id}`);
  if (manifest) {
    logger.info(`ID:          ${chalk.cyan(manifest.id)}`);
    logger.info(`Type:        ${chalk.cyan(manifest.type)}`);
    logger.info(`Package:     ${chalk.dim(pkg)}`);
    logger.info(`Description: ${manifest.description}`);
    if (manifest.versions?.length) {
      logger.info(`Versions:    ${manifest.versions.join(', ')}`);
    }
  }

  const AdapterClass = findAdapterClass(mod);
  if (AdapterClass) {
    const adapter = new AdapterClass();
    const endpoints = adapter.getEndpoints();

    console.log();
    logger.header(`Endpoints (${endpoints.length})`);
    for (const ep of endpoints) {
      logger.info(`  ${chalk.bold(ep.method.padEnd(7))} ${chalk.cyan(ep.path)}  ${chalk.dim('—')} ${ep.description}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findAdapterClass(mod: Record<string, unknown>): (new () => ApiMockAdapter) | undefined {
  return Object.values(mod).find((v) => {
    if (typeof v !== 'function') return false;
    try {
      const instance = new (v as new () => unknown)() as { type?: string };
      return instance.type === 'api-mock';
    } catch { return false; }
  }) as (new () => ApiMockAdapter) | undefined;
}
