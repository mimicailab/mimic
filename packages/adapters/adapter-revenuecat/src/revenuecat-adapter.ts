import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData, PromptContext } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { OpenApiMockAdapter } from '@mimicai/adapter-sdk';
import type { DefaultFactory, NotFoundError } from '@mimicai/adapter-sdk';
import meta from './adapter-meta.js';
import type { RevenueCatConfig } from './config.js';
import { registerRevenueCatTools } from './mcp.js';

import { revenuecatResourceSpecs } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';
import type { GeneratedRoute } from './generated/routes.js';

import * as subscriptionOverrides from './overrides/subscriptions.js';
import * as entitlementOverrides from './overrides/entitlements.js';
import * as productOverrides from './overrides/products.js';
import * as offeringOverrides from './overrides/offerings.js';

function ns(resource: string): string {
  return `revenuecat:${resource}`;
}

export class RevenueCatAdapter extends OpenApiMockAdapter<RevenueCatConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;
  readonly resourceSpecs = revenuecatResourceSpecs;

  /** @deprecated */
  readonly promptContext = derivePromptContext(revenuecatResourceSpecs);
  /** @deprecated */
  readonly dataSpec: DataSpec = deriveDataSpec(revenuecatResourceSpecs);

  protected readonly generatedRoutes: GeneratedRoute[] = GENERATED_ROUTES;
  protected readonly defaultFactories: Record<string, DefaultFactory> = SCHEMA_DEFAULTS;

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // 1. Register overrides FIRST
    this.mountOverrides(store);

    // 2. CRUD scaffolding
    await this.registerGeneratedRoutes(server, data, store, ns);
  }

  getEndpoints(): EndpointDefinition[] {
    return this.endpointsFromRoutes();
  }

  resolvePersona(req: FastifyRequest): string | null {
    // RevenueCat uses Bearer token auth
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+sk_test_([a-zA-Z0-9-]+)/);
    return match ? match[1] : null;
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerRevenueCatTools(mcpServer, mockBaseUrl);
  }

  // ---------------------------------------------------------------------------
  // RevenueCat-specific response conventions
  // ---------------------------------------------------------------------------

  /**
   * RevenueCat list response: { object: 'list', items: [...], next_page, url }
   */
  protected override wrapList(
    data: unknown[],
    route: GeneratedRoute,
    hasMore: boolean,
    _query: Record<string, string>,
  ): unknown {
    const lastItem = data[data.length - 1] as Record<string, unknown> | undefined;
    const lastId = lastItem?.id as string | undefined;
    return {
      object: 'list',
      items: data,
      next_page: hasMore && lastId
        ? `${route.fastifyPath}?starting_after=${lastId}`
        : null,
      url: route.fastifyPath,
    };
  }

  /**
   * Stripe-like cursor pagination: starting_after + limit
   */
  protected override paginate(
    items: Record<string, unknown>[],
    query: Record<string, string>,
  ): { data: Record<string, unknown>[]; hasMore: boolean } {
    const limit = Math.min(parseInt(query.limit ?? '20', 10) || 20, 100);
    let startIdx = 0;

    if (query.starting_after) {
      const idx = items.findIndex(i => i.id === query.starting_after);
      if (idx >= 0) startIdx = idx + 1;
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

  /**
   * RevenueCat DELETE: { object: type, id, deleted_at }
   */
  protected override deleteResponse(id: string, route: GeneratedRoute): unknown {
    return {
      object: route.objectType ?? route.resource.replace(/s$/, ''),
      id,
      deleted_at: Date.now(),
    };
  }

  protected override notFoundError(resource: string, id: string): NotFoundError {
    return {
      error: {
        type: 'resource_missing',
        code: 'resource_missing',
        message: `${resource} with id '${id}' not found`,
        param: null,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Override registration
  // ---------------------------------------------------------------------------

  private mountOverrides(store: StateStore): void {
    // Subscription lifecycle
    this.registerOverride('POST', '/revenuecat/projects/:project_id/subscriptions/:subscription_id/actions/cancel',
      subscriptionOverrides.buildCancelHandler(store));
    this.registerOverride('POST', '/revenuecat/projects/:project_id/subscriptions/:subscription_id/actions/refund',
      subscriptionOverrides.buildRefundHandler(store));

    // Entitlement archive/unarchive
    this.registerOverride('POST', '/revenuecat/projects/:project_id/entitlements/:entitlement_id/actions/archive',
      entitlementOverrides.buildArchiveHandler(store));
    this.registerOverride('POST', '/revenuecat/projects/:project_id/entitlements/:entitlement_id/actions/unarchive',
      entitlementOverrides.buildUnarchiveHandler(store));

    // Product archive/unarchive
    this.registerOverride('POST', '/revenuecat/projects/:project_id/products/:product_id/actions/archive',
      productOverrides.buildArchiveHandler(store));
    this.registerOverride('POST', '/revenuecat/projects/:project_id/products/:product_id/actions/unarchive',
      productOverrides.buildUnarchiveHandler(store));

    // Offering archive/unarchive
    this.registerOverride('POST', '/revenuecat/projects/:project_id/offerings/:offering_id/actions/archive',
      offeringOverrides.buildArchiveHandler(store));
    this.registerOverride('POST', '/revenuecat/projects/:project_id/offerings/:offering_id/actions/unarchive',
      offeringOverrides.buildUnarchiveHandler(store));
  }
}
