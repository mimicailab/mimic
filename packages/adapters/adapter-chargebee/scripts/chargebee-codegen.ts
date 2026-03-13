#!/usr/bin/env node
/**
 * Chargebee OpenAPI → Mimic codegen
 *
 * Reads the Chargebee OpenAPI spec (chargebee-spec.json) and generates
 * four TypeScript source files into src/generated/:
 *
 *   resource-specs.ts  – AdapterResourceSpecs for all curated resources
 *   schemas.ts         – defaultXxx() factory functions
 *   routes.ts          – GeneratedRoute[] for all Chargebee paths
 *   meta.ts            – spec version + generated timestamp
 *
 * Chargebee-specific patterns handled:
 *   - All mutations are POST (no PUT/PATCH/DELETE HTTP methods)
 *   - Delete = POST /{resource}/{id}/delete
 *   - Path params use kebab-case: {customer-id} → :customer-id
 *   - No x-resourceId markers — curated resource list
 *   - Responses wrap resources: {customer: {...}} / {list: [{customer: {...}}]}
 *   - Offset-based pagination (not cursor-based)
 *   - Request bodies are form-encoded
 *   - Timestamps are Unix seconds (integers)
 *
 * Usage:
 *   pnpm --filter @mimicai/adapter-chargebee generate
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, '../chargebee-spec.json');
const OUT_DIR = resolve(__dirname, '../src/generated');

// ---------------------------------------------------------------------------
// Types (minimal OpenAPI 3.1 shape)
// ---------------------------------------------------------------------------

interface OaSchema {
  type?: string | string[];
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
  deprecated?: boolean;
}

interface OaParameter {
  name: string;
  in: 'query' | 'path' | 'header';
  required?: boolean;
  schema?: OaSchema;
  description?: string;
  $ref?: string;
  style?: string;
  explode?: boolean;
}

interface OaOperation {
  operationId?: string;
  description?: string;
  summary?: string;
  parameters?: OaParameter[];
  requestBody?: {
    content?: {
      'application/x-www-form-urlencoded'?: { schema?: OaSchema };
      'application/json'?: { schema?: OaSchema };
    };
  };
  responses?: Record<string, { content?: { 'application/json'?: { schema?: OaSchema } } }>;
  deprecated?: boolean;
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
// Curated resource list (Chargebee has no x-resourceId markers)
// ---------------------------------------------------------------------------

interface ResourceDef {
  resourceId: string;       // 'customer'
  resourceKey: string;      // 'customers' (path segment / StateStore namespace suffix)
  objectType: string;       // 'customer' (value for mock responses)
  schemaName: string;       // 'Customer' (in components/schemas)
  idField: string;          // 'id' (field name holding the resource ID)
  idPrefix: string;         // 'cb_cus_' (for mock ID generation)
  volumeHint: 'entity' | 'reference' | 'skip';
  pathParamName: string;    // 'customer-id' (kebab-case as in spec)
}

const RESOURCES: ResourceDef[] = [
  // Core billing entities — Chargebee uses alphanumeric IDs; we use cb_ prefixes for uniqueness
  { resourceId: 'customer', resourceKey: 'customers', objectType: 'customer', schemaName: 'Customer', idField: 'id', idPrefix: 'cb_cus_', volumeHint: 'entity', pathParamName: 'customer-id' },
  { resourceId: 'subscription', resourceKey: 'subscriptions', objectType: 'subscription', schemaName: 'Subscription', idField: 'id', idPrefix: 'cb_sub_', volumeHint: 'entity', pathParamName: 'subscription-id' },
  { resourceId: 'invoice', resourceKey: 'invoices', objectType: 'invoice', schemaName: 'Invoice', idField: 'id', idPrefix: 'cb_inv_', volumeHint: 'entity', pathParamName: 'invoice-id' },
  { resourceId: 'credit_note', resourceKey: 'credit_notes', objectType: 'credit_note', schemaName: 'CreditNote', idField: 'id', idPrefix: 'cb_cn_', volumeHint: 'reference', pathParamName: 'credit-note-id' },
  { resourceId: 'transaction', resourceKey: 'transactions', objectType: 'transaction', schemaName: 'Transaction', idField: 'id', idPrefix: 'txn_', volumeHint: 'reference', pathParamName: 'transaction-id' },
  { resourceId: 'order', resourceKey: 'orders', objectType: 'order', schemaName: 'Order', idField: 'id', idPrefix: 'cb_ord_', volumeHint: 'reference', pathParamName: 'order-id' },

  // Product catalog
  { resourceId: 'item', resourceKey: 'items', objectType: 'item', schemaName: 'Item', idField: 'id', idPrefix: 'cb_item_', volumeHint: 'reference', pathParamName: 'item-id' },
  { resourceId: 'item_price', resourceKey: 'item_prices', objectType: 'item_price', schemaName: 'ItemPrice', idField: 'id', idPrefix: 'cb_ip_', volumeHint: 'reference', pathParamName: 'item-price-id' },
  { resourceId: 'item_family', resourceKey: 'item_families', objectType: 'item_family', schemaName: 'ItemFamily', idField: 'id', idPrefix: 'cb_if_', volumeHint: 'reference', pathParamName: 'item-family-id' },
  { resourceId: 'attached_item', resourceKey: 'attached_items', objectType: 'attached_item', schemaName: 'AttachedItem', idField: 'id', idPrefix: 'cb_ai_', volumeHint: 'skip', pathParamName: 'attached-item-id' },
  { resourceId: 'differential_price', resourceKey: 'differential_prices', objectType: 'differential_price', schemaName: 'DifferentialPrice', idField: 'id', idPrefix: 'cb_dp_', volumeHint: 'skip', pathParamName: 'differential-price-id' },
  { resourceId: 'price_variant', resourceKey: 'price_variants', objectType: 'price_variant', schemaName: 'PriceVariant', idField: 'id', idPrefix: 'cb_pv_', volumeHint: 'skip', pathParamName: 'price-variant-id' },

  // Payment
  { resourceId: 'payment_source', resourceKey: 'payment_sources', objectType: 'payment_source', schemaName: 'PaymentSource', idField: 'id', idPrefix: 'pm_', volumeHint: 'reference', pathParamName: 'payment-source-id' },
  { resourceId: 'payment_intent', resourceKey: 'payment_intents', objectType: 'payment_intent', schemaName: 'PaymentIntent', idField: 'id', idPrefix: 'pi_', volumeHint: 'skip', pathParamName: 'payment-intent-id' },
  { resourceId: 'virtual_bank_account', resourceKey: 'virtual_bank_accounts', objectType: 'virtual_bank_account', schemaName: 'VirtualBankAccount', idField: 'id', idPrefix: 'vba_', volumeHint: 'skip', pathParamName: 'virtual-bank-account-id' },

  // Discount/promo
  { resourceId: 'coupon', resourceKey: 'coupons', objectType: 'coupon', schemaName: 'Coupon', idField: 'id', idPrefix: 'cb_cpn_', volumeHint: 'reference', pathParamName: 'coupon-id' },
  { resourceId: 'coupon_set', resourceKey: 'coupon_sets', objectType: 'coupon_set', schemaName: 'CouponSet', idField: 'id', idPrefix: 'cb_cs_', volumeHint: 'skip', pathParamName: 'coupon-set-id' },
  { resourceId: 'coupon_code', resourceKey: 'coupon_codes', objectType: 'coupon_code', schemaName: 'CouponCode', idField: 'code', idPrefix: 'cb_cc_', volumeHint: 'skip', pathParamName: 'coupon-code-code' },
  { resourceId: 'promotional_credit', resourceKey: 'promotional_credits', objectType: 'promotional_credit', schemaName: 'PromotionalCredit', idField: 'id', idPrefix: 'pc_', volumeHint: 'skip', pathParamName: 'promotional-credit-id' },

  // Features & entitlements
  { resourceId: 'feature', resourceKey: 'features', objectType: 'feature', schemaName: 'Feature', idField: 'id', idPrefix: 'cb_feat_', volumeHint: 'skip', pathParamName: 'feature-id' },

  // Other
  { resourceId: 'comment', resourceKey: 'comments', objectType: 'comment', schemaName: 'Comment', idField: 'id', idPrefix: 'cb_cmt_', volumeHint: 'skip', pathParamName: 'comment-id' },
  { resourceId: 'gift', resourceKey: 'gifts', objectType: 'gift', schemaName: 'Gift', idField: 'id', idPrefix: 'cb_gift_', volumeHint: 'skip', pathParamName: 'gift-id' },
  { resourceId: 'quote', resourceKey: 'quotes', objectType: 'quote', schemaName: 'Quote', idField: 'id', idPrefix: 'cb_qt_', volumeHint: 'skip', pathParamName: 'quote-id' },
  { resourceId: 'unbilled_charge', resourceKey: 'unbilled_charges', objectType: 'unbilled_charge', schemaName: 'UnbilledCharge', idField: 'id', idPrefix: 'cb_uc_', volumeHint: 'skip', pathParamName: 'unbilled-charge-id' },
  { resourceId: 'hosted_page', resourceKey: 'hosted_pages', objectType: 'hosted_page', schemaName: 'HostedPage', idField: 'id', idPrefix: 'cb_hp_', volumeHint: 'skip', pathParamName: 'hosted-page-id' },
  { resourceId: 'portal_session', resourceKey: 'portal_sessions', objectType: 'portal_session', schemaName: 'PortalSession', idField: 'id', idPrefix: 'cb_ps_', volumeHint: 'skip', pathParamName: 'portal-session-id' },
  { resourceId: 'token', resourceKey: 'tokens', objectType: 'token', schemaName: 'Token', idField: 'id', idPrefix: 'cb_tok_', volumeHint: 'skip', pathParamName: 'cb-token-id' },
  { resourceId: 'card', resourceKey: 'cards', objectType: 'card', schemaName: 'Card', idField: 'payment_source_id', idPrefix: 'cb_card_', volumeHint: 'skip', pathParamName: 'card-id' },
  { resourceId: 'address', resourceKey: 'addresses', objectType: 'address', schemaName: 'Address', idField: 'label', idPrefix: 'cb_addr_', volumeHint: 'skip', pathParamName: 'address-label' },
  { resourceId: 'event', resourceKey: 'events', objectType: 'event', schemaName: 'Event', idField: 'id', idPrefix: 'ev_', volumeHint: 'skip', pathParamName: 'event-id' },
  { resourceId: 'usage', resourceKey: 'usages', objectType: 'usage', schemaName: 'Usage', idField: 'id', idPrefix: 'cb_usg_', volumeHint: 'skip', pathParamName: 'usage-id' },
  { resourceId: 'ramp', resourceKey: 'ramps', objectType: 'ramp', schemaName: 'Ramp', idField: 'id', idPrefix: 'cb_ramp_', volumeHint: 'skip', pathParamName: 'ramp-id' },
  { resourceId: 'product', resourceKey: 'products', objectType: 'product', schemaName: 'Product', idField: 'id', idPrefix: 'cb_prod_', volumeHint: 'reference', pathParamName: 'product-id' },
  { resourceId: 'variant', resourceKey: 'variants', objectType: 'variant', schemaName: 'Variant', idField: 'id', idPrefix: 'cb_var_', volumeHint: 'skip', pathParamName: 'variant-id' },
];

// Build lookup maps
const SCHEMA_TO_RESOURCE = new Map<string, ResourceDef>();
const KEY_TO_RESOURCE = new Map<string, ResourceDef>();
const ID_TO_RESOURCE = new Map<string, ResourceDef>();
for (const r of RESOURCES) {
  SCHEMA_TO_RESOURCE.set(r.schemaName, r);
  KEY_TO_RESOURCE.set(r.resourceKey, r);
  ID_TO_RESOURCE.set(r.resourceId, r);
}

// Semantic default overrides for newly-created objects
const SCHEMA_FIELD_OVERRIDES: Record<string, Record<string, { value?: unknown; code?: string }>> = {
  subscription: {
    status: { value: 'active' },
  },
  invoice: {
    status: { value: 'payment_due' },
  },
  payment_intent: {
    status: { value: 'inited' },
  },
  order: {
    status: { value: 'new' },
  },
  customer: {
    auto_collection: { value: 'on' },
    taxability: { value: 'taxable' },
    pii_cleared: { value: 'active' },
  },
  coupon: {
    status: { value: 'active' },
  },
  quote: {
    status: { value: 'open' },
  },
};

// Volume hints for blueprint data generation
const ENTITY_RESOURCES = new Set([
  'customer', 'subscription', 'invoice', 'transaction', 'order',
]);

const REFERENCE_RESOURCES = new Set([
  'item', 'item_price', 'item_family', 'coupon', 'payment_source',
  'credit_note', 'product',
]);

// Chargebee-specific: amount fields (integers in cents)
const AMOUNT_FIELDS = new Set([
  'amount', 'amount_due', 'amount_paid', 'amount_adjusted', 'amount_refundable',
  'amount_refunded', 'unit_amount', 'sub_total', 'total', 'tax',
  'credits_applied', 'amount_to_collect', 'net_term_days', 'mrr',
  'exchange_rate', 'base_currency_code', 'price', 'setup_fee',
  'price_in_decimal', 'amount_in_decimal',
]);

const SEMANTIC_FIELD_NAMES: Record<string, string> = {
  email: 'email',
  phone: 'phone',
  company: 'company',
  locale: 'locale',
  preferred_currency_code: 'currency_code',
  currency_code: 'currency_code',
  base_currency_code: 'currency_code',
};

// ---------------------------------------------------------------------------
// Spec loading
// ---------------------------------------------------------------------------

function loadSpec(): OaSpec {
  if (!existsSync(SPEC_PATH)) {
    throw new Error(
      `Chargebee spec not found at ${SPEC_PATH}.\n` +
      `Download it from: https://github.com/chargebee/openapi/blob/main/spec/chargebee_api_v2_pc_v2_spec.json`,
    );
  }
  console.log(`Loading spec from ${SPEC_PATH}...`);
  const raw = readFileSync(SPEC_PATH, 'utf-8');
  const spec = JSON.parse(raw) as OaSpec;
  const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;
  const pathCount = Object.keys(spec.paths ?? {}).length;
  console.log(`  Loaded: ${schemaCount} schemas, ${pathCount} paths`);
  return spec;
}

// ---------------------------------------------------------------------------
// $ref resolver
// ---------------------------------------------------------------------------

function resolveRef(ref: string, spec: OaSpec): OaSchema | null {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/);
  if (!match) return null;
  return spec.components.schemas[match[1]!] ?? null;
}

function resolveParamRef(ref: string, spec: OaSpec): OaParameter | null {
  const match = ref.match(/^#\/components\/parameters\/(.+)$/);
  if (!match) return null;
  return spec.components?.parameters?.[match[1]!] ?? null;
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
// Resolve type from OA 3.1 (type can be string or string[])
// ---------------------------------------------------------------------------

function resolveType(schema: OaSchema): { type: string; nullable: boolean } {
  const t = schema.type;
  if (Array.isArray(t)) {
    const nonNull = t.filter(x => x !== 'null');
    const isNullable = t.includes('null') || schema.nullable === true;
    return { type: nonNull[0] ?? 'string', nullable: isNullable };
  }
  return { type: t ?? 'string', nullable: schema.nullable === true };
}

// ---------------------------------------------------------------------------
// Explicit FK references
// ---------------------------------------------------------------------------

/**
 * Chargebee's OpenAPI spec uses plain `{type: "string"}` for FK fields —
 * no $ref pointers. We define refs explicitly per field name.
 */
const FIELD_REFS: Record<string, string> = {
  customer_id: 'customer',
  subscription_id: 'subscription',
  invoice_id: 'invoice',
  credit_note_id: 'credit_note',
  transaction_id: 'transaction',
  order_id: 'order',
  item_id: 'item',
  item_price_id: 'item_price',
  item_family_id: 'item_family',
  payment_source_id: 'payment_source',
  coupon_id: 'coupon',
  product_id: 'product',
  parent_item_id: 'item',
  plan_id: 'item_price',
  addon_id: 'item_price',
};

// ---------------------------------------------------------------------------
// Property → MappedField
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
  timestamp?: 'unix_seconds';
  isAmount?: boolean;
  semanticType?: string;
  ref?: string;
  description?: string;
}

function mapProperty(
  fieldName: string,
  rawSchema: OaSchema,
  isRequired: boolean,
  spec: OaSpec,
): MappedField {
  const flat = flattenSchema(rawSchema, spec);
  const { type: rawType, nullable: flatNullable } = resolveType(flat);
  const nullable = flatNullable || flat.nullable === true;

  let type: FieldType = 'string';
  if (rawType === 'integer') type = 'integer';
  else if (rawType === 'number') type = 'number';
  else if (rawType === 'boolean') type = 'boolean';
  else if (rawType === 'array') type = 'array';
  else if (rawType === 'object' || flat.properties) type = 'object';

  // Timestamp detection: Chargebee uses integer timestamps
  const isTimestamp = type === 'integer' && (
    fieldName.endsWith('_at') || fieldName === 'created_at' ||
    fieldName === 'updated_at' || fieldName === 'deleted_at' ||
    fieldName === 'activated_at' || fieldName === 'cancelled_at' ||
    fieldName === 'trial_start' || fieldName === 'trial_end' ||
    fieldName === 'current_term_start' || fieldName === 'current_term_end' ||
    fieldName === 'next_billing_at' || fieldName === 'start_date' ||
    fieldName === 'due_date' || fieldName === 'paid_at' || fieldName === 'voided_at' ||
    fieldName === 'date' || fieldName === 'resource_version'
  );

  const isAmount = AMOUNT_FIELDS.has(fieldName) && (type === 'integer' || type === 'number');
  const semanticType = SEMANTIC_FIELD_NAMES[fieldName];

  // Compute default value
  let defaultValue: unknown;
  if (fieldName === 'id' || fieldName === 'code') {
    defaultValue = '';
  } else if (fieldName === 'object') {
    defaultValue = flat.enum?.[0] ?? '';
  } else if (fieldName === 'meta_data' || fieldName === 'metadata') {
    defaultValue = {};
  } else if (fieldName === 'deleted') {
    defaultValue = false;
  } else if (isTimestamp) {
    defaultValue = undefined; // auto at runtime
  } else if (isAmount) {
    defaultValue = 0;
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
    auto: isTimestamp || fieldName === 'created_at',
    timestamp: isTimestamp ? 'unix_seconds' : undefined,
    isAmount: isAmount || undefined,
    semanticType,
    ref: FIELD_REFS[fieldName],
    description: flat.description,
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
  idPrefix: string;
  idField: string;
  fields: Record<string, MappedField>;
  volumeHint: 'entity' | 'reference' | 'skip';
  refs: string[];
}

function extractResources(spec: OaSpec): Map<string, ResourceInfo> {
  const resources = new Map<string, ResourceInfo>();

  for (const def of RESOURCES) {
    const schema = spec.components.schemas[def.schemaName];
    if (!schema) {
      console.warn(`  ⚠ Schema ${def.schemaName} not found in spec, skipping ${def.resourceId}`);
      continue;
    }

    const flat = flattenSchema(schema, spec);
    const properties = flat.properties ?? {};
    const required = new Set(flat.required ?? []);
    const fields: Record<string, MappedField> = {};

    for (const [fieldName, propSchema] of Object.entries(properties)) {
      const isRequired = required.has(fieldName);
      const mapped = mapProperty(fieldName, propSchema, isRequired, spec);

      // Set ID prefix for the id field
      if (fieldName === def.idField) {
        mapped.idPrefix = def.idPrefix;
      }

      fields[fieldName] = mapped;
    }

    // Collect refs
    const refs: string[] = [];
    for (const [, field] of Object.entries(fields)) {
      if (field.ref && !refs.includes(field.ref)) {
        refs.push(field.ref);
      }
    }

    resources.set(def.resourceId, {
      schemaName: def.schemaName,
      resourceId: def.resourceId,
      resourceKey: def.resourceKey,
      objectType: def.objectType,
      idPrefix: def.idPrefix,
      idField: def.idField,
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
  method: 'GET' | 'POST';
  stripePath: string;        // original spec path (field name is historical)
  fastifyPath: string;       // Fastify path with /chargebee prefix
  resource: string;          // e.g. 'customers'
  operation: RouteOperation;
  description: string;
  queryFilters: string[];
  idParam?: string;
  objectType?: string;
}

function extractRoutes(spec: OaSpec): ExtractedRoute[] {
  const routes: ExtractedRoute[] = [];
  const knownResourceKeys = new Set(RESOURCES.map(r => r.resourceKey));

  for (const [specPath, pathItem] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;
      if (operation.deprecated) continue;

      const httpMethod = method.toUpperCase() as 'GET' | 'POST';
      const description = operation.summary ?? operation.operationId ?? '';

      // Convert path params: {param-name} → :param_name (kebab→snake for Fastify compat)
      const fastifyPath = '/chargebee' + specPath.replace(/\{([^}]+)\}/g, (_m, p) => ':' + p.replace(/-/g, '_'));

      // Detect resource from path
      const resource = detectResource(specPath, knownResourceKeys);

      // Detect operation type
      const op = detectOperation(specPath, httpMethod, knownResourceKeys);

      // Query filters for list operations
      const queryFilters: string[] = [];
      if (op === 'list') {
        const allParams = resolveAllParams(pathItem, operation, spec);
        for (const param of allParams) {
          if (param.in === 'query' && !param.name.startsWith('chargebee-') &&
            param.name !== 'offset' && param.name !== 'limit' &&
            param.name !== 'include_deleted') {
            queryFilters.push(param.name);
          }
        }
      }

      // ID param: last path param (kebab→snake to match Fastify param names)
      const pathParams = (specPath.match(/\{([^}]+)\}/g) ?? []).map(p => p.slice(1, -1).replace(/-/g, '_'));
      const idParam = pathParams.length > 0 ? pathParams[pathParams.length - 1] : undefined;

      // Object type
      const resDef = RESOURCES.find(r => r.resourceKey === resource);
      const objectType = resDef?.objectType;

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

/**
 * Resolve all parameters for an operation (including path-level and $ref'd params).
 */
function resolveAllParams(pathItem: OaPathItem, operation: OaOperation, spec: OaSpec): OaParameter[] {
  const params: OaParameter[] = [];
  for (const p of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
    if (p.$ref) {
      const resolved = resolveParamRef(p.$ref, spec);
      if (resolved) params.push(resolved);
    } else {
      params.push(p);
    }
  }
  return params;
}

/**
 * Detect resource from the first path segment.
 */
function detectResource(path: string, knownKeys: Set<string>): string {
  const segments = path.replace(/^\//, '').split('/');
  // First segment is the resource collection
  const first = segments[0]!;
  if (knownKeys.has(first)) return first;

  // Try underscore conversion for kebab paths (shouldn't happen for Chargebee)
  const underscored = first.replace(/-/g, '_');
  if (knownKeys.has(underscored)) return underscored;

  return first;
}

/**
 * Detect operation type for a Chargebee route.
 *
 * Chargebee conventions:
 *   GET /resource → list
 *   GET /resource/{id} → retrieve
 *   POST /resource → create
 *   POST /resource/{id} → update
 *   POST /resource/{id}/delete → delete
 *   POST /resource/create_xxx → create
 *   POST /resource/{id}/action_name → action
 */
function detectOperation(
  path: string,
  method: 'GET' | 'POST',
  knownKeys: Set<string>,
): RouteOperation {
  const segments = path.replace(/^\//, '').split('/');
  const lastSegment = segments[segments.length - 1]!;
  const lastIsParam = lastSegment.startsWith('{');
  const paramCount = (path.match(/\{[^}]+\}/g) ?? []).length;

  if (method === 'GET') {
    if (paramCount === 0) return 'list';
    if (lastIsParam) return 'retrieve';
    // GET with params but last is literal — sub-resource list
    // e.g. GET /subscriptions/{subscription-id}/discounts
    return 'list';
  }

  // POST
  if (paramCount === 0) {
    // POST /resource → create
    return 'create';
  }

  if (lastIsParam) {
    // POST /resource/{id} → update
    return 'update';
  }

  // POST /resource/{id}/something → classify by last segment
  if (lastSegment === 'delete') return 'delete';

  // Some create variants: create_with_items, create_for_customer, etc.
  if (lastSegment.startsWith('create')) return 'create';

  // Check if last segment is a known resource key (sub-resource list/create)
  if (knownKeys.has(lastSegment)) return 'create';

  // Everything else is an action
  return 'action';
}

// ---------------------------------------------------------------------------
// Code generators
// ---------------------------------------------------------------------------

function generateMetaTs(spec: OaSpec): string {
  const version = spec.info?.version ?? 'unknown';
  const generatedAt = new Date().toISOString();

  return `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-chargebee generate
// Chargebee OpenAPI spec version: ${version}
// Generated at: ${generatedAt}

export const CHARGEBEE_SPEC_VERSION = ${JSON.stringify(version)};
export const CHARGEBEE_SPEC_GENERATED_AT = ${JSON.stringify(generatedAt)};
`;
}

function generateResourceSpecsTs(resources: Map<string, ResourceInfo>): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-chargebee generate`,
    `import type { AdapterResourceSpecs } from '@mimicai/core';`,
    ``,
    `export const chargebeeResourceSpecs: AdapterResourceSpecs = {`,
    `  platform: {`,
    `    timestampFormat: 'unix_seconds',`,
    `    amountFormat: 'integer_cents',`,
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
      if (field.default !== undefined) {
        parts.push(`default: ${JSON.stringify(field.default)}`);
      }
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
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-chargebee generate`,
    `import { unixNow, generateId } from '@mimicai/adapter-sdk';`,
    ``,
    `/**`,
    ` * Returns a complete Chargebee object with all fields defaulted to spec-faithful values.`,
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
      if (fieldName === info.idField && (fieldName === 'id' || fieldName === 'code')) {
        val = `generateId(${JSON.stringify(info.idPrefix)}, 14)`;
      } else if (field.auto && (fieldName === 'created_at' || fieldName === 'updated_at' ||
        fieldName === 'resource_version')) {
        val = `unixNow()`;
      } else {
        const override = SCHEMA_FIELD_OVERRIDES[info.resourceId]?.[fieldName];
        if (override?.code !== undefined) {
          val = override.code;
        } else if (override?.value !== undefined) {
          val = JSON.stringify(override.value);
        } else {
          val = JSON.stringify(field.default);
        }
      }
      lines.push(`    ${JSON.stringify(fieldName)}: ${val},`);
    }

    lines.push(`    ...overrides,`);
    lines.push(`  };`);
    lines.push(`}`);
    lines.push(``);
  }

  // Export lookup map
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
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-chargebee generate`,
    ``,
    `export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';`,
    `export type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';`,
    ``,
    `export interface GeneratedRoute {`,
    `  /** HTTP method */`,
    `  method: RouteMethod;`,
    `  /** Fastify route path with colon params and /chargebee prefix */`,
    `  fastifyPath: string;`,
    `  /** Original spec path for documentation (field name is historical) */`,
    `  stripePath: string;`,
    `  /** Top-level resource name (plural, e.g. 'customers') */`,
    `  resource: string;`,
    `  /** CRUD operation classification */`,
    `  operation: RouteOperation;`,
    `  /** Human-readable description from the spec */`,
    `  description: string;`,
    `  /** Query param names that can be used to filter list results */`,
    `  queryFilters: string[];`,
    `  /** Path param name holding the resource ID */`,
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
// Helpers
// ---------------------------------------------------------------------------

function toPascalCase(str: string): string {
  return str
    .split(/[_\s\-\.]+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
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

  mkdirSync(OUT_DIR, { recursive: true });
  console.log('Generating files...');

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
  console.log(`  Output: ${OUT_DIR}/`);
}

main();
