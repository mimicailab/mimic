import type { FastifyInstance } from 'fastify';
import type { ApiMockAdapter } from '../types/adapter.js';
import type { ExpandedData } from '../types/dataset.js';
import type { EndpointDefinition } from '../types/adapter.js';
import type { StateStore } from './state-store.js';
import { logger } from '../utils/logger.js';

/**
 * Manages route registration for API mock adapters on the Fastify instance.
 */
export class MockRouter {
  private registeredEndpoints: EndpointDefinition[] = [];

  async registerAdapter(
    server: FastifyInstance,
    adapter: ApiMockAdapter,
    data: Map<string, ExpandedData>,
    stateStore: StateStore,
    basePath: string,
  ): Promise<void> {
    await adapter.registerRoutes(server, data, stateStore);

    const endpoints = adapter.getEndpoints();
    this.registeredEndpoints.push(...endpoints);

    logger.info(
      `Registered ${endpoints.length} endpoints for ${adapter.name} at ${basePath}`,
    );
  }

  getRegisteredEndpoints(): EndpointDefinition[] {
    return [...this.registeredEndpoints];
  }
}
