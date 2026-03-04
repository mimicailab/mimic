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
