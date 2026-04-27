#!/usr/bin/env node
/**
 * Granola API (OpenAPI 3.1) → Mimic codegen
 *
 * Reads `granola-spec.json` (downloaded from
 * https://docs.granola.ai/api-reference/openapi.json) and writes four
 * TypeScript source files into `src/generated/`:
 *
 *   routes.ts          – GeneratedRoute[] (3 routes — full coverage)
 *   resource-specs.ts  – AdapterResourceSpecs for Note + Folder + sub-types
 *   schemas.ts         – defaultXxx() factories for mock data
 *   meta.ts            – spec version + generated timestamp
 *
 * Granola's public API is intentionally tiny — read-only access to meeting
 * notes plus workspace folders. The adapter implements all 3 spec endpoints
 * via overrides because (a) the list response uses the `{ notes, hasMore,
 * cursor }` shape (not a base-class default), and (b) `?include=transcript`
 * toggles a heavy field on the single-note response.
 *
 * Usage:
 *   pnpm --filter @mimicai/adapter-granola generate
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, '..', 'granola-spec.json');
const OUT_DIR = resolve(__dirname, '..', 'src', 'generated');

// ---------------------------------------------------------------------------
// OpenAPI 3.1 minimal types
// ---------------------------------------------------------------------------

interface OaParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
  schema?: { type?: string };
}

interface OaOperation {
  summary?: string;
  description?: string;
  parameters?: OaParameter[];
}

interface OaPathItem {
  get?: OaOperation;
  post?: OaOperation;
  put?: OaOperation;
  patch?: OaOperation;
  delete?: OaOperation;
}

interface OaSpec {
  openapi: string;
  info?: { title?: string; version?: string };
  paths: Record<string, OaPathItem>;
  components?: { schemas?: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Output route shape
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
// Path → resource mapping
// ---------------------------------------------------------------------------

function classifyPath(path: string): { resource: string; objectType: string; idParam?: string } {
  if (path === '/v1/folders') return { resource: 'folders', objectType: 'folder' };
  if (path === '/v1/notes') return { resource: 'notes', objectType: 'note' };
  if (path === '/v1/notes/{note_id}') return { resource: 'notes', objectType: 'note', idParam: 'note_id' };
  return { resource: 'unknown', objectType: 'unknown' };
}

function classifyOperation(path: string, method: RouteMethod): RouteOperation {
  const last = path.split('/').filter(Boolean).pop() ?? '';
  const lastIsParam = last.startsWith('{');

  if (method === 'GET') return lastIsParam ? 'retrieve' : 'list';
  if (method === 'POST') return 'create';
  if (method === 'PATCH' || method === 'PUT') return 'update';
  if (method === 'DELETE') return 'delete';
  return 'action';
}

// ---------------------------------------------------------------------------
// Route extraction
// ---------------------------------------------------------------------------

const HTTP_METHODS: RouteMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function buildRoutes(spec: OaSpec): GeneratedRoute[] {
  const routes: GeneratedRoute[] = [];

  for (const [path, item] of Object.entries(spec.paths)) {
    const ctx = classifyPath(path);
    const fastifyPath = path.replace(/\{([^}]+)\}/g, ':$1');

    for (const method of HTTP_METHODS) {
      const op = item[method.toLowerCase() as Lowercase<RouteMethod>];
      if (!op) continue;

      const operation = classifyOperation(path, method);
      const queryFilters = (op.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name);

      routes.push({
        method,
        fastifyPath,
        stripePath: path,
        resource: ctx.resource,
        operation,
        description: op.summary ?? op.description?.split('\n')[0] ?? `${method} ${path}`,
        queryFilters,
        idParam: ctx.idParam,
        objectType: ctx.objectType,
      });
    }
  }

  return routes.sort(
    (a, b) =>
      a.resource.localeCompare(b.resource) ||
      a.fastifyPath.localeCompare(b.fastifyPath) ||
      a.method.localeCompare(b.method),
  );
}

// ---------------------------------------------------------------------------
// Resource specs (hand-curated)
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
  note: {
    objectType: 'note',
    volumeHint: 'entity',
    refs: ['user', 'folder', 'calendar_event'],
    fields: {
      id: { type: 'string', required: true, default: '' },
      object: { type: 'string', required: true, default: 'note', enum: ['note'] },
      title: { type: 'string', required: false, nullable: true, default: null },
      owner: { type: 'object', required: true, default: null, description: 'User who owns the note' },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
      updated_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
      web_url: { type: 'string', required: false, default: '', semanticType: 'url' },
      calendar_event: { type: 'object', required: false, nullable: true, default: null },
      summary: { type: 'string', required: false, nullable: true, default: null },
      transcript: { type: 'array', required: false, default: [], description: 'Only present when ?include=transcript' },
      folder_id: { type: 'string', required: false, nullable: true, default: null },
    },
  },
  folder: {
    objectType: 'folder',
    volumeHint: 'reference',
    refs: ['folder'],
    fields: {
      id: { type: 'string', required: true, default: '' },
      object: { type: 'string', required: true, default: 'folder', enum: ['folder'] },
      name: { type: 'string', required: true, default: '' },
      parent_folder_id: { type: 'string', required: false, nullable: true, default: null },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
  user: {
    objectType: 'user',
    volumeHint: 'reference',
    refs: [],
    fields: {
      id: { type: 'string', required: false, default: '' },
      name: { type: 'string', required: true, default: '' },
      email: { type: 'string', required: true, default: '', semanticType: 'email' },
    },
  },
  calendar_event: {
    objectType: 'calendar_event',
    volumeHint: 'entity',
    refs: ['user'],
    fields: {
      id: { type: 'string', required: false, default: '' },
      title: { type: 'string', required: false, default: '' },
      start_time: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
      end_time: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
      invitees: { type: 'array', required: false, default: [] },
    },
  },
  transcript_entry: {
    objectType: 'transcript_entry',
    volumeHint: 'entity',
    refs: [],
    fields: {
      speaker: { type: 'object', required: true, default: null },
      text: { type: 'string', required: true, default: '' },
      start_time: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
      end_time: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
};

// ---------------------------------------------------------------------------
// Default factories
// ---------------------------------------------------------------------------

const FACTORY_TEMPLATES: Record<string, string> = {
  note: `
export function defaultNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    id: (o.id as string) ?? \`not_\${generateId('', 14)}\`,
    object: 'note',
    title: (o.title as string | null | undefined) ?? null,
    owner: (o.owner as Record<string, unknown> | null) ?? null,
    created_at: (o.created_at as string) ?? now,
    updated_at: (o.updated_at as string) ?? now,
    web_url: (o.web_url as string) ?? \`https://notes.granola.ai/d/\${(o.id as string) ?? generateId('', 14)}\`,
    calendar_event: (o.calendar_event as Record<string, unknown> | null) ?? null,
    summary: (o.summary as string | null | undefined) ?? null,
    transcript: (o.transcript as unknown[]) ?? [],
    folder_id: (o.folder_id as string | null | undefined) ?? null,
    ...overrides,
  };
}`,
  folder: `
export function defaultFolder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    id: (o.id as string) ?? \`fol_\${generateId('', 14)}\`,
    object: 'folder',
    name: (o.name as string) ?? 'Untitled folder',
    parent_folder_id: (o.parent_folder_id as string | null | undefined) ?? null,
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}`,
};

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const HEADER = '// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-granola generate';

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
  /** Original Granola spec path (field name is historical across adapters) */
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

export const granolaResourceSpecs: AdapterResourceSpecs = {
  platform: {
    timestampFormat: 'iso8601',
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

  // Map both objectType and route.resource to the same factory.
  const map = new Map<string, string>([
    ['note', 'defaultNote'],
    ['notes', 'defaultNote'],
    ['folder', 'defaultFolder'],
    ['folders', 'defaultFolder'],
  ]);

  const mapEntries = [...map.entries()]
    .map(([k, fn]) => `  ${JSON.stringify(k)}: ${fn},`)
    .join('\n');

  return `${HEADER}
import { generateId } from '@mimicai/adapter-sdk';
import type { DefaultFactory } from '@mimicai/adapter-sdk';

/**
 * Hand-tuned default factories. Granola IDs use prefixes \`not_\` (notes)
 * and \`fol_\` (folders), each followed by 14 alphanumeric chars.
 */
${factories}

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
${mapEntries}
};
`;
}

function renderMeta(version: string): string {
  return `${HEADER}
// Granola API spec version: ${version}
// Generated at: ${new Date().toISOString()}

export const GRANOLA_SPEC_VERSION = ${JSON.stringify(version)};
export const GRANOLA_SPEC_GENERATED_AT = ${JSON.stringify(new Date().toISOString())};
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  if (!existsSync(SPEC_PATH)) {
    throw new Error(
      `Granola spec not found at ${SPEC_PATH}\n` +
        `Download it:\n  curl -fsSL https://docs.granola.ai/api-reference/openapi.json -o granola-spec.json`,
    );
  }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf-8')) as OaSpec;

  const routes = buildRoutes(spec);
  writeFileSync(resolve(OUT_DIR, 'routes.ts'), renderRoutes(routes), 'utf-8');
  writeFileSync(resolve(OUT_DIR, 'resource-specs.ts'), renderResourceSpecs(RESOURCE_SPECS), 'utf-8');
  writeFileSync(resolve(OUT_DIR, 'schemas.ts'), renderSchemas(), 'utf-8');
  const version = spec.info?.version ?? 'v1';
  writeFileSync(resolve(OUT_DIR, 'meta.ts'), renderMeta(version), 'utf-8');

  const unknownPaths = routes.filter((r) => r.resource === 'unknown');
  if (unknownPaths.length > 0) {
    console.warn(`⚠ ${unknownPaths.length} routes fell into 'unknown' bucket:`);
    for (const r of unknownPaths) console.warn(`  ${r.method} ${r.stripePath}`);
  }

  console.log(`✓ Wrote ${routes.length} routes for ${Object.keys(RESOURCE_SPECS).length} resource specs`);
  for (const r of routes) console.log(`  ${r.method.padEnd(6)} ${r.fastifyPath} (${r.operation})`);
}

main();
