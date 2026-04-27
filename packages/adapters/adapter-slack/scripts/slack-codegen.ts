#!/usr/bin/env node
/**
 * Slack Web API (Swagger 2.0) → Mimic codegen
 *
 * Reads `slack-spec.json` (downloaded from `slackapi/slack-api-specs`) and
 * writes four TypeScript source files into `src/generated/`:
 *
 *   routes.ts          – GeneratedRoute[] for the curated Slack surface
 *   resource-specs.ts  – AdapterResourceSpecs covering Channel/Message/User/Team/File
 *   schemas.ts         – defaultXxx() factories for mock data
 *   meta.ts            – spec version + generated timestamp
 *
 * Scope: the Slack API has ~174 paths across admin, apps, sockets, workflows,
 * etc. The Briefing Agent (and most B2B agents) only needs a small subset:
 *   - auth.test, team.info
 *   - users.* (list, info, lookupByEmail, profile.get)
 *   - conversations.* (list, history, replies, info, members, open, create)
 *   - chat.* (postMessage, postEphemeral, update, delete)
 *   - reactions.* (add, remove, get, list)
 *   - pins.* (list, add, remove)
 *   - bookmarks.* (list, add, edit, remove)
 *   - files.* (list, info)
 *   - search.* (messages, files)
 *
 * `INCLUDE_PATHS` whitelists exactly these. Everything else is filtered out so
 * the route table reflects what the adapter actually implements.
 *
 * Usage:
 *   pnpm --filter @mimicai/adapter-slack generate
 *   (or: node --experimental-strip-types scripts/slack-codegen.ts)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, '..', 'slack-spec.json');
const OUT_DIR = resolve(__dirname, '..', 'src', 'generated');

// ---------------------------------------------------------------------------
// Curated Slack method whitelist — what the briefing agent needs
// ---------------------------------------------------------------------------

// Note: Slack's `slackapi/slack-api-specs` repo is stale — bookmarks.* and
// search.files are real, documented Slack methods but absent from the spec.
// They're omitted here. If/when they appear in the spec, add them back.
const INCLUDE_PATHS = new Set<string>([
  '/auth.test',
  '/team.info',
  '/users.list',
  '/users.info',
  '/users.lookupByEmail',
  '/users.profile.get',
  '/conversations.list',
  '/conversations.history',
  '/conversations.replies',
  '/conversations.info',
  '/conversations.members',
  '/conversations.open',
  '/conversations.create',
  '/chat.postMessage',
  '/chat.postEphemeral',
  '/chat.update',
  '/chat.delete',
  '/reactions.add',
  '/reactions.remove',
  '/reactions.get',
  '/reactions.list',
  '/pins.list',
  '/pins.add',
  '/pins.remove',
  '/files.list',
  '/files.info',
  '/search.messages',
]);

// ---------------------------------------------------------------------------
// Swagger 2.0 minimal types
// ---------------------------------------------------------------------------

interface SwaggerParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'formData' | 'body';
  required?: boolean;
  type?: string;
  description?: string;
}

interface SwaggerOperation {
  description?: string;
  summary?: string;
  parameters?: SwaggerParameter[];
  responses?: Record<string, { schema?: { $ref?: string } }>;
}

interface SwaggerPathItem {
  get?: SwaggerOperation;
  post?: SwaggerOperation;
  put?: SwaggerOperation;
  delete?: SwaggerOperation;
  patch?: SwaggerOperation;
}

interface SwaggerSpec {
  swagger: string;
  basePath?: string;
  paths: Record<string, SwaggerPathItem>;
  definitions: Record<string, SwaggerDefinition>;
  info?: { version?: string };
}

interface SwaggerDefinition {
  type?: string;
  description?: string;
  properties?: Record<string, SwaggerDefinition>;
  $ref?: string;
  enum?: string[];
}

// ---------------------------------------------------------------------------
// Output types (must match shapes in src/generated/* hand-written files)
// ---------------------------------------------------------------------------

type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';

interface GeneratedRoute {
  method: RouteMethod;
  fastifyPath: string;
  stripePath: string;
  resource: string;
  operation: RouteOperation;
  description: string;
  queryFilters: string[];
  idParam?: string;
  objectType?: string;
}

// ---------------------------------------------------------------------------
// Operation classification for Slack methods
//
// Slack doesn't follow REST. Every method is a verb. We classify *intent* so
// the briefing-agent and other consumers can reason about each route, but all
// route handling is done via explicit overrides — base CRUD scaffolding never
// runs for Slack routes.
// ---------------------------------------------------------------------------

function classifySlack(path: string, httpMethod: string): RouteOperation {
  if (path.endsWith('.list') || path.endsWith('.history') || path.endsWith('.replies')) return 'list';
  if (path.endsWith('.info') || path.endsWith('.get') || path.endsWith('.lookupByEmail')) return 'retrieve';
  if (path.endsWith('.create') || path.endsWith('.open') || path.endsWith('.add') || path.endsWith('.postMessage') || path.endsWith('.postEphemeral')) {
    return 'create';
  }
  if (path.endsWith('.update') || path.endsWith('.edit') || path.endsWith('.set')) return 'update';
  if (path.endsWith('.delete') || path.endsWith('.remove')) return 'delete';
  if (path.endsWith('.test')) return 'retrieve';
  // Search and everything else
  void httpMethod;
  return 'action';
}

/** Group Slack methods by their first dot segment for the `resource` field. */
function resourceFromPath(path: string): string {
  const stripped = path.startsWith('/') ? path.slice(1) : path;
  const head = stripped.split('.')[0];
  return head ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Walk paths and emit routes
// ---------------------------------------------------------------------------

function buildRoutes(spec: SwaggerSpec): GeneratedRoute[] {
  const routes: GeneratedRoute[] = [];

  for (const [path, item] of Object.entries(spec.paths)) {
    if (!INCLUDE_PATHS.has(path)) continue;

    for (const httpMethodLower of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const op = item[httpMethodLower];
      if (!op) continue;

      const method = httpMethodLower.toUpperCase() as RouteMethod;
      const queryFilters: string[] = [];
      for (const p of op.parameters ?? []) {
        if (p.in === 'query' || p.in === 'formData') {
          if (p.name !== 'token') queryFilters.push(p.name);
        }
      }

      const fastifyPath = `${spec.basePath ?? ''}${path}`; // e.g. /api/chat.postMessage
      const operation = classifySlack(path, method);

      routes.push({
        method,
        fastifyPath,
        stripePath: `${spec.basePath ?? ''}${path}`,
        resource: resourceFromPath(path),
        operation,
        description: op.description ?? op.summary ?? `${method} ${path}`,
        queryFilters,
        objectType: undefined,
      });
    }
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Resource specs (curated)
//
// Slack's spec definitions are sprawling and inconsistent. Hand-curating the
// five resources the Briefing Agent reads gives cleaner output than a naive
// walk of `definitions`.
// ---------------------------------------------------------------------------

interface ResourceSpecField {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  nullable?: boolean;
  default?: unknown;
  enum?: unknown[];
  semanticType?: string;
  description?: string;
  timestamp?: 'unix_seconds' | 'unix_ms' | 'epoch_ms' | 'iso8601';
}

interface ResourceSpec {
  objectType: string;
  volumeHint: 'reference' | 'entity';
  refs: string[];
  fields: Record<string, ResourceSpecField>;
}

const RESOURCE_SPECS: Record<string, ResourceSpec> = {
  channel: {
    objectType: 'channel',
    volumeHint: 'entity',
    refs: ['user'],
    fields: {
      id: { type: 'string', required: true, default: '' },
      name: { type: 'string', required: true, default: 'general' },
      is_channel: { type: 'boolean', required: true, default: true },
      is_group: { type: 'boolean', required: false, default: false },
      is_im: { type: 'boolean', required: false, default: false },
      is_mpim: { type: 'boolean', required: false, default: false },
      is_private: { type: 'boolean', required: false, default: false },
      is_archived: { type: 'boolean', required: false, default: false },
      is_general: { type: 'boolean', required: false, default: false },
      created: { type: 'integer', required: true, default: 0, timestamp: 'unix_seconds' },
      creator: { type: 'string', required: false, default: '' },
      num_members: { type: 'integer', required: false, default: 0 },
      topic: { type: 'object', required: false, default: null, description: 'Topic value/creator/last_set' },
      purpose: { type: 'object', required: false, default: null, description: 'Purpose value/creator/last_set' },
    },
  },
  message: {
    objectType: 'message',
    volumeHint: 'entity',
    refs: ['user', 'channel'],
    fields: {
      type: { type: 'string', required: true, default: 'message' },
      user: { type: 'string', required: false, default: '', description: 'User id of the author' },
      text: { type: 'string', required: true, default: '' },
      ts: { type: 'string', required: true, default: '', description: 'Slack message timestamp (epoch.seq)' },
      thread_ts: { type: 'string', required: false, default: '', description: 'Parent ts if this is a thread reply' },
      channel: { type: 'string', required: false, default: '' },
      reply_count: { type: 'integer', required: false, default: 0 },
      reactions: { type: 'array', required: false, default: [] },
      blocks: { type: 'array', required: false, default: [], description: 'Block Kit content' },
      attachments: { type: 'array', required: false, default: [] },
    },
  },
  user: {
    objectType: 'user',
    volumeHint: 'entity',
    refs: [],
    fields: {
      id: { type: 'string', required: true, default: '' },
      team_id: { type: 'string', required: true, default: '' },
      name: { type: 'string', required: true, default: '' },
      real_name: { type: 'string', required: false, default: '' },
      profile: {
        type: 'object',
        required: false,
        default: null,
        description: 'Display name, status, email, image URLs',
      },
      is_admin: { type: 'boolean', required: false, default: false },
      is_owner: { type: 'boolean', required: false, default: false },
      is_bot: { type: 'boolean', required: false, default: false },
      deleted: { type: 'boolean', required: false, default: false },
      tz: { type: 'string', required: false, default: 'America/Los_Angeles' },
    },
  },
  team: {
    objectType: 'team',
    volumeHint: 'reference',
    refs: [],
    fields: {
      id: { type: 'string', required: true, default: '' },
      name: { type: 'string', required: true, default: 'Acme Workspace' },
      domain: { type: 'string', required: true, default: 'acme', semanticType: 'slug' },
      email_domain: { type: 'string', required: false, default: '' },
      icon: { type: 'object', required: false, default: null },
    },
  },
  file: {
    objectType: 'file',
    volumeHint: 'entity',
    refs: ['user', 'channel'],
    fields: {
      id: { type: 'string', required: true, default: '' },
      created: { type: 'integer', required: true, default: 0, timestamp: 'unix_seconds' },
      timestamp: { type: 'integer', required: false, default: 0, timestamp: 'unix_seconds' },
      name: { type: 'string', required: true, default: '' },
      title: { type: 'string', required: false, default: '' },
      mimetype: { type: 'string', required: false, default: 'application/octet-stream' },
      filetype: { type: 'string', required: false, default: 'binary' },
      size: { type: 'integer', required: false, default: 0 },
      user: { type: 'string', required: false, default: '' },
      channels: { type: 'array', required: false, default: [] },
    },
  },
};

// ---------------------------------------------------------------------------
// Default factories — hand-curated, faithful to Slack's actual response shapes
// ---------------------------------------------------------------------------

const FACTORY_TEMPLATES: Record<string, string> = {
  channel: `
export function defaultChannel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId('C', 9).toUpperCase(),
    name: 'general',
    is_channel: true,
    is_group: false,
    is_im: false,
    is_mpim: false,
    is_private: false,
    is_archived: false,
    is_general: false,
    is_member: true,
    created: Math.floor(Date.now() / 1000),
    creator: '',
    num_members: 0,
    topic: { value: '', creator: '', last_set: 0 },
    purpose: { value: '', creator: '', last_set: 0 },
    ...overrides,
  };
}`,
  message: `
export function defaultMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const ts = (Date.now() / 1000).toFixed(6);
  return {
    type: 'message',
    user: '',
    text: '',
    ts,
    team: '',
    blocks: [],
    ...overrides,
  };
}`,
  user: `
export function defaultUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId('U', 9).toUpperCase(),
    team_id: '',
    name: 'unknown',
    real_name: 'Unknown User',
    deleted: false,
    is_admin: false,
    is_owner: false,
    is_bot: false,
    tz: 'America/Los_Angeles',
    profile: {
      real_name: 'Unknown User',
      display_name: 'unknown',
      email: 'unknown@example.com',
      image_24: 'https://placeholder.example/u24.png',
      image_72: 'https://placeholder.example/u72.png',
    },
    ...overrides,
  };
}`,
  team: `
export function defaultTeam(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId('T', 9).toUpperCase(),
    name: 'Acme Workspace',
    domain: 'acme',
    email_domain: 'acme.example',
    icon: {
      image_default: true,
      image_34: 'https://placeholder.example/t34.png',
      image_44: 'https://placeholder.example/t44.png',
      image_68: 'https://placeholder.example/t68.png',
    },
    ...overrides,
  };
}`,
  file: `
export function defaultFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: generateId('F', 9).toUpperCase(),
    created: now,
    timestamp: now,
    name: 'untitled',
    title: '',
    mimetype: 'application/octet-stream',
    filetype: 'binary',
    pretty_type: 'Binary',
    size: 0,
    user: '',
    channels: [],
    groups: [],
    ims: [],
    is_external: false,
    is_public: false,
    has_rich_preview: false,
    ...overrides,
  };
}`,
};

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const HEADER = '// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-slack generate';

function renderRoutes(routes: GeneratedRoute[]): string {
  const body = routes
    .map((r) => {
      const lines = [
        `    method: ${JSON.stringify(r.method)}`,
        `    fastifyPath: ${JSON.stringify(r.fastifyPath)}`,
        `    stripePath: ${JSON.stringify(r.stripePath)}`,
        `    resource: ${JSON.stringify(r.resource)}`,
        `    operation: ${JSON.stringify(r.operation)}`,
        `    description: ${JSON.stringify(r.description)}`,
        `    queryFilters: ${JSON.stringify(r.queryFilters)}`,
      ];
      if (r.idParam) lines.push(`    idParam: ${JSON.stringify(r.idParam)}`);
      if (r.objectType) lines.push(`    objectType: ${JSON.stringify(r.objectType)}`);
      return `  {\n${lines.map((l) => l + ',').join('\n')}\n  }`;
    })
    .join(',\n');

  return `${HEADER}

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';

export interface GeneratedRoute {
  method: RouteMethod;
  fastifyPath: string;
  /** Original Slack spec path (field name is historical across adapters) */
  stripePath: string;
  resource: string;
  operation: RouteOperation;
  description: string;
  queryFilters: string[];
  idParam?: string;
  objectType?: string;
}

export const GENERATED_ROUTES: GeneratedRoute[] = [
${body}
];
`;
}

function renderResourceSpecs(specs: Record<string, ResourceSpec>): string {
  const renderField = (f: ResourceSpecField): string => {
    const parts: string[] = [];
    parts.push(`type: ${JSON.stringify(f.type)}`);
    parts.push(`required: ${f.required}`);
    if (f.nullable) parts.push(`nullable: true`);
    if (f.default !== undefined) parts.push(`default: ${JSON.stringify(f.default)}`);
    if (f.enum) parts.push(`enum: ${JSON.stringify(f.enum)}`);
    if (f.semanticType) parts.push(`semanticType: ${JSON.stringify(f.semanticType)}`);
    if (f.timestamp) parts.push(`timestamp: ${JSON.stringify(f.timestamp)}`);
    if (f.description) parts.push(`description: ${JSON.stringify(f.description)}`);
    return `{ ${parts.join(', ')} }`;
  };

  const renderSpec = (id: string, s: ResourceSpec): string => {
    const fieldLines = Object.entries(s.fields)
      .map(([fname, f]) => `      ${JSON.stringify(fname)}: ${renderField(f)},`)
      .join('\n');
    return `    ${JSON.stringify(id)}: {
      objectType: ${JSON.stringify(s.objectType)},
      volumeHint: ${JSON.stringify(s.volumeHint)},
      refs: ${JSON.stringify(s.refs)},
      fields: {
${fieldLines}
      },
    }`;
  };

  const body = Object.entries(specs)
    .map(([id, s]) => renderSpec(id, s))
    .join(',\n');

  return `${HEADER}
import type { AdapterResourceSpecs } from '@mimicai/core';

export const slackResourceSpecs: AdapterResourceSpecs = {
  platform: {
    timestampFormat: 'unix_seconds',
    amountFormat: 'decimal_string',
  },
  resources: {
${body}
  },
};
`;
}

function renderSchemas(): string {
  const factories = Object.values(FACTORY_TEMPLATES).join('\n');

  // Routes use plural `resource` (e.g. "users") while resource-specs use
  // singular `objectType`. Key SCHEMA_DEFAULTS under both forms — paddle's
  // pattern — so `defaultFactories[route.resource]` always finds a factory.
  const mapEntries: string[] = [];
  for (const k of Object.keys(FACTORY_TEMPLATES)) {
    const fnName = `default${k.charAt(0).toUpperCase()}${k.slice(1)}`;
    mapEntries.push(`  ${JSON.stringify(k)}: ${fnName},`);
    if (!k.endsWith('s')) {
      mapEntries.push(`  ${JSON.stringify(k + 's')}: ${fnName},`);
    }
  }

  return `${HEADER}
import { generateId } from '@mimicai/adapter-sdk';
import type { DefaultFactory } from '@mimicai/adapter-sdk';

/**
 * Hand-tuned default factories. Codegen rewrites this file but the factory
 * bodies are preserved across regeneration (templates live in scripts/slack-codegen.ts).
 */
${factories}

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
${mapEntries.join('\n')}
};
`;
}

function renderMeta(version: string): string {
  return `${HEADER}
// Slack Web API spec version: ${version}
// Generated at: ${new Date().toISOString()}

export const SLACK_SPEC_VERSION = ${JSON.stringify(version)};
export const SLACK_SPEC_GENERATED_AT = ${JSON.stringify(new Date().toISOString())};
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  if (!existsSync(SPEC_PATH)) {
    throw new Error(
      `Slack spec not found at ${SPEC_PATH}\n` +
        `Download it:\n  curl -fsSL https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json -o slack-spec.json`,
    );
  }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf-8')) as SwaggerSpec;

  // 1. Routes (filtered + classified)
  const routes = buildRoutes(spec).sort(
    (a, b) =>
      a.resource.localeCompare(b.resource) ||
      a.fastifyPath.localeCompare(b.fastifyPath) ||
      a.method.localeCompare(b.method),
  );
  writeFileSync(resolve(OUT_DIR, 'routes.ts'), renderRoutes(routes), 'utf-8');

  // 2. Resource specs (hand-curated)
  writeFileSync(resolve(OUT_DIR, 'resource-specs.ts'), renderResourceSpecs(RESOURCE_SPECS), 'utf-8');

  // 3. Schemas (hand-curated factories)
  writeFileSync(resolve(OUT_DIR, 'schemas.ts'), renderSchemas(), 'utf-8');

  // 4. Meta
  const version = spec.info?.version ?? 'v2';
  writeFileSync(resolve(OUT_DIR, 'meta.ts'), renderMeta(version), 'utf-8');

  // Sanity check: every INCLUDE_PATHS entry should have produced a route
  const generated = new Set(routes.map((r) => r.stripePath.replace(spec.basePath ?? '', '')));
  const missing = [...INCLUDE_PATHS].filter((p) => !generated.has(p));
  if (missing.length > 0) {
    console.warn(`⚠ ${missing.length} curated paths not found in spec:`, missing);
  }

  console.log(`✓ Wrote ${routes.length} routes for ${Object.keys(RESOURCE_SPECS).length} resources`);
  console.log(`  routes.ts          — ${routes.length} entries`);
  console.log(`  resource-specs.ts  — ${Object.keys(RESOURCE_SPECS).length} resource specs`);
  console.log(`  schemas.ts         — ${Object.keys(FACTORY_TEMPLATES).length} factories`);
  console.log(`  meta.ts            — version ${version}`);
}

main();
