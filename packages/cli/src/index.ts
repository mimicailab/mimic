import { Command } from 'commander';
import chalk from 'chalk';
import { createRequire } from 'node:module';

import { registerInitCommand } from './commands/init.js';
import { registerRunCommand } from './commands/run.js';
import { registerSeedCommand } from './commands/seed.js';
import { registerHostCommand } from './commands/host.js';
import { registerTestCommand } from './commands/test.js';
import { registerInspectCommand } from './commands/inspect.js';
import { registerCleanCommand } from './commands/clean.js';
import { registerAdaptersCommand } from './commands/adapters.js';
import { registerInfoCommand } from './commands/info.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

const program = new Command();

program
  .name('mimic')
  .description(
    'Persona-driven synthetic data for AI agent testing — generate, seed, host, and test.',
  )
  .version(version, '-v, --version', 'display the current version');

// ---------------------------------------------------------------------------
// Register subcommands
// ---------------------------------------------------------------------------

registerInitCommand(program);
registerRunCommand(program);
registerSeedCommand(program);
registerHostCommand(program);
registerTestCommand(program);
registerInspectCommand(program);
registerCleanCommand(program);
registerAdaptersCommand(program);
registerInfoCommand(program);

// ---------------------------------------------------------------------------
// Global error handling
// ---------------------------------------------------------------------------

program.exitOverride();

/**
 * Parse argv and run the matched command.
 */
export async function run(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err: unknown) {
    // Commander throws a special error on --help / --version; let it through.
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'commander.helpDisplayed'
    ) {
      return;
    }
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'commander.version'
    ) {
      return;
    }

    // MimicError subclasses expose a `.format()` helper.
    if (err instanceof Error && 'format' in err && typeof (err as { format: unknown }).format === 'function') {
      console.error(
        chalk.red((err as { format: () => string }).format()),
      );
      process.exitCode = 1;
      return;
    }

    // Generic errors
    if (err instanceof Error) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exitCode = 1;
      return;
    }

    console.error(chalk.red(String(err)));
    process.exitCode = 1;
  }
}
