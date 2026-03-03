import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import chalk from 'chalk';

import {
  loadConfig,
  logger,
  MimicError,
  McpServerError,
  MimicMcpServer,
  MockServer,
  parseSchema,
  generateTools,
} from '@mimicai/core';
import type { SchemaModel, ExpandedData, ApiMockAdapter } from '@mimicai/core';
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
    .option('--no-api', 'skip starting the mock API server')
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
  api?: boolean;
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
  const apiPort = opts.apiPort ?? 4100;

  if (transport !== 'stdio' && transport !== 'sse') {
    throw new MimicError(
      `Invalid transport "${transport}"`,
      'MCP_SERVER_ERROR',
      'Use "stdio" or "sse"',
    );
  }

  const databases = config.databases;
  const apis = config.apis;
  const hasDatabase = databases && Object.keys(databases).length > 0;
  const hasApis = opts.api !== false && apis && Object.keys(apis).length > 0;

  if (!hasDatabase && !hasApis) {
    throw new MimicError(
      'No database or API configured',
      'CONFIG_INVALID',
      "Add a 'databases' or 'apis' section to mimic.json",
    );
  }

  logger.header('mimic host');
  logger.step(`Domain: ${chalk.yellow(config.domain)}`);
  logger.step(`Personas: ${config.personas.map((p) => chalk.yellow(p.name)).join(', ')}`);

  // ── Track resources for graceful shutdown ────────────────────────────────
  let pool: import('pg').Pool | null = null;
  let mcpServer: MimicMcpServer | null = null;
  let mockServer: MockServer | null = null;

  // ── MCP Server (database) ───────────────────────────────────────────────
  if (hasDatabase) {
    const [dbName, dbConfig] = Object.entries(databases!)[0]!;
    const dbUrl = resolveEnvVars((dbConfig as Record<string, unknown>).url as string);

    logger.step(`Database: ${chalk.yellow(dbName)}`);
    logger.step(`Transport: ${chalk.yellow(transport)}`);
    if (transport === 'sse') {
      logger.step(`MCP Port: ${chalk.yellow(String(port))}`);
    }

    let pg: typeof import('pg');
    try {
      pg = await import('pg');
    } catch {
      throw new McpServerError(
        'pg module not available',
        'Ensure "pg" is installed: pnpm add pg',
      );
    }

    pool = new pg.default.Pool({ connectionString: dbUrl });

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

    const mcpSpin = logger.spinner('Starting MCP server...');
    try {
      mcpServer = new MimicMcpServer(schema, pool, config);
      await mcpServer.start(transport as 'stdio' | 'sse', port);
      mcpSpin.succeed('MCP server started');

      console.log();
      logger.header('Available MCP Tools');
      const tools = generateTools(schema);
      for (const tool of tools) {
        logger.info(`${chalk.bold(tool.name)}  — ${tool.description.slice(0, 60)}`);
      }
    } catch (err) {
      mcpSpin.fail('Failed to start MCP server');
      await pool.end();
      throw new McpServerError(
        `MCP server failed: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        err instanceof Error ? err : undefined,
      );
    }
  }

  // ── Mock API Server ─────────────────────────────────────────────────────
  if (hasApis) {
    const apiSpin = logger.spinner('Starting mock API server...');
    try {
      const dataMap = await loadPersonaDataMap(config.personas, cwd);
      mockServer = new MockServer();

      for (const [apiName, apiConfig] of Object.entries(apis!)) {
        const cfg = apiConfig as Record<string, unknown>;
        if (cfg.enabled === false) {
          logger.debug(`Adapter "${apiName}" is disabled, skipping`);
          continue;
        }
        const adapterId = cfg.adapter as string || apiName;

        let mod: Record<string, unknown>;
        const pkg = `@mimicai/adapter-${adapterId}`;
        try {
          mod = await import(/* @vite-ignore */ pkg);
        } catch {
          // ESM import resolves from CWD which may not have the adapter.
          // Walk up from the CLI binary to find a node_modules that has it.
          try {
            mod = await importFromAncestors(pkg, process.argv[1]);
          } catch {
            logger.warn(`Adapter ${pkg} not installed, skipping`);
            logger.info(`Install it with: mimic adapters add ${adapterId}`);
            continue;
          }
        }

        // Find the adapter class — instantiate to check type since 'type' is an instance property
        const AdapterClass = Object.values(mod).find((v) => {
          if (typeof v !== 'function') return false;
          try {
            const instance = new (v as new () => unknown)() as { type?: string };
            return instance.type === 'api-mock';
          } catch { return false; }
        }) as (new () => ApiMockAdapter) | undefined;

        if (!AdapterClass) {
          logger.warn(`No ApiMockAdapter found in @mimicai/adapter-${adapterId}, skipping`);
          continue;
        }

        const adapter = new AdapterClass();
        const adapterConfig = (apiConfig as Record<string, unknown>).config ?? {};
        await adapter.init(adapterConfig, { config, blueprints: new Map(), logger: console });
        await mockServer.registerAdapter(adapter, dataMap, { basePath: adapter.basePath });
      }

      await mockServer.start(apiPort);
      apiSpin.succeed(`Mock API server running on http://localhost:${apiPort}`);

      console.log();
      logger.header('Available Mock API Endpoints');
      for (const ep of mockServer.getRegisteredEndpoints()) {
        logger.info(`${chalk.bold(ep.method.padEnd(7))} ${chalk.cyan(ep.path)}  — ${ep.description}`);
      }
    } catch (err) {
      apiSpin.fail('Failed to start mock API server');
      if (mcpServer) await mcpServer.stop();
      if (pool) await pool.end();
      throw err;
    }
  }

  // ── Print connection info ─────────────────────────────────────────────
  console.log();
  if (hasDatabase && transport === 'stdio') {
    logger.header('Claude Desktop Configuration');
    console.log(chalk.dim('  Add to ~/.claude/claude_desktop_config.json:'));
    console.log();
    console.log(
      chalk.cyan(
        JSON.stringify(
          { mcpServers: { mimic: { command: 'npx', args: ['mimic', 'host', '--transport', 'stdio'], cwd: process.cwd() } } },
          null,
          2,
        ).split('\n').map((line) => '  ' + line).join('\n'),
      ),
    );
    console.log();
  } else if (hasDatabase && transport === 'sse') {
    logger.header('MCP Connection');
    logger.info(`URL: ${chalk.cyan(`http://localhost:${port}/sse`)}`);
    console.log();
  }

  logger.info(chalk.dim('Press Ctrl+C to stop the server'));

  // ── Graceful shutdown ─────────────────────────────────────────────────
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      console.log();
      logger.step('Shutting down...');
      if (mockServer) await mockServer.stop();
      if (mcpServer) await mcpServer.stop();
      if (pool) await pool.end();
      logger.done('Server stopped');
      resolve();
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadPersonaDataMap(
  personas: Array<{ name: string }>,
  cwd: string,
): Promise<Map<string, ExpandedData>> {
  const dataDir = join(cwd, '.mimic', 'data');
  const dataMap = new Map<string, ExpandedData>();

  for (const persona of personas) {
    const dataPath = join(dataDir, `${persona.name}.json`);
    try {
      const raw = await readFile(dataPath, 'utf-8');
      const data = JSON.parse(raw) as ExpandedData;
      dataMap.set(persona.name, data);
    } catch {
      logger.debug(`No data file for persona "${persona.name}" at ${dataPath}`);
    }
  }

  return dataMap;
}

/**
 * Walk up from `startPath` to find a node_modules that can resolve `pkg`.
 * Works in pnpm workspaces where the adapter symlink lives in the monorepo root.
 */
async function importFromAncestors(pkg: string, startPath: string): Promise<Record<string, unknown>> {
  let dir = join(startPath, '..');
  for (let i = 0; i < 10; i++) {
    try {
      const require = createRequire(join(dir, 'package.json'));
      const resolved = require.resolve(pkg);
      return await import(/* @vite-ignore */ resolved) as Record<string, unknown>;
    } catch {
      const parent = join(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(`Cannot find ${pkg}`);
}
