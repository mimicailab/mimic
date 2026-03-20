#!/usr/bin/env node
/**
 * Plaid OpenAPI → Mimic codegen
 *
 * Reads the Plaid OpenAPI spec (YAML or JSON) and generates four TypeScript
 * source files into src/generated/:
 *
 *   resource-specs.ts  – AdapterResourceSpecs covering all core Plaid data models
 *   schemas.ts         – defaultXxx() factory functions for mock data
 *   routes.ts          – GeneratedRoute[] covering all Plaid paths
 *   meta.ts            – spec version + generated timestamp
 *
 * Key differences from Stripe codegen:
 *   - Plaid is RPC-style (all POST, no path params, no REST CRUD)
 *   - Supports YAML and JSON spec files
 *   - Resources identified by curated schema list (no x-resourceId in spec)
 *   - Routes grouped by path prefix (e.g., /transactions/*, /accounts/*)
 *
 * Usage:
 *   pnpm --filter @mimicai/adapter-plaid generate
 *   (or: npx tsx scripts/plaid-codegen.ts)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Locate the spec file — support both YAML and JSON
function findSpecPath(): string {
  const yamlPath = resolve(__dirname, '..', 'plaid-spec.yaml');
  const jsonPath = resolve(__dirname, '..', 'plaid-spec.json');
  if (existsSync(yamlPath)) return yamlPath;
  if (existsSync(jsonPath)) return jsonPath;
  throw new Error(
    `Plaid spec not found.\n` +
    `Download it:\n  curl -fsSL https://raw.githubusercontent.com/plaid/plaid-openapi/refs/heads/master/2020-09-14.yml -o plaid-spec.yaml`,
  );
}

const SPEC_PATH = findSpecPath();
const OUT_DIR = resolve(__dirname, '../src/generated');

// ---------------------------------------------------------------------------
// Types (minimal OpenAPI 3.0 shape)
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
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  additionalProperties?: boolean | OaSchema;
  'x-hidden-from-docs'?: boolean;
}

interface OaOperation {
  operationId?: string;
  description?: string;
  summary?: string;
  parameters?: OaParameter[];
  requestBody?: { content?: { 'application/json'?: { schema?: OaSchema } } };
  responses?: Record<string, { content?: { 'application/json'?: { schema?: OaSchema } } }>;
  'x-hidden-from-docs'?: boolean;
}

interface OaParameter {
  name: string;
  in: 'query' | 'path' | 'header';
  required?: boolean;
  schema?: OaSchema;
}

interface OaPathItem {
  get?: OaOperation;
  post?: OaOperation;
  put?: OaOperation;
  patch?: OaOperation;
  delete?: OaOperation;
}

interface OaSpec {
  info?: { version?: string; title?: string };
  components: { schemas: Record<string, OaSchema> };
  paths: Record<string, OaPathItem>;
}

// ---------------------------------------------------------------------------
// Plaid resource definitions
// ---------------------------------------------------------------------------

// Map from schema name → resource config. Plaid doesn't have x-resourceId,
// so we curate the list of schemas that represent core data models.
interface PlaidResourceDef {
  resourceId: string;       // e.g. 'account'
  resourceKey: string;      // e.g. 'accounts' (used in StateStore namespace)
  objectType: string;       // returned in mock responses
  idField: string;          // e.g. 'account_id'
  idPrefix: string;         // e.g. 'acc_'
  volumeHint: 'entity' | 'reference' | 'skip';
  schemaName: string;       // PascalCase schema in components/schemas
}

const PLAID_RESOURCES: PlaidResourceDef[] = [
  { resourceId: 'item', resourceKey: 'items', objectType: 'item', idField: 'item_id', idPrefix: 'item_', volumeHint: 'entity', schemaName: 'Item' },
  { resourceId: 'account', resourceKey: 'accounts', objectType: 'account', idField: 'account_id', idPrefix: 'acc_', volumeHint: 'entity', schemaName: 'AccountBase' },
  { resourceId: 'transaction', resourceKey: 'transactions', objectType: 'transaction', idField: 'transaction_id', idPrefix: 'txn_', volumeHint: 'entity', schemaName: 'Transaction' },
  { resourceId: 'institution', resourceKey: 'institutions', objectType: 'institution', idField: 'institution_id', idPrefix: 'ins_', volumeHint: 'reference', schemaName: 'Institution' },
  { resourceId: 'holding', resourceKey: 'holdings', objectType: 'holding', idField: 'holding_id', idPrefix: 'hld_', volumeHint: 'entity', schemaName: 'Holding' },
  { resourceId: 'security', resourceKey: 'securities', objectType: 'security', idField: 'security_id', idPrefix: 'sec_', volumeHint: 'reference', schemaName: 'Security' },
  { resourceId: 'investment_transaction', resourceKey: 'investment_transactions', objectType: 'investment_transaction', idField: 'investment_transaction_id', idPrefix: 'inv_txn_', volumeHint: 'entity', schemaName: 'InvestmentTransaction' },
  { resourceId: 'identity', resourceKey: 'identities', objectType: 'identity', idField: 'account_id', idPrefix: 'acc_', volumeHint: 'entity', schemaName: 'AccountIdentity' },
  { resourceId: 'link_token', resourceKey: 'link_tokens', objectType: 'link_token', idField: 'link_token', idPrefix: 'link-sandbox-', volumeHint: 'skip', schemaName: 'LinkTokenCreateResponse' },
  { resourceId: 'asset_report', resourceKey: 'asset_reports', objectType: 'asset_report', idField: 'asset_report_id', idPrefix: 'ar_', volumeHint: 'skip', schemaName: 'AssetReport' },
];

// Schema field overrides: fix defaults that are wrong for typical mock usage
const SCHEMA_FIELD_OVERRIDES: Record<string, Record<string, { value?: unknown; code?: string }>> = {
  item: {
    error: { value: null },
    consent_expiration_time: { value: null },
    update_type: { value: 'background' },
  },
  account: {
    verification_status: { value: null },
  },
  link_token: {
    expiration: { code: 'new Date(Date.now() + 4 * 3600_000).toISOString()' },
  },
};

// ---------------------------------------------------------------------------
// Spec loading
// ---------------------------------------------------------------------------

function loadSpec(): OaSpec {
  console.log(`Loading spec from ${SPEC_PATH}...`);
  const raw = readFileSync(SPEC_PATH, 'utf-8');
  const ext = extname(SPEC_PATH).toLowerCase();
  const spec: OaSpec = (ext === '.yaml' || ext === '.yml') ? parseYaml(raw) : JSON.parse(raw);
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
    if (schema.description) merged.description = merged.description ?? schema.description;
    return merged;
  }

  return schema;
}

function isNullishSchema(s: OaSchema): boolean {
  return (s.nullable === true && !s.type && !s.$ref) ||
    (Array.isArray(s.enum) && s.enum.length === 1 && s.enum[0] === '');
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

const AMOUNT_FIELDS = new Set([
  'amount', 'current', 'available', 'limit', 'iso_currency_code',
  'unofficial_currency_code', 'cost_basis', 'institution_price',
  'quantity', 'close_price', 'authorized_amount', 'captured_amount',
]);

const SEMANTIC_FIELD_NAMES: Record<string, string> = {
  email: 'email', phone_number: 'phone', url: 'url',
  address: 'address', country: 'country_code', city: 'city',
  region: 'region', postal_code: 'postal_code', street: 'street',
};

function mapProperty(
  fieldName: string,
  rawSchema: OaSchema,
  isRequired: boolean,
  spec: OaSpec,
  idField?: string,
  idPrefix?: string,
): MappedField {
  const flat = flattenSchema(rawSchema, spec);
  const nullable = flat.nullable ?? false;

  let type: FieldType = 'string';
  if (flat.type === 'integer') type = 'integer';
  else if (flat.type === 'number') type = 'number';
  else if (flat.type === 'boolean') type = 'boolean';
  else if (flat.type === 'array') type = 'array';
  else if (flat.type === 'object' || flat.properties) type = 'object';

  // Plaid uses ISO 8601 dates (format: 'date' or 'date-time')
  const isDate = flat.format === 'date' || flat.format === 'date-time';

  // Amount detection
  const isAmount = AMOUNT_FIELDS.has(fieldName) && (type === 'number' || type === 'integer');

  // Semantic type
  const semanticType = SEMANTIC_FIELD_NAMES[fieldName];

  // Default value
  let defaultValue: unknown;
  if (fieldName === idField) {
    defaultValue = '';
  } else if (isDate) {
    defaultValue = undefined; // auto-generated
  } else if (flat.enum && flat.enum.length > 0) {
    defaultValue = flat.enum.find(v => v !== '') ?? flat.enum[0];
  } else if (nullable && !isRequired) {
    defaultValue = null;
  } else if (type === 'boolean') {
    defaultValue = false;
  } else if (type === 'integer' || type === 'number') {
    defaultValue = 0;
  } else if (type === 'array') {
    defaultValue = [];
  } else if (type === 'object') {
    if (flat.properties) {
      defaultValue = computeObjectDefault(flat, spec);
    } else {
      defaultValue = {};
    }
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
    auto: isDate || undefined,
    timestamp: isDate ? 'iso8601' : undefined,
    isAmount: isAmount || undefined,
    semanticType,
  };
}

function computeObjectDefault(
  schema: OaSchema,
  spec: OaSpec,
  visited = new Set<string>(),
  depth = 0,
): Record<string, unknown> {
  if (depth > 4) return {};
  const flat = flattenSchema(schema, spec, new Set(visited), depth);
  if (!flat.properties) return {};
  const result: Record<string, unknown> = {};
  const required = new Set(flat.required ?? []);
  for (const [name, propSchema] of Object.entries(flat.properties)) {
    const propFlat = flattenSchema(propSchema, spec, new Set(visited), depth + 1);
    const isReq = required.has(name);
    if (propFlat.nullable && !isReq) { result[name] = null; continue; }
    if (propFlat.type === 'boolean') { result[name] = false; continue; }
    if (propFlat.type === 'integer' || propFlat.type === 'number') { result[name] = 0; continue; }
    if (propFlat.type === 'array') { result[name] = []; continue; }
    if (propFlat.type === 'object') { result[name] = {}; continue; }
    if (propFlat.enum && propFlat.enum.length > 0) {
      result[name] = propFlat.enum.find(v => v !== '') ?? propFlat.enum[0];
      continue;
    }
    result[name] = isReq ? '' : null;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Resource extraction
// ---------------------------------------------------------------------------

interface ResourceInfo {
  schemaName: string;
  resourceId: string;
  resourceKey: string;
  objectType: string;
  idField: string;
  idPrefix: string;
  fields: Record<string, MappedField>;
  volumeHint: 'entity' | 'reference' | 'skip';
  refs: string[];
}

function extractResources(spec: OaSpec): Map<string, ResourceInfo> {
  const resources = new Map<string, ResourceInfo>();

  for (const def of PLAID_RESOURCES) {
    const schema = spec.components.schemas[def.schemaName];
    if (!schema) {
      console.warn(`  ⚠ Schema ${def.schemaName} not found, skipping ${def.resourceId}`);
      continue;
    }

    const flat = flattenSchema(schema, spec);
    const properties = flat.properties ?? {};
    const required = new Set(flat.required ?? []);
    const fields: Record<string, MappedField> = {};

    for (const [fieldName, propSchema] of Object.entries(properties)) {
      // Skip internal/auth fields
      if (fieldName === 'client_id' || fieldName === 'secret') continue;
      const isRequired = required.has(fieldName);
      fields[fieldName] = mapProperty(fieldName, propSchema, isRequired, spec, def.idField, def.idPrefix);
    }

    resources.set(def.resourceId, {
      schemaName: def.schemaName,
      resourceId: def.resourceId,
      resourceKey: def.resourceKey,
      objectType: def.objectType,
      idField: def.idField,
      idPrefix: def.idPrefix,
      fields,
      volumeHint: def.volumeHint,
      refs: [],
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
  stripePath: string;       // original Plaid path (field name is historical)
  fastifyPath: string;      // /plaid/transactions/get
  resource: string;         // 'transactions'
  operation: RouteOperation;
  description: string;
  queryFilters: string[];
  idParam?: string;
  objectType?: string;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

// Map Plaid path prefixes to resource groups
function detectPlaidResource(path: string): string {
  // Remove leading slash, split by /
  const segments = path.replace(/^\//, '').split('/');

  // Special compound resources
  const twoSegment = segments.slice(0, 2).join('/');
  const compoundMap: Record<string, string> = {
    'link/token': 'link_token',
    'asset_report': 'asset_report',
    'bank_transfer': 'bank_transfer',
    'payment_initiation': 'payment_initiation',
    'identity_verification': 'identity_verification',
    'watchlist_screening': 'watchlist_screening',
    'item/public_token': 'item',
    'item/access_token': 'item',
    'item/application': 'item',
    'sandbox/item': 'sandbox',
    'sandbox/public_token': 'sandbox',
    'sandbox/bank_transfer': 'sandbox',
    'sandbox/transfer': 'sandbox',
    'sandbox/processor_token': 'sandbox',
    'sandbox/bank_income': 'sandbox',
    'sandbox/payment_profile': 'sandbox',
    'accounts/balance': 'accounts',
  };
  if (compoundMap[twoSegment]) return compoundMap[twoSegment];

  return segments[0] ?? 'unknown';
}

function detectPlaidOperation(path: string, _method: string): RouteOperation {
  const lastSegment = path.split('/').pop() ?? '';

  // Plaid action verbs in the last path segment
  if (lastSegment === 'get') return 'retrieve';
  if (lastSegment === 'list') return 'list';
  if (lastSegment === 'create') return 'create';
  if (lastSegment === 'remove' || lastSegment === 'delete') return 'delete';
  if (lastSegment === 'update') return 'update';

  // Everything else is an action (refresh, sync, invalidate, fire_webhook, etc.)
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

      // Plaid has no path params, so fastifyPath is just specPath
      const fastifyPath = specPath;

      const resource = detectPlaidResource(specPath);
      const op = detectPlaidOperation(specPath, httpMethod);

      routes.push({
        method: httpMethod,
        stripePath: specPath,
        fastifyPath,
        resource,
        operation: op,
        description: description.replace(/\n/g, ' ').slice(0, 120),
        queryFilters: [],
        objectType: undefined,
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
  return `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-plaid generate
// Plaid OpenAPI spec version: ${version}
// Generated at: ${generatedAt}

export const PLAID_SPEC_VERSION = ${JSON.stringify(version)};
export const PLAID_SPEC_GENERATED_AT = ${JSON.stringify(generatedAt)};
`;
}

function generateResourceSpecsTs(resources: Map<string, ResourceInfo>): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-plaid generate`,
    `import type { AdapterResourceSpecs } from '@mimicai/core';`,
    ``,
    `export const plaidResourceSpecs: AdapterResourceSpecs = {`,
    `  platform: {`,
    `    timestampFormat: 'iso8601',`,
    `    amountFormat: 'decimal_string',`,
    `    idPrefix: 'acc_',`,
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
      lines.push(`        ${JSON.stringify(fieldName)}: { ${parts.join(', ')} },`);
    }

    lines.push(`      },`);
    lines.push(`    },`);
  }

  lines.push(`  },`);
  lines.push(`};`);
  lines.push(``);
  return lines.join('\n');
}

function generateSchemasTs(resources: Map<string, ResourceInfo>): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-plaid generate`,
    `import { generateId } from '@mimicai/adapter-sdk';`,
    ``,
    `/**`,
    ` * Returns a complete Plaid object with all fields defaulted to spec-faithful values.`,
    ` * The caller merges request body fields on top of this default skeleton.`,
    ` */`,
    ``,
  ];

  for (const [, info] of resources) {
    const fnName = 'default' + toPascalCase(info.resourceId);
    lines.push(`export function ${fnName}(overrides: Record<string, unknown> = {}): Record<string, unknown> {`);
    lines.push(`  return {`);

    for (const [fieldName, field] of Object.entries(info.fields)) {
      let val: string;

      // Check overrides first — they take priority over auto-detection
      const override = SCHEMA_FIELD_OVERRIDES[info.resourceId]?.[fieldName];
      if (override?.code !== undefined) {
        val = override.code;
      } else if (override?.value !== undefined) {
        val = JSON.stringify(override.value);
      } else if (fieldName === info.idField) {
        val = `generateId(${JSON.stringify(info.idPrefix)}, 14)`;
      } else if (field.auto && field.timestamp === 'iso8601') {
        val = `new Date().toISOString().split('T')[0]!`;
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

  // Lookup map
  lines.push(`// ---------------------------------------------------------------------------`);
  lines.push(`// Lookup map: resourceId → default factory`);
  lines.push(`// ---------------------------------------------------------------------------`);
  lines.push(``);
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
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-plaid generate`,
    ``,
    `export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';`,
    `export type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';`,
    ``,
    `export interface GeneratedRoute {`,
    `  /** HTTP method */`,
    `  method: RouteMethod;`,
    `  /** Fastify route path */`,
    `  fastifyPath: string;`,
    `  /** Original Plaid spec path (field name is historical) */`,
    `  stripePath: string;`,
    `  /** Resource group (e.g. 'transactions', 'accounts') */`,
    `  resource: string;`,
    `  /** CRUD operation classification */`,
    `  operation: RouteOperation;`,
    `  /** Human-readable description from the spec */`,
    `  description: string;`,
    `  /** Query param names for filtering (unused — Plaid uses POST bodies) */`,
    `  queryFilters: string[];`,
    `  /** Path param name holding resource ID (unused — Plaid has no path params) */`,
    `  idParam?: string;`,
    `  /** Object type string for delete confirmation responses */`,
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
  lines.push(`/**`);
  lines.push(` * Build an override key for a route: "\${METHOD}:\${fastifyPath}"`);
  lines.push(` */`);
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

  const entityCount = [...resources.values()].filter(r => r.volumeHint === 'entity').length;
  const refCount = [...resources.values()].filter(r => r.volumeHint === 'reference').length;
  console.log(`  Blueprint resources: ${entityCount} entity, ${refCount} reference`);

  console.log('Extracting routes...');
  const routes = extractRoutes(spec);
  const routesByOp = routes.reduce((acc, r) => {
    acc[r.operation] = (acc[r.operation] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log(`  Found ${routes.length} routes: ${JSON.stringify(routesByOp)}`);

  // Unique resource groups
  const resourceGroups = new Set(routes.map(r => r.resource));
  console.log(`  Resource groups: ${resourceGroups.size} (${[...resourceGroups].slice(0, 15).join(', ')}...)`);

  mkdirSync(OUT_DIR, { recursive: true });

  const metaTs = generateMetaTs(spec);
  writeFileSync(`${OUT_DIR}/meta.ts`, metaTs);
  console.log('  ✓ meta.ts');

  const resourceSpecsTs = generateResourceSpecsTs(resources);
  writeFileSync(`${OUT_DIR}/resource-specs.ts`, resourceSpecsTs);
  console.log('  ✓ resource-specs.ts');

  const schemasTs = generateSchemasTs(resources);
  writeFileSync(`${OUT_DIR}/schemas.ts`, schemasTs);
  console.log('  ✓ schemas.ts');

  const routesTs = generateRoutesTs(routes);
  writeFileSync(`${OUT_DIR}/routes.ts`, routesTs);
  console.log('  ✓ routes.ts');

  const totalFields = [...resources.values()].reduce((sum, r) => sum + Object.keys(r.fields).length, 0);
  console.log(`\nCodegen complete:`);
  console.log(`  ${resources.size} resources, ${totalFields} total fields`);
  console.log(`  ${routes.length} routes across all Plaid paths`);
  console.log(`  Output: ${OUT_DIR}/`);
}

main();
