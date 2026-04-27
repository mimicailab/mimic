#!/usr/bin/env node
/**
 * Attio API (OpenAPI 3.1) → Mimic codegen
 *
 * Reads `attio-spec.json` (downloaded from https://api.attio.com/openapi/api)
 * and writes four TypeScript source files into `src/generated/`:
 *
 *   routes.ts          – GeneratedRoute[] for every (path × method) in the spec
 *   resource-specs.ts  – AdapterResourceSpecs covering all CRM resources
 *   schemas.ts         – defaultXxx() factories for mock data
 *   meta.ts            – spec version + generated timestamp
 *
 * Scope: full coverage. All 49 paths from the Attio spec are emitted (~87
 * route handlers once HTTP methods are expanded). No curation/filtering.
 *
 * Quirks handled:
 *   - POST `*​/query`  → operation: 'list'  (Attio uses POST for filtered listing)
 *   - POST `*​/search` → operation: 'list'  (global record search)
 *   - PUT  `*​/{id}`   → operation: 'update' (overwrite multiselects)
 *   - PUT  collection → operation: 'action' (assert / upsert by parent attribute)
 *   - PATCH           → operation: 'update' (append multiselects)
 *   - `{object}` and `{target}/{identifier}` stay as Fastify path params; the
 *     adapter seeds StateStore namespaces per concrete object type at runtime.
 *
 * Usage:
 *   pnpm --filter @mimicai/adapter-attio generate
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, '..', 'attio-spec.json');
const OUT_DIR = resolve(__dirname, '..', 'src', 'generated');

// ---------------------------------------------------------------------------
// OpenAPI 3.1 minimal types
// ---------------------------------------------------------------------------

interface OaParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
  schema?: { type?: string };
  description?: string;
}

interface OaOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OaParameter[];
  requestBody?: { required?: boolean; content?: Record<string, unknown> };
  responses?: Record<string, unknown>;
}

interface OaPathItem {
  get?: OaOperation;
  post?: OaOperation;
  put?: OaOperation;
  patch?: OaOperation;
  delete?: OaOperation;
  parameters?: OaParameter[];
}

interface OaSpec {
  openapi: string;
  info?: { title?: string; version?: string };
  servers?: { url: string }[];
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
//
// The spec has 49 paths. Resource buckets are derived structurally so the
// StateStore namespace is stable per resource family.
// ---------------------------------------------------------------------------

interface PathContext {
  resource: string;
  objectType: string;
  /** Path param that holds the resource's primary id (last `*_id` segment). */
  idParam?: string;
}

function classifyPath(path: string): PathContext {
  // SCIM provisioning surfaces
  if (path.startsWith('/scim/v2/Users')) {
    return { resource: 'scim_users', objectType: 'scim_user', idParam: pickIdParam(path) };
  }
  if (path.startsWith('/scim/v2/Groups')) {
    return { resource: 'scim_groups', objectType: 'scim_group', idParam: pickIdParam(path) };
  }
  if (path === '/scim/v2/Schemas') {
    return { resource: 'scim_schemas', objectType: 'scim_schema' };
  }

  // Attribute / option / status configuration (target = "objects" or "lists")
  if (path.includes('/attributes/{attribute}/options')) {
    return { resource: 'select_options', objectType: 'select_option', idParam: pickIdParam(path) };
  }
  if (path.includes('/attributes/{attribute}/statuses')) {
    return { resource: 'statuses', objectType: 'status', idParam: pickIdParam(path) };
  }
  if (path.includes('/attributes')) {
    return { resource: 'attributes', objectType: 'attribute', idParam: pickIdParam(path) };
  }

  // Record-scoped surfaces under /v2/objects/{object}/...
  if (path.match(/\/v2\/objects\/\{object\}\/records\/\{record_id\}\/entries/)) {
    return { resource: 'record_entries', objectType: 'record_entry', idParam: 'record_id' };
  }
  if (path.match(/\/v2\/objects\/\{object\}\/records/)) {
    return { resource: 'records', objectType: 'record', idParam: pickIdParam(path) };
  }
  if (path === '/v2/objects/records/search') {
    return { resource: 'records', objectType: 'record' };
  }
  if (path.match(/\/v2\/objects\/\{object\}\/views/)) {
    return { resource: 'object_views', objectType: 'object_view' };
  }
  if (path.startsWith('/v2/objects')) {
    return { resource: 'objects', objectType: 'object', idParam: 'object' };
  }

  // List entry surfaces
  if (path.match(/\/v2\/lists\/\{list\}\/entries/)) {
    return { resource: 'list_entries', objectType: 'list_entry', idParam: pickIdParam(path) };
  }
  if (path.match(/\/v2\/lists\/\{list\}\/views/)) {
    return { resource: 'list_views', objectType: 'list_view' };
  }
  if (path.startsWith('/v2/lists')) {
    return { resource: 'lists', objectType: 'list', idParam: 'list' };
  }

  // Workspace members
  if (path.startsWith('/v2/workspace_members')) {
    return { resource: 'workspace_members', objectType: 'workspace_member', idParam: 'workspace_member_id' };
  }

  // Activity / collaboration
  if (path.startsWith('/v2/notes')) {
    return { resource: 'notes', objectType: 'note', idParam: 'note_id' };
  }
  if (path.startsWith('/v2/tasks')) {
    return { resource: 'tasks', objectType: 'task', idParam: 'task_id' };
  }
  if (path.startsWith('/v2/threads')) {
    return { resource: 'threads', objectType: 'thread', idParam: 'thread_id' };
  }
  if (path.startsWith('/v2/comments')) {
    return { resource: 'comments', objectType: 'comment', idParam: 'comment_id' };
  }

  // Meeting intel
  if (path.match(/\/v2\/meetings\/\{meeting_id\}\/call_recordings\/\{call_recording_id\}\/transcript/)) {
    return { resource: 'call_recordings', objectType: 'call_recording', idParam: 'call_recording_id' };
  }
  if (path.match(/\/v2\/meetings\/\{meeting_id\}\/call_recordings/)) {
    return { resource: 'call_recordings', objectType: 'call_recording', idParam: pickIdParam(path) };
  }
  if (path.startsWith('/v2/meetings')) {
    return { resource: 'meetings', objectType: 'meeting', idParam: 'meeting_id' };
  }

  // Files & folders
  if (path.match(/\/v2\/files\/\{file_id\}\/download/)) {
    return { resource: 'files', objectType: 'file', idParam: 'file_id' };
  }
  if (path === '/v2/files/upload') {
    return { resource: 'files', objectType: 'file' };
  }
  if (path.startsWith('/v2/files')) {
    return { resource: 'files', objectType: 'file', idParam: 'file_id' };
  }

  // Webhooks
  if (path.startsWith('/v2/webhooks')) {
    return { resource: 'webhooks', objectType: 'webhook', idParam: 'webhook_id' };
  }

  // Workspace identity
  if (path === '/v2/self') {
    return { resource: 'self', objectType: 'self' };
  }

  // Fallback — shouldn't trigger if all 49 paths are covered above
  return { resource: 'unknown', objectType: 'unknown' };
}

function pickIdParam(path: string): string | undefined {
  // Find the last `{xxx}` segment; that's almost always the resource id.
  const matches = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1];
}

// ---------------------------------------------------------------------------
// Operation classification
// ---------------------------------------------------------------------------

function classifyOperation(path: string, method: RouteMethod): RouteOperation {
  const last = path.split('/').filter(Boolean).pop() ?? '';
  const lastIsParam = last.startsWith('{');
  const paramCount = (path.match(/\{[^}]+\}/g) ?? []).length;

  // Action-like POST suffixes (Attio uses POST for filtered listing)
  if (method === 'POST' && (last === 'query' || last === 'search')) return 'list';
  if (method === 'POST' && last === 'upload') return 'action';

  // GET on a literal sub-path that returns blob/transcript content
  if (method === 'GET' && (last === 'download' || last === 'transcript')) return 'action';

  // GET on collection-of-values under a record (e.g. .../attributes/{attribute}/values)
  if (method === 'GET' && last === 'values') return 'list';

  // GET on `/{id}` → retrieve, GET on collection → list
  if (method === 'GET') {
    if (lastIsParam) return 'retrieve';
    // Singleton GETs with no params → retrieve (e.g. /v2/self)
    if (paramCount === 0 && (last === 'self' || last === 'Schemas')) return 'retrieve';
    return 'list';
  }

  // POST collection → create. POST `/{id}/verb` already handled above.
  if (method === 'POST') {
    return 'create';
  }

  // PUT: on `/{id}` overwrites the resource (update); on collection it's an
  // "assert" / upsert-by-attribute (action — handled by override).
  if (method === 'PUT') {
    return lastIsParam ? 'update' : 'action';
  }

  if (method === 'PATCH') return 'update';
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

      const queryFilters: string[] = [];
      for (const p of op.parameters ?? []) {
        if (p.in === 'query') queryFilters.push(p.name);
      }

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
//
// Attio's spec describes 19 component schemas plus the dynamic `record` shape
// that varies per object type. We emit specs for the resources the briefing
// agent actually reads — every other resource still has routes registered,
// just without rich resource-spec metadata.
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
  record: {
    objectType: 'record',
    volumeHint: 'entity',
    refs: ['workspace_member'],
    fields: {
      id: { type: 'object', required: true, default: null, description: 'Compound { workspace_id, object_id, record_id }' },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
      web_url: { type: 'string', required: false, default: '', semanticType: 'url' },
      values: { type: 'object', required: true, default: {}, description: 'Attribute slug → array of typed values' },
    },
  },
  list: {
    objectType: 'list',
    volumeHint: 'reference',
    refs: [],
    fields: {
      id: { type: 'object', required: true, default: null },
      api_slug: { type: 'string', required: true, default: '' },
      name: { type: 'string', required: true, default: '' },
      parent_object: { type: 'array', required: false, default: [] },
      workspace_access: { type: 'string', required: false, default: 'read-and-write' },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
  list_entry: {
    objectType: 'list_entry',
    volumeHint: 'entity',
    refs: ['list', 'record'],
    fields: {
      id: { type: 'object', required: true, default: null },
      parent_record_id: { type: 'string', required: true, default: '' },
      parent_object: { type: 'string', required: true, default: '' },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
      entry_values: { type: 'object', required: true, default: {} },
    },
  },
  note: {
    objectType: 'note',
    volumeHint: 'entity',
    refs: ['record', 'workspace_member'],
    fields: {
      id: { type: 'object', required: true, default: null },
      parent_object: { type: 'string', required: true, default: '' },
      parent_record_id: { type: 'string', required: true, default: '' },
      title: { type: 'string', required: true, default: '' },
      content_plaintext: { type: 'string', required: false, default: '' },
      content_markdown: { type: 'string', required: false, default: '' },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
      created_by_actor: { type: 'object', required: false, default: null },
    },
  },
  task: {
    objectType: 'task',
    volumeHint: 'entity',
    refs: ['record', 'workspace_member'],
    fields: {
      id: { type: 'object', required: true, default: null },
      content_plaintext: { type: 'string', required: true, default: '' },
      deadline_at: { type: 'string', required: false, nullable: true, default: null, timestamp: 'iso8601' },
      is_completed: { type: 'boolean', required: true, default: false },
      linked_records: { type: 'array', required: false, default: [] },
      assignees: { type: 'array', required: false, default: [] },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
  meeting: {
    objectType: 'meeting',
    volumeHint: 'entity',
    refs: ['record', 'workspace_member'],
    fields: {
      id: { type: 'object', required: true, default: null },
      title: { type: 'string', required: true, default: '' },
      start_time: { type: 'string', required: false, nullable: true, default: null, timestamp: 'iso8601' },
      end_time: { type: 'string', required: false, nullable: true, default: null, timestamp: 'iso8601' },
      attendees: { type: 'array', required: false, default: [] },
      linked_records: { type: 'array', required: false, default: [] },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
  call_recording: {
    objectType: 'call_recording',
    volumeHint: 'entity',
    refs: ['meeting'],
    fields: {
      id: { type: 'object', required: true, default: null },
      meeting_id: { type: 'string', required: true, default: '' },
      url: { type: 'string', required: false, default: '', semanticType: 'url' },
      transcript: { type: 'string', required: false, default: '' },
      duration_seconds: { type: 'integer', required: false, default: 0 },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
  comment: {
    objectType: 'comment',
    volumeHint: 'entity',
    refs: ['thread', 'workspace_member'],
    fields: {
      id: { type: 'object', required: true, default: null },
      thread_id: { type: 'string', required: true, default: '' },
      content_plaintext: { type: 'string', required: true, default: '' },
      author: { type: 'object', required: false, default: null },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
  thread: {
    objectType: 'thread',
    volumeHint: 'entity',
    refs: ['record', 'list_entry'],
    fields: {
      id: { type: 'object', required: true, default: null },
      comments: { type: 'array', required: false, default: [] },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
  workspace_member: {
    objectType: 'workspace_member',
    volumeHint: 'reference',
    refs: [],
    fields: {
      id: { type: 'object', required: true, default: null },
      first_name: { type: 'string', required: true, default: '' },
      last_name: { type: 'string', required: true, default: '' },
      avatar_url: { type: 'string', required: false, default: '', semanticType: 'url' },
      email_address: { type: 'string', required: true, default: '', semanticType: 'email' },
      access_level: { type: 'string', required: false, default: 'member', enum: ['admin', 'member'] },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
  object: {
    objectType: 'object',
    volumeHint: 'reference',
    refs: [],
    fields: {
      id: { type: 'object', required: true, default: null },
      api_slug: { type: 'string', required: true, default: '' },
      singular_noun: { type: 'string', required: true, default: '' },
      plural_noun: { type: 'string', required: true, default: '' },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
  attribute: {
    objectType: 'attribute',
    volumeHint: 'reference',
    refs: [],
    fields: {
      id: { type: 'object', required: true, default: null },
      api_slug: { type: 'string', required: true, default: '' },
      title: { type: 'string', required: true, default: '' },
      type: { type: 'string', required: true, default: 'text' },
      is_required: { type: 'boolean', required: false, default: false },
      is_unique: { type: 'boolean', required: false, default: false },
      is_multiselect: { type: 'boolean', required: false, default: false },
      is_archived: { type: 'boolean', required: false, default: false },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
  select_option: {
    objectType: 'select_option',
    volumeHint: 'reference',
    refs: ['attribute'],
    fields: {
      id: { type: 'object', required: true, default: null },
      title: { type: 'string', required: true, default: '' },
      is_archived: { type: 'boolean', required: false, default: false },
    },
  },
  status: {
    objectType: 'status',
    volumeHint: 'reference',
    refs: ['attribute'],
    fields: {
      id: { type: 'object', required: true, default: null },
      title: { type: 'string', required: true, default: '' },
      celebration_enabled: { type: 'boolean', required: false, default: false },
      target_time_in_status: { type: 'string', required: false, nullable: true, default: null },
      is_archived: { type: 'boolean', required: false, default: false },
    },
  },
  file: {
    objectType: 'file',
    volumeHint: 'entity',
    refs: ['workspace_member'],
    fields: {
      id: { type: 'object', required: true, default: null },
      file_url: { type: 'string', required: false, default: '', semanticType: 'url' },
      filename: { type: 'string', required: true, default: '' },
      content_type: { type: 'string', required: false, default: 'application/octet-stream' },
      size: { type: 'integer', required: false, default: 0 },
      is_writable: { type: 'boolean', required: false, default: false },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
  webhook: {
    objectType: 'webhook',
    volumeHint: 'reference',
    refs: [],
    fields: {
      id: { type: 'object', required: true, default: null },
      target_url: { type: 'string', required: true, default: '', semanticType: 'url' },
      subscriptions: { type: 'array', required: false, default: [] },
      status: { type: 'string', required: false, default: 'active', enum: ['active', 'paused', 'degraded'] },
      created_at: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
};

// ---------------------------------------------------------------------------
// Default factories
// ---------------------------------------------------------------------------

const FACTORY_TEMPLATES: Record<string, string> = {
  record: `
export function defaultRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      object_id: (idIn.object_id as string) ?? generateUuid(),
      record_id: (idIn.record_id as string) ?? generateUuid(),
    },
    created_at: (o.created_at as string) ?? now,
    web_url: (o.web_url as string) ?? '',
    values: (o.values as Record<string, unknown>) ?? {},
    ...overrides,
  };
}`,
  list: `
export function defaultList(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      list_id: (idIn.list_id as string) ?? generateUuid(),
    },
    api_slug: (o.api_slug as string) ?? 'default-list',
    name: (o.name as string) ?? 'Default list',
    parent_object: (o.parent_object as string[]) ?? [],
    workspace_access: (o.workspace_access as string) ?? 'read-and-write',
    workspace_member_access: (o.workspace_member_access as unknown[]) ?? [],
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}`,
  list_entry: `
export function defaultListEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      list_id: (idIn.list_id as string) ?? generateUuid(),
      entry_id: (idIn.entry_id as string) ?? generateUuid(),
    },
    parent_record_id: (o.parent_record_id as string) ?? generateUuid(),
    parent_object: (o.parent_object as string) ?? '',
    created_at: (o.created_at as string) ?? now,
    entry_values: (o.entry_values as Record<string, unknown>) ?? {},
    ...overrides,
  };
}`,
  note: `
export function defaultNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      note_id: (idIn.note_id as string) ?? generateUuid(),
    },
    parent_object: (o.parent_object as string) ?? '',
    parent_record_id: (o.parent_record_id as string) ?? '',
    title: (o.title as string) ?? '',
    content_plaintext: (o.content_plaintext as string) ?? '',
    content_markdown: (o.content_markdown as string) ?? '',
    tags: (o.tags as unknown[]) ?? [],
    created_at: (o.created_at as string) ?? now,
    created_by_actor: (o.created_by_actor as Record<string, unknown> | null) ?? null,
    ...overrides,
  };
}`,
  task: `
export function defaultTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      task_id: (idIn.task_id as string) ?? generateUuid(),
    },
    content_plaintext: (o.content_plaintext as string) ?? '',
    deadline_at: (o.deadline_at as string | null) ?? null,
    is_completed: (o.is_completed as boolean) ?? false,
    linked_records: (o.linked_records as unknown[]) ?? [],
    assignees: (o.assignees as unknown[]) ?? [],
    created_at: (o.created_at as string) ?? now,
    created_by_actor: (o.created_by_actor as Record<string, unknown> | null) ?? null,
    ...overrides,
  };
}`,
  meeting: `
export function defaultMeeting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      meeting_id: (idIn.meeting_id as string) ?? generateUuid(),
    },
    title: (o.title as string) ?? '',
    start_time: (o.start_time as string | null) ?? null,
    end_time: (o.end_time as string | null) ?? null,
    attendees: (o.attendees as unknown[]) ?? [],
    linked_records: (o.linked_records as unknown[]) ?? [],
    notes: (o.notes as unknown[]) ?? [],
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}`,
  call_recording: `
export function defaultCallRecording(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      call_recording_id: (idIn.call_recording_id as string) ?? generateUuid(),
    },
    meeting_id: (o.meeting_id as string) ?? generateUuid(),
    url: (o.url as string) ?? '',
    transcript: (o.transcript as string) ?? '',
    duration_seconds: (o.duration_seconds as number) ?? 0,
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}`,
  comment: `
export function defaultComment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      comment_id: (idIn.comment_id as string) ?? generateUuid(),
    },
    thread_id: (o.thread_id as string) ?? generateUuid(),
    content_plaintext: (o.content_plaintext as string) ?? '',
    entity: (o.entity as Record<string, unknown> | null) ?? null,
    author: (o.author as Record<string, unknown> | null) ?? null,
    resolved_at: (o.resolved_at as string | null) ?? null,
    resolved_by: (o.resolved_by as Record<string, unknown> | null) ?? null,
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}`,
  thread: `
export function defaultThread(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      thread_id: (idIn.thread_id as string) ?? generateUuid(),
    },
    comments: (o.comments as unknown[]) ?? [],
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}`,
  workspace_member: `
export function defaultWorkspaceMember(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      workspace_member_id: (idIn.workspace_member_id as string) ?? generateUuid(),
    },
    first_name: (o.first_name as string) ?? '',
    last_name: (o.last_name as string) ?? '',
    avatar_url: (o.avatar_url as string) ?? '',
    email_address: (o.email_address as string) ?? '',
    access_level: (o.access_level as string) ?? 'member',
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}`,
  object: `
export function defaultObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      object_id: (idIn.object_id as string) ?? generateUuid(),
    },
    api_slug: (o.api_slug as string) ?? '',
    singular_noun: (o.singular_noun as string) ?? '',
    plural_noun: (o.plural_noun as string) ?? '',
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}`,
  attribute: `
export function defaultAttribute(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      object_id: (idIn.object_id as string) ?? generateUuid(),
      attribute_id: (idIn.attribute_id as string) ?? generateUuid(),
    },
    api_slug: (o.api_slug as string) ?? '',
    title: (o.title as string) ?? '',
    description: (o.description as string) ?? '',
    type: (o.type as string) ?? 'text',
    is_required: (o.is_required as boolean) ?? false,
    is_unique: (o.is_unique as boolean) ?? false,
    is_multiselect: (o.is_multiselect as boolean) ?? false,
    is_writable: (o.is_writable as boolean) ?? true,
    is_default_value_enabled: (o.is_default_value_enabled as boolean) ?? false,
    default_value: (o.default_value as Record<string, unknown> | null) ?? null,
    is_archived: (o.is_archived as boolean) ?? false,
    relationship: (o.relationship as Record<string, unknown> | null) ?? null,
    config: (o.config as Record<string, unknown>) ?? {},
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}`,
  select_option: `
export function defaultSelectOption(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      object_id: (idIn.object_id as string) ?? generateUuid(),
      attribute_id: (idIn.attribute_id as string) ?? generateUuid(),
      option_id: (idIn.option_id as string) ?? generateUuid(),
    },
    title: (o.title as string) ?? '',
    is_archived: (o.is_archived as boolean) ?? false,
    ...overrides,
  };
}`,
  status: `
export function defaultStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      object_id: (idIn.object_id as string) ?? generateUuid(),
      attribute_id: (idIn.attribute_id as string) ?? generateUuid(),
      status_id: (idIn.status_id as string) ?? generateUuid(),
    },
    title: (o.title as string) ?? '',
    celebration_enabled: (o.celebration_enabled as boolean) ?? false,
    target_time_in_status: (o.target_time_in_status as string | null) ?? null,
    is_archived: (o.is_archived as boolean) ?? false,
    ...overrides,
  };
}`,
  file: `
export function defaultFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      file_id: (idIn.file_id as string) ?? generateUuid(),
    },
    file_url: (o.file_url as string) ?? '',
    filename: (o.filename as string) ?? 'untitled',
    content_type: (o.content_type as string) ?? 'application/octet-stream',
    size: (o.size as number) ?? 0,
    is_writable: (o.is_writable as boolean) ?? false,
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}`,
  webhook: `
export function defaultWebhook(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      webhook_id: (idIn.webhook_id as string) ?? generateUuid(),
    },
    target_url: (o.target_url as string) ?? '',
    subscriptions: (o.subscriptions as unknown[]) ?? [],
    status: (o.status as string) ?? 'active',
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}`,
};

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const HEADER = '// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-attio generate';

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
  /** Original Attio spec path (field name is historical across adapters) */
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

export const attioResourceSpecs: AdapterResourceSpecs = {
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

  // Map both objectType and route.resource to the same factory so seeding and
  // CRUD scaffolding both find a default. Records are keyed by route resource
  // ("records") and by all canonical Attio object slugs.
  const map = new Map<string, string>();
  for (const k of Object.keys(FACTORY_TEMPLATES)) {
    const fn = `default${k.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')}`;
    map.set(k, fn);
  }
  // Plural / route-resource aliases
  const aliases: Record<string, string> = {
    records: 'record',
    record_entries: 'record',
    record_attribute_values: 'record',
    lists: 'list',
    list_entries: 'list_entry',
    list_entry_attribute_values: 'list_entry',
    list_views: 'list',
    object_views: 'object',
    objects: 'object',
    notes: 'note',
    tasks: 'task',
    threads: 'thread',
    comments: 'comment',
    meetings: 'meeting',
    call_recordings: 'call_recording',
    files: 'file',
    workspace_members: 'workspace_member',
    webhooks: 'webhook',
    attributes: 'attribute',
    select_options: 'select_option',
    statuses: 'status',
    // Concrete Attio object slugs that records may belong to — same shape
    people: 'record',
    companies: 'record',
    deals: 'record',
    workspaces: 'record',
    users: 'record',
  };
  for (const [alias, target] of Object.entries(aliases)) {
    if (!map.has(alias) && map.has(target)) map.set(alias, map.get(target)!);
  }

  const mapEntries = [...map.entries()]
    .map(([k, fn]) => `  ${JSON.stringify(k)}: ${fn},`)
    .join('\n');

  return `${HEADER}
import { generateId } from '@mimicai/adapter-sdk';
import type { DefaultFactory } from '@mimicai/adapter-sdk';

/**
 * Hand-tuned default factories. Every Attio resource id is a compound
 * \`{ workspace_id, [object_id|list_id|...], <resource>_id }\` envelope, so
 * factories accept partial id overrides and fill in UUIDs for missing pieces.
 *
 * The factory bodies live in scripts/attio-codegen.ts and are re-emitted on
 * every \`pnpm generate\`.
 */

export const DEFAULT_WORKSPACE_ID = '14beef7a-99f7-4534-a87e-70b564330a4c';

/** Generate an RFC 4122 v4-style id using the SDK's generateId (deterministic in tests). */
function generateUuid(): string {
  // Format like: \`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx\` (32 hex chars regrouped).
  const hex = generateId('', 32).replace(/[^a-f0-9]/gi, '0').padEnd(32, '0').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    '8' + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}
${factories}

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
${mapEntries}
};
`;
}

function renderMeta(version: string): string {
  return `${HEADER}
// Attio API spec version: ${version}
// Generated at: ${new Date().toISOString()}

export const ATTIO_SPEC_VERSION = ${JSON.stringify(version)};
export const ATTIO_SPEC_GENERATED_AT = ${JSON.stringify(new Date().toISOString())};
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  if (!existsSync(SPEC_PATH)) {
    throw new Error(
      `Attio spec not found at ${SPEC_PATH}\n` +
        `Download it:\n  curl -fsSL https://api.attio.com/openapi/api -o attio-spec.json`,
    );
  }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf-8')) as OaSpec;

  // 1. Routes
  const routes = buildRoutes(spec);
  writeFileSync(resolve(OUT_DIR, 'routes.ts'), renderRoutes(routes), 'utf-8');

  // 2. Resource specs (hand-curated)
  writeFileSync(resolve(OUT_DIR, 'resource-specs.ts'), renderResourceSpecs(RESOURCE_SPECS), 'utf-8');

  // 3. Schemas (hand-curated factories with object-id aliases)
  writeFileSync(resolve(OUT_DIR, 'schemas.ts'), renderSchemas(), 'utf-8');

  // 4. Meta
  const version = spec.info?.version ?? 'v2';
  writeFileSync(resolve(OUT_DIR, 'meta.ts'), renderMeta(version), 'utf-8');

  // Sanity: report any 'unknown' resource buckets (means classifyPath missed)
  const unknownPaths = routes.filter((r) => r.resource === 'unknown');
  if (unknownPaths.length > 0) {
    console.warn(`⚠ ${unknownPaths.length} routes fell into 'unknown' bucket:`);
    for (const r of unknownPaths) console.warn(`  ${r.method} ${r.stripePath}`);
  }

  // Group counts by resource for visibility
  const byResource = new Map<string, number>();
  for (const r of routes) byResource.set(r.resource, (byResource.get(r.resource) ?? 0) + 1);

  console.log(`✓ Wrote ${routes.length} routes for ${Object.keys(RESOURCE_SPECS).length} resource specs`);
  console.log(`  routes.ts          — ${routes.length} entries (${[...byResource.entries()].map(([k, n]) => `${k}:${n}`).join(', ')})`);
  console.log(`  resource-specs.ts  — ${Object.keys(RESOURCE_SPECS).length} resource specs`);
  console.log(`  schemas.ts         — ${Object.keys(FACTORY_TEMPLATES).length} factories`);
  console.log(`  meta.ts            — version ${version}`);
}

main();
