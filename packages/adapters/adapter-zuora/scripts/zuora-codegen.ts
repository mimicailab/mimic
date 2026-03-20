#!/usr/bin/env node
/**
 * Zuora OpenAPI → Mimic codegen
 *
 * Reads the Zuora OpenAPI spec (YAML or JSON) and generates four TypeScript
 * source files into src/generated/:
 *
 *   resource-specs.ts  – AdapterResourceSpecs for all curated resources
 *   schemas.ts         – defaultXxx() factory functions for mock data
 *   routes.ts          – GeneratedRoute[] for all Zuora /v1/ paths
 *   meta.ts            – spec version + generated timestamp
 *
 * Zuora-specific patterns handled:
 *   - REST API with GET/POST/PUT/DELETE (some PATCH)
 *   - Path params use kebab-case in spec: {account-key} → :accountKey (camelCase for Fastify)
 *   - List envelopes vary by resource (e.g., { payments, nextPage, success })
 *   - Page-based pagination: pageSize/page query params
 *   - Mixed camelCase + PascalCase (PascalCase for /object/ endpoints)
 *   - Timestamps are ISO 8601 strings
 *   - IDs are 32-char hex strings
 *   - Success envelope: { success: true, ... }
 *   - Error envelope: { success: false, reasons: [{ code, message }] }
 *
 * Usage:
 *   pnpm --filter @mimicai/adapter-zuora generate
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findSpecPath(): string {
  const yamlPath = resolve(__dirname, '..', 'zuora-spec.yaml');
  const jsonPath = resolve(__dirname, '..', 'zuora-spec.json');
  if (existsSync(yamlPath)) return yamlPath;
  if (existsSync(jsonPath)) return jsonPath;
  throw new Error(
    `Zuora spec not found.\n` +
    `Download it from: https://developer.zuora.com/yaml/swagger.yaml`,
  );
}

const SPEC_PATH = findSpecPath();
const OUT_DIR = resolve(__dirname, '../src/generated');

// ---------------------------------------------------------------------------
// Types (minimal OpenAPI 3.0 shape)
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
// Zuora resource definitions
// ---------------------------------------------------------------------------

interface ZuoraResourceDef {
  resourceId: string;
  resourceKey: string;
  objectType: string;
  idField: string;
  idPrefix: string;
  volumeHint: 'entity' | 'reference' | 'skip';
  schemaName: string;
  listKey?: string;  // key in list response envelope (e.g., 'payments', 'creditmemos')
}

const ZUORA_RESOURCES: ZuoraResourceDef[] = [
  // Use flat/expanded schemas for internal storage — NOT the wrapped GET response schemas
  // ExpandedAccount has flat fields (id, accountNumber, name, status, ...) vs GETAccountType which wraps in basicInfo/billToContact/etc.
  { resourceId: 'account', resourceKey: 'accounts', objectType: 'account', idField: 'id', idPrefix: 'zu_acct_', volumeHint: 'entity', schemaName: 'ExpandedAccount', listKey: 'accounts' },
  // GETSubscriptionType has flat fields (id, subscriptionNumber, status, ...) — the "WithSuccess" variant wraps in success envelope
  { resourceId: 'subscription', resourceKey: 'subscriptions', objectType: 'subscription', idField: 'id', idPrefix: 'zu_sub_', volumeHint: 'entity', schemaName: 'GETSubscriptionType', listKey: 'subscriptions' },
  // Order schema is flat with orderNumber as ID
  { resourceId: 'order', resourceKey: 'orders', objectType: 'order', idField: 'orderNumber', idPrefix: 'zu_ord_', volumeHint: 'entity', schemaName: 'Order', listKey: 'orders' },
  // ExpandedInvoice has flat fields (id, invoiceNumber, amount, status, ...)
  { resourceId: 'invoice', resourceKey: 'invoices', objectType: 'invoice', idField: 'id', idPrefix: 'zu_inv_', volumeHint: 'entity', schemaName: 'ExpandedInvoice', listKey: 'invoices' },
  // GETARPaymentTypewithSuccess is the flat payment schema (lowercase 'id', no success wrapper despite the name)
  { resourceId: 'payment', resourceKey: 'payments', objectType: 'payment', idField: 'id', idPrefix: 'zu_pay_', volumeHint: 'entity', schemaName: 'GETARPaymentTypewithSuccess', listKey: 'payments' },
  // GETCreditMemoTypewithSuccess is the flat credit memo schema (has 'number' field, not 'memoNumber')
  { resourceId: 'credit_memo', resourceKey: 'credit-memos', objectType: 'credit_memo', idField: 'id', idPrefix: 'zu_cm_', volumeHint: 'entity', schemaName: 'GETCreditMemoTypewithSuccess', listKey: 'creditmemos' },
  // GETDebitMemoTypewithSuccess is the flat debit memo schema
  { resourceId: 'debit_memo', resourceKey: 'debit-memos', objectType: 'debit_memo', idField: 'id', idPrefix: 'zu_dm_', volumeHint: 'entity', schemaName: 'GETDebitMemoTypewithSuccess', listKey: 'debitmemos' },
  { resourceId: 'payment_method', resourceKey: 'payment-methods', objectType: 'payment_method', idField: 'id', idPrefix: 'zu_pm_', volumeHint: 'entity', schemaName: 'GETPaymentMethodResponse', listKey: 'paymentMethods' },
  // GETRefundTypewithSuccess is the flat refund schema
  { resourceId: 'refund', resourceKey: 'refunds', objectType: 'refund', idField: 'id', idPrefix: 'zu_ref_', volumeHint: 'entity', schemaName: 'GETRefundTypewithSuccess', listKey: 'refunds' },
  { resourceId: 'product', resourceKey: 'products', objectType: 'product', idField: 'id', idPrefix: 'zu_prod_', volumeHint: 'reference', schemaName: 'GETProductType', listKey: 'products' },
  // ExpandedContact has flat fields (id, firstName, lastName, ...)
  { resourceId: 'contact', resourceKey: 'contacts', objectType: 'contact', idField: 'id', idPrefix: 'zu_con_', volumeHint: 'entity', schemaName: 'ExpandedContact', listKey: 'contacts' },
  // ExpandedUsage has flat fields (id, accountId, quantity, ...)
  { resourceId: 'usage', resourceKey: 'usage', objectType: 'usage', idField: 'id', idPrefix: 'zu_usg_', volumeHint: 'entity', schemaName: 'ExpandedUsage', listKey: 'usage' },
  { resourceId: 'product_rate_plan', resourceKey: 'product-rate-plans', objectType: 'product_rate_plan', idField: 'id', idPrefix: 'zu_rp_', volumeHint: 'reference', schemaName: 'GETProductRatePlanType', listKey: 'productRatePlans' },
  { resourceId: 'bill_run', resourceKey: 'bill-runs', objectType: 'bill_run', idField: 'billRunId', idPrefix: 'zu_br_', volumeHint: 'skip', schemaName: 'GetBillRunResponseType' },
  { resourceId: 'journal_entry', resourceKey: 'journal-entries', objectType: 'journal_entry', idField: 'id', idPrefix: 'zu_je_', volumeHint: 'skip', schemaName: 'GETJournalEntryDetailType', listKey: 'journalEntries' },
  { resourceId: 'accounting_period', resourceKey: 'accounting-periods', objectType: 'accounting_period', idField: 'id', idPrefix: 'zu_ap_', volumeHint: 'skip', schemaName: 'GETAccountingPeriodType', listKey: 'accountingPeriods' },
  { resourceId: 'accounting_code', resourceKey: 'accounting-codes', objectType: 'accounting_code', idField: 'id', idPrefix: 'zu_ac_', volumeHint: 'skip', schemaName: 'GETAccountingCodeItemType', listKey: 'accountingCodes' },
  { resourceId: 'invoice_schedule', resourceKey: 'invoice-schedules', objectType: 'invoice_schedule', idField: 'id', idPrefix: 'zu_is_', volumeHint: 'skip', schemaName: 'InvoiceScheduleResponses' },
  { resourceId: 'payment_schedule', resourceKey: 'payment-schedules', objectType: 'payment_schedule', idField: 'id', idPrefix: 'zu_ps_', volumeHint: 'skip', schemaName: 'PaymentScheduleItemCommonResponse' },
  { resourceId: 'payment_run', resourceKey: 'payment-runs', objectType: 'payment_run', idField: 'id', idPrefix: 'zu_pr_', volumeHint: 'skip', schemaName: 'GETPaymentRunType' },
  { resourceId: 'order_line_item', resourceKey: 'order-line-items', objectType: 'order_line_item', idField: 'id', idPrefix: 'zu_oli_', volumeHint: 'skip', schemaName: 'GetOrderLineItemResponseType' },
  { resourceId: 'fulfillment', resourceKey: 'fulfillments', objectType: 'fulfillment', idField: 'id', idPrefix: 'zu_ful_', volumeHint: 'skip', schemaName: 'FulfillmentGet' },
  { resourceId: 'adjustment', resourceKey: 'adjustments', objectType: 'adjustment', idField: 'id', idPrefix: 'zu_adj_', volumeHint: 'skip', schemaName: 'GETAdjustmentByIdResponseType' },
  { resourceId: 'catalog_group', resourceKey: 'catalog-groups', objectType: 'catalog_group', idField: 'id', idPrefix: 'zu_cg_', volumeHint: 'skip', schemaName: 'CatalogGroupResponse' },
  { resourceId: 'sequence_set', resourceKey: 'sequence-sets', objectType: 'sequence_set', idField: 'id', idPrefix: 'zu_ss_', volumeHint: 'skip', schemaName: 'GETSequenceSetResponse' },
];

// Schema field overrides: fix defaults for typical mock usage
const SCHEMA_FIELD_OVERRIDES: Record<string, Record<string, { value?: unknown; code?: string }>> = {
  account: {
    status: { value: 'Active' },
    currency: { value: 'USD' },
    billCycleDay: { value: 1 },
    paymentTerm: { value: 'Net 30' },
  },
  subscription: {
    status: { value: 'Active' },
    termType: { value: 'TERMED' },
    autoRenew: { value: true },
  },
  order: {
    status: { value: 'Completed' },
    currency: { value: 'USD' },
  },
  invoice: {
    status: { value: 'Draft' },
    currency: { value: 'USD' },
  },
  payment: {
    status: { value: 'Processed' },
    currency: { value: 'USD' },
    type: { value: 'Electronic' },
  },
  credit_memo: {
    status: { value: 'Draft' },
    currency: { value: 'USD' },
    memoNumber: { code: `'CM-' + generateId('', 8)` },
  },
  debit_memo: {
    status: { value: 'Draft' },
    currency: { value: 'USD' },
    memoNumber: { code: `'DM-' + generateId('', 8)` },
  },
  refund: {
    status: { value: 'Processed' },
    type: { value: 'Electronic' },
  },
  product: {
    effectiveStartDate: { code: `new Date().toISOString().slice(0, 10)` },
    effectiveEndDate: { code: `'2099-12-31'` },
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

// FK field name → referenced resource type
const FIELD_REFS: Record<string, string> = {
  accountId: 'account',
  account_id: 'account',
  subscriptionId: 'subscription',
  subscription_id: 'subscription',
  invoiceId: 'invoice',
  invoice_id: 'invoice',
  paymentMethodId: 'payment_method',
  payment_method_id: 'payment_method',
  productId: 'product',
  product_id: 'product',
  productRatePlanId: 'product_rate_plan',
  product_rate_plan_id: 'product_rate_plan',
  orderId: 'order',
  order_id: 'order',
};

const AMOUNT_FIELDS = new Set([
  'amount', 'totalAmount', 'balance', 'creditBalance', 'contractedMrr',
  'totalContractedValue', 'taxAmount', 'discountAmount', 'subtotal',
  'refundAmount', 'unappliedAmount', 'appliedAmount', 'paidAmount',
]);

function mapProperty(
  fieldName: string,
  rawSchema: OaSchema,
  isRequired: boolean,
  spec: OaSpec,
  idField: string,
): MappedField {
  const flat = flattenSchema(rawSchema, spec);
  const nullable = flat.nullable ?? false;

  let type: FieldType = 'string';
  const flatType = Array.isArray(flat.type) ? flat.type[0] : flat.type;
  if (flatType === 'integer') type = 'integer';
  else if (flatType === 'number') type = 'number';
  else if (flatType === 'boolean') type = 'boolean';
  else if (flatType === 'array') type = 'array';
  else if (flatType === 'object' || flat.properties) type = 'object';

  // Zuora uses ISO 8601 timestamps
  const isTimestamp = flat.format === 'date-time' ||
    fieldName === 'createdDate' || fieldName === 'updatedDate' ||
    fieldName === 'createdOn' || fieldName === 'updatedOn' ||
    fieldName === 'CreatedDate' || fieldName === 'UpdatedDate';

  const isAmount = AMOUNT_FIELDS.has(fieldName) && (type === 'string' || type === 'number');

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
    idPrefix: undefined,
    auto: isTimestamp || undefined,
    timestamp: isTimestamp ? 'iso8601' : undefined,
    isAmount: isAmount || undefined,
    ref: FIELD_REFS[fieldName],
  };
}

function computeObjectDefault(
  schema: OaSchema,
  spec: OaSpec,
  visited = new Set<string>(),
  depth = 0,
): Record<string, unknown> {
  if (depth > 3) return {};
  const flat = flattenSchema(schema, spec, new Set(visited), depth);
  if (!flat.properties) return {};
  const result: Record<string, unknown> = {};
  const required = new Set(flat.required ?? []);
  for (const [name, propSchema] of Object.entries(flat.properties)) {
    const propFlat = flattenSchema(propSchema, spec, new Set(visited), depth + 1);
    const isReq = required.has(name);
    const propType = Array.isArray(propFlat.type) ? propFlat.type[0] : propFlat.type;
    if (propFlat.nullable && !isReq) { result[name] = null; continue; }
    if (propType === 'boolean') { result[name] = false; continue; }
    if (propType === 'integer' || propType === 'number') { result[name] = 0; continue; }
    if (propType === 'array') { result[name] = []; continue; }
    if (propType === 'object') { result[name] = {}; continue; }
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
  listKey?: string;
}

function extractResources(spec: OaSpec): Map<string, ResourceInfo> {
  const resources = new Map<string, ResourceInfo>();

  for (const def of ZUORA_RESOURCES) {
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

    // Filter out meta fields like 'success', 'nextPage', etc.
    const skipFields = new Set(['success', 'nextPage', 'processId', 'requestId', 'reasons']);

    for (const [fieldName, propSchema] of Object.entries(properties)) {
      if (skipFields.has(fieldName)) continue;
      const isRequired = required.has(fieldName);
      const mapped = mapProperty(fieldName, propSchema, isRequired, spec, def.idField);
      fields[fieldName] = mapped;
    }

    // Ensure id field exists and has correct idPrefix from resource def
    if (!fields[def.idField]) {
      fields[def.idField] = {
        type: 'string',
        required: true,
        nullable: false,
        default: '',
        idPrefix: def.idPrefix,
      };
    } else {
      fields[def.idField]!.idPrefix = def.idPrefix;
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
      listKey: def.listKey,
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
 * Map a Zuora path to a resource group name.
 */
function detectZuoraResource(path: string): string {
  // Remove /v1/ prefix
  const stripped = path.replace(/^\/v1\//, '');
  const segments = stripped.split('/');
  const first = segments[0]!;

  // /v1/object/{type} paths
  if (first === 'object') {
    const objectType = segments[1];
    const objectMap: Record<string, string> = {
      'product': 'products',
      'product-rate-plan': 'product-rate-plans',
      'product-rate-plan-charge': 'product-rate-plan-charges',
      'account': 'accounts',
      'contact': 'contacts',
      'subscription': 'subscriptions',
      'invoice': 'invoices',
      'payment': 'payments',
      'payment-method': 'payment-methods',
      'refund': 'refunds',
      'usage': 'usage',
    };
    return objectMap[objectType ?? ''] ?? first;
  }

  // /v1/catalog/products → products
  if (first === 'catalog') return 'products';

  return first;
}

/**
 * Detect CRUD operation from path and HTTP method.
 */
function detectZuoraOperation(path: string, method: string): RouteOperation {
  const stripped = path.replace(/^\/v1\//, '');
  const segments = stripped.split('/');
  const lastSegment = segments[segments.length - 1]!;
  const lastIsParam = lastSegment.startsWith('{');
  const paramCount = (path.match(/\{[^}]+\}/g) ?? []).length;

  // Action verbs as last segment
  const actionVerbs = new Set([
    'cancel', 'suspend', 'resume', 'renew', 'close', 'reopen', 'void',
    'apply', 'unapply', 'post', 'unpost', 'reverse', 'transfer',
    'collect', 'execute', 'preview', 'run', 'stop', 'refund',
    'reconcile', 'verify', 'generate', 'email', 'delete', 'pdf',
    'write-off', 'pdf-status', 'batch', 'bulk',
  ]);
  if (actionVerbs.has(lastSegment)) return 'action';

  // Actions with compound names
  if (lastSegment.includes('-') && !lastIsParam && paramCount > 0) {
    // e.g., /credit-memos/{id}/credit-memo-items → sub-resource list
    // But /credit-memos/pdf-status → action
    if (segments.length > 2 && !lastSegment.startsWith('{')) {
      // Sub-resource under a parent with an ID
      const prevIsParam = segments[segments.length - 2]?.startsWith('{');
      if (prevIsParam) {
        if (method === 'get') return 'list';  // sub-resource list
        if (method === 'post') return 'create'; // sub-resource create
        return 'action';
      }
    }
    return 'action';
  }

  // /v1/object/{type}/{id} → CRUD
  if (segments[0] === 'object') {
    if (paramCount === 0) {
      if (method === 'post') return 'create';
      return 'list';
    }
    if (method === 'get') return 'retrieve';
    if (method === 'put') return 'update';
    if (method === 'delete') return 'delete';
    return 'action';
  }

  // Standard CRUD patterns
  if (!lastIsParam && paramCount === 0) {
    if (method === 'get') return 'list';
    if (method === 'post') return 'create';
    return 'action';
  }

  if (lastIsParam) {
    if (method === 'get') return 'retrieve';
    if (method === 'put' || method === 'patch') return 'update';
    if (method === 'delete') return 'delete';
    if (method === 'post') return 'create'; // some POST to /{id} are action-like
    return 'action';
  }

  // Sub-resources: /resource/{id}/sub-resource
  if (segments.length >= 3 && !lastIsParam) {
    if (method === 'get') return 'list';
    if (method === 'post') return 'create';
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
    // Only process /v1/ paths
    if (!specPath.startsWith('/v1/')) continue;

    // Resolve path-level parameters
    const pathParams = (pathItem.parameters ?? [])
      .map(p => resolveParameter(p, spec))
      .filter((p): p is OaParameter => p !== null);

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const httpMethod = method.toUpperCase() as ExtractedRoute['method'];
      const description = operation.summary ?? operation.operationId ?? '';

      // Convert {param-name} to :paramName for Fastify (camelCase — Fastify
      // doesn't support hyphens in param names), 
      const fastifyPath = specPath.replace(/\{([^}]+)\}/g, (_, p) => ':' + kebabToCamel(p));

      const resource = detectZuoraResource(specPath);
      const op = detectZuoraOperation(specPath, method);

      // Extract query filters from parameters
      const allParams = [
        ...pathParams,
        ...(operation.parameters ?? []).map(p => resolveParameter(p, spec)).filter((p): p is OaParameter => p !== null),
      ];
      const paginationParams = new Set(['pageSize', 'page', 'zuora-version', 'Zuora-Track-Id']);
      const queryFilters = allParams
        .filter(p => p.in === 'query' && !paginationParams.has(p.name))
        .map(p => p.name);

      // Find the last path param for idParam (camelCase to match fastifyPath)
      const pathParamMatches = specPath.match(/\{([^}]+)\}/g);
      let idParam: string | undefined;
      if (pathParamMatches && pathParamMatches.length > 0) {
        const lastParam = pathParamMatches[pathParamMatches.length - 1]!;
        idParam = kebabToCamel(lastParam.replace(/[{}]/g, ''));
      }

      // Map resource to objectType
      const resourceToObject: Record<string, string> = {};
      for (const r of ZUORA_RESOURCES) {
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

/** Convert kebab-case to camelCase: "account-key" → "accountKey" */
function kebabToCamel(str: string): string {
  return str.replace(/-([a-zA-Z0-9])/g, (_, ch) => ch.toUpperCase());
}

function generateMetaTs(spec: OaSpec): string {
  const version = spec.info?.version ?? 'unknown';
  const generatedAt = new Date().toISOString();
  return `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-zuora generate
// Zuora OpenAPI spec version: ${version}
// Generated at: ${generatedAt}

export const ZUORA_SPEC_VERSION = ${JSON.stringify(version)};
export const ZUORA_SPEC_GENERATED_AT = ${JSON.stringify(generatedAt)};
`;
}

function generateResourceSpecsTs(resources: Map<string, ResourceInfo>): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-zuora generate`,
    `import type { AdapterResourceSpecs } from '@mimicai/core';`,
    ``,
    `export const zuoraResourceSpecs: AdapterResourceSpecs = {`,
    `  platform: {`,
    `    timestampFormat: 'iso8601',`,
    `    amountFormat: 'decimal_string',`,
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
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-zuora generate`,
    `import { generateId } from '@mimicai/adapter-sdk';`,
    ``,
    `/**`,
    ` * Returns a complete Zuora object with all fields defaulted to spec-faithful values.`,
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
        // Zuora uses 32-char hex IDs
        val = `generateId('', 32)`;
      } else if (field.auto && field.timestamp === 'iso8601') {
        val = `new Date().toISOString()`;
      } else {
        val = JSON.stringify(field.default);
      }
      lines.push(`    ${JSON.stringify(fieldName)}: ${val},`);
    }

    // Emit override-only fields not present in the spec schema
    const overridesForResource = SCHEMA_FIELD_OVERRIDES[info.resourceId];
    if (overridesForResource) {
      for (const [fieldName, override] of Object.entries(overridesForResource)) {
        if (info.fields[fieldName]) continue; // already emitted above
        const val = override.code !== undefined ? override.code : JSON.stringify(override.value);
        lines.push(`    ${JSON.stringify(fieldName)}: ${val},`);
      }
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
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-zuora generate`,
    ``,
    `export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';`,
    `export type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';`,
    ``,
    `export interface GeneratedRoute {`,
    `  method: RouteMethod;`,
    `  fastifyPath: string;`,
    `  /** Original Zuora spec path (field name is historical) */`,
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
  lines.push('  return `${method}:${fastifyPath}`;');
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
  const skipCount = [...resources.values()].filter(r => r.volumeHint === 'skip').length;
  console.log(`  Blueprint resources: ${entityCount} entity, ${refCount} reference, ${skipCount} skip`);

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
  console.log(`  ${routes.length} routes across all Zuora /v1/ paths`);
  console.log(`  Output: ${OUT_DIR}/`);
}

main();
