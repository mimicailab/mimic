import Fastify, { type FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import type { ApiMockAdapter, ExpandedData } from '@mimicai/core';
import { StateStore } from '@mimicai/core';

export interface TestServer {
  /** The Fastify instance — use `server.inject()` for in-process requests. */
  server: FastifyInstance;
  /** The StateStore backing the adapter — inspect state in tests. */
  stateStore: StateStore;
  /** Shut down the server and clean up. */
  close: () => Promise<void>;
}

/**
 * Build a test server pre-loaded with adapter routes and seed data.
 *
 * Usage:
 * ```ts
 * const { server, stateStore, close } = await buildTestServer(new StripeAdapter());
 * const res = await server.inject({ method: 'GET', url: '/stripe/v1/customers' });
 * expect(res.statusCode).toBe(200);
 * await close();
 * ```
 */
export async function buildTestServer(
  adapter: ApiMockAdapter,
  seedData?: Map<string, ExpandedData>,
): Promise<TestServer> {
  const server = Fastify({ logger: false });
  await server.register(formbody);

  const stateStore = new StateStore();
  const data = seedData ?? new Map<string, ExpandedData>();

  await adapter.registerRoutes(server, data, stateStore);
  await server.ready();

  return {
    server,
    stateStore,
    close: () => server.close(),
  };
}
