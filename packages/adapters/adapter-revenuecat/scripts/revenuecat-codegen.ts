#!/usr/bin/env node
/**
 * RevenueCat OpenAPI → Mimic codegen
 *
 * Reads the RevenueCat OpenAPI spec (YAML) and generates four TypeScript
 * source files into src/generated/:
 *
 *   resource-specs.ts  – AdapterResourceSpecs covering all core RevenueCat entities
 *   schemas.ts         – defaultXxx() factory functions for mock data
 *   routes.ts          – GeneratedRoute[] covering all RevenueCat paths
 *   meta.ts            – spec version + generated timestamp
 *
 * Key differences from Stripe/Paddle:
 *   - All paths are under /projects/{project_id}/... — project_id is stripped from routes
 *   - List envelope: { object: 'list', items: [...], next_page: string|null, url: string }
 *   - Pagination: starting_after + limit (Stripe-like)
 *   - Timestamps in milliseconds since epoch (int64)
 *   - ID prefixes vary: proj, ofrng, entl, prod, pkg, pw, sub, purch, rcbin, collab
 *   - Actions under .../actions/{action}
 *
 * Usage:
 *   pnpm --filter @mimicai/adapter-revenuecat generate
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findSpecPath(): string {
  const yamlPath = resolve(__dirname, '..', 'revenuecat-spec.yaml');
  const jsonPath = resolve(__dirname, '..', 'revenuecat-spec.json');
  if (existsSync(yamlPath)) return yamlPath;
  if (existsSync(jsonPath)) return jsonPath;
  throw new Error('RevenueCat spec not found.');
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
  example?: unknown;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  pattern?: string;
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
// RevenueCat resource definitions
// ---------------------------------------------------------------------------

interface RCResourceDef {
  resourceId: string;
  resourceKey: string;
  objectType: string;
  idField: string;
  idPrefix: string;
  volumeHint: 'entity' | 'reference' | 'skip';
  schemaName: string;
}

const RC_RESOURCES: RCResourceDef[] = [
  { resourceId: 'project', resourceKey: 'projects', objectType: 'project', idField: 'id', idPrefix: 'proj', volumeHint: 'skip', schemaName: 'Project' },
  { resourceId: 'customer', resourceKey: 'customers', objectType: 'customer', idField: 'id', idPrefix: 'rc_cus_', volumeHint: 'entity', schemaName: 'Customer' },
  { resourceId: 'entitlement', resourceKey: 'entitlements', objectType: 'entitlement', idField: 'id', idPrefix: 'entl', volumeHint: 'reference', schemaName: 'Entitlement' },
  { resourceId: 'offering', resourceKey: 'offerings', objectType: 'offering', idField: 'id', idPrefix: 'ofrng', volumeHint: 'reference', schemaName: 'Offering' },
  { resourceId: 'package', resourceKey: 'packages', objectType: 'package', idField: 'id', idPrefix: 'pkg', volumeHint: 'reference', schemaName: 'Package' },
  { resourceId: 'product', resourceKey: 'products', objectType: 'product', idField: 'id', idPrefix: 'prod', volumeHint: 'reference', schemaName: 'Product' },
  { resourceId: 'subscription', resourceKey: 'subscriptions', objectType: 'subscription', idField: 'id', idPrefix: 'sub', volumeHint: 'entity', schemaName: 'Subscription' },
  { resourceId: 'purchase', resourceKey: 'purchases', objectType: 'purchase', idField: 'id', idPrefix: 'purch', volumeHint: 'entity', schemaName: 'Purchase' },
  { resourceId: 'paywall', resourceKey: 'paywalls', objectType: 'paywall', idField: 'id', idPrefix: 'pw', volumeHint: 'reference', schemaName: 'Paywall' },
  { resourceId: 'app', resourceKey: 'apps', objectType: 'app', idField: 'id', idPrefix: 'app', volumeHint: 'skip', schemaName: 'App' },
  { resourceId: 'collaborator', resourceKey: 'collaborators', objectType: 'collaborator', idField: 'id', idPrefix: 'collab', volumeHint: 'skip', schemaName: 'Collaborator' },
  { resourceId: 'virtual_currency', resourceKey: 'virtual_currencies', objectType: 'virtual_currency', idField: 'code', idPrefix: 'rc_vc_', volumeHint: 'reference', schemaName: 'VirtualCurrency' },
  { resourceId: 'webhook_integration', resourceKey: 'webhooks', objectType: 'webhook_integration', idField: 'id', idPrefix: 'whi', volumeHint: 'skip', schemaName: 'WebhookIntegration' },
  { resourceId: 'invoice', resourceKey: 'invoices', objectType: 'invoice', idField: 'id', idPrefix: 'rcbin', volumeHint: 'entity', schemaName: 'Invoice' },
];

// Schema field overrides for sensible mock defaults
const SCHEMA_FIELD_OVERRIDES: Record<string, Record<string, { value?: unknown; code?: string }>> = {
  customer: {
    last_seen_platform: { value: 'ios' },
    last_seen_country: { value: 'US' },
  },
  entitlement: {
    state: { value: 'active' },
  },
  offering: {
    state: { value: 'active' },
    is_current: { value: true },
  },
  product: {
    state: { value: 'active' },
    type: { value: 'subscription' },
  },
  subscription: {
    status: { value: 'active' },
    auto_renewal_status: { value: 'will_renew' },
    gives_access: { value: true },
    pending_payment: { value: false },
    environment: { value: 'production' },
    store: { value: 'app_store' },
    ownership: { value: 'purchased' },
  },
  purchase: {
    status: { value: 'owned' },
    environment: { value: 'production' },
    store: { value: 'app_store' },
    ownership: { value: 'purchased' },
    quantity: { value: 1 },
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
  timestamp?: 'epoch_ms';
  semanticType?: string;
  ref?: string;
}

const SEMANTIC_FIELD_NAMES: Record<string, string> = {
  email: 'email', locale: 'locale', country: 'country_code',
  currency: 'currency_code',
};

const FIELD_REFS: Record<string, string> = {
  customer_id: 'customer',
  product_id: 'product',
  entitlement_id: 'entitlement',
  offering_id: 'offering',
  package_id: 'package',
  subscription_id: 'subscription',
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

  // RevenueCat uses epoch ms timestamps (int64)
  const isTimestamp = (flat.format === 'int64' && (
    fieldName.endsWith('_at') ||
    fieldName === 'created_at' ||
    fieldName === 'purchased_at' ||
    fieldName === 'starts_at'
  ));

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

  // Detect refs to other RC resources (explicit map first, then auto-detect)
  let ref: string | undefined = FIELD_REFS[fieldName];
  if (!ref && fieldName.endsWith('_id') && fieldName !== idField) {
    const refResource = fieldName.replace(/_id$/, '');
    const known = RC_RESOURCES.find(r => r.resourceId === refResource);
    if (known) ref = known.resourceId;
  }

  return {
    type,
    required: isRequired,
    nullable,
    default: defaultValue,
    enum: flat.enum && flat.enum.length > 0 ? flat.enum : undefined,
    idPrefix: fieldName === idField ? idPrefix : undefined,
    auto: isTimestamp || undefined,
    timestamp: isTimestamp ? 'epoch_ms' : undefined,
    semanticType,
    ref,
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

  for (const def of RC_RESOURCES) {
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
      // Skip nested list/object properties that are expandable sub-resources
      const propFlat = flattenSchema(propSchema, spec);
      if (propFlat.properties && propFlat.required?.includes('items') && propFlat.required?.includes('object')) {
        continue; // This is an embedded list sub-resource, skip
      }

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

/**
 * Detect the primary resource from a RevenueCat path.
 * Paths are /projects/{project_id}/... — we look at the segment after project_id.
 */
function detectRCResource(path: string): string {
  // Handle top-level /projects path (no project_id prefix)
  if (path === '/projects' || path === '/projects/{project_id}') return 'projects';

  // Remove /projects/{project_id}/ prefix
  const stripped = path.replace(/^\/projects\/\{project_id\}\/?/, '');
  const segments = stripped.split('/');

  // Handle nested resources under customers
  if (segments[0] === 'customers' && segments.length >= 3) {
    const subSeg = segments[2];
    if (subSeg === 'subscriptions') return 'subscriptions';
    if (subSeg === 'purchases') return 'purchases';
    if (subSeg === 'active_entitlements') return 'active_entitlements';
    if (subSeg === 'aliases') return 'aliases';
    if (subSeg === 'attributes') return 'attributes';
    if (subSeg === 'virtual_currencies') {
      if (segments.length >= 4 && (segments[3] === 'transactions' || segments[3] === 'update_balance')) {
        return 'virtual_currency_transactions';
      }
      return 'virtual_currencies';
    }
    if (subSeg === 'invoices') return 'invoices';
    if (subSeg === 'actions') return 'customers';
  }

  // Handle nested resources under subscriptions
  if (segments[0] === 'subscriptions' && segments.length >= 3) {
    const subSeg = segments[2];
    if (subSeg === 'transactions') return 'subscription_transactions';
    if (subSeg === 'entitlements') return 'subscription_entitlements';
    if (subSeg === 'actions') return 'subscriptions';
    if (subSeg === 'authenticated_management_url') return 'subscriptions';
  }

  // Handle nested resources under purchases
  if (segments[0] === 'purchases' && segments.length >= 3) {
    const subSeg = segments[2];
    if (subSeg === 'entitlements') return 'purchase_entitlements';
    if (subSeg === 'actions') return 'purchases';
  }

  // Handle nested resources under entitlements
  if (segments[0] === 'entitlements' && segments.length >= 3) {
    const subSeg = segments[2];
    if (subSeg === 'products') return 'entitlement_products';
    if (subSeg === 'actions') return 'entitlements';
  }

  // Handle nested resources under offerings
  if (segments[0] === 'offerings' && segments.length >= 3) {
    const subSeg = segments[2];
    if (subSeg === 'packages') return 'packages';
    if (subSeg === 'actions') return 'offerings';
  }

  // Handle nested resources under packages
  if (segments[0] === 'packages' && segments.length >= 3) {
    const subSeg = segments[2];
    if (subSeg === 'products') return 'package_products';
    if (subSeg === 'actions') return 'packages';
  }

  // Handle nested resources under products
  if (segments[0] === 'products' && segments.length >= 3) {
    const subSeg = segments[2];
    if (subSeg === 'actions') return 'products';
    if (subSeg === 'create_in_store') return 'products';
  }

  // Handle integrations/webhooks
  if (segments[0] === 'integrations' && segments[1] === 'webhooks') return 'webhooks';

  // Handle apps sub-resources
  if (segments[0] === 'apps' && segments.length >= 3) {
    const subSeg = segments[2];
    if (subSeg === 'public_api_keys') return 'public_api_keys';
    if (subSeg === 'store_kit_config') return 'apps';
  }

  // Handle virtual_currencies
  if (segments[0] === 'virtual_currencies') return 'virtual_currencies';

  // Handle charts/metrics
  if (segments[0] === 'metrics') return 'metrics';
  if (segments[0] === 'charts') return 'charts';
  if (segments[0] === 'audit_logs') return 'audit_logs';

  return segments[0] ?? 'unknown';
}

function detectRCOperation(path: string, method: string): RouteOperation {
  const stripped = path.replace(/^\/projects\/\{project_id\}\/?/, '');
  const segments = stripped.split('/');
  const lastSegment = segments[segments.length - 1]!;
  const paramCount = (stripped.match(/\{[^}]+\}/g) ?? []).length;
  const lastIsParam = lastSegment.startsWith('{');

  // Action verbs
  if (segments.includes('actions')) return 'action';
  if (lastSegment === 'create_in_store') return 'action';
  if (lastSegment === 'authenticated_management_url') return 'action';
  if (lastSegment === 'store_kit_config') return 'action';
  if (lastSegment === 'update_balance') return 'action';
  if (lastSegment === 'file') return 'action';

  // Standard CRUD detection
  if (!lastIsParam && paramCount === 0) {
    if (method === 'get') return 'list';
    if (method === 'post') return 'create';
    return 'action';
  }

  // Collection endpoints (e.g., /customers/{id}/subscriptions)
  if (!lastIsParam) {
    if (method === 'get') return 'list';
    if (method === 'post') return 'create';
    return 'action';
  }

  // Resource endpoints (last segment is param)
  if (lastIsParam) {
    if (method === 'get') return 'retrieve';
    if (method === 'patch' || method === 'put' || method === 'post') return 'update';
    if (method === 'delete') return 'delete';
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

      // Convert {param} to :param and prepend /revenuecat
      // For paths starting with /projects/{project_id}, keep that prefix for routing
      let fastifyPath: string;
      if (specPath.startsWith('/projects/{project_id}')) {
        const withoutProjectPrefix = specPath.replace(/^\/projects\/\{project_id\}/, '');
        fastifyPath = '/revenuecat/projects/:project_id' + withoutProjectPrefix.replace(/\{([^}]+)\}/g, ':$1');
      } else {
        // Top-level paths like /projects
        fastifyPath = '/revenuecat' + specPath.replace(/\{([^}]+)\}/g, ':$1');
      }

      const resource = detectRCResource(specPath);
      const op = detectRCOperation(specPath, method);

      // Extract query filters
      const allParams = [
        ...pathParams,
        ...(operation.parameters ?? []).map(p => resolveParameter(p, spec)).filter((p): p is OaParameter => p !== null),
      ];
      const queryFilters = allParams
        .filter(p => p.in === 'query' && p.name !== 'starting_after' && p.name !== 'limit' && p.name !== 'expand')
        .map(p => p.name);

      // Find the ID param (last path param that's not project_id)
      const pathParamMatches = specPath.match(/\{([^}]+)\}/g);
      let idParam: string | undefined;
      if (pathParamMatches && pathParamMatches.length > 0) {
        const lastParam = pathParamMatches[pathParamMatches.length - 1]!.replace(/[{}]/g, '');
        if (lastParam !== 'project_id') {
          idParam = lastParam;
        }
      }

      // Map resource to objectType
      const resourceToObject: Record<string, string> = {};
      for (const r of RC_RESOURCES) {
        resourceToObject[r.resourceKey] = r.objectType;
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
  return `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-revenuecat generate
// RevenueCat OpenAPI spec version: ${version}
// Generated at: ${generatedAt}

export const RC_SPEC_VERSION = ${JSON.stringify(version)};
export const RC_SPEC_GENERATED_AT = ${JSON.stringify(generatedAt)};
`;
}

function generateResourceSpecsTs(resources: Map<string, ResourceInfo>): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-revenuecat generate`,
    `import type { AdapterResourceSpecs } from '@mimicai/core';`,
    ``,
    `export const revenuecatResourceSpecs: AdapterResourceSpecs = {`,
    `  platform: {`,
    `    timestampFormat: 'epoch_ms',`,
    `    amountFormat: 'object',`,
    `    idPrefix: '',`,
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
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-revenuecat generate`,
    `import { generateId } from '@mimicai/adapter-sdk';`,
    ``,
    `/**`,
    ` * Returns a complete RevenueCat object with all fields defaulted to spec-faithful values.`,
    ` * The caller merges request body fields on top of this default skeleton.`,
    ` */`,
    ``,
  ];

  for (const [, info] of resources) {
    const fnName = 'default' + toPascalCase(info.resourceId);
    lines.push(`export function ${fnName}(overrides: Record<string, unknown> = {}): Record<string, unknown> {`);
    lines.push(`  return {`);
    lines.push(`    "object": ${JSON.stringify(info.objectType)},`);

    for (const [fieldName, field] of Object.entries(info.fields)) {
      if (fieldName === 'object') continue; // Already handled above
      let val: string;

      const override = SCHEMA_FIELD_OVERRIDES[info.resourceId]?.[fieldName];
      if (override?.code !== undefined) {
        val = override.code;
      } else if (override?.value !== undefined) {
        val = JSON.stringify(override.value);
      } else if (fieldName === info.idField) {
        if (info.idPrefix) {
          val = `generateId(${JSON.stringify(info.idPrefix)}, 14)`;
        } else {
          // UUID-style IDs for customers
          val = `crypto.randomUUID()`;
        }
      } else if (field.auto && field.timestamp === 'epoch_ms') {
        val = `Date.now()`;
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
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-revenuecat generate`,
    ``,
    `export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';`,
    `export type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';`,
    ``,
    `export interface GeneratedRoute {`,
    `  method: RouteMethod;`,
    `  fastifyPath: string;`,
    `  /** Original RevenueCat spec path (field name is historical) */`,
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
  console.log(`  ${routes.length} routes across all RevenueCat paths`);
  console.log(`  Output: ${OUT_DIR}/`);
}

main();
