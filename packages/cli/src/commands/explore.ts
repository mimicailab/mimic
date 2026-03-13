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
// Explore logic
// ---------------------------------------------------------------------------

interface ExploreOptions {
  port?: number;
  open?: boolean;
}

async function runExplore(opts: ExploreOptions): Promise<void> {
  const port = opts.port ?? 7879;

  logger.header('mimic explore');

  const spin = logger.spinner('Starting explorer...');

  let startExplorer: typeof import('@mimicai/explorer').startExplorer;
  try {
    const mod = await import('@mimicai/explorer');
    startExplorer = mod.startExplorer;
  } catch {
    spin.fail('Explorer package not found');
    logger.error(
      `Install @mimicai/explorer: ${chalk.yellow('pnpm add @mimicai/explorer')}`,
    );
    return;
  }

  const { url, stop } = await startExplorer({ port, cwd: process.cwd() });
  spin.succeed(`Explorer running at ${chalk.cyan(url)}`);

  // Auto-open browser
  if (opts.open !== false) {
    try {
      const { exec } = await import('node:child_process');
      const cmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      exec(`${cmd} ${url}`);
    } catch {
      // Silently ignore if browser can't be opened
    }
  }

  console.log();
  logger.info(chalk.dim('Press Ctrl+C to stop the explorer'));

  // Keep running until Ctrl+C
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      console.log();
      logger.step('Shutting down explorer...');
      await stop();
      logger.done('Explorer stopped');
      resolve();
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });
}
