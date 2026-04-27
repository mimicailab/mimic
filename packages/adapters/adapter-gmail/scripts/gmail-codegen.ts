#!/usr/bin/env node
/**
 * Gmail Discovery doc → Mimic codegen
 *
 * Reads the Gmail Discovery doc (`gmail-discovery.json`, downloaded from
 * `https://gmail.googleapis.com/$discovery/rest?version=v1`) and writes four
 * TypeScript source files into `src/generated/`:
 *
 *   routes.ts          – GeneratedRoute[] for all Gmail v1 routes
 *   resource-specs.ts  – AdapterResourceSpecs covering Message/Thread/Label/Draft/Profile
 *   schemas.ts         – defaultXxx() factories for mock data
 *   meta.ts            – spec revision + generated timestamp
 *
 * Scope: messages / threads / labels / drafts / history / profile / watch / stop.
 * Settings (vacation, IMAP/POP, filters, sendAs, delegates, CSE) are deferred per
 * issue #150 and excluded by `RESOURCE_SKIP`.
 *
 * Usage:
 *   pnpm --filter @mimicai/adapter-gmail generate
 *   (or: node --experimental-strip-types scripts/gmail-codegen.ts)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, '..', 'gmail-discovery.json');
const OUT_DIR = resolve(__dirname, '..', 'src', 'generated');

// ---------------------------------------------------------------------------
// Discovery types (minimal — what we read)
// ---------------------------------------------------------------------------

interface DiscoverySchema {
  id?: string;
  type?: string;
  description?: string;
  properties?: Record<string, DiscoverySchema>;
  items?: DiscoverySchema;
  enum?: string[];
  format?: string;
  $ref?: string;
}

interface DiscoveryParameter {
  type?: string;
  description?: string;
  required?: boolean;
  location?: 'path' | 'query';
  format?: string;
  enum?: string[];
  default?: string;
}

interface DiscoveryMethod {
  id?: string;
  description?: string;
  httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path?: string;
  flatPath?: string;
  parameters?: Record<string, DiscoveryParameter>;
  parameterOrder?: string[];
  request?: { $ref: string };
  response?: { $ref: string };
}

interface DiscoveryResource {
  methods?: Record<string, DiscoveryMethod>;
  resources?: Record<string, DiscoveryResource>;
}

interface DiscoveryDoc {
  name: string;
  version: string;
  revision: string;
  schemas: Record<string, DiscoverySchema>;
  resources: Record<string, DiscoveryResource>;
}

// ---------------------------------------------------------------------------
// Scope filter — settings are deferred for the MVP
// ---------------------------------------------------------------------------

/** Resource paths (dot-joined) to skip. Anything starting with one of these is skipped. */
const RESOURCE_SKIP = ['users.settings'];

function isSkipped(path: string): boolean {
  return RESOURCE_SKIP.some((p) => path === p || path.startsWith(p + '.'));
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
// Path / operation derivation
// ---------------------------------------------------------------------------

/** Convert Discovery path "gmail/v1/users/{userId}/messages/{id}" → "/gmail/v1/users/:userId/messages/:id". */
function toFastifyPath(p: string): string {
  return '/' + p.replace(/\{([^}]+)\}/g, ':$1');
}

/** Strip leading slash and convert to spec-compatible form for traceability. */
function toStripePath(p: string): string {
  return '/' + p;
}

/** Last path segment minus any param braces, used to detect verb endpoints. */
function lastSegment(path: string): string {
  const segs = path.split('/').filter(Boolean);
  return segs[segs.length - 1] ?? '';
}

/** Extract the `:idParam` for an item-targeted route (last `{xxx}` segment). */
function extractIdParam(path: string): string | undefined {
  const matches = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  // The userId is always the path scope, never the resource id.
  const ids = matches.filter((m) => m !== 'userId');
  return ids.length > 0 ? ids[ids.length - 1] : undefined;
}

/** Verbs that always indicate an action route, even when the path looks like a collection. */
const ACTION_VERBS = new Set([
  'send',
  'modify',
  'trash',
  'untrash',
  'watch',
  'stop',
  'batchModify',
  'batchDelete',
  'import',
  'insert',
  'verify',
  'enable',
  'disable',
  'obliterate',
  'setDefault',
]);

/** Determine the CRUD/action classification for a Discovery method. */
function classify(method: DiscoveryMethod): RouteOperation {
  const path = method.flatPath ?? method.path ?? '';
  const last = lastSegment(path);
  const lastIsParam = last.startsWith('{') && last.endsWith('}');

  if (ACTION_VERBS.has(last)) return 'action';

  switch (method.httpMethod) {
    case 'GET':
      return lastIsParam ? 'retrieve' : 'list';
    case 'POST':
      // POST to a collection is create; POST to a verb is action (handled above).
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return 'action';
  }
}

/** "Message" → "message", "ListMessagesResponse" → "message", etc. */
function refToObjectType(ref?: string): string | undefined {
  if (!ref) return undefined;
  // Common Google list responses: ListMessagesResponse, ListThreadsResponse, ...
  const listMatch = ref.match(/^List(.+?)(Response)?$/);
  if (listMatch && listMatch[1]) {
    const stem = listMatch[1].replace(/s$/, '');
    return stem.charAt(0).toLowerCase() + stem.slice(1);
  }
  return ref.charAt(0).toLowerCase() + ref.slice(1);
}

/** Determine the resource the route addresses (innermost resource in dotted path). */
function resourceFromPath(dotPath: string): string {
  // dotPath like "users.messages.attachments" → "attachments"
  const segs = dotPath.split('.');
  return segs[segs.length - 1] ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Walk Discovery resources and emit routes
// ---------------------------------------------------------------------------

function walkResources(
  resources: Record<string, DiscoveryResource>,
  prefix: string,
  out: GeneratedRoute[],
): void {
  for (const [name, r] of Object.entries(resources)) {
    const dotPath = prefix ? `${prefix}.${name}` : name;
    if (isSkipped(dotPath)) continue;

    if (r.methods) {
      for (const [methodName, m] of Object.entries(r.methods)) {
        const httpPath = m.flatPath ?? m.path ?? '';
        if (!httpPath) continue;

        const operation = classify(m);
        const queryFilters: string[] = [];
        let idParam: string | undefined = extractIdParam(httpPath);

        if (m.parameters) {
          for (const [pName, pVal] of Object.entries(m.parameters)) {
            if (pVal.location === 'query') queryFilters.push(pName);
          }
        }

        const objectType = refToObjectType(m.response?.$ref);
        const description = m.description ?? `${methodName} ${dotPath}`;

        out.push({
          method: m.httpMethod,
          fastifyPath: toFastifyPath(httpPath),
          stripePath: toStripePath(httpPath),
          resource: resourceFromPath(dotPath),
          operation,
          description,
          queryFilters,
          idParam,
          objectType,
        });
      }
    }

    if (r.resources) walkResources(r.resources, dotPath, out);
  }
}

// ---------------------------------------------------------------------------
// Resource specs (field metadata)
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
  auto?: boolean;
}

interface ResourceSpec {
  objectType: string;
  volumeHint: 'reference' | 'entity';
  refs: string[];
  fields: Record<string, ResourceSpecField>;
}

interface ResourceDef {
  schemaName: string;
  objectType: string;
  volumeHint: 'reference' | 'entity';
  refs: string[];
  /** Optional: override factory body shape (handled inline in renderSchemas). */
}

const RESOURCES_TO_SPEC: ResourceDef[] = [
  { schemaName: 'Message', objectType: 'message', volumeHint: 'entity', refs: ['thread', 'label'] },
  { schemaName: 'Thread', objectType: 'thread', volumeHint: 'entity', refs: ['message'] },
  { schemaName: 'Label', objectType: 'label', volumeHint: 'reference', refs: [] },
  { schemaName: 'Draft', objectType: 'draft', volumeHint: 'entity', refs: ['message'] },
  { schemaName: 'Profile', objectType: 'profile', volumeHint: 'reference', refs: [] },
];

/** Map a Discovery property to a ResourceSpecField (best-effort). */
function fieldSpec(name: string, prop: DiscoverySchema, requiredSet: Set<string>): ResourceSpecField {
  const type = mapDiscoveryType(prop);
  const isRequired = requiredSet.has(name);

  const out: ResourceSpecField = {
    type,
    required: isRequired,
    description: prop.description,
  };

  if (prop.enum && prop.enum.length > 0) {
    out.enum = prop.enum.slice();
    if (prop.enum[0] !== undefined) out.default = prop.enum[0];
  }

  // Timestamp heuristic: int64-format strings whose name ends in "Date" or is "internalDate".
  if (prop.format === 'int64' && (name === 'internalDate' || name.endsWith('Date'))) {
    out.timestamp = 'unix_ms';
  }

  if (name === 'emailAddress' || name.endsWith('Email')) out.semanticType = 'email';
  if (name === 'historyId') out.semanticType = 'platform_id';

  // Defaults
  if (out.default === undefined) {
    if (type === 'string') out.default = '';
    else if (type === 'integer' || type === 'number') out.default = 0;
    else if (type === 'boolean') out.default = false;
    else if (type === 'array') out.default = [];
    else if (type === 'object') out.default = null;
  }

  return out;
}

function mapDiscoveryType(prop: DiscoverySchema): ResourceSpecField['type'] {
  if (prop.$ref) return 'object';
  switch (prop.type) {
    case 'integer':
      return 'integer';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    case 'string':
    default:
      return 'string';
  }
}

function buildResourceSpec(def: ResourceDef, schemas: Record<string, DiscoverySchema>): ResourceSpec {
  const schema = schemas[def.schemaName];
  if (!schema || !schema.properties) {
    throw new Error(`Schema ${def.schemaName} missing or has no properties`);
  }
  const requiredSet = new Set<string>(); // Discovery doesn't mark required at field level for these
  const fields: Record<string, ResourceSpecField> = {};
  for (const [pName, pVal] of Object.entries(schema.properties)) {
    fields[pName] = fieldSpec(pName, pVal, requiredSet);
  }
  return {
    objectType: def.objectType,
    volumeHint: def.volumeHint,
    refs: def.refs,
    fields,
  };
}

// ---------------------------------------------------------------------------
// Default factories — hand-tuned per resource so seeded data is realistic.
// (Auto-generation from Discovery yields too-loose defaults; we curate here.)
// ---------------------------------------------------------------------------

const FACTORY_TEMPLATES: Record<string, string> = {
  message: `
export function defaultMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = generateId('m', 16);
  const now = Date.now();
  return {
    id,
    threadId: id,
    labelIds: ['INBOX', 'UNREAD'],
    snippet: '',
    historyId: String(now),
    internalDate: String(now),
    sizeEstimate: 0,
    payload: {
      partId: '',
      mimeType: 'text/plain',
      filename: '',
      headers: [],
      body: { size: 0, data: '' },
      parts: [],
    },
    raw: '',
    classificationLabelValues: [],
    ...overrides,
  };
}`,
  thread: `
export function defaultThread(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId('t', 16),
    snippet: '',
    historyId: String(Date.now()),
    messages: [],
    ...overrides,
  };
}`,
  label: `
export function defaultLabel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId('Label', 12),
    name: 'New Label',
    type: 'user',
    messageListVisibility: 'show',
    labelListVisibility: 'labelShow',
    messagesTotal: 0,
    messagesUnread: 0,
    threadsTotal: 0,
    threadsUnread: 0,
    color: undefined,
    ...overrides,
  };
}`,
  draft: `
export function defaultDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId('r', 18),
    message: defaultMessage({ labelIds: ['DRAFT'] }),
    ...overrides,
  };
}`,
  profile: `
export function defaultProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    emailAddress: 'user@example.com',
    messagesTotal: 0,
    threadsTotal: 0,
    historyId: String(Date.now()),
    ...overrides,
  };
}`,
};

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const HEADER = '// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-gmail generate';

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
  /** Original Gmail spec path (field name is historical across adapters) */
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
    if (f.auto) parts.push(`auto: true`);
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

export const gmailResourceSpecs: AdapterResourceSpecs = {
  platform: {
    timestampFormat: 'unix_ms',
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

  // Routes use plural `resource` (e.g. "labels") while resource-specs use
  // singular `objectType` (e.g. "label"). Paddle's adapter solves this by
  // keying SCHEMA_DEFAULTS under both forms — we follow the same convention so
  // `defaultFactories[route.resource]` finds a factory regardless.
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
 * bodies are preserved across regeneration (templates live in scripts/gmail-codegen.ts).
 */
${factories}

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
${mapEntries.join('\n')}
};
`;
}

function renderMeta(revision: string): string {
  return `${HEADER}
// Gmail Discovery doc revision: ${revision}
// Generated at: ${new Date().toISOString()}

export const GMAIL_SPEC_VERSION = ${JSON.stringify(revision)};
export const GMAIL_SPEC_GENERATED_AT = ${JSON.stringify(new Date().toISOString())};
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  if (!existsSync(SPEC_PATH)) {
    throw new Error(
      `Gmail Discovery doc not found at ${SPEC_PATH}\n` +
        `Download it:\n  curl -fsSL "https://gmail.googleapis.com/\\$discovery/rest?version=v1" -o gmail-discovery.json`,
    );
  }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const doc = JSON.parse(readFileSync(SPEC_PATH, 'utf-8')) as DiscoveryDoc;

  // 1. Routes
  const routes: GeneratedRoute[] = [];
  walkResources(doc.resources, '', routes);
  // Sort for deterministic output: by resource then path then method
  routes.sort(
    (a, b) =>
      a.resource.localeCompare(b.resource) ||
      a.fastifyPath.localeCompare(b.fastifyPath) ||
      a.method.localeCompare(b.method),
  );
  writeFileSync(resolve(OUT_DIR, 'routes.ts'), renderRoutes(routes), 'utf-8');

  // 2. Resource specs
  const specs: Record<string, ResourceSpec> = {};
  for (const def of RESOURCES_TO_SPEC) {
    specs[def.objectType] = buildResourceSpec(def, doc.schemas);
  }
  writeFileSync(resolve(OUT_DIR, 'resource-specs.ts'), renderResourceSpecs(specs), 'utf-8');

  // 3. Schemas (factories)
  writeFileSync(resolve(OUT_DIR, 'schemas.ts'), renderSchemas(), 'utf-8');

  // 4. Meta
  writeFileSync(resolve(OUT_DIR, 'meta.ts'), renderMeta(doc.revision), 'utf-8');

  console.log(`✓ Wrote ${routes.length} routes for ${RESOURCES_TO_SPEC.length} resources`);
  console.log(`  routes.ts          — ${routes.length} entries`);
  console.log(`  resource-specs.ts  — ${RESOURCES_TO_SPEC.length} resource specs`);
  console.log(`  schemas.ts         — ${Object.keys(FACTORY_TEMPLATES).length} factories`);
  console.log(`  meta.ts            — revision ${doc.revision}`);
}

main();
