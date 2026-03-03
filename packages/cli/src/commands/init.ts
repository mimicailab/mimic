import { Command } from 'commander';
import { input, select, checkbox, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { resolve, join } from 'node:path';
import { readFile, appendFile } from 'node:fs/promises';

import {
  fileExists,
  writeJson,
  ensureDir,
  logger,
  MimicError,
} from '@mimicai/core';
import { listBuiltinBlueprints } from '@mimicai/blueprints';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Interactive wizard to create a mimic.json configuration')
    .action(async () => {
      await runInit();
    });
}

// ---------------------------------------------------------------------------
// Init wizard
// ---------------------------------------------------------------------------

async function runInit(): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolve(cwd, 'mimic.json');

  console.log();
  console.log(
    chalk.bold('mimic init') + chalk.dim(' — set up Mimic for this project'),
  );
  console.log();

  // ── Guard: already initialised ──────────────────────────────────────────
  if (await fileExists(configPath)) {
    const overwrite = await confirm({
      message: 'mimic.json already exists. Overwrite?',
      default: false,
    });
    if (!overwrite) {
      logger.info('Aborted — existing mimic.json left untouched.');
      return;
    }
  }

  // ── Domain ──────────────────────────────────────────────────────────────
  const domain = await input({
    message: 'Describe your domain (e.g. "personal finance", "calendar scheduling"):',
    validate: (v) => (v.trim().length > 0 ? true : 'Domain description is required'),
  });

  // ── Schema source ───────────────────────────────────────────────────────
  const schemaSource = await select({
    message: 'How should Mimic read your database schema?',
    choices: [
      { name: 'Prisma schema file', value: 'prisma' as const },
      { name: 'Raw SQL DDL file', value: 'sql' as const },
      { name: 'Introspect a live database', value: 'introspect' as const },
    ],
  });

  let schemaPath: string | undefined;
  if (schemaSource === 'prisma') {
    schemaPath = await input({
      message: 'Path to your Prisma schema:',
      default: 'prisma/schema.prisma',
    });
  } else if (schemaSource === 'sql') {
    schemaPath = await input({
      message: 'Path to your SQL DDL file:',
      default: 'schema.sql',
    });
  }

  // ── Database URL ────────────────────────────────────────────────────────
  const envUrl = process.env['DATABASE_URL'];
  let databaseUrl: string;

  if (envUrl) {
    const useEnv = await confirm({
      message: `Detected $DATABASE_URL. Use it? (${maskUrl(envUrl)})`,
      default: true,
    });
    databaseUrl = useEnv ? '$DATABASE_URL' : await promptDatabaseUrl();
  } else {
    databaseUrl = await promptDatabaseUrl();
  }

  // ── Personas ────────────────────────────────────────────────────────────
  const builtins = listBuiltinBlueprints();
  const builtinChoices = builtins.map((b) => ({
    name: `${b.id} — ${b.description}`,
    value: b.id,
    checked: true,
  }));

  const selectedBuiltins = await checkbox({
    message: 'Select built-in personas to include:',
    choices: builtinChoices,
  });

  const addCustom = await confirm({
    message: 'Add a custom persona?',
    default: false,
  });

  interface PersonaEntry {
    name: string;
    description: string;
    blueprint?: string;
  }

  const personas: PersonaEntry[] = selectedBuiltins.map((id) => {
    const info = builtins.find((b) => b.id === id)!;
    return {
      name: id,
      description: info.description,
      blueprint: `builtin:${info.domain}/${id}`,
    };
  });

  if (addCustom) {
    const customName = await input({
      message: 'Persona slug (lowercase, hyphens ok):',
      validate: (v) =>
        /^[a-z0-9-]+$/.test(v.trim()) ? true : 'Must be lowercase alphanumeric with hyphens',
    });
    const customDesc = await input({
      message: 'Short description:',
      validate: (v) => (v.trim().length > 0 ? true : 'Description is required'),
    });
    personas.push({ name: customName.trim(), description: customDesc.trim() });
  }

  if (personas.length === 0) {
    throw new MimicError(
      'At least one persona is required',
      'CONFIG_INVALID',
      'Select a built-in persona or add a custom one',
    );
  }

  // ── LLM provider ───────────────────────────────────────────────────────
  const llmProvider = await select({
    message: 'LLM provider for blueprint generation:',
    choices: [
      { name: 'Anthropic (Claude)', value: 'anthropic' as const },
      { name: 'OpenAI', value: 'openai' as const },
      { name: 'Ollama (local)', value: 'ollama' as const },
      { name: 'Custom OpenAI-compatible', value: 'custom' as const },
    ],
  });

  const defaultModels: Record<string, string> = {
    anthropic: 'claude-haiku-4-5',
    openai: 'gpt-4o-mini',
    ollama: 'llama3',
    custom: 'gpt-4o-mini',
  };

  const llmModel = await input({
    message: 'Model name:',
    default: defaultModels[llmProvider],
  });

  // ── Build config ────────────────────────────────────────────────────────
  const config: Record<string, unknown> = {
    $schema: 'https://github.com/mimicailab/mimic/blob/main/packages/core/mimic.schema.json',
    domain,
    llm: {
      provider: llmProvider,
      model: llmModel,
    },
    personas,
    generate: {
      volume: '6 months',
      seed: 42,
    },
    databases: {
      default: {
        type: 'postgres',
        url: databaseUrl,
        schema: {
          source: schemaSource,
          ...(schemaPath ? { path: schemaPath } : {}),
        },
        seedStrategy: 'truncate-and-insert',
      },
    },
  };

  // ── Write files ─────────────────────────────────────────────────────────
  const spin = logger.spinner('Writing configuration...');

  try {
    // mimic.json
    await writeJson(configPath, config);

    // .mimic/ directory
    const mimicDir = join(cwd, '.mimic');
    await ensureDir(join(mimicDir, 'data'));
    await ensureDir(join(mimicDir, 'blueprints'));

    // .gitignore
    const gitignorePath = join(cwd, '.gitignore');
    if (await fileExists(gitignorePath)) {
      const content = await readFile(gitignorePath, 'utf-8');
      if (!content.includes('.mimic/')) {
        await appendFile(gitignorePath, '\n# Mimic generated data\n.mimic/\n');
        logger.debug('Appended .mimic/ to .gitignore');
      }
    }

    spin.succeed('Configuration written');
  } catch (err) {
    spin.fail('Failed to write configuration');
    throw err;
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log();
  logger.done('Mimic initialised');
  logger.info(`Config:   ${chalk.cyan(configPath)}`);
  logger.info(`Data dir: ${chalk.cyan(join(cwd, '.mimic'))}`);
  logger.info(`Personas: ${personas.map((p) => chalk.yellow(p.name)).join(', ')}`);
  console.log();
  logger.info(chalk.dim('Next steps:'));
  logger.info(`  ${chalk.bold('mimic run')}    — generate & expand blueprint data`);
  logger.info(`  ${chalk.bold('mimic seed')}   — push data to PostgreSQL`);
  logger.info(`  ${chalk.bold('mimic serve')}  — start MCP server for Claude`);
  console.log();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function promptDatabaseUrl(): Promise<string> {
  return input({
    message: 'PostgreSQL connection URL:',
    validate: (v) =>
      v.trim().startsWith('postgres') || v.trim().startsWith('$')
        ? true
        : 'Must be a PostgreSQL URL (postgres://...) or $ENV_VAR',
  });
}

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    return url.slice(0, 20) + '...';
  }
}
