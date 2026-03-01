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
    data: ExpandedData,
    config: { basePath: string; port?: number },
  ): Promise<void> {
    this.adapters.set(adapter.id, adapter);
    await this.router.registerAdapter(
      this.server,
      adapter,
      data,
      config.basePath,
    );
    logger.info(`Registered ${adapter.name} at ${config.basePath}`);
  }

  async start(port: number = 4100): Promise<void> {
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
