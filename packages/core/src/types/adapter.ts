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
  /** Platform schema context injected into LLM prompts for accurate data generation */
  readonly promptContext?: PromptContext;
  /** Structured data spec for post-expansion validation/repair (optional, falls back to promptContext) */
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
