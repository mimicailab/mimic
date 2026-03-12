#!/usr/bin/env node
/**
 * Recurly OpenAPI → Mimic codegen
 *
 * Reads the Recurly spec YAML and generates four TypeScript source files
 * into src/generated/:
 *
 *   resource-specs.ts  – AdapterResourceSpecs
 *   schemas.ts         – defaultXxx() factory functions
 *   routes.ts          – GeneratedRoute[] array
 *   meta.ts            – spec version + generated timestamp
 *
 * Usage:
 *   pnpm --filter @mimicai/adapter-recurly generate
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, '../recurly-spec.yaml');
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
  readOnly?: boolean;
}

interface OaParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: OaSchema;
}

interface OaOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OaParameter[];
  requestBody?: unknown;
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
  info: { title?: string; version?: string };
  paths: Record<string, OaPathItem>;
  components: { schemas: Record<string, OaSchema> };
}

// ---------------------------------------------------------------------------
// Recurly-specific configuration
// ---------------------------------------------------------------------------

// ID prefixes for mock data (Recurly uses UUIDs, but we add prefixes for clarity)
const ID_PREFIXES: Record<string, string> = {
  account: 'acct_',
  subscription: 'sub_',
  plan: 'plan_',
  add_on: 'addon_',
  invoice: 'inv_',
  line_item: 'li_',
  transaction: 'txn_',
  billing_info: 'bi_',
  coupon: 'cpn_',
  coupon_redemption: 'cr_',
  shipping_address: 'sa_',
  item: 'item_',
  usage: 'usg_',
  site: 'site_',
  measured_unit: 'mu_',
  gift_card: 'gc_',
  shipping_method: 'sm_',
  credit_payment: 'cp_',
  account_note: 'note_',
  external_subscription: 'exsub_',
  external_invoice: 'exinv_',
  external_product: 'exprod_',
  external_account: 'exacct_',
  business_entity: 'be_',
  custom_field_definition: 'cfd_',
  dunning_campaign: 'dc_',
  general_ledger_account: 'gla_',
  performance_obligation: 'po_',
  invoice_template: 'it_',
  unique_coupon_code: 'ucc_',
  price_segment: 'ps_',
  subscription_change: 'sc_',
  external_payment_phase: 'epp_',
  external_product_reference: 'epr_',
  entitlement: 'ent_',
  account_acquisition: 'aa_',
  account_balance: 'ab_',
};

// Schema name → resource definition (since Recurly has no x-resourceId)
interface ResourceDef {
  resourceId: string;
  resourceKey: string; // Plural path segment used in routes
  schemaName: string;
  idPrefix: string;
  volumeHint: 'entity' | 'reference' | 'skip';
  idField: string;
}

const RESOURCES: ResourceDef[] = [
  { resourceId: 'account', resourceKey: 'accounts', schemaName: 'Account', idPrefix: 'acct_', volumeHint: 'entity', idField: 'id' },
  { resourceId: 'subscription', resourceKey: 'subscriptions', schemaName: 'Subscription', idPrefix: 'sub_', volumeHint: 'entity', idField: 'id' },
  { resourceId: 'plan', resourceKey: 'plans', schemaName: 'Plan', idPrefix: 'plan_', volumeHint: 'reference', idField: 'id' },
  { resourceId: 'add_on', resourceKey: 'add_ons', schemaName: 'AddOn', idPrefix: 'addon_', volumeHint: 'reference', idField: 'id' },
  { resourceId: 'invoice', resourceKey: 'invoices', schemaName: 'Invoice', idPrefix: 'inv_', volumeHint: 'entity', idField: 'id' },
  { resourceId: 'line_item', resourceKey: 'line_items', schemaName: 'LineItem', idPrefix: 'li_', volumeHint: 'reference', idField: 'id' },
  { resourceId: 'transaction', resourceKey: 'transactions', schemaName: 'Transaction', idPrefix: 'txn_', volumeHint: 'entity', idField: 'id' },
  { resourceId: 'billing_info', resourceKey: 'billing_infos', schemaName: 'BillingInfo', idPrefix: 'bi_', volumeHint: 'reference', idField: 'id' },
  { resourceId: 'coupon', resourceKey: 'coupons', schemaName: 'Coupon', idPrefix: 'cpn_', volumeHint: 'reference', idField: 'id' },
  { resourceId: 'coupon_redemption', resourceKey: 'coupon_redemptions', schemaName: 'CouponRedemption', idPrefix: 'cr_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'shipping_address', resourceKey: 'shipping_addresses', schemaName: 'ShippingAddress', idPrefix: 'sa_', volumeHint: 'reference', idField: 'id' },
  { resourceId: 'item', resourceKey: 'items', schemaName: 'Item', idPrefix: 'item_', volumeHint: 'reference', idField: 'id' },
  { resourceId: 'usage', resourceKey: 'usage', schemaName: 'Usage', idPrefix: 'usg_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'site', resourceKey: 'sites', schemaName: 'Site', idPrefix: 'site_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'measured_unit', resourceKey: 'measured_units', schemaName: 'MeasuredUnit', idPrefix: 'mu_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'gift_card', resourceKey: 'gift_cards', schemaName: 'GiftCard', idPrefix: 'gc_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'shipping_method', resourceKey: 'shipping_methods', schemaName: 'ShippingMethod', idPrefix: 'sm_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'credit_payment', resourceKey: 'credit_payments', schemaName: 'CreditPayment', idPrefix: 'cp_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'account_note', resourceKey: 'notes', schemaName: 'AccountNote', idPrefix: 'note_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'external_subscription', resourceKey: 'external_subscriptions', schemaName: 'ExternalSubscription', idPrefix: 'exsub_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'external_invoice', resourceKey: 'external_invoices', schemaName: 'ExternalInvoice', idPrefix: 'exinv_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'external_product', resourceKey: 'external_products', schemaName: 'ExternalProduct', idPrefix: 'exprod_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'external_account', resourceKey: 'external_accounts', schemaName: 'ExternalAccount', idPrefix: 'exacct_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'business_entity', resourceKey: 'business_entities', schemaName: 'BusinessEntity', idPrefix: 'be_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'custom_field_definition', resourceKey: 'custom_field_definitions', schemaName: 'CustomFieldDefinition', idPrefix: 'cfd_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'dunning_campaign', resourceKey: 'dunning_campaigns', schemaName: 'DunningCampaign', idPrefix: 'dc_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'general_ledger_account', resourceKey: 'general_ledger_accounts', schemaName: 'GeneralLedgerAccount', idPrefix: 'gla_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'performance_obligation', resourceKey: 'performance_obligations', schemaName: 'PerformanceObligation', idPrefix: 'po_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'invoice_template', resourceKey: 'invoice_templates', schemaName: 'InvoiceTemplate', idPrefix: 'it_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'unique_coupon_code', resourceKey: 'unique_coupon_codes', schemaName: 'UniqueCouponCode', idPrefix: 'ucc_', volumeHint: 'skip', idField: 'id' },
  { resourceId: 'price_segment', resourceKey: 'price_segments', schemaName: 'PriceSegment', idPrefix: 'ps_', volumeHint: 'skip', idField: 'id' },
];

// Schema defaults overrides
const SCHEMA_FIELD_OVERRIDES: Record<string, Record<string, { value?: unknown; code?: string }>> = {
  account: {
    state: { value: 'active' },
  },
  subscription: {
    state: { value: 'active' },
    collection_method: { value: 'automatic' },
    auto_renew: { value: true },
  },
  plan: {
    state: { value: 'active' },
    interval_unit: { value: 'months' },
    interval_length: { value: 1 },
    pricing_model: { value: 'fixed' },
  },
  invoice: {
    state: { value: 'pending' },
    type: { value: 'charge' },
    origin: { value: 'purchase' },
  },
  coupon: {
    state: { value: 'redeemable' },
    discount_type: { value: 'percent' },
    duration: { value: 'single_use' },
    coupon_type: { value: 'single_code' },
  },
  item: {
    state: { value: 'active' },
  },
};

// Volume hints
const ENTITY_RESOURCE_IDS = new Set(['account', 'subscription', 'invoice', 'transaction']);
const REFERENCE_RESOURCE_IDS = new Set(['plan', 'add_on', 'line_item', 'billing_info', 'coupon', 'shipping_address', 'item']);

// Schemas to skip entirely
const SKIP_SCHEMAS = new Set([
  'Error', 'ErrorMayHaveTransaction', 'Empty', 'BinaryFile',
  'AccountCreate', 'AccountUpdate', 'AccountPurchase',
  'SubscriptionCreate', 'SubscriptionUpdate', 'SubscriptionCancel', 'SubscriptionPause', 'SubscriptionPurchase',
  'PlanCreate', 'PlanUpdate',
  'AddOnCreate', 'AddOnUpdate',
  'InvoiceCreate', 'InvoiceUpdate', 'InvoiceCollect', 'InvoiceRefund',
  'LineItemCreate', 'LineItemRefund',
  'BillingInfoCreate', 'BillingInfoVerify', 'BillingInfoVerifyCVV',
  'CouponCreate', 'CouponUpdate', 'CouponBulkCreate',
  'CouponRedemptionCreate',
  'ShippingAddressCreate', 'ShippingAddressUpdate',
  'ItemCreate', 'ItemUpdate',
  'UsageCreate',
  'MeasuredUnitCreate', 'MeasuredUnitUpdate',
  'GiftCardCreate', 'GiftCardDeliveryCreate', 'GiftCardRedeem',
  'ShippingMethodCreate', 'ShippingMethodUpdate',
  'ExternalSubscriptionCreate', 'ExternalSubscriptionUpdate',
  'ExternalInvoiceCreate',
  'ExternalProductCreate', 'ExternalProductUpdate',
  'ExternalAccountCreate', 'ExternalAccountUpdate',
  'ExternalProductReferenceCreate', 'ExternalProductReferenceUpdate',
  'ExternalChargeCreate',
  'GeneralLedgerAccountCreate', 'GeneralLedgerAccountUpdate',
  'PurchaseCreate',
  'SubscriptionChangeCreate', 'SubscriptionChangeBillingInfoCreate', 'SubscriptionChangeShippingCreate',
  'SubscriptionCreateProrationSettings',
  'ShippingFeeCreate', 'ShippingMethodMini',
  'AccountNoteCreate',
  'DunningCampaignsBulkUpdate', 'DunningCampaignsBulkUpdateResponse',
  'UniqueCouponCodeParams',
]);

// ---------------------------------------------------------------------------
// Spec loading
// ---------------------------------------------------------------------------

function loadSpec(): OaSpec {
  if (!existsSync(SPEC_PATH)) {
    throw new Error(
      `Recurly spec not found at ${SPEC_PATH}.\n` +
      `Download it to the adapter-recurly directory.`,
    );
  }
  console.log(`Loading spec from ${SPEC_PATH}...`);
  const raw = readFileSync(SPEC_PATH, 'utf-8');
  const spec = parseYaml(raw) as OaSpec;
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
    // Inherit required from top-level schema
    if (schema.required) {
      merged.required = [...(merged.required ?? []), ...schema.required];
    }
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
// Property → ResourceFieldSpec mapping
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
  'unit_amount', 'subtotal', 'total', 'tax', 'amount', 'discount',
  'balance', 'setup_fee', 'add_ons_total', 'net',
]);

const CURRENCY_FIELDS = new Set(['currency']);

const SEMANTIC_FIELD_NAMES: Record<string, string> = {
  email: 'email',
  cc_emails: 'email',
  url: 'url',
  currency: 'currency_code',
  country: 'country_code',
  preferred_locale: 'locale',
  vat_number: 'vat_number',
};

const TIMESTAMP_FIELDS = new Set([
  'created_at', 'updated_at', 'deleted_at', 'activated_at', 'canceled_at',
  'expires_at', 'paused_at', 'closed_at', 'converted_at',
  'trial_started_at', 'trial_ends_at',
  'current_period_started_at', 'current_period_ends_at',
  'current_term_started_at', 'current_term_ends_at',
  'bank_account_authorized_at',
]);

// Known resource schema names that we ref
const RESOURCE_SCHEMA_NAMES = new Map<string, string>();
for (const r of RESOURCES) {
  RESOURCE_SCHEMA_NAMES.set(r.schemaName, r.resourceId);
  // Also map Mini schemas
  RESOURCE_SCHEMA_NAMES.set(r.schemaName + 'Mini', r.resourceId);
}

function getResourceRef(schema: OaSchema): string | undefined {
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop()!;
    return RESOURCE_SCHEMA_NAMES.get(name);
  }
  if (schema.anyOf) {
    for (const v of schema.anyOf) {
      if (v.$ref) {
        const name = v.$ref.split('/').pop()!;
        const ref = RESOURCE_SCHEMA_NAMES.get(name);
        if (ref) return ref;
      }
    }
  }
  return undefined;
}

function mapProperty(
  fieldName: string,
  rawSchema: OaSchema,
  isRequired: boolean,
  spec: OaSpec,
): MappedField {
  const resourceRef = getResourceRef(rawSchema);
  const flat = flattenSchema(rawSchema, spec);
  const nullable = flat.nullable ?? false;

  let type: FieldType = 'string';
  if (flat.type === 'integer') type = 'integer';
  else if (flat.type === 'number') type = 'number';
  else if (flat.type === 'boolean') type = 'boolean';
  else if (flat.type === 'array') type = 'array';
  else if (flat.type === 'object' || flat.properties) type = 'object';

  const isTimestamp = TIMESTAMP_FIELDS.has(fieldName) ||
    (flat.format === 'date-time' && fieldName.endsWith('_at'));

  const isAmount = AMOUNT_FIELDS.has(fieldName) && (type === 'number' || type === 'integer');

  let semanticType: string | undefined;
  if (CURRENCY_FIELDS.has(fieldName)) semanticType = 'currency_code';
  else if (SEMANTIC_FIELD_NAMES[fieldName]) semanticType = SEMANTIC_FIELD_NAMES[fieldName];

  // Compute default
  let defaultValue: unknown;
  if (fieldName === 'id') {
    defaultValue = '';
  } else if (fieldName === 'object') {
    defaultValue = flat.enum?.[0] ?? '';
  } else if (fieldName === 'uuid') {
    defaultValue = '';
  } else if (isTimestamp) {
    defaultValue = undefined;
  } else if (isAmount) {
    defaultValue = 0;
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
    auto: isTimestamp || fieldName === 'id',
    timestamp: isTimestamp ? 'iso8601' : undefined,
    isAmount: isAmount || undefined,
    semanticType,
    ref: resourceRef,
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
  fields: Record<string, MappedField>;
  volumeHint: 'entity' | 'reference' | 'skip';
  refs: string[];
}

function extractResources(spec: OaSpec): Map<string, ResourceInfo> {
  const resources = new Map<string, ResourceInfo>();

  for (const def of RESOURCES) {
    const schema = spec.components.schemas[def.schemaName];
    if (!schema) {
      console.warn(`  Warning: schema ${def.schemaName} not found, skipping`);
      continue;
    }

    const flat = flattenSchema(schema, spec);
    const properties = flat.properties ?? {};
    const required = new Set(flat.required ?? []);

    const fields: Record<string, MappedField> = {};
    for (const [fieldName, propSchema] of Object.entries(properties)) {
      const mapped = mapProperty(fieldName, propSchema, required.has(fieldName), spec);
      if (fieldName === 'id') {
        mapped.idPrefix = def.idPrefix;
      }
      fields[fieldName] = mapped;
    }

    // Collect refs
    const refs: string[] = [];
    for (const field of Object.values(fields)) {
      if (field.ref && !refs.includes(field.ref)) {
        refs.push(field.ref);
      }
    }

    resources.set(def.resourceId, {
      schemaName: def.schemaName,
      resourceId: def.resourceId,
      resourceKey: def.resourceKey,
      objectType: def.resourceId,
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

// Map from resource key in paths to resource info
function buildResourceKeyMap(resources: Map<string, ResourceInfo>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [id, info] of resources) {
    map.set(info.resourceKey, id);
  }
  return map;
}

function extractRoutes(spec: OaSpec, resources: Map<string, ResourceInfo>): ExtractedRoute[] {
  const routes: ExtractedRoute[] = [];
  const knownKeys = new Set<string>();
  for (const [, info] of resources) {
    knownKeys.add(info.resourceKey);
  }

  for (const [specPath, pathItem] of Object.entries(spec.paths)) {
    // Skip .pdf endpoints and preview endpoints
    if (specPath.endsWith('.pdf')) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const httpMethod = method.toUpperCase() as ExtractedRoute['method'];
      const description = operation.summary ?? operation.description ?? '';

      // Convert {param} → :param, add /recurly prefix
      const fastifyPath = '/recurly' + specPath.replace(/\{([^}]+)\}/g, ':$1');

      // Determine resource
      const resource = detectRouteResource(specPath, knownKeys);

      // Determine operation type
      const op = detectOperation(specPath, httpMethod, operation);

      // Query filters
      const queryFilters: string[] = [];
      if (op === 'list') {
        const allParams = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
        for (const param of allParams) {
          if (param.in === 'query' && !['expand', 'limit', 'order', 'sort', 'begin_time', 'end_time'].includes(param.name)) {
            queryFilters.push(param.name);
          }
        }
      }

      // ID param
      const pathParams = (specPath.match(/\{([^}]+)\}/g) ?? []).map(p => p.slice(1, -1));
      const idParam = pathParams.length > 0 ? pathParams[pathParams.length - 1] : undefined;

      // Object type
      const keyToId = buildResourceKeyMap(resources);
      const resourceInfo = resources.get(keyToId.get(resource) ?? resource);
      const objectType = resourceInfo?.objectType;

      routes.push({
        method: httpMethod,
        stripePath: specPath,
        fastifyPath,
        resource,
        operation: op,
        description,
        queryFilters,
        idParam,
        objectType,
      });
    }
  }

  return routes;
}

function detectRouteResource(path: string, knownKeys: Set<string>): string {
  const parts = path.replace(/^\//, '').split('/');

  // Walk from deepest to shallowest for sub-resource detection
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i]!;
    if (seg.startsWith('{')) continue;
    if (knownKeys.has(seg)) return seg;
  }

  return parts[0]!;
}

function detectOperation(
  path: string,
  method: string,
  operation: OaOperation,
): RouteOperation {
  const parts = path.replace(/^\//, '').split('/');
  const paramCount = (path.match(/\{[^}]+\}/g) ?? []).length;
  const lastSegment = parts[parts.length - 1]!;
  const lastIsParam = lastSegment.startsWith('{');

  // Check operationId for hints
  const opId = operation.operationId ?? '';

  // Actions detected by operationId
  if (opId.startsWith('cancel_') || opId.startsWith('pause_') || opId.startsWith('resume_') ||
      opId.startsWith('reactivate_') || opId.startsWith('deactivate_') ||
      opId.startsWith('void_') || opId.startsWith('collect_') ||
      opId.startsWith('mark_') || opId.startsWith('reopen_') ||
      opId.startsWith('refund_') || opId.startsWith('convert_') ||
      opId.startsWith('verify_') || opId.startsWith('apply_') ||
      opId.startsWith('generate_') || opId.startsWith('restore_') ||
      opId.startsWith('redeem_') || opId.startsWith('preview_') ||
      opId.startsWith('record_') || opId === 'cancelPurchase' ||
      opId.startsWith('create_capture_') || opId.startsWith('create_authorize_') ||
      opId.startsWith('create_pending_')) {
    return 'action';
  }

  // No path params
  if (paramCount === 0) {
    if (method === 'GET') return 'list';
    if (method === 'POST') return 'create';
    return 'action';
  }

  // Last segment is a param
  if (lastIsParam) {
    if (method === 'GET') return 'retrieve';
    if (method === 'PUT' || method === 'POST' || method === 'PATCH') return 'update';
    if (method === 'DELETE') return 'delete';
    return 'action';
  }

  // Last segment is literal after param → could be sub-resource or action
  const secondToLast = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  const isSubResourceCollection = secondToLast?.startsWith('{');

  if (isSubResourceCollection) {
    if (method === 'GET') return 'list';
    if (method === 'POST') return 'create';
    if (method === 'DELETE') return 'delete';
    return 'action';
  }

  // Action (e.g., /subscriptions/{id}/cancel)
  return 'action';
}

// ---------------------------------------------------------------------------
// Code generators
// ---------------------------------------------------------------------------

function generateMetaTs(spec: OaSpec): string {
  const version = spec.info?.version ?? 'unknown';
  const generatedAt = new Date().toISOString();

  return `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-recurly generate
// Recurly OpenAPI spec version: ${version}
// Generated at: ${generatedAt}

export const RECURLY_SPEC_VERSION = ${JSON.stringify(version)};
export const RECURLY_SPEC_GENERATED_AT = ${JSON.stringify(generatedAt)};
`;
}

function generateResourceSpecsTs(resources: Map<string, ResourceInfo>): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-recurly generate`,
    `import type { AdapterResourceSpecs } from '@mimicai/core';`,
    ``,
    `export const recurlyResourceSpecs: AdapterResourceSpecs = {`,
    `  platform: {`,
    `    timestampFormat: 'iso8601',`,
    `    amountFormat: 'decimal_float',`,
    `    idPrefix: 'acct_',`,
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
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-recurly generate`,
    `import { generateId } from '@mimicai/adapter-sdk';`,
    ``,
    `function isoNow(): string {`,
    `  return new Date().toISOString();`,
    `}`,
    ``,
  ];

  for (const [, info] of resources) {
    const fnName = 'default' + toPascalCase(info.resourceId);
    lines.push(`export function ${fnName}(overrides: Record<string, unknown> = {}): Record<string, unknown> {`);
    lines.push(`  return {`);

    for (const [fieldName, field] of Object.entries(info.fields)) {
      let val: string;
      if (fieldName === 'id') {
        val = `generateId(${JSON.stringify(info.idPrefix)}, 14)`;
      } else if (fieldName === 'uuid') {
        val = `generateId("", 32)`;
      } else if (field.timestamp) {
        val = `isoNow()`;
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
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-recurly generate`,
    ``,
    `export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';`,
    `export type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';`,
    ``,
    `export interface GeneratedRoute {`,
    `  method: RouteMethod;`,
    `  fastifyPath: string;`,
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
    lines.push(`    description: ${JSON.stringify((route.description || '').replace(/\n/g, ' ').slice(0, 120))},`);
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
  const skipCount = [...resources.values()].filter(r => r.volumeHint === 'skip').length;
  console.log(`  Blueprint resources: ${entityCount} entity, ${refCount} reference, ${skipCount} skip`);

  console.log('Extracting routes...');
  const routes = extractRoutes(spec, resources);
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
  console.log(`  ${routes.length} routes across all Recurly paths`);
  console.log(`  Output: ${OUT_DIR}/`);
}

main();
