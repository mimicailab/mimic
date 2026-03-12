#!/usr/bin/env node
/**
 * GoCardless OpenAPI → Mimic codegen
 *
 * Reads the GoCardless OpenAPI spec (JSON) and generates four TypeScript
 * source files into src/generated/:
 *
 *   resource-specs.ts  – AdapterResourceSpecs covering all core GoCardless entities
 *   schemas.ts         – defaultXxx() factory functions for mock data
 *   routes.ts          – GeneratedRoute[] covering all GoCardless paths
 *   meta.ts            – spec version + generated timestamp
 *
 * Key differences from Stripe/Paddle codegen:
 *   - GoCardless uses flat schema naming: `customer`, `customer_email`, `customer_id`
 *   - Resource fields are properties within the top-level resource schema
 *   - Response envelope: { resource_plural: item } for single, { resource_plural: [...], meta } for lists
 *   - PUT for updates (not PATCH or POST)
 *   - Actions under /{id}/actions/{action}
 *   - ID prefixes are uppercase without underscore: CU, PM, MD, SB, RF, PO, CR
 *
 * Usage:
 *   pnpm --filter @mimicai/adapter-gocardless generate
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findSpecPath(): string {
  const jsonPath = resolve(__dirname, '..', 'gocardless-spec.json');
  if (existsSync(jsonPath)) return jsonPath;
  throw new Error(`GoCardless spec not found at ${jsonPath}`);
}

const SPEC_PATH = findSpecPath();
const OUT_DIR = resolve(__dirname, '../src/generated');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OaSchema {
  type?: string;
  format?: string;
  description?: string;
  nullable?: boolean;
  enum?: unknown[];
  properties?: Record<string, OaSchema>;
  required?: string[];
  items?: OaSchema;
  $ref?: string;
  anyOf?: OaSchema[];
  oneOf?: OaSchema[];
  allOf?: OaSchema[];
  title?: string;
  default?: unknown;
  example?: unknown;
  additionalProperties?: boolean | OaSchema;
  readOnly?: boolean;
}

interface OaOperation {
  operationId?: string;
  description?: string;
  summary?: string;
  tags?: string[];
  parameters?: OaParameter[];
  requestBody?: { content?: { 'application/json'?: { schema?: OaSchema } } };
  responses?: Record<string, { content?: { 'application/json'?: { schema?: OaSchema } } }>;
}

interface OaParameter {
  name: string;
  in: 'query' | 'path' | 'header';
  required?: boolean;
  schema?: OaSchema;
  $ref?: string;
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
  info?: { version?: string; title?: string };
  components: {
    schemas: Record<string, OaSchema>;
    parameters?: Record<string, OaParameter>;
  };
  paths: Record<string, OaPathItem>;
}

// ---------------------------------------------------------------------------
// GoCardless resource definitions
// ---------------------------------------------------------------------------

interface GCResourceDef {
  resourceId: string;
  resourceKey: string;
  objectType: string;
  wrapperKey: string;       // Key used in GoCardless response envelope (e.g. "customers")
  idField: string;
  idPrefix: string;
  volumeHint: 'entity' | 'reference' | 'skip';
  schemaName: string;
}

const GC_RESOURCES: GCResourceDef[] = [
  { resourceId: 'customer', resourceKey: 'customers', objectType: 'customer', wrapperKey: 'customers', idField: 'id', idPrefix: 'CU', volumeHint: 'entity', schemaName: 'customer' },
  { resourceId: 'customer_bank_account', resourceKey: 'customer_bank_accounts', objectType: 'customer_bank_account', wrapperKey: 'customer_bank_accounts', idField: 'id', idPrefix: 'BA', volumeHint: 'entity', schemaName: 'customer_bank_account' },
  { resourceId: 'mandate', resourceKey: 'mandates', objectType: 'mandate', wrapperKey: 'mandates', idField: 'id', idPrefix: 'MD', volumeHint: 'entity', schemaName: 'mandate' },
  { resourceId: 'payment', resourceKey: 'payments', objectType: 'payment', wrapperKey: 'payments', idField: 'id', idPrefix: 'PM', volumeHint: 'entity', schemaName: 'payment' },
  { resourceId: 'subscription', resourceKey: 'subscriptions', objectType: 'subscription', wrapperKey: 'subscriptions', idField: 'id', idPrefix: 'SB', volumeHint: 'entity', schemaName: 'subscription' },
  { resourceId: 'refund', resourceKey: 'refunds', objectType: 'refund', wrapperKey: 'refunds', idField: 'id', idPrefix: 'RF', volumeHint: 'entity', schemaName: 'refund' },
  { resourceId: 'payout', resourceKey: 'payouts', objectType: 'payout', wrapperKey: 'payouts', idField: 'id', idPrefix: 'PO', volumeHint: 'reference', schemaName: 'payout' },
  { resourceId: 'creditor', resourceKey: 'creditors', objectType: 'creditor', wrapperKey: 'creditors', idField: 'id', idPrefix: 'CR', volumeHint: 'reference', schemaName: 'creditor' },
  { resourceId: 'creditor_bank_account', resourceKey: 'creditor_bank_accounts', objectType: 'creditor_bank_account', wrapperKey: 'creditor_bank_accounts', idField: 'id', idPrefix: 'BA', volumeHint: 'reference', schemaName: 'creditor_bank_account' },
  { resourceId: 'event', resourceKey: 'events', objectType: 'event', wrapperKey: 'events', idField: 'id', idPrefix: 'EV', volumeHint: 'skip', schemaName: 'event' },
  { resourceId: 'billing_request', resourceKey: 'billing_requests', objectType: 'billing_request', wrapperKey: 'billing_requests', idField: 'id', idPrefix: 'BRQ', volumeHint: 'entity', schemaName: 'billing_request' },
  { resourceId: 'instalment_schedule', resourceKey: 'instalment_schedules', objectType: 'instalment_schedule', wrapperKey: 'instalment_schedules', idField: 'id', idPrefix: 'IS', volumeHint: 'entity', schemaName: 'instalment_schedule' },
  { resourceId: 'redirect_flow', resourceKey: 'redirect_flows', objectType: 'redirect_flow', wrapperKey: 'redirect_flows', idField: 'id', idPrefix: 'RE', volumeHint: 'skip', schemaName: 'redirect_flow' },
  { resourceId: 'payout_item', resourceKey: 'payout_items', objectType: 'payout_item', wrapperKey: 'payout_items', idField: 'id', idPrefix: 'PI', volumeHint: 'skip', schemaName: 'payout_item' },
  { resourceId: 'scheme_identifier', resourceKey: 'scheme_identifiers', objectType: 'scheme_identifier', wrapperKey: 'scheme_identifiers', idField: 'id', idPrefix: 'SU', volumeHint: 'skip', schemaName: 'scheme_identifier' },
];

const SCHEMA_FIELD_OVERRIDES: Record<string, Record<string, { value?: unknown; code?: string }>> = {
  payment: {
    status: { value: 'pending_submission' },
    retry_if_possible: { value: true },
  },
  mandate: {
    status: { value: 'pending_submission' },
  },
  subscription: {
    status: { value: 'active' },
    retry_if_possible: { value: true },
  },
  refund: {
    status: { value: 'created' },
  },
  payout: {
    status: { value: 'pending' },
  },
  billing_request: {
    status: { value: 'pending' },
  },
  instalment_schedule: {
    status: { value: 'pending' },
  },
};

// ---------------------------------------------------------------------------
// Spec loading
// ---------------------------------------------------------------------------

function loadSpec(): OaSpec {
  console.log(`Loading spec from ${SPEC_PATH}...`);
  const raw = readFileSync(SPEC_PATH, 'utf-8');
  const spec: OaSpec = JSON.parse(raw);
  const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;
  const pathCount = Object.keys(spec.paths ?? {}).length;
  console.log(`  Loaded: ${schemaCount} schemas, ${pathCount} paths`);
  return spec;
}

// ---------------------------------------------------------------------------
// $ref resolver + schema flattener
// ---------------------------------------------------------------------------

function resolveRef(ref: string, spec: OaSpec): OaSchema | null {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/);
  if (!match) return null;
  return spec.components.schemas[match[1]!] ?? null;
}

function flattenSchema(
  schema: OaSchema,
  spec: OaSpec,
  visited = new Set<string>(),
  depth = 0,
): OaSchema {
  if (depth > 8) return { type: 'object' };

  if (schema.$ref) {
    if (visited.has(schema.$ref)) return { type: 'object' };
    visited.add(schema.$ref);
    const resolved = resolveRef(schema.$ref, spec);
    if (!resolved) return { type: 'string' };
    const flat = flattenSchema(resolved, spec, new Set(visited), depth + 1);
    if (schema.nullable) flat.nullable = true;
    return flat;
  }

  if (schema.anyOf && schema.anyOf.length > 0) {
    const nonEmpty = schema.anyOf.filter(s => !isNullishSchema(s));
    const isNullable = schema.anyOf.some(s => isNullishSchema(s)) || schema.nullable;
    if (nonEmpty.length >= 1) {
      const flat = flattenSchema(nonEmpty[0]!, spec, visited, depth + 1);
      if (isNullable) flat.nullable = true;
      return flat;
    }
    return { type: 'string', nullable: true };
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    const nonEmpty = schema.oneOf.filter(s => !isNullishSchema(s));
    const isNullable = schema.oneOf.some(s => isNullishSchema(s)) || schema.nullable;
    if (nonEmpty.length >= 1) {
      const flat = flattenSchema(nonEmpty[0]!, spec, visited, depth + 1);
      if (isNullable) flat.nullable = true;
      return flat;
    }
    return { type: 'string', nullable: isNullable };
  }

  if (schema.allOf && schema.allOf.length > 0) {
    let merged: OaSchema = {};
    for (const sub of schema.allOf) {
      const flat = flattenSchema(sub, spec, new Set(visited), depth + 1);
      merged = mergeSchemas(merged, flat);
    }
    if (schema.nullable) merged.nullable = true;
    return merged;
  }

  return schema;
}

function isNullishSchema(s: OaSchema): boolean {
  if (s.type === 'null') return true;
  if (s.nullable === true && !s.type && !s.$ref) return true;
  return false;
}

function mergeSchemas(base: OaSchema, ext: OaSchema): OaSchema {
  const merged: OaSchema = { ...base };
  if (ext.type) merged.type = ext.type;
  if (ext.format) merged.format = ext.format;
  if (ext.nullable) merged.nullable = true;
  if (ext.enum) merged.enum = ext.enum;
  if (ext.properties) {
    merged.properties = { ...(base.properties ?? {}), ...ext.properties };
  }
  if (ext.required) {
    merged.required = [...(base.required ?? []), ...ext.required];
  }
  if (ext.items) merged.items = ext.items;
  if (ext.description) merged.description = base.description ?? ext.description;
  return merged;
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';

interface MappedField {
  type: FieldType;
  required: boolean;
  nullable: boolean;
  default: unknown;
  enum?: unknown[];
  idPrefix?: string;
  auto?: boolean;
  timestamp?: 'iso8601';
  isAmount?: boolean;
  semanticType?: string;
  ref?: string;
}

const AMOUNT_FIELDS = new Set(['amount', 'amount_refunded', 'deducted_fees', 'total_amount', 'app_fee']);

const SEMANTIC_FIELD_NAMES: Record<string, string> = {
  email: 'email', phone_number: 'phone', country_code: 'country_code',
  city: 'city', region: 'region', postal_code: 'postal_code',
  currency: 'currency_code', language: 'locale',
};

function mapProperty(
  fieldName: string,
  rawSchema: OaSchema,
  isRequired: boolean,
  spec: OaSpec,
  idField: string,
  idPrefix: string,
): MappedField {
  const flat = flattenSchema(rawSchema, spec);
  const nullable = flat.nullable ?? false;

  let type: FieldType = 'string';
  if (flat.type === 'integer') type = 'integer';
  else if (flat.type === 'number') type = 'number';
  else if (flat.type === 'boolean') type = 'boolean';
  else if (flat.type === 'array') type = 'array';
  else if (flat.type === 'object' || flat.properties) type = 'object';

  const isTimestamp = flat.format === 'date-time' || fieldName === 'created_at';
  const isDate = flat.format === 'date' || fieldName === 'charge_date' || fieldName === 'start_date' || fieldName === 'end_date' || fieldName === 'arrival_date';
  const isAmount = AMOUNT_FIELDS.has(fieldName) && (type === 'integer' || type === 'number' || type === 'string');
  const semanticType = SEMANTIC_FIELD_NAMES[fieldName];

  let defaultValue: unknown;
  if (fieldName === idField) {
    defaultValue = '';
  } else if (isTimestamp) {
    defaultValue = undefined;
  } else if (isDate) {
    defaultValue = undefined;
  } else if (flat.enum && flat.enum.length > 0) {
    defaultValue = flat.enum.find(v => v !== '') ?? flat.enum[0];
  } else if (nullable) {
    defaultValue = null;
  } else if (type === 'boolean') {
    defaultValue = false;
  } else if (type === 'integer' || type === 'number') {
    defaultValue = 0;
  } else if (type === 'array') {
    defaultValue = [];
  } else if (type === 'object') {
    defaultValue = {};
  } else if (!isRequired) {
    defaultValue = null;
  } else {
    defaultValue = '';
  }

  return {
    type,
    required: isRequired,
    nullable,
    default: defaultValue,
    enum: flat.enum && flat.enum.length > 0 ? flat.enum : undefined,
    idPrefix: fieldName === idField ? idPrefix : undefined,
    auto: (isTimestamp || isDate) || undefined,
    timestamp: (isTimestamp || isDate) ? 'iso8601' : undefined,
    isAmount: isAmount || undefined,
    semanticType,
  };
}

// ---------------------------------------------------------------------------
// Resource extraction
// ---------------------------------------------------------------------------

interface ResourceInfo {
  schemaName: string;
  resourceId: string;
  resourceKey: string;
  objectType: string;
  wrapperKey: string;
  idField: string;
  idPrefix: string;
  fields: Record<string, MappedField>;
  volumeHint: 'entity' | 'reference' | 'skip';
  refs: string[];
}

function extractResources(spec: OaSpec): Map<string, ResourceInfo> {
  const resources = new Map<string, ResourceInfo>();

  for (const def of GC_RESOURCES) {
    const schema = spec.components.schemas[def.schemaName];
    if (!schema) {
      console.warn(`  Warning: Schema ${def.schemaName} not found, skipping ${def.resourceId}`);
      continue;
    }

    const flat = flattenSchema(schema, spec);
    const properties = flat.properties ?? {};
    const required = new Set(flat.required ?? []);
    const fields: Record<string, MappedField> = {};
    const refs: string[] = [];

    for (const [fieldName, propSchema] of Object.entries(properties)) {
      const isRequired = required.has(fieldName);
      const mapped = mapProperty(fieldName, propSchema, isRequired, spec, def.idField, def.idPrefix);
      fields[fieldName] = mapped;
    }

    // Detect refs from links object
    if (properties.links) {
      const linksFlat = flattenSchema(properties.links, spec);
      if (linksFlat.properties) {
        for (const linkName of Object.keys(linksFlat.properties)) {
          const known = GC_RESOURCES.find(r => r.resourceId === linkName || r.resourceKey === linkName);
          if (known && !refs.includes(known.resourceId)) refs.push(known.resourceId);
        }
      }
    }

    resources.set(def.resourceId, {
      schemaName: def.schemaName,
      resourceId: def.resourceId,
      resourceKey: def.resourceKey,
      objectType: def.objectType,
      wrapperKey: def.wrapperKey,
      idField: def.idField,
      idPrefix: def.idPrefix,
      fields,
      volumeHint: def.volumeHint,
      refs,
    });
  }

  return resources;
}

// ---------------------------------------------------------------------------
// Route extraction
// ---------------------------------------------------------------------------

type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';

interface ExtractedRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  stripePath: string;
  fastifyPath: string;
  resource: string;
  operation: RouteOperation;
  description: string;
  queryFilters: string[];
  idParam?: string;
  objectType?: string;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function detectGCResource(path: string): string {
  const segments = path.replace(/^\//, '').split('/');
  return segments[0]!;
}

function detectGCOperation(path: string, method: string): RouteOperation {
  const segments = path.replace(/^\//, '').split('/');
  const paramCount = (path.match(/\{[^}]+\}/g) ?? []).length;
  const lastSegment = segments[segments.length - 1]!;
  const lastIsParam = lastSegment.startsWith('{');

  // Actions pattern: /{id}/actions/{action}
  if (segments.includes('actions')) return 'action';

  // Special endpoints
  if (lastSegment === 'institutions' || lastSegment === 'transactions' || lastSegment === 'stats') return 'action';
  if (path.includes('create_with_actions') || path.includes('block_by_ref')) return 'action';

  // Standard CRUD
  if (paramCount === 0) {
    if (method === 'get') return 'list';
    if (method === 'post') return 'create';
    return 'action';
  }

  if (lastIsParam) {
    if (method === 'get') return 'retrieve';
    if (method === 'put') return 'update';
    if (method === 'delete') return 'delete';
    if (method === 'post') return 'update';
    return 'action';
  }

  return 'action';
}

function extractRoutes(spec: OaSpec): ExtractedRoute[] {
  const routes: ExtractedRoute[] = [];

  for (const [specPath, pathItem] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const httpMethod = method.toUpperCase() as ExtractedRoute['method'];
      const description = operation.summary ?? operation.description ?? '';

      const fastifyPath = '/gocardless' + specPath.replace(/\{([^}]+)\}/g, ':$1');
      const resource = detectGCResource(specPath);
      const op = detectGCOperation(specPath, method);

      // Extract query filters
      const queryFilters = (operation.parameters ?? [])
        .filter((p): p is OaParameter => 'in' in p && p.in === 'query' && p.name !== 'after' && p.name !== 'before' && p.name !== 'limit')
        .map(p => p.name);

      // Find ID param
      const pathParamMatches = specPath.match(/\{([^}]+)\}/g);
      let idParam: string | undefined;
      if (pathParamMatches && pathParamMatches.length > 0) {
        const lastParam = pathParamMatches[pathParamMatches.length - 1]!;
        idParam = lastParam.replace(/[{}]/g, '');
      }

      // Map resource to objectType
      const def = GC_RESOURCES.find(r => r.resourceKey === resource);
      const objectType = def?.objectType;

      routes.push({
        method: httpMethod,
        stripePath: specPath,
        fastifyPath,
        resource,
        operation: op,
        description: description.replace(/\n/g, ' ').slice(0, 120),
        queryFilters,
        idParam,
        objectType,
      });
    }
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Code generators
// ---------------------------------------------------------------------------

function toPascalCase(str: string): string {
  return str
    .split(/[_\s\-\.]+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function generateMetaTs(spec: OaSpec): string {
  const version = spec.info?.version ?? 'unknown';
  const generatedAt = new Date().toISOString();
  return `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-gocardless generate
// GoCardless OpenAPI spec version: ${version}
// Generated at: ${generatedAt}

export const GC_SPEC_VERSION = ${JSON.stringify(version)};
export const GC_SPEC_GENERATED_AT = ${JSON.stringify(generatedAt)};
`;
}

function generateResourceSpecsTs(resources: Map<string, ResourceInfo>): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-gocardless generate`,
    `import type { AdapterResourceSpecs } from '@mimicai/core';`,
    ``,
    `export const gocardlessResourceSpecs: AdapterResourceSpecs = {`,
    `  platform: {`,
    `    timestampFormat: 'iso8601',`,
    `    amountFormat: 'integer_cents',`,
    `    idPrefix: 'CU',`,
    `  },`,
    `  resources: {`,
  ];

  for (const [resourceId, info] of resources) {
    if (info.volumeHint === 'skip') continue;

    lines.push(`    ${JSON.stringify(resourceId)}: {`);
    lines.push(`      objectType: ${JSON.stringify(info.objectType)},`);
    lines.push(`      volumeHint: ${JSON.stringify(info.volumeHint)},`);
    lines.push(`      refs: ${JSON.stringify(info.refs)},`);
    lines.push(`      fields: {`);

    for (const [fieldName, field] of Object.entries(info.fields)) {
      const parts: string[] = [`type: ${JSON.stringify(field.type)}`];
      parts.push(`required: ${field.required}`);
      if (field.nullable) parts.push(`nullable: true`);
      if (field.default !== undefined) parts.push(`default: ${JSON.stringify(field.default)}`);
      if (field.enum) parts.push(`enum: ${JSON.stringify(field.enum)}`);
      if (field.idPrefix !== undefined) parts.push(`idPrefix: ${JSON.stringify(field.idPrefix)}`);
      if (field.auto) parts.push(`auto: true`);
      if (field.timestamp) parts.push(`timestamp: ${JSON.stringify(field.timestamp)}`);
      if (field.isAmount) parts.push(`isAmount: true`);
      if (field.semanticType) parts.push(`semanticType: ${JSON.stringify(field.semanticType)}`);
      if (field.ref) parts.push(`ref: ${JSON.stringify(field.ref)}`);
      lines.push(`        ${JSON.stringify(fieldName)}: { ${parts.join(', ')} },`);
    }

    lines.push(`      },`);
    lines.push(`    },`);
  }

  lines.push(`  },`);
  lines.push(`};`);
  lines.push(``);

  // Export wrapper key map for runtime use
  lines.push(`/** Map from resource key → GoCardless response wrapper key */`);
  lines.push(`export const WRAPPER_KEYS: Record<string, string> = {`);
  for (const [, info] of resources) {
    lines.push(`  ${JSON.stringify(info.resourceKey)}: ${JSON.stringify(info.wrapperKey)},`);
  }
  lines.push(`};`);
  lines.push(``);

  return lines.join('\n');
}

function generateSchemasTs(resources: Map<string, ResourceInfo>): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-gocardless generate`,
    `import { generateId } from '@mimicai/adapter-sdk';`,
    ``,
  ];

  for (const [, info] of resources) {
    const fnName = 'default' + toPascalCase(info.resourceId);
    lines.push(`export function ${fnName}(overrides: Record<string, unknown> = {}): Record<string, unknown> {`);
    lines.push(`  return {`);

    for (const [fieldName, field] of Object.entries(info.fields)) {
      let val: string;

      const override = SCHEMA_FIELD_OVERRIDES[info.resourceId]?.[fieldName];
      if (override?.code !== undefined) {
        val = override.code;
      } else if (override?.value !== undefined) {
        val = JSON.stringify(override.value);
      } else if (fieldName === info.idField) {
        val = `generateId(${JSON.stringify(info.idPrefix)}, 8)`;
      } else if (field.auto && field.timestamp === 'iso8601') {
        if (fieldName === 'charge_date' || fieldName === 'start_date' || fieldName === 'arrival_date') {
          val = `new Date(Date.now() + 5 * 86400_000).toISOString().split('T')[0]!`;
        } else {
          val = `new Date().toISOString()`;
        }
      } else {
        val = JSON.stringify(field.default);
      }
      lines.push(`    ${JSON.stringify(fieldName)}: ${val},`);
    }

    lines.push(`    ...overrides,`);
    lines.push(`  };`);
    lines.push(`}`);
    lines.push(``);
  }

  lines.push(`export type DefaultFactory = (overrides?: Record<string, unknown>) => Record<string, unknown>;`);
  lines.push(``);
  lines.push(`export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {`);
  const seenKeys = new Set<string>();
  for (const [resourceId, info] of resources) {
    const fnName = 'default' + toPascalCase(info.resourceId);
    if (!seenKeys.has(resourceId)) {
      lines.push(`  ${JSON.stringify(resourceId)}: ${fnName},`);
      seenKeys.add(resourceId);
    }
    if (!seenKeys.has(info.resourceKey)) {
      lines.push(`  ${JSON.stringify(info.resourceKey)}: ${fnName},`);
      seenKeys.add(info.resourceKey);
    }
  }
  lines.push(`};`);
  lines.push(``);
  return lines.join('\n');
}

function generateRoutesTs(routes: ExtractedRoute[]): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-gocardless generate`,
    ``,
    `export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';`,
    `export type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';`,
    ``,
    `export interface GeneratedRoute {`,
    `  method: RouteMethod;`,
    `  fastifyPath: string;`,
    `  /** Original GoCardless spec path (field name is historical) */`,
    `  stripePath: string;`,
    `  resource: string;`,
    `  operation: RouteOperation;`,
    `  description: string;`,
    `  queryFilters: string[];`,
    `  idParam?: string;`,
    `  objectType?: string;`,
    `}`,
    ``,
    `export const GENERATED_ROUTES: GeneratedRoute[] = [`,
  ];

  for (const route of routes) {
    lines.push(`  {`);
    lines.push(`    method: ${JSON.stringify(route.method)},`);
    lines.push(`    fastifyPath: ${JSON.stringify(route.fastifyPath)},`);
    lines.push(`    stripePath: ${JSON.stringify(route.stripePath)},`);
    lines.push(`    resource: ${JSON.stringify(route.resource)},`);
    lines.push(`    operation: ${JSON.stringify(route.operation)},`);
    lines.push(`    description: ${JSON.stringify(route.description)},`);
    lines.push(`    queryFilters: ${JSON.stringify(route.queryFilters)},`);
    if (route.idParam) lines.push(`    idParam: ${JSON.stringify(route.idParam)},`);
    if (route.objectType) lines.push(`    objectType: ${JSON.stringify(route.objectType)},`);
    lines.push(`  },`);
  }

  lines.push(`];`);
  lines.push(``);
  lines.push(`export function routeKey(method: RouteMethod, fastifyPath: string): string {`);
  lines.push(`  return \`\${method}:\${fastifyPath}\`;`);
  lines.push(`}`);
  lines.push(``);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const spec = loadSpec();

  console.log('Extracting resources...');
  const resources = extractResources(spec);
  console.log(`  Found ${resources.size} resources`);

  console.log('Extracting routes...');
  const routes = extractRoutes(spec);
  const routesByOp = routes.reduce((acc, r) => {
    acc[r.operation] = (acc[r.operation] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log(`  Found ${routes.length} routes: ${JSON.stringify(routesByOp)}`);

  const resourceGroups = new Set(routes.map(r => r.resource));
  console.log(`  Resource groups: ${resourceGroups.size} (${[...resourceGroups].join(', ')})`);

  mkdirSync(OUT_DIR, { recursive: true });

  writeFileSync(`${OUT_DIR}/meta.ts`, generateMetaTs(spec));
  console.log('  ✓ meta.ts');

  writeFileSync(`${OUT_DIR}/resource-specs.ts`, generateResourceSpecsTs(resources));
  console.log('  ✓ resource-specs.ts');

  writeFileSync(`${OUT_DIR}/schemas.ts`, generateSchemasTs(resources));
  console.log('  ✓ schemas.ts');

  writeFileSync(`${OUT_DIR}/routes.ts`, generateRoutesTs(routes));
  console.log('  ✓ routes.ts');

  const totalFields = [...resources.values()].reduce((sum, r) => sum + Object.keys(r.fields).length, 0);
  console.log(`\nCodegen complete:`);
  console.log(`  ${resources.size} resources, ${totalFields} total fields`);
  console.log(`  ${routes.length} routes`);
}

main();
