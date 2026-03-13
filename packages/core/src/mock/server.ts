import Fastify, { type FastifyInstance } from 'fastify';
import type { ApiMockAdapter } from '../types/adapter.js';
import type { ExpandedData } from '../types/dataset.js';
import type { EndpointDefinition } from '../types/adapter.js';
import { logger } from '../utils/logger.js';
import { MockRouter } from './router.js';
import { StateStore } from './state-store.js';
import { RequestLogger } from './request-logger.js';

export class MockServer {
  private server: FastifyInstance;
  private adapters: Map<string, ApiMockAdapter> = new Map();
  private router: MockRouter;
  readonly stateStore: StateStore;
  readonly requestLogger: RequestLogger;

  constructor() {
    this.server = Fastify({ logger: false });
    this.router = new MockRouter();
    this.stateStore = new StateStore();
    this.requestLogger = new RequestLogger();
  }

  async registerAdapter(
    adapter: ApiMockAdapter,
    data: ExpandedData | Map<string, ExpandedData>,
    config: { basePath: string; port?: number },
  ): Promise<void> {
    this.adapters.set(adapter.id, adapter);

    // Normalize data to Map<string, ExpandedData>
    const dataMap =
      data instanceof Map
        ? data
        : new Map<string, ExpandedData>([[data.personaId, data]]);

    await this.router.registerAdapter(
      this.server,
      adapter,
      dataMap,
      this.stateStore,
      config.basePath,
    );
    logger.info(`Registered ${adapter.name} at ${config.basePath}`);
  }

  async start(port: number = 4100): Promise<void> {
    // CORS — allow explorer UI and other local tools to call the mock server
    this.server.addHook('onRequest', (req, reply, done) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Stripe-Version');
      if (req.method === 'OPTIONS') {
        reply.status(204).send();
        return;
      }
      done();
    });

    // Request logging
    this.server.addHook('onRequest', (req, _reply, done) => {
      logger.debug(`${req.method} ${req.url}`);
      done();
    });

    // 404 handler — helps developers identify unmocked endpoints
    this.server.setNotFoundHandler((req, reply) => {
      reply.status(404).send({
        error: 'not_mocked',
        message: `No mock registered for ${req.method} ${req.url}`,
        hint: 'Check your mimic.json apis config or create a custom adapter',
        available_endpoints: this.getRegisteredEndpoints(),
      });
    });

    await this.server.listen({ port, host: '0.0.0.0' });
    logger.success(`Mock server running on http://localhost:${port}`);
  }

  async stop(): Promise<void> {
    await this.server.close();
    for (const adapter of this.adapters.values()) {
      await adapter.dispose();
    }
    this.stateStore.clear();
  }

  getRegisteredEndpoints(): EndpointDefinition[] {
    return this.router.getRegisteredEndpoints();
  }

  getFastifyInstance(): FastifyInstance {
    return this.server;
  }
}
