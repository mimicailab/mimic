import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData, PromptContext } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { OpenApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { DefaultFactory, NotFoundError } from '@mimicai/adapter-sdk';
import meta from './adapter-meta.js';
import type { GoCardlessConfig } from './config.js';
import { registerGoCardlessTools } from './mcp.js';

import { gocardlessResourceSpecs, WRAPPER_KEYS } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';
import type { GeneratedRoute } from './generated/routes.js';

import * as mandateOverrides from './overrides/mandates.js';
import * as paymentOverrides from './overrides/payments.js';
import * as subscriptionOverrides from './overrides/subscriptions.js';

function ns(resource: string): string {
  return `gocardless:${resource}`;
}

export class GoCardlessAdapter extends OpenApiMockAdapter<GoCardlessConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;
  readonly resourceSpecs = gocardlessResourceSpecs;

  /** @deprecated */
  readonly promptContext = derivePromptContext(gocardlessResourceSpecs);
  /** @deprecated */
  readonly dataSpec: DataSpec = deriveDataSpec(gocardlessResourceSpecs);

  protected readonly generatedRoutes: GeneratedRoute[] = GENERATED_ROUTES;
  protected readonly defaultFactories: Record<string, DefaultFactory> = SCHEMA_DEFAULTS;

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // GoCardless wraps single-item responses in { resource_plural: item }
    server.addHook('preSerialization', async (request, reply, payload) => {
      if (reply.statusCode >= 200 && reply.statusCode < 300 && payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>;
        // Already wrapped (list responses, errors, or responses from overrides)
        if ('error' in p || 'meta' in p) return payload;
        // Check if already wrapped with a known wrapper key
        for (const wk of Object.values(WRAPPER_KEYS)) {
          if (wk in p) return payload;
        }
        // Derive wrapper key from URL path
        const url = request.url.replace('/gocardless/', '');
        const segments = url.split('/');
        const wrapperKey = segments[0] ?? 'unknown';
        return { [wrapperKey]: payload };
      }
      return payload;
    });

    this.mountOverrides(store);
    await this.registerGeneratedRoutes(server, data, store, ns);
  }

  getEndpoints(): EndpointDefinition[] {
    return this.endpointsFromRoutes();
  }

  resolvePersona(req: FastifyRequest): string | null {
    // GoCardless uses Bearer token auth
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+sandbox_([a-zA-Z0-9-]+)/);
    return match ? match[1] : null;
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerGoCardlessTools(mcpServer, mockBaseUrl);
  }

  // ---------------------------------------------------------------------------
  // GoCardless-specific response conventions
  // ---------------------------------------------------------------------------

  protected override wrapList(
    data: unknown[],
    route: GeneratedRoute,
    hasMore: boolean,
    query: Record<string, string>,
  ): unknown {
    const limit = parseInt(query.limit ?? '50', 10) || 50;
    const lastItem = data[data.length - 1] as Record<string, unknown> | undefined;
    const firstItem = data[0] as Record<string, unknown> | undefined;
    const wrapperKey = WRAPPER_KEYS[route.resource] ?? route.resource;

    return {
      [wrapperKey]: data,
      meta: {
        cursors: {
          before: firstItem?.id ?? null,
          after: lastItem?.id ?? null,
        },
        limit,
      },
    };
  }

  protected override paginate(
    items: Record<string, unknown>[],
    query: Record<string, string>,
  ): { data: Record<string, unknown>[]; hasMore: boolean } {
    const limit = Math.min(parseInt(query.limit ?? '50', 10) || 50, 500);
    let startIdx = 0;

    if (query.after) {
      const idx = items.findIndex(i => i.id === query.after);
      if (idx >= 0) startIdx = idx + 1;
    } else if (query.before) {
      const idx = items.findIndex(i => i.id === query.before);
      if (idx >= 0) startIdx = Math.max(0, idx - limit);
    }

    const page = items.slice(startIdx, startIdx + limit);
    return { data: page, hasMore: startIdx + limit < items.length };
  }

  protected override mergeUpdate(
    existing: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const updated: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(body)) {
      if (k === 'metadata' && typeof existing.metadata === 'object' && existing.metadata !== null) {
        updated.metadata = { ...(existing.metadata as Record<string, unknown>), ...(v as Record<string, unknown>) };
      } else {
        updated[k] = v;
      }
    }
    return updated;
  }

  protected override deleteResponse(id: string, _route: GeneratedRoute): unknown {
    // GoCardless DELETE returns 204 No Content, but we return 200 with empty
    return {};
  }

  protected override notFoundError(resource: string, id: string): NotFoundError {
    return {
      error: {
        type: 'invalid_api_usage',
        code: 'resource_not_found',
        message: `${resource} with id ${id} not found`,
        param: null,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Override registration
  // ---------------------------------------------------------------------------

  private mountOverrides(store: StateStore): void {
    // Mandate lifecycle
    this.registerOverride('POST', '/gocardless/mandates/:mandate_id/actions/cancel',
      mandateOverrides.buildCancelHandler(store));
    this.registerOverride('POST', '/gocardless/mandates/:mandate_id/actions/reinstate',
      mandateOverrides.buildReinstateHandler(store));

    // Payment lifecycle
    this.registerOverride('POST', '/gocardless/payments/:payment_id/actions/cancel',
      paymentOverrides.buildCancelHandler(store));
    this.registerOverride('POST', '/gocardless/payments/:payment_id/actions/retry',
      paymentOverrides.buildRetryHandler(store));

    // Subscription lifecycle
    this.registerOverride('POST', '/gocardless/subscriptions/:subscription_id/actions/cancel',
      subscriptionOverrides.buildCancelHandler(store));
    this.registerOverride('POST', '/gocardless/subscriptions/:subscription_id/actions/pause',
      subscriptionOverrides.buildPauseHandler(store));
    this.registerOverride('POST', '/gocardless/subscriptions/:subscription_id/actions/resume',
      subscriptionOverrides.buildResumeHandler(store));
  }
}
