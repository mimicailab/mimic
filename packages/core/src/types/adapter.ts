import type { ZodSchema } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SchemaModel } from './schema.js';
import type { Blueprint } from './blueprint.js';
import type { ExpandedData } from './dataset.js';
import type { MimicConfig } from './config.js';
import type { StateStore } from '../mock/state-store.js';

/** Every adapter (DB, API, file, event) implements this */
export interface Adapter<TConfig = unknown> {
  readonly id: string;
  readonly name: string;
  readonly type: AdapterType;
  readonly versions?: string[];

  init(config: TConfig, context: AdapterContext): Promise<void>;
  apply(data: ExpandedData, context: AdapterContext): Promise<AdapterResult>;
  clean(context: AdapterContext): Promise<void>;
  healthcheck(context: AdapterContext): Promise<boolean>;
  dispose(): Promise<void>;
}

export type AdapterType =
  | 'database'
  | 'api-mock'
  | 'file-generator'
  | 'event-emitter';

/** Specialized interface for database adapters */
export interface DatabaseAdapter<TConfig = unknown> extends Adapter<TConfig> {
  readonly type: 'database';

  /** Introspect the database schema */
  introspect(config: TConfig): Promise<SchemaModel>;

  /** Seed data into the database */
  seed(data: ExpandedData, context: AdapterContext): Promise<AdapterResult>;

  /** Inspect current database state (row counts, table info) */
  inspect(context: AdapterContext): Promise<InspectResult>;
}

/** Additional interface for API mock adapters */
export interface ApiMockAdapter<TConfig = unknown> extends Adapter<TConfig> {
  readonly type: 'api-mock';
  readonly basePath: string;
  readonly versions?: string[];
  /** Canonical resource specs — the single source of platform truth */
  readonly resourceSpecs?: AdapterResourceSpecs;
  /** @deprecated Use resourceSpecs. Will be removed. */
  readonly promptContext?: PromptContext;
  /** @deprecated Use resourceSpecs. Will be removed. */
  readonly dataSpec?: DataSpec;

  /** Register routes on the mock server */
  registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    stateStore: StateStore,
  ): Promise<void>;

  /** Get the list of mocked endpoints */
  getEndpoints(): EndpointDefinition[];

  /** Resolve persona from an incoming request (e.g. via auth header or body) */
  resolvePersona(req: FastifyRequest): string | null;

  /** Register MCP tools on a shared MCP server (called when mcp: true in config) */
  registerMcpTools?(mcpServer: McpServer, mockBaseUrl: string): void;
}

/** Additional interface for event emitter adapters */
export interface EventEmitterAdapter<TConfig = unknown> extends Adapter<TConfig> {
  readonly type: 'event-emitter';

  /** Start emitting events */
  startEmitting(data: ExpandedData, context: AdapterContext): Promise<void>;

  /** Stop emitting */
  stopEmitting(): Promise<void>;
}

export interface AdapterContext {
  config: MimicConfig;
  schema?: SchemaModel;
  blueprints: Map<string, Blueprint>;
  logger: unknown;
  llmClient?: unknown;
}

export interface AdapterResult {
  adapterId: string;
  success: boolean;
  stats: Record<string, number>;
  duration: number;
  errors?: string[];
}

export interface EndpointDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  version?: string;
}

/** Result of inspecting database state */
export interface InspectResult {
  tables: Record<string, { rowCount: number; sizeBytes?: number }>;
  totalRows: number;
  timestamp: Date;
}

/** Result of a health check */
export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  details?: Record<string, unknown>;
}

/**
 * Structured, machine-readable data specification for post-expansion
 * validation and repair. Adapters can optionally provide this for precise
 * type coercion, ID prefix enforcement, and status validation that goes
 * beyond what PromptContext can express.
 *
 * When not provided, the DataValidator falls back to rules derived from
 * PromptContext (amount format parsing, relationship-based FK checks, etc.).
 */
export interface DataSpec {
  /** How timestamps should be formatted in API responses */
  timestampFormat: 'unix_seconds' | 'unix_ms' | 'iso8601';
  /** Per-resource ID prefix (e.g. { customers: 'cus_', invoices: 'in_' }) */
  idPrefixes?: Record<string, string>;
  /** Field names that contain monetary amounts and should be type-coerced */
  amountFields?: string[];
  /** Per-resource valid status values for validation */
  statusEnums?: Record<string, string[]>;
  /** Field names that contain timestamps and should be format-coerced */
  timestampFields?: string[];
}

/**
 * Platform-specific context injected into the LLM prompt during blueprint
 * generation. Each API mock adapter provides this so the LLM knows the
 * platform's resource types, amount conventions, and relationship graph
 * without hardcoding platform knowledge in the system prompt.
 */
export interface PromptContext {
  /** Resource types the platform exposes (e.g. customers, subscriptions) */
  resources: string[];
  /** How monetary amounts are represented (e.g. "integer cents", "decimal string") */
  amountFormat: string;
  /** Resource relationship graph as simple edges (e.g. "subscription → customer, price") */
  relationships: string[];
  /** Required fields per resource type */
  requiredFields: Record<string, string[]>;
  /** Platform-specific notes (timestamp format, sign conventions, etc.) */
  notes?: string;
  /**
   * Short prefix this platform uses for entity IDs (e.g. "cus_" for Stripe,
   * "cb_" for Chargebee). Used to generate deterministic cross-surface ID
   * prefixes. If not set, derived algorithmically from the adapter ID.
   */
  idPrefix?: string;
}

// ---------------------------------------------------------------------------
// ResourceSpec — the single adapter metadata contract
// ---------------------------------------------------------------------------

/** Semantic type hints — used for prompt derivation, validation, and deterministic generation */
export type SemanticType =
  | 'email' | 'url' | 'phone' | 'currency_code' | 'country_code' | 'locale'
  | 'ip_address' | 'uuid' | 'slug' | 'color_hex'
  | 'platform_id' | 'timestamp' | 'amount' | 'percentage'
  | 'city' | 'region' | 'postal_code' | 'street_address'
  | 'company' | 'vat_number';

export interface ResourceFieldSpec {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  nullable?: boolean;
  default?: unknown;
  ref?: string;
  enum?: unknown[];
  idPrefix?: string;
  auto?: boolean;
  timestamp?: 'unix_seconds' | 'unix_ms' | 'iso8601';
  isAmount?: boolean;
  semanticType?: SemanticType;
  description?: string;

  // v2 fields — added when real adapters need them
  examples?: unknown[];
  properties?: Record<string, ResourceFieldSpec>;
  items?: ResourceFieldSpec;
  derivedFrom?: string;
  format?: string;
}

export interface ResourceSpec {
  objectType: string;
  fields: Record<string, ResourceFieldSpec>;
  volumeHint: 'reference' | 'entity';
  refs?: string[];
}

export interface AdapterResourceSpecs {
  platform: {
    timestampFormat: 'unix_seconds' | 'unix_ms' | 'iso8601';
    amountFormat: 'integer_cents' | 'decimal_string' | 'decimal_float' | 'currency_object';
    idPrefix?: string;
  };
  resources: Record<string, ResourceSpec>;
}

// ---------------------------------------------------------------------------
// Derived functions (replace promptContext and dataSpec during migration)
// ---------------------------------------------------------------------------

/** Derive a PromptContext from ResourceSpec — for backward compat during migration */
export function derivePromptContext(specs: AdapterResourceSpecs): PromptContext {
  const resources = Object.keys(specs.resources);

  const amountFormatMap: Record<string, string> = {
    integer_cents: 'integer cents (e.g. 2999 = $29.99)',
    decimal_string: 'decimal string (e.g. "29.99")',
    decimal_float: 'decimal float (e.g. 29.99)',
    currency_object: 'object with value and currency (e.g. {"value": "29.99", "currency": "USD"})',
  };
  const amountFormat = amountFormatMap[specs.platform.amountFormat] ?? specs.platform.amountFormat;

  const relationships: string[] = [];
  for (const [resourceType, spec] of Object.entries(specs.resources)) {
    if (spec.refs && spec.refs.length > 0) {
      relationships.push(`${resourceType} → ${spec.refs.join(', ')}`);
    }
  }

  const requiredFields: Record<string, string[]> = {};
  for (const [resourceType, spec] of Object.entries(specs.resources)) {
    const required = Object.entries(spec.fields)
      .filter(([, f]) => f.required)
      .map(([name]) => name);
    if (required.length > 0) {
      requiredFields[resourceType] = required;
    }
  }

  const notesParts: string[] = [];
  const tsFormatMap: Record<string, string> = {
    unix_seconds: 'All timestamps are Unix seconds.',
    unix_ms: 'All timestamps are Unix milliseconds.',
    iso8601: 'All timestamps are ISO-8601 strings.',
  };
  notesParts.push(tsFormatMap[specs.platform.timestampFormat] ?? '');

  // Collect ID prefixes for notes
  const idPrefixParts: string[] = [];
  for (const [, spec] of Object.entries(specs.resources)) {
    for (const [fieldName, fieldSpec] of Object.entries(spec.fields)) {
      if (fieldSpec.idPrefix && fieldName === 'id') {
        idPrefixParts.push(`${spec.objectType}: ${fieldSpec.idPrefix}`);
      }
    }
  }
  if (idPrefixParts.length > 0) {
    notesParts.push(`ID prefixes: ${idPrefixParts.join(', ')}.`);
  }

  // Collect status enums for notes
  for (const [, spec] of Object.entries(specs.resources)) {
    const statusField = spec.fields.status;
    if (statusField?.enum && statusField.enum.length > 0) {
      notesParts.push(`${spec.objectType} status: ${statusField.enum.join(', ')}.`);
    }
  }

  return {
    resources,
    amountFormat,
    relationships,
    requiredFields,
    notes: notesParts.filter(Boolean).join(' '),
    idPrefix: specs.platform.idPrefix,
  };
}

/** Derive a DataSpec from ResourceSpec — for backward compat during migration */
export function deriveDataSpec(specs: AdapterResourceSpecs): DataSpec {
  const idPrefixes: Record<string, string> = {};
  const amountFields: string[] = [];
  const statusEnums: Record<string, string[]> = {};
  const timestampFields: string[] = [];
  const seenAmountFields = new Set<string>();
  const seenTimestampFields = new Set<string>();

  for (const [resourceType, spec] of Object.entries(specs.resources)) {
    for (const [fieldName, fieldSpec] of Object.entries(spec.fields)) {
      if (fieldSpec.idPrefix && fieldName === 'id') {
        idPrefixes[resourceType] = fieldSpec.idPrefix;
      }

      if (fieldSpec.isAmount && !seenAmountFields.has(fieldName)) {
        amountFields.push(fieldName);
        seenAmountFields.add(fieldName);
      }

      if (fieldSpec.timestamp && !seenTimestampFields.has(fieldName)) {
        timestampFields.push(fieldName);
        seenTimestampFields.add(fieldName);
      }

      if (fieldName === 'status' && fieldSpec.enum && fieldSpec.enum.length > 0) {
        statusEnums[resourceType] = fieldSpec.enum as string[];
      }
    }
  }

  return {
    timestampFormat: specs.platform.timestampFormat,
    idPrefixes: Object.keys(idPrefixes).length > 0 ? idPrefixes : undefined,
    amountFields: amountFields.length > 0 ? amountFields : undefined,
    statusEnums: Object.keys(statusEnums).length > 0 ? statusEnums : undefined,
    timestampFields: timestampFields.length > 0 ? timestampFields : undefined,
  };
}

/** Adapter manifest — used for discovery and documentation */
export interface AdapterManifest {
  id: string;
  name: string;
  type: AdapterType;
  description: string;
  versions?: string[];
  configSchema?: ZodSchema;
  requiredSecrets?: string[];
  documentationUrl?: string;
}
