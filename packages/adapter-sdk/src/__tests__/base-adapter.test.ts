import { describe, it, expect } from 'vitest';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EndpointDefinition, ExpandedData, AdapterContext } from '@mimicailab/core';
import type { StateStore } from '@mimicailab/core';
import { BaseApiMockAdapter } from '../base-api-mock-adapter.js';

class TestAdapter extends BaseApiMockAdapter<{ name: string }> {
  readonly id = 'test';
  readonly name = 'Test Adapter';
  readonly basePath = '/test';

  async registerRoutes(
    _server: FastifyInstance,
    _data: Map<string, ExpandedData>,
    _stateStore: StateStore,
  ): Promise<void> {}

  getEndpoints(): EndpointDefinition[] {
    return [{ method: 'GET', path: '/test/items', description: 'List items' }];
  }

  resolvePersona(_req: FastifyRequest): string | null {
    return null;
  }

  // Expose protected fields for testing
  getConfig() { return this.config; }
  getContext() { return this.context; }
}

describe('BaseApiMockAdapter', () => {
  it('should have correct type', () => {
    const adapter = new TestAdapter();
    expect(adapter.type).toBe('api-mock');
    expect(adapter.id).toBe('test');
    expect(adapter.name).toBe('Test Adapter');
    expect(adapter.basePath).toBe('/test');
  });

  it('should store config and context on init', async () => {
    const adapter = new TestAdapter();
    const config = { name: 'test-config' };
    const context = { config: {} as any, blueprints: new Map(), logger: console };
    await adapter.init(config, context as AdapterContext);
    expect(adapter.getConfig()).toEqual({ name: 'test-config' });
    expect(adapter.getContext()).toBeDefined();
  });

  it('should return no-op result from apply', async () => {
    const adapter = new TestAdapter();
    const result = await adapter.apply({} as ExpandedData, {} as AdapterContext);
    expect(result.adapterId).toBe('test');
    expect(result.success).toBe(true);
    expect(result.duration).toBe(0);
  });

  it('should return true from healthcheck', async () => {
    const adapter = new TestAdapter();
    const healthy = await adapter.healthcheck({} as AdapterContext);
    expect(healthy).toBe(true);
  });

  it('should clear config on dispose', async () => {
    const adapter = new TestAdapter();
    await adapter.init({ name: 'x' }, {} as AdapterContext);
    expect(adapter.getConfig()).toBeDefined();
    await adapter.dispose();
    expect(adapter.getContext()).toBeUndefined();
  });

  it('should clean without error', async () => {
    const adapter = new TestAdapter();
    await expect(adapter.clean({} as AdapterContext)).resolves.toBeUndefined();
  });

  it('should return endpoints', () => {
    const adapter = new TestAdapter();
    const endpoints = adapter.getEndpoints();
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].method).toBe('GET');
    expect(endpoints[0].path).toBe('/test/items');
  });
});
