import { spawn } from 'node:child_process';
import { Command } from 'commander';
import chalk from 'chalk';
import { logger } from '@mimicai/core';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerExploreCommand(program: Command): void {
  program
    .command('explore')
    .description('Open the interactive data explorer UI in your browser')
    .option('--port <number>', 'port for the explorer UI (default: 7879)', parseInt)
    .option('--no-open', 'do not auto-open the browser')
    .action(async (opts) => {
      await runExplore(opts);
    });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExploreOptions {
  port?: number;
  open?: boolean;
}

// ---------------------------------------------------------------------------
// Daemon entry point — invoked when re-spawned with MIMIC_EXPLORE_DAEMON=1
// ---------------------------------------------------------------------------

export async function runExploreDaemon(): Promise<void> {
  const port = parseInt(process.env.MIMIC_EXPLORE_PORT ?? '7879', 10);
  const cwd = process.env.MIMIC_EXPLORE_CWD ?? process.cwd();

  let startExplorer: typeof import('@mimicai/explorer').startExplorer;
  try {
    const mod = await import('@mimicai/explorer');
    startExplorer = mod.startExplorer;
  } catch {
    process.exit(1);
  }

  // The Fastify HTTP server keeps the process alive automatically.
  await startExplorer({ port, cwd });
}

// ---------------------------------------------------------------------------
// Main command — discovers an available port, spawns daemon, exits
// ---------------------------------------------------------------------------

async function runExplore(opts: ExploreOptions): Promise<void> {
  logger.header('mimic explore');

  let startExplorer: typeof import('@mimicai/explorer').startExplorer;
  try {
    const mod = await import('@mimicai/explorer');
    startExplorer = mod.startExplorer;
  } catch {
    logger.error(
      `Explorer package not found. Install it: ${chalk.yellow('pnpm add @mimicai/explorer')}`,
    );
    process.exit(1);
  }

  // Start the server briefly to claim an available port, then shut it down.
  // This lets us pass the exact port to the daemon without races.
  const spin = logger.spinner('Finding available port...');
  let chosenPort: number;
  try {
    const { port, stop } = await startExplorer({
      port: opts.port ?? 7879,
      cwd: process.cwd(),
    });
    chosenPort = port;
    await stop();
    spin.succeed(`Using port ${chalk.cyan(String(chosenPort))}`);
  } catch (err) {
    spin.fail('Failed to find an available port');
    logger.error(String(err));
    process.exit(1);
  }

  // Spawn a detached daemon that owns the server.
  const child = spawn(process.execPath, process.argv.slice(1), {
    env: {
      ...(process.env as Record<string, string>),
      MIMIC_EXPLORE_DAEMON: '1',
      MIMIC_EXPLORE_PORT: String(chosenPort),
      MIMIC_EXPLORE_CWD: process.cwd(),
    },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const url = `http://localhost:${chosenPort}`;

  // Open browser from the foreground process for immediate feedback.
  if (opts.open !== false) {
    try {
      const cmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
    } catch {
      // Ignore
    }
  }

  logger.success(`Explorer running at ${chalk.cyan(url)}`);
  logger.info(chalk.dim(`Background process PID ${child.pid} — to stop: kill ${child.pid}`));
}
