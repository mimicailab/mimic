import type { ZodSchema } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { SchemaModel } from './schema.js';
import type { Blueprint } from './blueprint.js';
import type { ExpandedData } from './dataset.js';
import type { MimicConfig } from './config.js';

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

/** Additional interface for API mock adapters */
export interface ApiMockAdapter<TConfig = unknown> extends Adapter<TConfig> {
  readonly type: 'api-mock';

  /** Register routes on the mock server */
  registerRoutes(server: FastifyInstance, data: ExpandedData): Promise<void>;

  /** Get the list of mocked endpoints */
  getEndpoints(): EndpointDefinition[];
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
