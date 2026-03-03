import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EndpointDefinition, ExpandedData } from '@mimicailab/core';
import type { StateStore } from '@mimicailab/core';
import { BaseApiMockAdapter } from '../base-api-mock-adapter.js';
import { buildTestServer, type TestServer } from '../test-helpers.js';

class PingAdapter extends BaseApiMockAdapter<Record<string, never>> {
  readonly id = 'ping';
  readonly name = 'Ping Adapter';
  readonly basePath = '/ping';

  async registerRoutes(
    server: FastifyInstance,
    _data: Map<string, ExpandedData>,
    _stateStore: StateStore,
  ): Promise<void> {
    server.get('/ping', async (_req, reply) => {
      return reply.send({ ok: true, message: 'pong' });
    });

    server.post('/ping/echo', async (req, reply) => {
      return reply.send({ ok: true, body: req.body });
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      { method: 'GET', path: '/ping', description: 'Ping' },
      { method: 'POST', path: '/ping/echo', description: 'Echo body' },
    ];
  }

  resolvePersona(_req: FastifyRequest): string | null {
    return null;
  }
}

describe('buildTestServer', () => {
  let ts: TestServer | undefined;

  afterEach(async () => {
    if (ts) await ts.close();
    ts = undefined;
  });

  it('should create a server with adapter routes', async () => {
    ts = await buildTestServer(new PingAdapter());
    const res = await ts.server.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, message: 'pong' });
  });

  it('should handle form-encoded POST bodies', async () => {
    ts = await buildTestServer(new PingAdapter());
    const res = await ts.server.inject({
      method: 'POST',
      url: '/ping/echo',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=test&value=123',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.body).toEqual({ name: 'test', value: '123' });
  });

  it('should provide a StateStore', async () => {
    ts = await buildTestServer(new PingAdapter());
    expect(ts.stateStore).toBeDefined();
    ts.stateStore.set('test', 'key', { value: 1 });
    expect(ts.stateStore.get('test', 'key')).toEqual({ value: 1 });
  });

  it('should close cleanly', async () => {
    ts = await buildTestServer(new PingAdapter());
    await expect(ts.close()).resolves.toBeUndefined();
    ts = undefined; // prevent double close in afterEach
  });
});
