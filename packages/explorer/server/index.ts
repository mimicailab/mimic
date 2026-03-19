import { join, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { loadConfig, logger } from '@mimicai/core';
import type { MimicConfig, ApiMockAdapter, AdapterManifest } from '@mimicai/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExplorerOptions {
  port?: number;
  cwd?: string;
}

interface PersonaDataSummary {
  persona: string;
  tables: Record<string, number>;
  apis: Record<string, Record<string, number>>;
}

interface AdapterInfo {
  id: string;
  name: string;
  description: string;
  type: string;
  basePath: string;
  versions: string[];
  endpoints: Array<{ method: string; path: string; description: string }>;
  enabled: boolean;
  port?: number;
}

// ---------------------------------------------------------------------------
// Explorer Server
// ---------------------------------------------------------------------------

/** Check if a TCP port is available on localhost. */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createNetServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

/** Find the first available port starting from `startPort`. */
async function findAvailablePort(startPort: number): Promise<number> {
  for (let p = startPort; p < startPort + 20; p++) {
    if (await isPortAvailable(p)) return p;
  }
  throw new Error(`No available port found in range ${startPort}–${startPort + 19}`);
}

export async function startExplorer(options: ExplorerOptions = {}): Promise<{
  url: string;
  port: number;
  stop: () => Promise<void>;
}> {
  const port = await findAvailablePort(options.port ?? 7879);
  const cwd = options.cwd ?? process.cwd();

  const config = await loadConfig(cwd);
  const server = Fastify({ logger: false });

  await server.register(fastifyCors, { origin: true });

  // ── API routes ──────────────────────────────────────────────────────────

  // GET /_api/config
  server.get('/_api/config', async () => {
    return {
      domain: config.domain,
      personas: config.personas,
      llm: config.llm,
      apis: config.apis ?? {},
      databases: config.databases ?? {},
    };
  });

  // GET /_api/adapters
  server.get('/_api/adapters', async () => {
    return await loadAdapterInfos(config, cwd);
  });

  // GET /_api/data
  server.get('/_api/data', async () => {
    return await loadDataSummaries(config, cwd);
  });

  // GET /_api/data/:persona
  server.get<{ Params: { persona: string } }>('/_api/data/:persona', async (req) => {
    const { persona } = req.params;
    const dataPath = join(cwd, '.mimic', 'data', `${persona}.json`);
    try {
      const raw = await readFile(dataPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { persona, tables: {}, apiResponses: {}, facts: [] };
    }
  });

  // ── Serve static React build ────────────────────────────────────────────
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const clientDir = join(__dirname, '..', 'client');

  await server.register(fastifyStatic, {
    root: clientDir,
    prefix: '/',
    wildcard: false,
  });

  // SPA fallback — serve index.html for non-API routes
  server.setNotFoundHandler(async (_req, reply) => {
    return reply.sendFile('index.html', clientDir);
  });

  // ── Start ────────────────────────────────────────────────────────────────
  await server.listen({ port, host: '0.0.0.0' });

  return {
    url: `http://localhost:${port}`,
    port,
    stop: () => server.close(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadAdapterInfos(config: MimicConfig, cwd: string): Promise<AdapterInfo[]> {
  const apis = config.apis ?? {};
  const infos: AdapterInfo[] = [];

  // Calculate ports matching mimic host's assignment logic
  let nextPort = 4101;

  for (const [apiName, apiConfig] of Object.entries(apis)) {
    const cfg = apiConfig as Record<string, unknown>;
    const adapterId = (cfg.adapter as string) || apiName;
    const pkg = `@mimicai/adapter-${adapterId}`;
    const port = (cfg.port as number) ?? nextPort++;
    const enabled = cfg.enabled !== false;

    try {
      const mod = await tryImport(pkg, cwd);
      const manifest = findManifest(mod);
      const AdapterClass = findAdapterClass(mod);

      let endpoints: Array<{ method: string; path: string; description: string }> = [];
      let adapterBasePath = `/${adapterId}`;
      if (AdapterClass) {
        const adapter = new AdapterClass();
        endpoints = adapter.getEndpoints();
        adapterBasePath = adapter.basePath;
      }

      infos.push({
        id: adapterId,
        name: manifest?.name ?? adapterId,
        description: manifest?.description ?? '',
        type: manifest?.type ?? 'api-mock',
        basePath: adapterBasePath,
        versions: manifest?.versions ?? [],
        endpoints,
        enabled,
        port: enabled ? port : undefined,
      });
    } catch {
      infos.push({
        id: adapterId,
        name: adapterId,
        description: `Package ${pkg} not installed`,
        type: 'api-mock',
        basePath: `/${adapterId}`,
        versions: [],
        endpoints: [],
        enabled,
        port: enabled ? port : undefined,
      });
    }
  }

  return infos;
}

async function loadDataSummaries(config: MimicConfig, cwd: string): Promise<PersonaDataSummary[]> {
  const summaries: PersonaDataSummary[] = [];

  for (const persona of config.personas) {
    const dataPath = join(cwd, '.mimic', 'data', `${persona.name}.json`);
    try {
      const raw = await readFile(dataPath, 'utf-8');
      const data = JSON.parse(raw);

      const tables: Record<string, number> = {};
      if (data.tables) {
        for (const [name, rows] of Object.entries(data.tables)) {
          tables[name] = (rows as unknown[]).length;
        }
      }

      const apis: Record<string, Record<string, number>> = {};
      if (data.apiResponses) {
        for (const [adapterId, responseSet] of Object.entries(data.apiResponses)) {
          const rs = responseSet as { responses: Record<string, unknown[]> };
          const resources: Record<string, number> = {};
          for (const [resource, arr] of Object.entries(rs.responses)) {
            if ((arr as unknown[]).length > 0) {
              resources[resource] = (arr as unknown[]).length;
            }
          }
          if (Object.keys(resources).length > 0) {
            apis[adapterId] = resources;
          }
        }
      }

      summaries.push({ persona: persona.name, tables, apis });
    } catch {
      // No data file yet
    }
  }

  return summaries;
}

async function tryImport(pkg: string, cwd: string): Promise<Record<string, unknown>> {
  // 1. Bare specifier — works when resolvable from calling context
  try {
    return await import(/* @vite-ignore */ pkg);
  } catch {
    // fall through
  }

  // 2. Resolve from the project's node_modules
  try {
    const req = createRequire(join(cwd, 'package.json'));
    let resolved = req.resolve(pkg);
    if (resolved.endsWith('.cjs')) {
      resolved = resolved.replace(/\.cjs$/, '.js');
    }
    return await import(/* @vite-ignore */ resolved);
  } catch {
    // fall through
  }

  // 3. Resolve from @mimicai/cli's location — adapters are dependencies of
  //    the CLI package, so they're resolvable from the CLI's node_modules.
  //    This works in both real user projects (npm install @mimicai/cli) and
  //    monorepos (workspace symlinks).
  try {
    const cliEntry = createRequire(join(cwd, 'package.json')).resolve('@mimicai/cli');
    const cliDir = dirname(cliEntry);
    const req = createRequire(join(cliDir, 'package.json'));
    let resolved = req.resolve(pkg);
    if (resolved.endsWith('.cjs')) {
      resolved = resolved.replace(/\.cjs$/, '.js');
    }
    return await import(/* @vite-ignore */ resolved);
  } catch {
    // fall through
  }

  // 4. Walk up from the CLI binary (process.argv[1]) — covers pnpm
  //    workspaces where packages are hoisted to a .pnpm store.
  const startPath = process.argv[1] ?? cwd;
  let dir = dirname(startPath);
  for (let i = 0; i < 10; i++) {
    try {
      const req = createRequire(join(dir, 'package.json'));
      let resolved = req.resolve(pkg);
      if (resolved.endsWith('.cjs')) {
        resolved = resolved.replace(/\.cjs$/, '.js');
      }
      return await import(/* @vite-ignore */ resolved);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  throw new Error(`Cannot find ${pkg}`);
}

function findManifest(mod: Record<string, unknown>): AdapterManifest | undefined {
  return mod.manifest as AdapterManifest | undefined;
}

function findAdapterClass(mod: Record<string, unknown>): (new () => ApiMockAdapter) | undefined {
  return Object.values(mod).find((v) => {
    if (typeof v !== 'function') return false;
    try {
      const instance = new (v as new () => unknown)() as { type?: string };
      return instance.type === 'api-mock';
    } catch { return false; }
  }) as (new () => ApiMockAdapter) | undefined;
}
