#!/usr/bin/env node
/**
 * HubSpot multi-spec codegen.
 *
 * Walks `specs/<area>/<product>/<version>--<file>.json`, merges every
 * spec's paths into a single GENERATED_ROUTES table, and emits the
 * standard four files into `src/generated/`:
 *
 *   routes.ts          – GeneratedRoute[] for every (path × method) combo
 *   resource-specs.ts  – AdapterResourceSpecs for the major CRM objects
 *   schemas.ts         – defaultXxx() factories (typed for hot resources, generic fallback)
 *   meta.ts            – spec versions + generated timestamp
 *
 * HubSpot publishes one OpenAPI 3.0 spec per product (Contacts, Companies,
 * Deals, Notes, Tasks, Calls, Meetings, Emails, Pipelines, Owners,
 * Properties, Associations, Lists, Pages, Files, Webhooks, ...). This codegen
 * just unions them all. ~105 specs → ~1200 routes.
 *
 * Operation classification follows REST + HubSpot's own conventions:
 *   GET  /xxx                     → list
 *   GET  /xxx/{id}                → retrieve
 *   POST /xxx                     → create
 *   POST /xxx/search              → list (HubSpot search-as-list)
 *   POST /xxx/batch/{verb}        → action (handled by override)
 *   POST /xxx/{id}/{verb}         → action
 *   PATCH /xxx/{id}               → update
 *   PUT  /xxx/{id}                → update
 *   DELETE /xxx/{id}              → delete
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPECS_ROOT = resolve(__dirname, '..', 'specs');
const OUT_DIR = resolve(__dirname, '..', 'src', 'generated');

// ---------------------------------------------------------------------------
// OpenAPI 3.x minimal types
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
  operationId?: string;
  parameters?: OaParameter[];
  tags?: string[];
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
  openapi?: string;
  swagger?: string;
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
  /** "<area>/<product>" — for documentation and namespace allocation */
  source: string;
}

// ---------------------------------------------------------------------------
// Path → resource mapping
//
// HubSpot paths follow a consistent shape:
//   /<area>/<resource>/<version>/<noun>/...
// e.g. /crm/objects/2026-03/contacts, /crm/properties/2026-03/contacts/{name},
//      /marketing/v3/forms, /cms/v3/pages, /webhooks/v3/{appId}/subscriptions
//
// We use the path's first non-version noun after the resource segment as the
// StateStore namespace. For /crm/objects/{version}/{objectType}, the dynamic
// {objectType} param drives namespacing at runtime.
// ---------------------------------------------------------------------------

function deriveResourceBucket(path: string, sourceProduct: string): { resource: string; idParam?: string; objectType?: string } {
  const segs = path.split('/').filter(Boolean);
  // segs example: ['crm', 'objects', '2026-03', '{objectType}', 'search']

  // CRM unified objects API
  if (segs[0] === 'crm' && segs[1] === 'objects' && segs[3] === '{objectType}') {
    const idParam = pickIdParam(path);
    return { resource: 'crm_objects', idParam, objectType: 'object' };
  }

  // Other CRM noun-typed APIs: /crm/<noun>/<version>/...
  if (segs[0] === 'crm' && segs.length >= 3) {
    const noun = segs[1];
    const idParam = pickIdParam(path);
    return { resource: `crm_${slug(noun)}`, idParam, objectType: noun.replace(/-/g, '_') };
  }

  // Other top-level resources: /<area>/<version>/<resource>/...
  // Use product-derived slug
  const slugProduct = slug(sourceProduct);
  return { resource: slugProduct, idParam: pickIdParam(path), objectType: slugProduct };
}

function pickIdParam(path: string): string | undefined {
  const matches = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
  if (matches.length === 0) return undefined;
  // Prefer the LAST id-shaped param ("xxxId" or just at the path tail)
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    if (/Id$/.test(m) || /id$/.test(m) || m === 'id') return m;
  }
  return matches[matches.length - 1];
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ---------------------------------------------------------------------------
// Operation classification
// ---------------------------------------------------------------------------

const BATCH_VERBS = new Set(['create', 'read', 'update', 'upsert', 'archive', 'delete']);

function classifyOperation(path: string, method: RouteMethod): RouteOperation {
  const segs = path.split('/').filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  const lastIsParam = last.startsWith('{');
  const secondLast = segs.length >= 2 ? segs[segs.length - 2]! : '';

  // POST /xxx/search — HubSpot's filtered list pattern
  if (method === 'POST' && last === 'search') return 'list';

  // POST /xxx/batch/<verb> — batch action
  if (method === 'POST' && secondLast === 'batch' && BATCH_VERBS.has(last)) return 'action';

  // POST /xxx/{id}/<verb> — verb action on a resource
  if (method === 'POST' && !lastIsParam && segs.some((s) => s.startsWith('{')) && !lastIsParam) {
    // Make sure the last segment isn't immediately preceded by no params
    // e.g. /xxx/{id}/<verb> ✓ vs /xxx/<verb> ✗ (handled below)
    const hasIdParam = segs.slice(0, -1).some((s) => s.startsWith('{'));
    if (hasIdParam) return 'action';
  }

  // GET on /{id} → retrieve, GET on collection → list
  if (method === 'GET') {
    if (lastIsParam) return 'retrieve';
    return 'list';
  }

  // POST collection → create
  if (method === 'POST') return 'create';

  // PUT/PATCH on /{id} → update; on collection → action (replace-all is rare)
  if (method === 'PATCH' || method === 'PUT') return lastIsParam ? 'update' : 'action';

  if (method === 'DELETE') return 'delete';

  return 'action';
}

// ---------------------------------------------------------------------------
// Walk specs/ tree
// ---------------------------------------------------------------------------

interface SpecFile {
  area: string;
  product: string;
  version: string;
  filePath: string;
}

function walkSpecs(): SpecFile[] {
  const out: SpecFile[] = [];
  if (!existsSync(SPECS_ROOT)) return out;

  for (const area of readdirSync(SPECS_ROOT)) {
    const areaPath = resolve(SPECS_ROOT, area);
    if (!statSync(areaPath).isDirectory()) continue;

    for (const product of readdirSync(areaPath)) {
      const productPath = resolve(areaPath, product);
      if (!statSync(productPath).isDirectory()) continue;

      for (const file of readdirSync(productPath)) {
        if (!file.endsWith('.json')) continue;
        const filePath = resolve(productPath, file);
        const versionPart = file.split('--')[0]!;
        out.push({ area, product, version: versionPart, filePath });
      }
    }
  }
  return out.sort((a, b) =>
    a.area.localeCompare(b.area) || a.product.localeCompare(b.product),
  );
}

// ---------------------------------------------------------------------------
// Build routes
// ---------------------------------------------------------------------------

const HTTP_METHODS: RouteMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Normalize a Fastify path so collisions like `/x/:folderId` vs `/x/:folderPath`
 * register as the same shape. Fastify rejects both registering — first one wins.
 */
function normalizeFastifyPath(p: string): string {
  return p.replace(/:[^/]+/g, ':_');
}

function buildRoutes(specs: SpecFile[]): GeneratedRoute[] {
  const routes: GeneratedRoute[] = [];
  const seenExact = new Set<string>(); // METHOD:fastifyPath (exact)
  const seenShape = new Set<string>(); // METHOD:normalizedFastifyPath (shape collision)

  let droppedExact = 0;
  let droppedShape = 0;

  for (const sf of specs) {
    let spec: OaSpec;
    try {
      spec = JSON.parse(readFileSync(sf.filePath, 'utf-8')) as OaSpec;
    } catch (e) {
      console.warn(`⚠ Skipping ${sf.filePath}: parse failed`, (e as Error).message);
      continue;
    }
    if (!spec.paths) continue;

    for (const [path, item] of Object.entries(spec.paths)) {
      // Convert {param} → :param
      const fastifyPath = path.replace(/\{([^}]+)\}/g, ':$1');
      const shapeKey = normalizeFastifyPath(fastifyPath);

      const ctx = deriveResourceBucket(path, sf.product);

      for (const method of HTTP_METHODS) {
        const op = item[method.toLowerCase() as Lowercase<RouteMethod>];
        if (!op) continue;

        const exactKey = `${method}:${fastifyPath}`;
        if (seenExact.has(exactKey)) {
          droppedExact++;
          continue;
        }
        const shapeKeyMethod = `${method}:${shapeKey}`;
        if (seenShape.has(shapeKeyMethod)) {
          droppedShape++;
          continue;
        }
        seenExact.add(exactKey);
        seenShape.add(shapeKeyMethod);

        const operation = classifyOperation(path, method);
        const queryFilters = (op.parameters ?? [])
          .filter((p) => p.in === 'query')
          .map((p) => p.name);

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
          source: `${sf.area}/${sf.product}`,
        });
      }
    }
  }

  if (droppedExact > 0 || droppedShape > 0) {
    console.log(`  Dropped ${droppedExact} exact-duplicate routes, ${droppedShape} shape-collision routes (Fastify can't distinguish :foo vs :bar at the same path)`);
  }

  return routes.sort(
    (a, b) =>
      a.resource.localeCompare(b.resource) ||
      a.fastifyPath.localeCompare(b.fastifyPath) ||
      a.method.localeCompare(b.method),
  );
}

// ---------------------------------------------------------------------------
// Resource specs (curated for hot CRM objects)
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

const HUBSPOT_OBJECT_FIELDS: Record<string, ResourceSpecField> = {
  id: { type: 'string', required: true, default: '' },
  properties: { type: 'object', required: true, default: {}, description: 'HubSpot property bag (e.g. firstname, lastname, email, dealname, dealstage)' },
  createdAt: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
  updatedAt: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
  archived: { type: 'boolean', required: false, default: false },
};

const RESOURCE_SPECS: Record<string, ResourceSpec> = {
  contact: {
    objectType: 'contact',
    volumeHint: 'entity',
    refs: ['company', 'deal'],
    fields: HUBSPOT_OBJECT_FIELDS,
  },
  company: {
    objectType: 'company',
    volumeHint: 'entity',
    refs: ['contact', 'deal'],
    fields: HUBSPOT_OBJECT_FIELDS,
  },
  deal: {
    objectType: 'deal',
    volumeHint: 'entity',
    refs: ['contact', 'company'],
    fields: HUBSPOT_OBJECT_FIELDS,
  },
  ticket: {
    objectType: 'ticket',
    volumeHint: 'entity',
    refs: ['contact', 'company'],
    fields: HUBSPOT_OBJECT_FIELDS,
  },
  note: {
    objectType: 'note',
    volumeHint: 'entity',
    refs: ['contact', 'company', 'deal', 'owner'],
    fields: HUBSPOT_OBJECT_FIELDS,
  },
  task: {
    objectType: 'task',
    volumeHint: 'entity',
    refs: ['contact', 'company', 'deal', 'owner'],
    fields: HUBSPOT_OBJECT_FIELDS,
  },
  call: {
    objectType: 'call',
    volumeHint: 'entity',
    refs: ['contact', 'company', 'deal', 'owner'],
    fields: HUBSPOT_OBJECT_FIELDS,
  },
  meeting: {
    objectType: 'meeting',
    volumeHint: 'entity',
    refs: ['contact', 'company', 'deal', 'owner'],
    fields: HUBSPOT_OBJECT_FIELDS,
  },
  email: {
    objectType: 'email',
    volumeHint: 'entity',
    refs: ['contact', 'deal', 'owner'],
    fields: HUBSPOT_OBJECT_FIELDS,
  },
  line_item: {
    objectType: 'line_item',
    volumeHint: 'entity',
    refs: ['deal'],
    fields: HUBSPOT_OBJECT_FIELDS,
  },
  product: {
    objectType: 'product',
    volumeHint: 'reference',
    refs: [],
    fields: HUBSPOT_OBJECT_FIELDS,
  },
  owner: {
    objectType: 'owner',
    volumeHint: 'reference',
    refs: [],
    fields: {
      id: { type: 'string', required: true, default: '' },
      email: { type: 'string', required: true, default: '', semanticType: 'email' },
      firstName: { type: 'string', required: false, default: '' },
      lastName: { type: 'string', required: false, default: '' },
      userId: { type: 'integer', required: false, default: 0 },
      createdAt: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
      updatedAt: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
      archived: { type: 'boolean', required: false, default: false },
      teams: { type: 'array', required: false, default: [] },
    },
  },
  pipeline: {
    objectType: 'pipeline',
    volumeHint: 'reference',
    refs: [],
    fields: {
      id: { type: 'string', required: true, default: '' },
      label: { type: 'string', required: true, default: '' },
      displayOrder: { type: 'integer', required: false, default: 0 },
      stages: { type: 'array', required: false, default: [] },
      archived: { type: 'boolean', required: false, default: false },
      createdAt: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
      updatedAt: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
  property: {
    objectType: 'property',
    volumeHint: 'reference',
    refs: [],
    fields: {
      name: { type: 'string', required: true, default: '' },
      label: { type: 'string', required: true, default: '' },
      type: { type: 'string', required: true, default: 'string' },
      fieldType: { type: 'string', required: true, default: 'text' },
      groupName: { type: 'string', required: false, default: '' },
      options: { type: 'array', required: false, default: [] },
      hubspotDefined: { type: 'boolean', required: false, default: false },
      modificationMetadata: { type: 'object', required: false, default: null },
      createdAt: { type: 'string', required: false, default: '', timestamp: 'iso8601' },
      updatedAt: { type: 'string', required: false, default: '', timestamp: 'iso8601' },
    },
  },
  list: {
    objectType: 'list',
    volumeHint: 'reference',
    refs: [],
    fields: {
      listId: { type: 'string', required: true, default: '' },
      name: { type: 'string', required: true, default: '' },
      objectTypeId: { type: 'string', required: true, default: '0-1' },
      processingType: { type: 'string', required: false, default: 'MANUAL' },
      processingStatus: { type: 'string', required: false, default: 'COMPLETED' },
      createdAt: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
      updatedAt: { type: 'string', required: true, default: '', timestamp: 'iso8601' },
    },
  },
};

// ---------------------------------------------------------------------------
// Default factories
// ---------------------------------------------------------------------------

const FACTORY_TEMPLATES: Record<string, string> = {
  hubspotObject: `
/** Generic factory for any "CRM object" — contacts, companies, deals, etc. */
export function defaultHubSpotObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    id: (o.id as string) ?? generateId('', 18),
    properties: (o.properties as Record<string, unknown>) ?? {},
    createdAt: (o.createdAt as string) ?? now,
    updatedAt: (o.updatedAt as string) ?? now,
    archived: (o.archived as boolean) ?? false,
    ...overrides,
  };
}`,
  contact: `
export function defaultContact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      firstname: '',
      lastname: '',
      email: '',
      lifecyclestage: 'lead',
      hs_lead_status: 'NEW',
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}`,
  company: `
export function defaultCompany(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      name: '',
      domain: '',
      industry: '',
      lifecyclestage: 'lead',
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}`,
  deal: `
export function defaultDeal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      dealname: '',
      amount: '0',
      dealstage: 'qualifiedtobuy',
      pipeline: 'default',
      closedate: null,
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}`,
  ticket: `
export function defaultTicket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      subject: '',
      content: '',
      hs_pipeline: '0',
      hs_pipeline_stage: '1',
      hs_ticket_priority: 'MEDIUM',
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}`,
  note: `
export function defaultNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      hs_note_body: '',
      hs_timestamp: new Date().toISOString(),
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}`,
  task: `
export function defaultTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      hs_task_subject: '',
      hs_task_body: '',
      hs_task_status: 'NOT_STARTED',
      hs_task_priority: 'MEDIUM',
      hs_timestamp: new Date().toISOString(),
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}`,
  call: `
export function defaultCall(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      hs_call_title: '',
      hs_call_body: '',
      hs_call_duration: '0',
      hs_call_disposition: '',
      hs_call_status: 'COMPLETED',
      hs_timestamp: new Date().toISOString(),
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}`,
  meeting: `
export function defaultMeeting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      hs_meeting_title: '',
      hs_meeting_body: '',
      hs_meeting_outcome: 'COMPLETED',
      hs_meeting_start_time: new Date().toISOString(),
      hs_meeting_end_time: new Date(Date.now() + 30 * 60_000).toISOString(),
      hs_timestamp: new Date().toISOString(),
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}`,
  email: `
export function defaultEmail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      hs_email_subject: '',
      hs_email_text: '',
      hs_email_status: 'SENT',
      hs_email_direction: 'EMAIL',
      hs_timestamp: new Date().toISOString(),
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}`,
  lineItem: `
export function defaultLineItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      name: '',
      quantity: '1',
      price: '0',
      amount: '0',
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}`,
  product: `
export function defaultProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      name: '',
      price: '0',
      hs_sku: '',
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}`,
  owner: `
export function defaultOwner(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    id: (o.id as string) ?? generateId('', 8),
    email: (o.email as string) ?? '',
    firstName: (o.firstName as string) ?? '',
    lastName: (o.lastName as string) ?? '',
    userId: (o.userId as number) ?? Math.floor(Math.random() * 100_000_000),
    createdAt: (o.createdAt as string) ?? now,
    updatedAt: (o.updatedAt as string) ?? now,
    archived: (o.archived as boolean) ?? false,
    teams: (o.teams as unknown[]) ?? [],
    ...overrides,
  };
}`,
  pipeline: `
export function defaultPipeline(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    id: (o.id as string) ?? generateId('', 12),
    label: (o.label as string) ?? '',
    displayOrder: (o.displayOrder as number) ?? 0,
    stages: (o.stages as unknown[]) ?? [],
    archived: (o.archived as boolean) ?? false,
    createdAt: (o.createdAt as string) ?? now,
    updatedAt: (o.updatedAt as string) ?? now,
    ...overrides,
  };
}`,
  property: `
export function defaultProperty(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    name: (o.name as string) ?? '',
    label: (o.label as string) ?? '',
    type: (o.type as string) ?? 'string',
    fieldType: (o.fieldType as string) ?? 'text',
    groupName: (o.groupName as string) ?? '',
    options: (o.options as unknown[]) ?? [],
    hubspotDefined: (o.hubspotDefined as boolean) ?? false,
    modificationMetadata: (o.modificationMetadata as Record<string, unknown> | null) ?? null,
    createdAt: (o.createdAt as string) ?? now,
    updatedAt: (o.updatedAt as string) ?? now,
    ...overrides,
  };
}`,
  list: `
export function defaultList(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    listId: (o.listId as string) ?? String(Math.floor(Math.random() * 1_000_000)),
    name: (o.name as string) ?? '',
    objectTypeId: (o.objectTypeId as string) ?? '0-1',
    processingType: (o.processingType as string) ?? 'MANUAL',
    processingStatus: (o.processingStatus as string) ?? 'COMPLETED',
    createdAt: (o.createdAt as string) ?? now,
    updatedAt: (o.updatedAt as string) ?? now,
    ...overrides,
  };
}`,
};

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const HEADER = '// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-hubspot generate';

function renderRoutes(routes: GeneratedRoute[]): string {
  // Compact rendering — 1219 routes is a lot of lines to keep readable.
  const body = routes
    .map((r) => {
      const fields: string[] = [
        `m: ${JSON.stringify(r.method)}`,
        `p: ${JSON.stringify(r.fastifyPath)}`,
        `o: ${JSON.stringify(r.operation)}`,
        `r: ${JSON.stringify(r.resource)}`,
      ];
      if (r.idParam) fields.push(`i: ${JSON.stringify(r.idParam)}`);
      if (r.objectType) fields.push(`t: ${JSON.stringify(r.objectType)}`);
      if (r.queryFilters.length > 0) fields.push(`q: ${JSON.stringify(r.queryFilters)}`);
      if (r.description) fields.push(`d: ${JSON.stringify(r.description)}`);
      fields.push(`s: ${JSON.stringify(r.source)}`);
      fields.push(`sp: ${JSON.stringify(r.stripePath)}`);
      return `  { ${fields.join(', ')} }`;
    })
    .join(',\n');

  return `${HEADER}

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';

export interface GeneratedRoute {
  method: RouteMethod;
  fastifyPath: string;
  /** Original spec path (field name kept "stripePath" for cross-adapter consistency) */
  stripePath: string;
  resource: string;
  operation: RouteOperation;
  description: string;
  queryFilters: string[];
  idParam?: string;
  objectType?: string;
  /** "<area>/<product>" — which spec emitted this route */
  source: string;
}

/** Compact internal shape — expanded by GENERATED_ROUTES below to match GeneratedRoute. */
interface CompactRoute {
  m: RouteMethod;
  p: string;
  o: RouteOperation;
  r: string;
  i?: string;
  t?: string;
  q?: string[];
  d?: string;
  s: string;
  sp: string;
}

const COMPACT_ROUTES: CompactRoute[] = [
${body}
];

export const GENERATED_ROUTES: GeneratedRoute[] = COMPACT_ROUTES.map((c) => ({
  method: c.m,
  fastifyPath: c.p,
  stripePath: c.sp,
  resource: c.r,
  operation: c.o,
  description: c.d ?? '',
  queryFilters: c.q ?? [],
  idParam: c.i,
  objectType: c.t,
  source: c.s,
}));
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

export const hubspotResourceSpecs: AdapterResourceSpecs = {
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

  // Map both objectType and route.resource keys to factories; fall back to
  // generic defaultHubSpotObject for anything we haven't typed.
  const aliases: Array<[string, string]> = [
    ['contact', 'defaultContact'],
    ['contacts', 'defaultContact'],
    ['crm_contacts', 'defaultContact'],
    ['company', 'defaultCompany'],
    ['companies', 'defaultCompany'],
    ['crm_companies', 'defaultCompany'],
    ['deal', 'defaultDeal'],
    ['deals', 'defaultDeal'],
    ['crm_deals', 'defaultDeal'],
    ['ticket', 'defaultTicket'],
    ['tickets', 'defaultTicket'],
    ['crm_tickets', 'defaultTicket'],
    ['note', 'defaultNote'],
    ['notes', 'defaultNote'],
    ['crm_notes', 'defaultNote'],
    ['task', 'defaultTask'],
    ['tasks', 'defaultTask'],
    ['crm_tasks', 'defaultTask'],
    ['call', 'defaultCall'],
    ['calls', 'defaultCall'],
    ['crm_calls', 'defaultCall'],
    ['meeting', 'defaultMeeting'],
    ['meetings', 'defaultMeeting'],
    ['crm_meetings', 'defaultMeeting'],
    ['email', 'defaultEmail'],
    ['emails', 'defaultEmail'],
    ['crm_emails', 'defaultEmail'],
    ['line_item', 'defaultLineItem'],
    ['line_items', 'defaultLineItem'],
    ['crm_line_items', 'defaultLineItem'],
    ['product', 'defaultProduct'],
    ['products', 'defaultProduct'],
    ['crm_products', 'defaultProduct'],
    ['owner', 'defaultOwner'],
    ['owners', 'defaultOwner'],
    ['crm_owners', 'defaultOwner'],
    ['crm_crm_owners', 'defaultOwner'],
    ['pipeline', 'defaultPipeline'],
    ['pipelines', 'defaultPipeline'],
    ['crm_pipelines', 'defaultPipeline'],
    ['property', 'defaultProperty'],
    ['properties', 'defaultProperty'],
    ['crm_properties', 'defaultProperty'],
    ['list', 'defaultList'],
    ['lists', 'defaultList'],
    ['crm_lists', 'defaultList'],
    // Generic CRM Objects API uses dynamic objectType — namespaced separately at runtime
    ['crm_objects', 'defaultHubSpotObject'],
  ];

  const mapEntries = aliases.map(([k, fn]) => `  ${JSON.stringify(k)}: ${fn},`).join('\n');

  return `${HEADER}
import { generateId } from '@mimicai/adapter-sdk';
import type { DefaultFactory } from '@mimicai/adapter-sdk';

/**
 * Hand-tuned factories for the most-used HubSpot CRM objects, plus a
 * generic factory (\`defaultHubSpotObject\`) used as a fallback for any
 * resource the codegen sees but we haven't typed explicitly.
 *
 * HubSpot's universal CRM-object shape is:
 *   { id, properties: {...}, createdAt, updatedAt, archived }
 * Properties are flat string→value bags — even numeric/date values are
 * stringified per HubSpot convention.
 */
${factories}

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
${mapEntries}
};

/** Fallback factory for any resource not in SCHEMA_DEFAULTS. */
export const GENERIC_FACTORY: DefaultFactory = defaultHubSpotObject;
`;
}

function renderMeta(specs: SpecFile[]): string {
  const versions = [...new Set(specs.map((s) => s.version))].sort();
  const productCount = new Set(specs.map((s) => `${s.area}/${s.product}`)).size;

  return `${HEADER}
// HubSpot multi-spec adapter
// Generated at: ${new Date().toISOString()}
// Spec versions in play: ${versions.join(', ')}
// Products covered: ${productCount}

export const HUBSPOT_SPEC_VERSIONS = ${JSON.stringify(versions)};
export const HUBSPOT_PRODUCT_COUNT = ${productCount};
export const HUBSPOT_SPEC_GENERATED_AT = ${JSON.stringify(new Date().toISOString())};
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  if (!existsSync(SPECS_ROOT)) {
    throw new Error(
      `Specs directory not found at ${SPECS_ROOT}\n` +
        `See README.md for the spec download command (clones https://github.com/HubSpot/HubSpot-public-api-spec-collection).`,
    );
  }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const specs = walkSpecs();
  console.log(`Discovered ${specs.length} spec files`);

  const routes = buildRoutes(specs);
  writeFileSync(resolve(OUT_DIR, 'routes.ts'), renderRoutes(routes), 'utf-8');
  writeFileSync(resolve(OUT_DIR, 'resource-specs.ts'), renderResourceSpecs(RESOURCE_SPECS), 'utf-8');
  writeFileSync(resolve(OUT_DIR, 'schemas.ts'), renderSchemas(), 'utf-8');
  writeFileSync(resolve(OUT_DIR, 'meta.ts'), renderMeta(specs), 'utf-8');

  // Group counts by source for visibility
  const byArea = new Map<string, number>();
  const byOp = new Map<string, number>();
  for (const r of routes) {
    const area = r.source.split('/')[0]!;
    byArea.set(area, (byArea.get(area) ?? 0) + 1);
    byOp.set(r.operation, (byOp.get(r.operation) ?? 0) + 1);
  }

  console.log(`✓ Wrote ${routes.length} routes for ${Object.keys(RESOURCE_SPECS).length} resource specs, ${Object.keys(FACTORY_TEMPLATES).length} factories`);
  console.log(`  By area:      ${[...byArea.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(', ')}`);
  console.log(`  By operation: ${[...byOp.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(', ')}`);
}

main();
// @ts-ignore — basename is needed for the renderer headers in some setups
void basename;
