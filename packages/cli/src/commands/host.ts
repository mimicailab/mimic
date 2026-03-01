import { Command } from 'commander';
import chalk from 'chalk';

import {
  loadConfig,
  logger,
  MimicError,
  McpServerError,
  MimicMcpServer,
  parseSchema,
  generateTools,
} from '@mimicailab/core';
import type { SchemaModel } from '@mimicailab/core';
import { resolveEnvVars } from '../utils/env.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerHostCommand(program: Command): void {
  program
    .command('host')
    .description('Start mock API server and MCP server to expose seeded data to AI agents')
    .option(
      '-t, --transport <transport>',
      'transport: stdio or sse',
      'stdio',
    )
    .option('-P, --port <number>', 'port for SSE transport', parseInt)
    .option('-p, --api-port <number>', 'port for mock API server', parseInt)
    .option('--verbose', 'enable verbose logging')
    .action(async (opts) => {
      await runHost(opts);
    });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HostOptions {
  transport?: string;
  port?: number;
  apiPort?: number;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Host logic
// ---------------------------------------------------------------------------

async function runHost(opts: HostOptions): Promise<void> {
  if (opts.verbose) {
    logger.setVerbose(true);
  }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const transport = opts.transport ?? 'stdio';
  const port = opts.port ?? 4200;

  if (transport !== 'stdio' && transport !== 'sse') {
    throw new MimicError(
      `Invalid transport "${transport}"`,
      'MCP_SERVER_ERROR',
      'Use "stdio" or "sse"',
    );
  }

  // ── Resolve database ────────────────────────────────────────────────────
  const databases = config.databases;
  if (!databases || Object.keys(databases).length === 0) {
    throw new MimicError(
      'No database configured',
      'CONFIG_INVALID',
      "Add a 'databases' section to mimic.json",
    );
  }

  const [dbName, dbConfig] = Object.entries(databases)[0]!;
  const dbUrl = resolveEnvVars((dbConfig as Record<string, unknown>).url as string);

  logger.header('mimic host');
  logger.step(`Transport: ${chalk.yellow(transport)}`);
  if (transport === 'sse') {
    logger.step(`Port: ${chalk.yellow(String(port))}`);
  }
  logger.step(`Database: ${chalk.yellow(dbName)}`);
  logger.step(`Domain: ${chalk.yellow(config.domain)}`);

  // ── Connect to PG ──────────────────────────────────────────────────────
  let pg: typeof import('pg');
  try {
    pg = await import('pg');
  } catch {
    throw new McpServerError(
      'pg module not available',
      'Ensure "pg" is installed: pnpm add pg',
    );
  }

  const pool = new pg.default.Pool({ connectionString: dbUrl });

  // Verify connectivity
  try {
    const client = await pool.connect();
    client.release();
    logger.success('Database connection verified');
  } catch (err) {
    throw new McpServerError(
      `Failed to connect to database: ${err instanceof Error ? err.message : String(err)}`,
      'Check DATABASE_URL and ensure PostgreSQL is running',
      err instanceof Error ? err : undefined,
    );
  }

  // ── Parse schema ─────────────────────────────────────────────────────────
  const schemaSpin = logger.spinner('Parsing database schema...');
  let schema: SchemaModel;
  try {
    const schemaConfig = (dbConfig as Record<string, unknown>).schema as
      | { source: 'prisma' | 'sql' | 'introspect'; path?: string }
      | undefined;
    schema = await parseSchema({ schema: schemaConfig, pool, basePath: cwd });
    schemaSpin.succeed(`Parsed schema: ${chalk.yellow(String(schema.tables.length))} tables`);
  } catch (err) {
    schemaSpin.fail('Failed to parse schema');
    await pool.end();
    throw err;
  }

  // ── Start MCP server ───────────────────────────────────────────────────
  const spin = logger.spinner('Starting MCP server...');
  let mcpServer: MimicMcpServer;

  try {
    mcpServer = new MimicMcpServer(schema, pool, config);
    await mcpServer.start(transport as 'stdio' | 'sse', port);

    spin.succeed('MCP server started');

    // ── Print connection info ──────────────────────────────────────────
    console.log();
    logger.header('Server Info');
    logger.info(`Transport: ${chalk.cyan(transport)}`);
    if (transport === 'sse') {
      logger.info(`URL: ${chalk.cyan(`http://localhost:${port}`)}`);
    }
    logger.info(`Domain: ${chalk.cyan(config.domain)}`);
    logger.info(`Personas: ${config.personas.map((p) => chalk.yellow(p.name)).join(', ')}`);

    console.log();
    logger.header('Available MCP Tools');
    const tools = generateTools(schema);
    for (const tool of tools) {
      logger.info(`${chalk.bold(tool.name)}  — ${tool.description.slice(0, 60)}`);
    }

    console.log();
    logger.header('Claude Desktop Configuration');
    if (transport === 'stdio') {
      console.log(chalk.dim('  Add to ~/.claude/claude_desktop_config.json:'));
      console.log();
      console.log(
        chalk.cyan(
          JSON.stringify(
            {
              mcpServers: {
                mimic: {
                  command: 'npx',
                  args: ['mimic', 'host', '--transport', 'stdio'],
                  cwd: process.cwd(),
                },
              },
            },
            null,
            2,
          )
            .split('\n')
            .map((line) => '  ' + line)
            .join('\n'),
        ),
      );
    } else {
      console.log(chalk.dim('  Add to ~/.claude/claude_desktop_config.json:'));
      console.log();
      console.log(
        chalk.cyan(
          JSON.stringify(
            {
              mcpServers: {
                mimic: {
                  url: `http://localhost:${port}/sse`,
                },
              },
            },
            null,
            2,
          )
            .split('\n')
            .map((line) => '  ' + line)
            .join('\n'),
        ),
      );
    }

    console.log();
    logger.info(chalk.dim('Press Ctrl+C to stop the server'));

    // ── Graceful shutdown ─────────────────────────────────────────────
    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        console.log();
        logger.step('Shutting down...');
        await mcpServer.stop();
        await pool.end();
        logger.done('Server stopped');
        resolve();
      };

      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());
    });
  } catch (err) {
    spin.fail('Failed to start MCP server');
    await pool.end();
    throw new McpServerError(
      `MCP server failed: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      err instanceof Error ? err : undefined,
    );
  }
}
