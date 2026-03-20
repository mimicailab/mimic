import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData, PromptContext } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { OpenApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { DefaultFactory, NotFoundError } from '@mimicai/adapter-sdk';
import meta from './adapter-meta.js';
import type { PaddleConfig } from './config.js';
import { registerPaddleTools } from './mcp.js';

import { paddleResourceSpecs } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';
import type { GeneratedRoute } from './generated/routes.js';

import * as subscriptionOverrides from './overrides/subscriptions.js';
import * as transactionOverrides from './overrides/transactions.js';

function ns(resource: string): string {
  return `paddle:${resource}`;
}

export class PaddleAdapter extends OpenApiMockAdapter<PaddleConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;
  readonly resourceSpecs = paddleResourceSpecs;

  /** @deprecated Required by base class — use resourceSpecs instead. */
  readonly promptContext = derivePromptContext(paddleResourceSpecs);

  /** @deprecated Required by base class — use resourceSpecs instead. */
  readonly dataSpec: DataSpec = deriveDataSpec(paddleResourceSpecs);

  protected readonly generatedRoutes: GeneratedRoute[] = GENERATED_ROUTES;
  protected readonly defaultFactories: Record<string, DefaultFactory> = SCHEMA_DEFAULTS;

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // Wrap all 2xx non-error/non-list responses in Paddle's { data, meta } envelope
    server.addHook('preSerialization', async (_request, reply, payload) => {
      if (reply.statusCode >= 200 && reply.statusCode < 300 && payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>;
        // Already wrapped (list/error responses)
        if ('data' in p || 'error' in p) return payload;
        // Wrap single-item responses
        return {
          data: payload,
          meta: { request_id: generateId('', 32) },
        };
      }
      return payload;
    });

    // 1. Register overrides FIRST
    this.mountOverrides(store);

    // 2. CRUD scaffolding
    await this.registerGeneratedRoutes(server, data, store, ns);
  }

  getEndpoints(): EndpointDefinition[] {
    return this.endpointsFromRoutes();
  }

  resolvePersona(req: FastifyRequest): string | null {
    // Paddle uses Bearer token auth
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+test_([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerPaddleTools(mcpServer, mockBaseUrl);
  }

  // ---------------------------------------------------------------------------
  // Paddle-specific response conventions
  // ---------------------------------------------------------------------------

  protected override wrapList(
    data: unknown[],
    _route: GeneratedRoute,
    hasMore: boolean,
    query: Record<string, string>,
  ): unknown {
    const perPage = parseInt(query.per_page ?? '50', 10) || 50;
    return {
      data,
      meta: {
        request_id: generateId('', 32),
        pagination: {
          per_page: perPage,
          next: hasMore ? `https://mock.paddle.com/?after=${(data[data.length - 1] as any)?.id ?? ''}&per_page=${perPage}` : null,
          has_more: hasMore,
          estimated_total: data.length,
        },
      },
    };
  }

  protected override paginate(
    items: Record<string, unknown>[],
    query: Record<string, string>,
  ): { data: Record<string, unknown>[]; hasMore: boolean } {
    const perPage = Math.min(parseInt(query.per_page ?? '50', 10) || 50, 200);
    let startIdx = 0;

    if (query.after) {
      const idx = items.findIndex(i => i.id === query.after);
      if (idx >= 0) startIdx = idx + 1;
    }

    const page = items.slice(startIdx, startIdx + perPage);
    return { data: page, hasMore: startIdx + perPage < items.length };
  }

  protected override mergeUpdate(
    existing: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const updated: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(body)) {
      if (k === 'custom_data' && typeof existing.custom_data === 'object' && existing.custom_data !== null) {
        updated.custom_data = { ...(existing.custom_data as Record<string, unknown>), ...(v as Record<string, unknown>) };
      } else {
        updated[k] = v;
      }
    }
    updated.updated_at = new Date().toISOString();
    return updated;
  }

  protected override deleteResponse(id: string, _route: GeneratedRoute): unknown {
    // Paddle DELETE returns 200 with empty body (preSerialization hook will skip wrapping)
    return { data: { id }, meta: { request_id: generateId('', 32) } };
  }

  protected override notFoundError(resource: string, id: string): NotFoundError {
    // Return Paddle error format, but satisfying the NotFoundError interface
    return {
      error: {
        type: 'request_error',
        code: 'not_found',
        message: `Entity ${id} not found`,
        param: null,
      },
    } as NotFoundError;
  }

  // ---------------------------------------------------------------------------
  // Override registration
  // ---------------------------------------------------------------------------

  private mountOverrides(store: StateStore): void {
    // Subscription lifecycle
    this.registerOverride('POST', '/subscriptions/:subscription_id/cancel',
      subscriptionOverrides.buildCancelHandler(store));
    this.registerOverride('POST', '/subscriptions/:subscription_id/pause',
      subscriptionOverrides.buildPauseHandler(store));
    this.registerOverride('POST', '/subscriptions/:subscription_id/resume',
      subscriptionOverrides.buildResumeHandler(store));
    this.registerOverride('POST', '/subscriptions/:subscription_id/activate',
      subscriptionOverrides.buildActivateHandler(store));

    // Transaction lifecycle
    this.registerOverride('POST', '/transactions/:transaction_id/revise',
      transactionOverrides.buildReviseHandler(store));
  }
}
