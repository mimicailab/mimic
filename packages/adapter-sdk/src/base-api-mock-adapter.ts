import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  ApiMockAdapter,
  AdapterContext,
  AdapterResult,
  EndpointDefinition,
  ExpandedData,
} from '@mimicai/core';
import type { StateStore } from '@mimicai/core';

/**
 * Abstract base class for API mock adapters.
 *
 * Provides sensible defaults for the `Adapter` lifecycle methods
 * (`init`, `apply`, `clean`, `healthcheck`, `dispose`) so that
 * concrete adapters only need to implement the API-specific logic:
 * `registerRoutes`, `getEndpoints`, and `resolvePersona`.
 */
export abstract class BaseApiMockAdapter<TConfig = unknown>
  implements ApiMockAdapter<TConfig>
{
  abstract readonly id: string;
  abstract readonly name: string;
  readonly type = 'api-mock' as const;
  abstract readonly basePath: string;
  readonly versions?: string[];

  protected config!: TConfig;
  protected context?: AdapterContext;

  async init(config: TConfig, context: AdapterContext): Promise<void> {
    this.config = config;
    this.context = context;
  }

  /**
   * No-op for API mock adapters.
   * Data is served via HTTP routes, not written to a destination.
   */
  async apply(
    _data: ExpandedData,
    _context: AdapterContext,
  ): Promise<AdapterResult> {
    return {
      adapterId: this.id,
      success: true,
      stats: {},
      duration: 0,
    };
  }

  async clean(_context: AdapterContext): Promise<void> {
    // API mocks have no persistent state to clean
  }

  async healthcheck(_context: AdapterContext): Promise<boolean> {
    return true;
  }

  async dispose(): Promise<void> {
    this.config = undefined as unknown as TConfig;
    this.context = undefined;
  }

  abstract registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    stateStore: StateStore,
  ): Promise<void>;

  abstract getEndpoints(): EndpointDefinition[];

  abstract resolvePersona(req: FastifyRequest): string | null;
}
