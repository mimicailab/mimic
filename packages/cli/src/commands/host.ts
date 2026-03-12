import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
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
import { importFromProject, importFromAncestors } from '../utils/import.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerHostCommand(program: Command): void {
  program
    .command('host')
    .description('Start mock API server and MCP server to expose seeded data to AI agents')
    .option('--mcp-base-port <number>', 'starting port for MCP SSE servers (default: 4201)', parseInt)
    .option('--api-base-port <number>', 'starting port for mock API servers (default: 4101)', parseInt)
    .option('--no-api', 'skip starting mock API servers')
    .option('--verbose', 'enable verbose logging')
    .action(async (opts) => {
      await runHost(opts);
    });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HostOptions {
  mcpBasePort?: number;
  apiBasePort?: number;
  api?: boolean;
  verbose?: boolean;
}

/** Tracks a running server pair (MCP + optional mock API) for shutdown. */
interface ServerInstance {
  name: string;
  type: 'database' | 'adapter';
  mcpServer: MimicMcpServer;
  mcpPort: number;
  mockServer?: MockServer;
  apiPort?: number;
  pool?: import('pg').Pool;
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

  const databases = config.databases;
  const apis = config.apis;
  const hasDatabase = databases && Object.keys(databases).length > 0;
  const hasApis = opts.api !== false && apis && Object.keys(apis).length > 0;
  const totalServers =
    (hasDatabase ? Object.keys(databases!).length : 0) +
    (hasApis ? Object.entries(apis!).filter(([, v]) => (v as Record<string, unknown>).enabled !== false).length : 0);

  if (!hasDatabase && !hasApis) {
    throw new MimicError(
      'No database or API configured',
      'CONFIG_INVALID',
      "Add a 'databases' or 'apis' section to mimic.json",
    );
  }

  // Auto-detect transport: stdio for single server, SSE for multiple
  const transport: 'stdio' | 'sse' = totalServers > 1 ? 'sse' : 'stdio';

  const mcpBasePort = opts.mcpBasePort ?? 4201;
  const apiBasePort = opts.apiBasePort ?? 4101;

  // Always clean up ports before starting host so repeated runs don't fail
  // with EADDRINUSE when previous sessions were not shut down cleanly.
  cleanupHostPorts({
    transport,
    totalServers,
    hasApis: Boolean(hasApis),
    apiCount: hasApis ? Object.entries(apis!).filter(([, v]) => (v as Record<string, unknown>).enabled !== false).length : 0,
    mcpBasePort,
    apiBasePort,
  });

  logger.header('mimic host');
  logger.step(`Domain: ${chalk.yellow(config.domain)}`);
  logger.step(`Personas: ${config.personas.map((p) => chalk.yellow(p.name)).join(', ')}`);
  logger.step(`Transport: ${chalk.yellow(transport)}`);
  logger.step(`Servers: ${chalk.yellow(String(totalServers))} (1 MCP per database/adapter)`);

  // ── Track all server instances for graceful shutdown ──────────────────
  const instances: ServerInstance[] = [];
  let nextMcpPort = mcpBasePort;
  let nextApiPort = apiBasePort;

  // Pre-load persona data (shared across adapters)
  let dataMap: Map<string, ExpandedData> | null = null;
  if (hasApis) {
    dataMap = await loadPersonaDataMap(config.personas, cwd);
  }

  // ── 1. Spin up one MCP server per database ─────────────────────────────
  if (hasDatabase) {
    let pg: typeof import('pg');
    try {
      pg = await import('pg');
    } catch {
      throw new McpServerError(
        'pg module not available',
        'Ensure "pg" is installed: pnpm add pg',
      );
    }

    for (const [dbName, dbConfig] of Object.entries(databases!)) {
      const cfg = dbConfig as Record<string, unknown>;
      const dbUrl = resolveEnvVars(cfg.url as string);
      const mcpPort = nextMcpPort++;

      logger.step(`Database ${chalk.yellow(dbName)}: connecting...`);

      const pool = new pg.default.Pool({ connectionString: dbUrl });

      try {
        const client = await pool.connect();
        client.release();
        logger.success(`Database ${chalk.yellow(dbName)} connection verified`);
      } catch (err) {
        await pool.end();
        throw new McpServerError(
          `Failed to connect to database "${dbName}": ${err instanceof Error ? err.message : String(err)}`,
          'Check DATABASE_URL and ensure PostgreSQL is running',
          err instanceof Error ? err : undefined,
        );
      }

      const schemaSpin = logger.spinner(`Parsing schema for ${dbName}...`);
      let schema: SchemaModel;
      try {
        const schemaConfig = cfg.schema as
          | { source: 'prisma' | 'sql' | 'introspect'; path?: string }
          | undefined;
        schema = await parseSchema({ schema: schemaConfig, pool, basePath: cwd });
        schemaSpin.succeed(`${chalk.yellow(dbName)}: ${schema.tables.length} tables`);
      } catch (err) {
        schemaSpin.fail(`Failed to parse schema for ${dbName}`);
        await pool.end();
        throw err;
      }

      try {
        const mcpServer = new MimicMcpServer(schema, pool, config);

        if (transport === 'sse') {
          await mcpServer.start('sse', mcpPort);
        } else {
          await mcpServer.start('stdio');
        }

        instances.push({ name: dbName, type: 'database', mcpServer, mcpPort, pool });
        logger.success(`${chalk.yellow(dbName)} MCP server on :${mcpPort}`);
      } catch (err) {
        await pool.end();
        throw new McpServerError(
          `MCP server for "${dbName}" failed: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          err instanceof Error ? err : undefined,
        );
      }
    }
  }

  // ── 2. Spin up one mock API + MCP server per adapter ───────────────────
  if (hasApis) {
    for (const [apiName, apiConfig] of Object.entries(apis!)) {
      const cfg = apiConfig as Record<string, unknown>;
      if (cfg.enabled === false) {
        logger.debug(`Adapter "${apiName}" is disabled, skipping`);
        continue;
      }

      const adapterId = (cfg.adapter as string) || apiName;
      const mcpPort = nextMcpPort++;
      const apiPort = nextApiPort++;

      // ── Load adapter module ──────────────────────────────────────────
      let mod: Record<string, unknown>;
      const pkg = `@mimicai/adapter-${adapterId}`;
      try {
        mod = await importFromProject(pkg, process.cwd());
      } catch {
        try {
          mod = await importFromAncestors(pkg, process.argv[1]);
        } catch {
          logger.warn(`Adapter ${pkg} not installed, skipping`);
          logger.info(`Install it with: mimic adapters add ${adapterId}`);
          continue;
        }
      }

      const AdapterClass = Object.values(mod).find((v) => {
        if (typeof v !== 'function') return false;
        try {
          const instance = new (v as new () => unknown)() as { type?: string };
          return instance.type === 'api-mock';
        } catch { return false; }
      }) as (new () => ApiMockAdapter) | undefined;

      if (!AdapterClass) {
        logger.warn(`No ApiMockAdapter found in ${pkg}, skipping`);
        continue;
      }

      // ── Start mock API server for this adapter ───────────────────────
      const adapter = new AdapterClass();
      const adapterConfig = cfg.config ?? {};
      await adapter.init(adapterConfig, { config, blueprints: new Map(), logger: console });

      const mockServer = new MockServer();
      await mockServer.registerAdapter(adapter, dataMap!, { basePath: adapter.basePath });
      await mockServer.start(apiPort);

      // ── Create MCP server with this adapter's tools ──────────────────
      const mcpServer = new MimicMcpServer(undefined, undefined, config);
      const mockBaseUrl = `http://localhost:${apiPort}`;

      if (cfg.mcp && typeof adapter.registerMcpTools === 'function') {
        mcpServer.registerExternalTools((srv) => adapter.registerMcpTools!(srv, mockBaseUrl));
      }

      if (transport === 'sse') {
        await mcpServer.start('sse', mcpPort);
      } else {
        await mcpServer.start('stdio');
      }

      instances.push({ name: apiName, type: 'adapter', mcpServer, mcpPort, mockServer, apiPort });
      logger.success(`${chalk.yellow(apiName)} → API :${apiPort} | MCP :${mcpPort}`);
    }
  }

  // ── Print connection summary ─────────────────────────────────────────────
  console.log();
  logger.header('MCP Servers');
  console.log();

  const mcpServersConfig: Record<string, { url: string; type: string }> = {};

  for (const inst of instances) {
    const url = transport === 'sse'
      ? `http://localhost:${inst.mcpPort}/sse`
      : 'stdio';
    const typeLabel = inst.type === 'database' ? 'database' : 'adapter';
    const portInfo = inst.apiPort
      ? `MCP :${inst.mcpPort} | API :${inst.apiPort}`
      : `MCP :${inst.mcpPort}`;

    logger.info(`  ${chalk.bold(inst.name.padEnd(14))} ${chalk.cyan(portInfo)}  (${typeLabel})`);
    mcpServersConfig[inst.name] = { url, type: typeLabel };
  }

  console.log();
  logger.header('Agent Configuration');
  console.log(chalk.dim('  MCP server endpoints:'));
  console.log();
  console.log(
    chalk.cyan(
      JSON.stringify(mcpServersConfig, null, 2)
        .split('\n')
        .map((line) => '  ' + line)
        .join('\n'),
    ),
  );
  console.log();

  logger.info(chalk.dim('Press Ctrl+C to stop all servers'));

  // ── Graceful shutdown ────────────────────────────────────────────────────
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      console.log();
      logger.step('Shutting down...');
      for (const inst of instances) {
        if (inst.mockServer) await inst.mockServer.stop();
        await inst.mcpServer.stop();
        if (inst.pool) await inst.pool.end();
      }
      logger.done('All servers stopped');
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

function cleanupHostPorts(input: {
  transport: 'stdio' | 'sse';
  totalServers: number;
  hasApis: boolean;
  apiCount: number;
  mcpBasePort: number;
  apiBasePort: number;
}): void {
  const ports = new Set<number>();

  // In SSE mode each server gets a dedicated MCP HTTP port.
  if (input.transport === 'sse') {
    for (let i = 0; i < input.totalServers; i++) {
      ports.add(input.mcpBasePort + i);
    }
  }

  // Each enabled API adapter gets a mock API port.
  if (input.hasApis) {
    for (let i = 0; i < input.apiCount; i++) {
      ports.add(input.apiBasePort + i);
    }
  }

  if (ports.size === 0) return;

  const sorted = [...ports].sort((a, b) => a - b);
  const killedPids = new Set<number>();

  for (const port of sorted) {
    let output = '';
    try {
      // macOS/Linux: list listeners on a TCP port.
      output = execSync(`lsof -nP -ti tcp:${port}`, { encoding: 'utf8' }).trim();
    } catch {
      continue;
    }
    if (!output) continue;

    const pids = output
      .split('\n')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isInteger(v) && v > 0 && v !== process.pid);

    for (const pid of pids) {
      if (killedPids.has(pid)) continue;
      try {
        process.kill(pid, 'SIGKILL');
        killedPids.add(pid);
      } catch {
        // Process may have exited between lookup and kill.
      }
    }
  }

  if (killedPids.size > 0) {
    logger.debug(
      `Cleaned up ${killedPids.size} existing process(es) on host ports: ${sorted.join(', ')}`,
    );
  }
}

