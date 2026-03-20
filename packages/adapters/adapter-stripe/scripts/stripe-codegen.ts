#!/usr/bin/env node
/**
 * Stripe OpenAPI → Mimic codegen
 *
 * Reads the pinned Stripe spec3.json (downloaded to scripts/stripe-spec3.json)
 * and generates four TypeScript source files into src/generated/:
 *
 *   resource-specs.ts  – AdapterResourceSpecs covering all x-resourceId schemas
 *   schemas.ts         – defaultXxx() factory functions for full field defaulting
 *   routes.ts          – GeneratedRoute[] covering all 435+ Stripe paths
 *   meta.ts            – spec version + generated timestamp
 *
 * Usage:
 *   pnpm --filter @mimicai/adapter-stripe generate
 *   (or: npx tsx scripts/stripe-codegen.ts)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, 'stripe-spec3.json');
const OUT_DIR = resolve(__dirname, '../src/generated');

// ---------------------------------------------------------------------------
// Types (minimal OpenAPI 3.0 shape we care about)
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
  'x-resourceId'?: string;
  'x-expandableFields'?: string[];
  'x-stripeResource'?: { type?: string; nameOverride?: string };
  title?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
}

interface OaOperation {
  operationId?: string;
  description?: string;
  summary?: string;
  parameters?: OaParameter[];
  requestBody?: { content?: { 'application/x-www-form-urlencoded'?: { schema?: OaSchema } } };
  responses?: Record<string, { content?: { 'application/json'?: { schema?: OaSchema } } }>;
  'x-stripeOperationMetadata'?: { sortKey?: string; apiVersion?: string };
}

interface OaParameter {
  name: string;
  in: 'query' | 'path' | 'header';
  required?: boolean;
  schema?: OaSchema;
  description?: string;
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
// Known Stripe ID prefixes (the spec doesn't include these, so we hardcode)
// ---------------------------------------------------------------------------

const ID_PREFIXES: Record<string, string> = {
  account: 'acct_',
  account_link: 'acctlnk_',
  apple_pay_domain: 'apwc_',
  application_fee: 'fee_',
  application_fee_refund: 'fr_',
  balance_transaction: 'txn_',
  bank_account: 'ba_',
  billing_alert: 'alrt_',
  billing_credit_grant: 'credgr_',
  billing_meter: 'meter_',
  billing_portal_configuration: 'bpc_',
  billing_portal_session: 'pts_',
  capability: '',
  card: 'card_',
  cash_balance: '',
  charge: 'ch_',
  checkout_session: 'cs_',
  climate_order: 'climorder_',
  climate_product: 'climsku_',
  climate_supplier: 'climsup_',
  confirmation_token: 'ctoken_',
  coupon: '',
  credit_note: 'cn_',
  customer: 'cus_',
  customer_balance_transaction: 'cbtxn_',
  customer_cash_balance_transaction: 'ccsbtxn_',
  discount: 'di_',
  dispute: 'dp_',
  ephemeral_key: 'ephkey_',
  event: 'evt_',
  exchange_rate: '',
  file: 'file_',
  file_link: 'link_',
  financial_connections_account: 'fca_',
  financial_connections_session: 'fcsess_',
  financial_connections_transaction: 'fctxn_',
  forwarding_request: 'fwdreq_',
  identity_verification_report: 'vr_',
  identity_verification_session: 'vs_',
  invoice: 'in_',
  invoice_item: 'ii_',
  invoice_rendering_template: 'invtmpl_',
  issuing_authorization: 'iauth_',
  issuing_card: 'ic_',
  issuing_cardholder: 'ich_',
  issuing_dispute: 'idp_',
  issuing_personalization_design: 'ipd_',
  issuing_physical_bundle: 'ics_',
  issuing_settlement: 'ipi_',
  issuing_token: 'isok_',
  issuing_transaction: 'ipi_',
  line_item: 'li_',
  mandate: 'mandate_',
  payment_intent: 'pi_',
  payment_link: 'plink_',
  payment_method: 'pm_',
  payment_method_configuration: 'pmc_',
  payment_method_domain: 'pmd_',
  payout: 'po_',
  plan: 'plan_',
  price: 'price_',
  product: 'prod_',
  promotion_code: 'promo_',
  quote: 'qt_',
  radar_early_fraud_warning: 'issfr_',
  radar_rule: 'rule_',
  radar_value_list: 'rsl_',
  radar_value_list_item: 'rsli_',
  refund: 're_',
  reporting_report_run: 'frr_',
  reporting_report_type: 'sigma.',
  reserve_transaction: 'rtr_',
  review: 'prv_',
  scheduled_query_run: 'sqr_',
  setup_attempt: 'setatt_',
  setup_intent: 'seti_',
  shipping_rate: 'shr_',
  sigma_scheduled_query_run: 'sqr_',
  source: 'src_',
  source_mandate_notification: 'src_',
  source_transaction: 'srctxn_',
  subscription: 'sub_',
  subscription_item: 'si_',
  subscription_schedule: 'sub_sched_',
  tax_calculation: '',
  tax_id: 'txi_',
  tax_rate: 'txr_',
  tax_registration: 'taxreg_',
  tax_settings: '',
  tax_transaction: 'tax_',
  terminal_configuration: 'tmc_',
  terminal_connection_token: '',
  terminal_location: 'tml_',
  terminal_reader: 'tmr_',
  test_helpers_test_clock: 'clock_',
  token: 'tok_',
  topup: 'tu_',
  transfer: 'tr_',
  transfer_reversal: 'trr_',
  usage_record: 'mbur_',
  usage_record_summary: '',
  webhook_endpoint: 'we_',
  // Stripe uses 'invoiceitem' (no underscore) as the resource ID in the spec
  invoiceitem: 'ii_',
};

// Semantic default overrides: fixes for spec-generated defaults that are wrong
// for typical mock usage (e.g. 'canceled' status on a freshly created PaymentIntent).
// Each entry: { value } emits JSON.stringify(value), { code } emits the raw expression.
const SCHEMA_FIELD_OVERRIDES: Record<string, Record<string, { value?: unknown; code?: string }>> = {
  payment_intent: {
    status: { value: 'requires_payment_method' },
    client_secret: { code: 'generateId("pi_", 14) + "_secret_" + generateId("", 10)' },
  },
  setup_intent: {
    status: { value: 'requires_payment_method' },
    client_secret: { code: 'generateId("seti_", 14) + "_secret_" + generateId("", 10)' },
  },
  coupon: {
    valid: { value: true },
  },
  payment_link: {
    active: { value: true },
    url: { code: '"https://buy.stripe.com/test_" + generateId("", 10)' },
  },
};

// Volume hints: resources the blueprint engine should generate persona data for
const ENTITY_RESOURCES = new Set([
  'customer', 'payment_intent', 'charge', 'invoice', 'subscription',
  'refund', 'dispute', 'review',
]);

const REFERENCE_RESOURCES = new Set([
  'product', 'price', 'coupon', 'promotion_code', 'tax_rate', 'shipping_rate',
  'payment_method', 'payment_link', 'mandate', 'setup_intent', 'plan',
  'subscription_item', 'invoice_item', 'credit_note', 'payout',
  'balance_transaction', 'transfer', 'file', 'webhook_endpoint',
  'issuing_card', 'issuing_cardholder', 'issuing_authorization',
]);

// Resources we explicitly exclude from resourceSpecs (internal/config objects)
const EXCLUDE_FROM_RESOURCE_SPECS = new Set([
  'error', 'api_errors', 'deleted_customer', 'deleted_product', 'deleted_price',
  'deleted_coupon', 'deleted_discount', 'deleted_subscription_item',
  'deleted_plan', 'deleted_tax_id', 'deleted_invoice_item',
  'deleted_payment_method', 'deleted_webhook_endpoint', 'deleted_radar_rule',
  'deleted_test_helpers_test_clock', 'deleted_file_link',
  'notification_event_data', 'notification_event_request',
]);

// ---------------------------------------------------------------------------
// Spec loading
// ---------------------------------------------------------------------------

function loadSpec(): OaSpec {
  if (!existsSync(SPEC_PATH)) {
    throw new Error(
      `Stripe spec not found at ${SPEC_PATH}.\n` +
      `Run: curl -fsSL https://raw.githubusercontent.com/stripe/openapi/master/latest/spec3.json -o scripts/stripe-spec3.json`,
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

/**
 * Resolve a $ref string to its schema.
 * Only handles local refs: '#/components/schemas/Foo'
 */
function resolveRef(ref: string, spec: OaSpec): OaSchema | null {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/);
  if (!match) return null;
  return spec.components.schemas[match[1]!] ?? null;
}

/**
 * Fully flatten a schema by resolving $ref, anyOf, allOf, oneOf.
 * Returns a "resolved" schema with nullable/enum/type/properties merged.
 * Handles cycles via a visited set.
 */
function flattenSchema(
  schema: OaSchema,
  spec: OaSpec,
  visited = new Set<string>(),
  depth = 0,
): OaSchema {
  if (depth > 8) return { type: 'object' }; // safety cap

  // Direct $ref
  if (schema.$ref) {
    if (visited.has(schema.$ref)) return { type: 'object' }; // cycle
    visited.add(schema.$ref);
    const resolved = resolveRef(schema.$ref, spec);
    if (!resolved) return { type: 'string' };
    const flat = flattenSchema(resolved, spec, new Set(visited), depth + 1);
    // Preserve nullable from the referencing site
    if (schema.nullable) flat.nullable = true;
    return flat;
  }

  // anyOf — Stripe uses this for "nullable ref": anyOf: [{$ref: ...}, {nullable: true}]
  if (schema.anyOf && schema.anyOf.length > 0) {
    const nonEmpty = schema.anyOf.filter(s => !isNullishSchema(s));
    const isNullable = schema.anyOf.some(s => isNullishSchema(s)) || schema.nullable;
    if (nonEmpty.length === 1) {
      const flat = flattenSchema(nonEmpty[0]!, spec, visited, depth + 1);
      if (isNullable) flat.nullable = true;
      return flat;
    }
    if (nonEmpty.length === 0) return { type: 'string', nullable: true };
    // Multiple non-null anyOf → use first (for type defaulting purposes)
    const flat = flattenSchema(nonEmpty[0]!, spec, visited, depth + 1);
    if (isNullable) flat.nullable = true;
    return flat;
  }

  // oneOf — treat same as anyOf for our purposes
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

  // allOf — merge all schemas (usually [{$ref: Base}, {extra props}])
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
  if (ext['x-resourceId']) merged['x-resourceId'] = ext['x-resourceId'];
  if (ext['x-expandableFields']) merged['x-expandableFields'] = ext['x-expandableFields'];
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
  timestamp?: 'unix_seconds';
  isAmount?: boolean;
  semanticType?: string;
  ref?: string;
  description?: string;
}

const AMOUNT_FIELDS = new Set([
  'amount', 'amount_off', 'amount_due', 'amount_paid', 'amount_remaining',
  'amount_captured', 'amount_refunded', 'amount_to_capture', 'unit_amount',
  'unit_amount_decimal', 'subtotal', 'total', 'tax', 'balance',
  'net', 'fee', 'application_fee_amount',
  'amount_authorized', 'amount_details',
]);

const CURRENCY_FIELDS = new Set(['currency', 'presentment_currency']);

const SEMANTIC_FIELD_NAMES: Record<string, string> = {
  email: 'email',
  phone: 'phone',
  url: 'url',
  website: 'url',
  ip: 'ip_address',
  ip_address: 'ip_address',
  country: 'country_code',
  locale: 'locale',
  currency: 'currency_code',
};

/**
 * Determine the `ref` field for a property if it points to a known resource.
 * Checks direct $ref, and also looks inside anyOf/oneOf for expandable
 * references (Stripe pattern: anyOf: [{ $ref: "..." }, { type: "string" }]).
 */
function getResourceRef(
  schema: OaSchema,
  spec: OaSpec,
  resourceSchemaNames: Set<string>,
): string | undefined {
  // Direct $ref at top level
  const directRef = extractRefResourceId(schema, spec, resourceSchemaNames);
  if (directRef) return directRef;

  // Check inside anyOf (Stripe uses anyOf: [{$ref: ...}, {type: "string"}])
  if (schema.anyOf) {
    for (const variant of schema.anyOf) {
      const ref = extractRefResourceId(variant, spec, resourceSchemaNames);
      if (ref) return ref;
    }
  }

  // Check inside oneOf
  if (schema.oneOf) {
    for (const variant of schema.oneOf) {
      const ref = extractRefResourceId(variant, spec, resourceSchemaNames);
      if (ref) return ref;
    }
  }

  return undefined;
}

function extractRefResourceId(
  schema: OaSchema,
  spec: OaSpec,
  resourceSchemaNames: Set<string>,
): string | undefined {
  if (!schema.$ref) return undefined;
  const match = schema.$ref.match(/^#\/components\/schemas\/(.+)$/);
  if (!match) return undefined;
  const schemaName = match[1]!;
  if (!resourceSchemaNames.has(schemaName)) return undefined;
  const resolved = spec.components.schemas[schemaName];
  if (!resolved?.['x-resourceId']) return undefined;
  return resolved['x-resourceId'];
}

/**
 * Compute a deep default value for an object schema.
 * Returns a Record<string, unknown> suitable for use as `default` in ResourceFieldSpec.
 */
function computeObjectDefault(
  schema: OaSchema,
  spec: OaSpec,
  resourceSchemaNames: Set<string>,
  visited = new Set<string>(),
  depth = 0,
): Record<string, unknown> {
  if (depth > 5) return {};
  const flat = flattenSchema(schema, spec, new Set(visited), depth);
  if (!flat.properties) return {};

  const result: Record<string, unknown> = {};
  const required = new Set(flat.required ?? []);

  for (const [name, propSchema] of Object.entries(flat.properties)) {
    const propFlat = flattenSchema(propSchema, spec, new Set(visited), depth + 1);
    const isRequired = required.has(name);
    result[name] = computeScalarDefault(propFlat, name, isRequired, spec, resourceSchemaNames, visited, depth + 1);
  }
  return result;
}

function computeScalarDefault(
  flat: OaSchema,
  fieldName: string,
  isRequired: boolean,
  spec: OaSpec,
  resourceSchemaNames: Set<string>,
  visited: Set<string>,
  depth: number,
): unknown {
  if (flat.nullable && !isRequired) return null;

  if (flat.enum && flat.enum.length > 0) {
    // Use first non-empty enum value
    const first = flat.enum.find(v => v !== '');
    return first ?? flat.enum[0];
  }

  if (flat.format === 'unix-time') return 0; // placeholder, overridden at runtime

  switch (flat.type) {
    case 'boolean': return false;
    case 'integer': return 0;
    case 'number': return 0;
    case 'string': return '';
    case 'array': return [];
    case 'object':
      if (flat.properties) {
        return computeObjectDefault(flat, spec, resourceSchemaNames, visited, depth + 1);
      }
      // metadata-style objects
      if (fieldName === 'metadata' || fieldName === 'extra_data') return {};
      return {};
    default:
      if (!isRequired) return null;
      return null;
  }
}

/**
 * Map a single OpenAPI property schema to a MappedField.
 */
function mapProperty(
  fieldName: string,
  rawSchema: OaSchema,
  isRequired: boolean,
  spec: OaSpec,
  resourceSchemaNames: Set<string>,
): MappedField {
  // Check for direct resource ref before flattening
  const resourceRef = getResourceRef(rawSchema, spec, resourceSchemaNames);

  const flat = flattenSchema(rawSchema, spec);
  const nullable = flat.nullable ?? false;

  // Determine type
  let type: FieldType = 'string';
  if (flat.type === 'integer') type = 'integer';
  else if (flat.type === 'number') type = 'number';
  else if (flat.type === 'boolean') type = 'boolean';
  else if (flat.type === 'array') type = 'array';
  else if (flat.type === 'object' || flat.properties) type = 'object';

  // Timestamp
  const isTimestamp = flat.format === 'unix-time';

  // Amount field
  const isAmount = AMOUNT_FIELDS.has(fieldName) && (type === 'integer' || type === 'number');

  // Currency field
  const isCurrency = CURRENCY_FIELDS.has(fieldName);

  // Semantic type from field name
  let semanticType: string | undefined;
  if (isCurrency) {
    semanticType = 'currency_code';
  } else if (SEMANTIC_FIELD_NAMES[fieldName]) {
    semanticType = SEMANTIC_FIELD_NAMES[fieldName];
  } else if (flat.format === 'email') {
    semanticType = 'email';
  }

  // ID field with prefix
  let idPrefix: string | undefined;
  if (fieldName === 'id' && !resourceRef) {
    // idPrefix is set by the resource extractor, not here
  }

  // Compute default
  let defaultValue: unknown;
  if (fieldName === 'id') {
    defaultValue = ''; // filled by ID generator at runtime
  } else if (fieldName === 'object') {
    defaultValue = flat.enum?.[0] ?? '';
  } else if (fieldName === 'metadata') {
    defaultValue = {};
  } else if (fieldName === 'livemode') {
    defaultValue = false;
  } else if (isTimestamp) {
    defaultValue = undefined; // auto-generated at runtime
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
    if (flat.properties) {
      defaultValue = computeObjectDefault(flat, spec, resourceSchemaNames);
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
    auto: isTimestamp || fieldName === 'created',
    timestamp: isTimestamp ? 'unix_seconds' : undefined,
    isAmount: isAmount || undefined,
    semanticType,
    ref: resourceRef,
    description: flat.description,
  };
}

// ---------------------------------------------------------------------------
// Resource extraction
// ---------------------------------------------------------------------------

interface ResourceInfo {
  schemaName: string;        // e.g. 'customer'
  resourceId: string;        // x-resourceId value, e.g. 'customer'
  resourceKey: string;       // plural key used in routes, e.g. 'customers'
  objectType: string;        // e.g. 'customer'
  idPrefix: string;          // e.g. 'cus_'
  fields: Record<string, MappedField>;
  expandableFields: string[];
  volumeHint: 'entity' | 'reference' | 'skip';
  refs: string[];            // resource types this resource refs
}

/**
 * Extract all top-level resource schemas (those with x-resourceId).
 */
function extractResources(spec: OaSpec): Map<string, ResourceInfo> {
  const resources = new Map<string, ResourceInfo>();

  // First pass: collect all schema names that have x-resourceId
  const resourceSchemaNames = new Set<string>();
  for (const [name, schema] of Object.entries(spec.components.schemas)) {
    if (schema['x-resourceId']) {
      resourceSchemaNames.add(name);
    }
  }

  // Second pass: extract fields
  for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
    const resourceId = schema['x-resourceId'];
    if (!resourceId) continue;
    if (EXCLUDE_FROM_RESOURCE_SPECS.has(schemaName)) continue;
    if (schemaName.startsWith('deleted_')) continue;

    const flat = flattenSchema(schema, spec);
    const properties = flat.properties ?? {};
    const required = new Set(flat.required ?? []);

    const fields: Record<string, MappedField> = {};

    for (const [fieldName, propSchema] of Object.entries(properties)) {
      const isRequired = required.has(fieldName);
      const mapped = mapProperty(fieldName, propSchema, isRequired, spec, resourceSchemaNames);

      // Set ID prefix for the `id` field
      if (fieldName === 'id') {
        mapped.idPrefix = ID_PREFIXES[resourceId] ?? '';
      }

      fields[fieldName] = mapped;
    }

    const idPrefix = ID_PREFIXES[resourceId] ?? '';

    // Determine resourceKey (plural form used in URL path)
    const resourceKey = deriveResourceKey(resourceId, spec);

    // Determine volumeHint
    let volumeHint: 'entity' | 'reference' | 'skip' = 'skip';
    if (ENTITY_RESOURCES.has(resourceId)) volumeHint = 'entity';
    else if (REFERENCE_RESOURCES.has(resourceId)) volumeHint = 'reference';

    // Collect refs (fields that point to other resources)
    const refs: string[] = [];
    for (const [, field] of Object.entries(fields)) {
      if (field.ref && !refs.includes(field.ref)) {
        refs.push(field.ref);
      }
    }

    const expandableFields = flat['x-expandableFields'] ?? [];

    resources.set(resourceId, {
      schemaName,
      resourceId,
      resourceKey,
      objectType: resourceId,
      idPrefix,
      fields,
      expandableFields,
      volumeHint,
      refs,
    });
  }

  return resources;
}

/**
 * Derive the plural URL key for a resource ID.
 * Most are just resourceId + 's', but some are irregular.
 */
function deriveResourceKey(resourceId: string, spec: OaSpec): string {
  // Check if any path starts with /v1/{key} or /v2/{key}
  const candidates = new Set<string>();
  for (const path of Object.keys(spec.paths)) {
    const match = path.match(/^\/v\d+\/([a-z_]+)\/?/);
    if (match) candidates.add(match[1]!);
  }

  // Try common transformations
  const tryKeys = [
    resourceId,
    resourceId + 's',
    resourceId.replace(/_/g, '_') + 's',
  ];

  for (const key of tryKeys) {
    if (candidates.has(key)) return key;
  }

  // Fall through to simple pluralization
  if (resourceId.endsWith('y')) {
    return resourceId.slice(0, -1) + 'ies';
  }
  return resourceId + 's';
}

// ---------------------------------------------------------------------------
// Route extraction
// ---------------------------------------------------------------------------

type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';

interface ExtractedRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  stripePath: string;        // original Stripe path, e.g. /v1/customers/{customer}
  fastifyPath: string;       // Fastify route path with colon params
  resource: string;          // resource type, e.g. 'customers'
  operation: RouteOperation;
  description: string;
  queryFilters: string[];    // filterable query params for list ops
  idParam?: string;          // path param name for the ID
  objectType?: string;       // for delete responses
  hasRequestBody: boolean;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function extractRoutes(spec: OaSpec, resources: Map<string, ResourceInfo>): ExtractedRoute[] {
  const routes: ExtractedRoute[] = [];

  // Build lookup: resourceKey → resourceId
  const keyToId = new Map<string, string>();
  for (const [id, info] of resources) {
    keyToId.set(info.resourceKey, id);
  }

  // Also build a set of all resource schema names for response schema detection
  const resourceSchemaNames = new Set<string>();
  for (const [, info] of resources) {
    resourceSchemaNames.add(info.schemaName);
  }

  for (const [stripePath, pathItem] of Object.entries(spec.paths)) {
    if (!stripePath.startsWith('/v1/') && !stripePath.startsWith('/v2/')) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const httpMethod = method.toUpperCase() as ExtractedRoute['method'];
      const description = operation.summary ?? operation.description ?? '';

      // Convert Stripe path params {param} → Fastify :param
      const fastifyPath = stripePath.replace(/\{([^}]+)\}/g, ':$1');

      // Determine what resource this route belongs to
      const resource = detectRouteResource(stripePath, operation, resources, spec);

      // Determine operation type
      const op = detectOperation(stripePath, httpMethod, operation);

      // Query filters (for list operations)
      const queryFilters: string[] = [];
      if (op === 'list' && operation.parameters) {
        for (const param of operation.parameters) {
          if (param.in === 'query' && param.name !== 'expand') {
            queryFilters.push(param.name);
          }
        }
      }

      // ID param: use the last path param (handles nested resources correctly)
      const pathParams = (stripePath.match(/\{([^}]+)\}/g) ?? []).map(p => p.slice(1, -1));
      const idParam = pathParams.length > 0 ? pathParams[pathParams.length - 1] : undefined;

      // Object type (for delete confirmation responses)
      const resourceInfo = resources.get(keyToId.get(resource) ?? resource);
      const objectType = resourceInfo?.objectType;

      const hasRequestBody = !!(operation.requestBody);

      routes.push({
        method: httpMethod,
        stripePath,
        fastifyPath,
        resource,
        operation: op,
        description,
        queryFilters,
        idParam,
        objectType,
        hasRequestBody,
      });
    }
  }

  return routes;
}

/**
 * Detect which resource a route operates on.
 *
 * Strategy: find the deepest literal path segment that matches a known
 * resource key. This correctly attributes nested sub-resource routes
 * (e.g. /v1/customers/{customer}/subscriptions → subscriptions).
 * Falls back to the first segment for unknown resources.
 */
function detectRouteResource(
  path: string,
  _operation: OaOperation,
  resources: Map<string, ResourceInfo>,
  _spec: OaSpec,
): string {
  const parts = path.replace(/^\/v\d+\//, '').split('/');
  const knownKeys = new Set<string>();
  for (const [, info] of resources) {
    knownKeys.add(info.resourceKey);
  }

  // Walk segments from deepest to shallowest, find the first literal
  // segment matching a known resource key.
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i]!;
    if (seg.startsWith('{')) continue; // skip path params
    if (knownKeys.has(seg)) return seg;
  }

  // Fallback: first literal segment (may not be a known resource, e.g. billing_portal)
  return parts[0]!;
}

// Singleton resources that return a single object from GET with no path params
const SINGLETON_RESOURCES = new Set(['account', 'balance']);

/**
 * Determine the CRUD operation type for a route.
 *
 * Stripe uses POST for both create and update — we disambiguate by
 * checking whether the final segment is a path param (update) or a
 * literal (create/action).
 */
function detectOperation(
  path: string,
  method: ExtractedRoute['method'],
  operation: OaOperation,
): RouteOperation {
  const segments = path.replace(/^\/v\d+\//, '').split('/');
  const paramCount = (path.match(/\{[^}]+\}/g) ?? []).length;
  const lastSegment = segments[segments.length - 1]!;
  const lastIsParam = lastSegment.startsWith('{');

  // /v1/resource — no path params
  if (paramCount === 0) {
    // Detect singleton retrieves (e.g. GET /v1/account, GET /v1/balance)
    if (method === 'GET' && SINGLETON_RESOURCES.has(segments[0]!)) return 'retrieve';
    if (method === 'GET') return 'list';
    if (method === 'POST') return 'create';
    return 'action';
  }

  // Last segment is a path param → operating on a specific resource instance
  if (lastIsParam) {
    if (method === 'GET') return 'retrieve';
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') return 'update';
    if (method === 'DELETE') return 'delete';
    return 'action';
  }

  // Last segment is a literal after a param → action or sub-resource collection
  // e.g. /v1/payment_intents/{intent}/confirm → action
  // e.g. /v1/customers/{customer}/subscriptions → list/create on sub-resource
  const secondToLast = segments.length >= 2 ? segments[segments.length - 2] : undefined;
  const isSubResourceCollection = secondToLast?.startsWith('{');

  if (isSubResourceCollection) {
    // /v1/parent/{id}/sub_resource — list or create on a sub-resource
    if (method === 'GET') return 'list';
    if (method === 'POST') return 'create';
    if (method === 'DELETE') return 'delete';
    return 'action';
  }

  // Literal after a param where the second-to-last is also literal
  // — this is an action (e.g. /v1/payment_intents/{intent}/confirm)
  return 'action';
}

// ---------------------------------------------------------------------------
// Default factory computation (for schemas.ts)
// ---------------------------------------------------------------------------

interface SchemaDefault {
  resourceId: string;
  fnName: string;
  fields: Record<string, unknown>;
}

function computeSchemaDefaults(resources: Map<string, ResourceInfo>): SchemaDefault[] {
  const results: SchemaDefault[] = [];

  for (const [resourceId, info] of resources) {
    const fields: Record<string, unknown> = {};

    for (const [fieldName, field] of Object.entries(info.fields)) {
      if (field.auto && (fieldName === 'created' || fieldName === 'created_at')) {
        fields[fieldName] = '__UNIX_NOW__';
      } else if (fieldName === 'id') {
        fields[fieldName] = '__GENERATE_ID__';
      } else {
        fields[fieldName] = field.default;
      }
    }

    results.push({
      resourceId,
      fnName: 'default' + toPascalCase(resourceId),
      fields,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Code generators
// ---------------------------------------------------------------------------

function generateMetaTs(spec: OaSpec): string {
  const version = spec.info?.version ?? 'unknown';
  const generatedAt = new Date().toISOString();

  return `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-stripe generate
// Stripe OpenAPI spec version: ${version}
// Generated at: ${generatedAt}

export const STRIPE_SPEC_VERSION = ${JSON.stringify(version)};
export const STRIPE_SPEC_GENERATED_AT = ${JSON.stringify(generatedAt)};
`;
}

function generateResourceSpecsTs(resources: Map<string, ResourceInfo>): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-stripe generate`,
    `import type { AdapterResourceSpecs } from '@mimicai/core';`,
    ``,
    `export const stripeResourceSpecs: AdapterResourceSpecs = {`,
    `  platform: {`,
    `    timestampFormat: 'unix_seconds',`,
    `    amountFormat: 'integer_cents',`,
    `    idPrefix: 'cus_',`,
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
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-stripe generate`,
    `import { unixNow, generateId } from '@mimicai/adapter-sdk';`,
    ``,
    `/**`,
    ` * Returns a complete Stripe object with all fields defaulted to spec-faithful values.`,
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
      if (fieldName === 'id') {
        val = `generateId(${JSON.stringify(info.idPrefix)}, 14)`;
      } else if (field.auto && (fieldName === 'created' || fieldName === 'created_at')) {
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

  // Export a lookup map
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
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-stripe generate`,
    ``,
    `export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';`,
    `export type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';`,
    ``,
    `export interface GeneratedRoute {`,
    `  /** HTTP method */`,
    `  method: RouteMethod;`,
    `  /** Fastify route path with colon params */`,
    `  fastifyPath: string;`,
    `  /** Original Stripe path for documentation */`,
    `  stripePath: string;`,
    `  /** Top-level resource name (plural, e.g. 'customers') */`,
    `  resource: string;`,
    `  /** CRUD operation classification */`,
    `  operation: RouteOperation;`,
    `  /** Human-readable description from the spec */`,
    `  description: string;`,
    `  /** Query param names that can be used to filter list results */`,
    `  queryFilters: string[];`,
    `  /** Path param name holding the resource ID (retrieve/update/delete) */`,
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
    lines.push(`    description: ${JSON.stringify(route.description.replace(/\n/g, ' ').slice(0, 120))},`);
    lines.push(`    queryFilters: ${JSON.stringify(route.queryFilters)},`);
    if (route.idParam) lines.push(`    idParam: ${JSON.stringify(route.idParam)},`);
    if (route.objectType) lines.push(`    objectType: ${JSON.stringify(route.objectType)},`);
    lines.push(`  },`);
  }

  lines.push(`];`);
  lines.push(``);
  lines.push(`/**`);
  lines.push(` * Build an override key for a route: "\${METHOD}:\${fastifyPath}"`);
  lines.push(` * Used to register custom handlers that replace generated CRUD logic.`);
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
  console.log(`  Found ${resources.size} resources with x-resourceId`);

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

  console.log('Generating files...');

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

  // Summary
  const totalFields = [...resources.values()].reduce((sum, r) => sum + Object.keys(r.fields).length, 0);
  console.log(`\nCodegen complete:`);
  console.log(`  ${resources.size} resources, ${totalFields} total fields`);
  console.log(`  ${routes.length} routes across all Stripe paths`);
  console.log(`  Output: ${OUT_DIR}/`);
}

main();
