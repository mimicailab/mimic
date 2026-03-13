#!/usr/bin/env node
/**
 * Paddle OpenAPI → Mimic codegen
 *
 * Reads the Paddle OpenAPI spec (YAML) and generates four TypeScript
 * source files into src/generated/:
 *
 *   resource-specs.ts  – AdapterResourceSpecs covering all core Paddle entities
 *   schemas.ts         – defaultXxx() factory functions for mock data
 *   routes.ts          – GeneratedRoute[] covering all Paddle paths
 *   meta.ts            – spec version + generated timestamp
 *
 * Usage:
 *   pnpm --filter @mimicai/adapter-paddle generate
 *   (or: npx tsx scripts/paddle-codegen.ts)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findSpecPath(): string {
  const yamlPath = resolve(__dirname, '..', 'paddle-spec.yaml');
  const jsonPath = resolve(__dirname, '..', 'paddle-spec.json');
  if (existsSync(yamlPath)) return yamlPath;
  if (existsSync(jsonPath)) return jsonPath;
  throw new Error(
    `Paddle spec not found.\n` +
    `Download it:\n  curl -fsSL https://raw.githubusercontent.com/PaddleHQ/paddle-openapi/main/v1/openapi.yaml -o paddle-spec.yaml`,
  );
}

const SPEC_PATH = findSpecPath();
const OUT_DIR = resolve(__dirname, '../src/generated');

// ---------------------------------------------------------------------------
// Types (minimal OpenAPI 3.1 shape)
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
  pattern?: string;
  examples?: unknown[];
  readOnly?: boolean;
  additionalProperties?: boolean | OaSchema;
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
// Paddle resource definitions
// ---------------------------------------------------------------------------

interface PaddleResourceDef {
  resourceId: string;
  resourceKey: string;
  objectType: string;
  idField: string;
  idPrefix: string;
  volumeHint: 'entity' | 'reference' | 'skip';
  schemaName: string;
}

const PADDLE_RESOURCES: PaddleResourceDef[] = [
  { resourceId: 'customer', resourceKey: 'customers', objectType: 'customer', idField: 'id', idPrefix: 'ctm_', volumeHint: 'entity', schemaName: 'Customer' },
  { resourceId: 'address', resourceKey: 'addresses', objectType: 'address', idField: 'id', idPrefix: 'add_', volumeHint: 'entity', schemaName: 'Address' },
  { resourceId: 'business', resourceKey: 'businesses', objectType: 'business', idField: 'id', idPrefix: 'biz_', volumeHint: 'entity', schemaName: 'Business' },
  { resourceId: 'product', resourceKey: 'products', objectType: 'product', idField: 'id', idPrefix: 'pro_', volumeHint: 'reference', schemaName: 'Product' },
  { resourceId: 'price', resourceKey: 'prices', objectType: 'price', idField: 'id', idPrefix: 'pri_', volumeHint: 'reference', schemaName: 'Price' },
  { resourceId: 'discount', resourceKey: 'discounts', objectType: 'discount', idField: 'id', idPrefix: 'dsc_', volumeHint: 'reference', schemaName: 'Discount' },
  { resourceId: 'discount_group', resourceKey: 'discount_groups', objectType: 'discount_group', idField: 'id', idPrefix: 'dsg_', volumeHint: 'reference', schemaName: 'DiscountGroup' },
  { resourceId: 'transaction', resourceKey: 'transactions', objectType: 'transaction', idField: 'id', idPrefix: 'txn_', volumeHint: 'entity', schemaName: 'Transaction' },
  { resourceId: 'subscription', resourceKey: 'subscriptions', objectType: 'subscription', idField: 'id', idPrefix: 'sub_', volumeHint: 'entity', schemaName: 'Subscription' },
  { resourceId: 'adjustment', resourceKey: 'adjustments', objectType: 'adjustment', idField: 'id', idPrefix: 'adj_', volumeHint: 'entity', schemaName: 'Adjustment' },
  { resourceId: 'event', resourceKey: 'events', objectType: 'event', idField: 'id', idPrefix: 'evt_', volumeHint: 'skip', schemaName: 'Event' },
  { resourceId: 'notification_setting', resourceKey: 'notification_settings', objectType: 'notification_setting', idField: 'id', idPrefix: 'ntfset_', volumeHint: 'skip', schemaName: 'NotificationSetting' },
  { resourceId: 'notification', resourceKey: 'notifications', objectType: 'notification', idField: 'id', idPrefix: 'ntf_', volumeHint: 'skip', schemaName: 'Notification' },
  { resourceId: 'report', resourceKey: 'reports', objectType: 'report', idField: 'id', idPrefix: 'rep_', volumeHint: 'skip', schemaName: 'Report' },
  { resourceId: 'client_token', resourceKey: 'client_tokens', objectType: 'client_token', idField: 'id', idPrefix: 'ctkn_', volumeHint: 'skip', schemaName: 'ClientToken' },
];

// Schema field overrides: fix defaults for typical mock usage
const SCHEMA_FIELD_OVERRIDES: Record<string, Record<string, { value?: unknown; code?: string }>> = {
  customer: {
    status: { value: 'active' },
    marketing_consent: { value: false },
  },
  product: {
    status: { value: 'active' },
    type: { value: 'standard' },
  },
  price: {
    status: { value: 'active' },
    type: { value: 'standard' },
    tax_mode: { value: 'account_setting' },
  },
  subscription: {
    status: { value: 'active' },
    collection_mode: { value: 'automatic' },
  },
  transaction: {
    status: { value: 'draft' },
    origin: { value: 'api' },
    collection_mode: { value: 'automatic' },
  },
  discount: {
    status: { value: 'active' },
    enabled_for_checkout: { value: true },
    type: { value: 'percentage' },
    mode: { value: 'standard' },
    recur: { value: false },
    times_used: { value: 0 },
  },
  address: {
    status: { value: 'active' },
  },
  business: {
    status: { value: 'active' },
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
  if (s.type === 'null') return true;
  if (s.nullable === true && !s.type && !s.$ref) return true;
  if (Array.isArray(s.enum) && s.enum.length === 1 && s.enum[0] === '') return true;
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
  if (ext.pattern) merged.pattern = ext.pattern;
  if (ext.examples) merged.examples = ext.examples;
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
  'amount', 'unit_price', 'subtotal', 'tax', 'total', 'grand_total',
  'fee', 'earnings', 'balance', 'credit',
]);

const SEMANTIC_FIELD_NAMES: Record<string, string> = {
  email: 'email', locale: 'locale', country_code: 'country_code',
  city: 'city', region: 'region', postal_code: 'postal_code',
  currency_code: 'currency_code',
};

const FIELD_REFS: Record<string, string> = {
  customer_id: 'customer',
  address_id: 'address',
  business_id: 'business',
  product_id: 'product',
  price_id: 'price',
  discount_id: 'discount',
  subscription_id: 'subscription',
  transaction_id: 'transaction',
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

  // Paddle uses ISO 8601 timestamps
  const isTimestamp = flat.format === 'date-time' ||
    fieldName.endsWith('_at') ||
    fieldName === 'created_at' || fieldName === 'updated_at';

  const isAmount = AMOUNT_FIELDS.has(fieldName) && (type === 'string' || type === 'number');
  const semanticType = SEMANTIC_FIELD_NAMES[fieldName];

  // Default value
  let defaultValue: unknown;
  if (fieldName === idField) {
    defaultValue = '';
  } else if (isTimestamp) {
    defaultValue = undefined; // auto-generated
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
    auto: isTimestamp || undefined,
    timestamp: isTimestamp ? 'iso8601' : undefined,
    isAmount: isAmount || undefined,
    semanticType,
    ref: FIELD_REFS[fieldName],
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
    if (propFlat.type === 'null') { result[name] = null; continue; }
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

  for (const def of PADDLE_RESOURCES) {
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
      if (mapped.ref && !refs.includes(mapped.ref)) refs.push(mapped.ref);
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

// Map Paddle paths to resource groups
function detectPaddleResource(path: string): string {
  const segments = path.replace(/^\//, '').split('/');

  // Sub-resources under customers
  if (segments[0] === 'customers' && segments.length >= 3) {
    const subResource = segments[2];
    if (subResource === 'addresses') return 'addresses';
    if (subResource === 'businesses') return 'businesses';
    if (subResource === 'payment-methods') return 'payment_methods';
    if (subResource === 'credit-balances') return 'credit_balances';
    if (subResource === 'auth-token') return 'customers';
    if (subResource === 'portal-sessions') return 'portal_sessions';
  }

  // Compound path resources
  const compoundMap: Record<string, string> = {
    'discount-groups': 'discount_groups',
    'notification-settings': 'notification_settings',
    'event-types': 'event_types',
    'client-tokens': 'client_tokens',
    'simulation-types': 'simulation_types',
    'pricing-preview': 'pricing_preview',
  };

  const firstSegment = segments[0]!;
  if (compoundMap[firstSegment]) return compoundMap[firstSegment];

  return firstSegment;
}

function detectPaddleOperation(path: string, method: string): RouteOperation {
  const segments = path.replace(/^\//, '').split('/');
  const lastSegment = segments[segments.length - 1]!;
  const paramCount = (path.match(/\{[^}]+\}/g) ?? []).length;
  const lastIsParam = lastSegment.startsWith('{');

  // Action verbs as last segment
  const actionVerbs = new Set(['cancel', 'pause', 'resume', 'activate', 'revise', 'replay', 'preview', 'charge']);
  if (actionVerbs.has(lastSegment)) return 'action';

  // Special cases
  if (lastSegment === 'download-url' || lastSegment === 'credit-note' || lastSegment === 'invoice') return 'action';
  if (lastSegment === 'update-payment-method-transaction') return 'action';
  if (lastSegment === 'auth-token' || lastSegment === 'portal-sessions') return 'action';

  // Standard CRUD
  if (paramCount === 0 || (!lastIsParam && !actionVerbs.has(lastSegment))) {
    if (method === 'get') return 'list';
    if (method === 'post') return 'create';
    return 'action';
  }

  if (lastIsParam) {
    if (method === 'get') return 'retrieve';
    if (method === 'patch') return 'update';
    if (method === 'delete') return 'delete';
    if (method === 'post') return 'update';
    return 'action';
  }

  return 'action';
}

function resolveParameter(param: OaParameter | { $ref?: string }, spec: OaSpec): OaParameter | null {
  if ('$ref' in param && param.$ref) {
    const match = param.$ref.match(/^#\/components\/parameters\/(.+)$/);
    if (match && spec.components.parameters) {
      return spec.components.parameters[match[1]!] ?? null;
    }
    return null;
  }
  return param as OaParameter;
}

function extractRoutes(spec: OaSpec): ExtractedRoute[] {
  const routes: ExtractedRoute[] = [];

  for (const [specPath, pathItem] of Object.entries(spec.paths)) {
    // Resolve path-level parameters
    const pathParams = (pathItem.parameters ?? [])
      .map(p => resolveParameter(p, spec))
      .filter((p): p is OaParameter => p !== null);

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const httpMethod = method.toUpperCase() as ExtractedRoute['method'];
      const description = operation.summary ?? operation.description ?? '';

      // Convert {param} to :param for Fastify
      const fastifyPath = '/paddle' + specPath.replace(/\{([^}]+)\}/g, ':$1');

      const resource = detectPaddleResource(specPath);
      const op = detectPaddleOperation(specPath, method);

      // Extract query filters from parameters
      const allParams = [
        ...pathParams,
        ...(operation.parameters ?? []).map(p => resolveParameter(p, spec)).filter((p): p is OaParameter => p !== null),
      ];
      const queryFilters = allParams
        .filter(p => p.in === 'query' && p.name !== 'after' && p.name !== 'per_page' && p.name !== 'order_by' && p.name !== 'include')
        .map(p => p.name);

      // Find the ID param (last path param)
      const pathParamMatches = specPath.match(/\{([^}]+)\}/g);
      let idParam: string | undefined;
      if (pathParamMatches && pathParamMatches.length > 0) {
        const lastParam = pathParamMatches[pathParamMatches.length - 1]!;
        idParam = lastParam.replace(/[{}]/g, '');
      }

      // Map resource to objectType
      const resourceToObject: Record<string, string> = {};
      for (const r of PADDLE_RESOURCES) {
        resourceToObject[r.resourceKey] = r.objectType;
        resourceToObject[r.resourceKey.replace(/_/g, '-')] = r.objectType;
      }
      const objectType = resourceToObject[resource];

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
  return `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-paddle generate
// Paddle OpenAPI spec version: ${version}
// Generated at: ${generatedAt}

export const PADDLE_SPEC_VERSION = ${JSON.stringify(version)};
export const PADDLE_SPEC_GENERATED_AT = ${JSON.stringify(generatedAt)};
`;
}

function generateResourceSpecsTs(resources: Map<string, ResourceInfo>): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-paddle generate`,
    `import type { AdapterResourceSpecs } from '@mimicai/core';`,
    ``,
    `export const paddleResourceSpecs: AdapterResourceSpecs = {`,
    `  platform: {`,
    `    timestampFormat: 'iso8601',`,
    `    amountFormat: 'decimal_string',`,
    `    idPrefix: 'ctm_',`,
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
  return lines.join('\n');
}

function generateSchemasTs(resources: Map<string, ResourceInfo>): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-paddle generate`,
    `import { generateId } from '@mimicai/adapter-sdk';`,
    ``,
    `/**`,
    ` * Returns a complete Paddle object with all fields defaulted to spec-faithful values.`,
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

      const override = SCHEMA_FIELD_OVERRIDES[info.resourceId]?.[fieldName];
      if (override?.code !== undefined) {
        val = override.code;
      } else if (override?.value !== undefined) {
        val = JSON.stringify(override.value);
      } else if (fieldName === info.idField) {
        val = `generateId(${JSON.stringify(info.idPrefix)}, 24)`;
      } else if (field.auto && field.timestamp === 'iso8601') {
        val = `new Date().toISOString()`;
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
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-paddle generate`,
    ``,
    `export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';`,
    `export type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';`,
    ``,
    `export interface GeneratedRoute {`,
    `  method: RouteMethod;`,
    `  fastifyPath: string;`,
    `  /** Original Paddle spec path (field name is historical) */`,
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

  const resourceGroups = new Set(routes.map(r => r.resource));
  console.log(`  Resource groups: ${resourceGroups.size} (${[...resourceGroups].join(', ')})`);

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
  console.log(`  ${routes.length} routes across all Paddle paths`);
  console.log(`  Output: ${OUT_DIR}/`);
}

main();
