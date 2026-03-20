import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec, generateId } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { OpenApiMockAdapter, unixNow } from '@mimicai/adapter-sdk';
import type { DefaultFactory, NotFoundError } from '@mimicai/adapter-sdk';
import type { GeneratedRoute } from '@mimicai/adapter-sdk';
import type { ChargebeeConfig } from './config.js';
import { registerChargebeeTools } from './mcp.js';
import meta from './adapter-meta.js';

// Generated files
import { chargebeeResourceSpecs } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';
import type { GeneratedRoute as CBRoute } from './generated/routes.js';

// Overrides
import * as subOverrides from './overrides/subscriptions.js';
import * as invOverrides from './overrides/invoices.js';

// ---------------------------------------------------------------------------
// Namespace helper
// ---------------------------------------------------------------------------

function ns(resource: string): string {
  return `chargebee:${resource}`;
}

/**
 * Map resource key (plural, e.g. 'customers') to the singular
 * Chargebee wrapper key used in API responses (e.g. 'customer').
 */
function resourceSingular(resourceKey: string): string {
  if (resourceKey.endsWith('ies')) return resourceKey.slice(0, -3) + 'y';
  if (resourceKey.endsWith('ses')) return resourceKey.slice(0, -2);
  if (resourceKey.endsWith('s')) return resourceKey.slice(0, -1);
  return resourceKey;
}

// ---------------------------------------------------------------------------
// ChargebeeAdapter
// ---------------------------------------------------------------------------

export class ChargebeeAdapter extends OpenApiMockAdapter<ChargebeeConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;

  readonly resourceSpecs = chargebeeResourceSpecs;

  /** @deprecated Use resourceSpecs. */
  readonly promptContext = derivePromptContext(chargebeeResourceSpecs);

  /** @deprecated Use resourceSpecs. */
  readonly dataSpec: DataSpec = deriveDataSpec(chargebeeResourceSpecs);

  protected readonly generatedRoutes: GeneratedRoute[] = GENERATED_ROUTES as GeneratedRoute[];
  protected readonly defaultFactories: Record<string, DefaultFactory> = SCHEMA_DEFAULTS;

  // ---------------------------------------------------------------------------
  // Route registration
  // ---------------------------------------------------------------------------

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // ── Chargebee wraps single-resource responses: { customer: {...} } ──
    // The preSerialization hook wraps raw objects returned by CRUD handlers.
    // Override handlers and wrapList/deleteResponse must NOT pre-wrap;
    // they return raw objects and this hook adds the envelope.
    server.addHook('preSerialization', async (req, _reply, payload) => {
      if (!payload || typeof payload !== 'object') return payload;
      const p = payload as Record<string, unknown>;

      // Already in Chargebee list format
      if ('list' in p) return payload;

      // Error responses — don't wrap
      if ('message' in p && 'api_error_code' in p) return payload;
      if ('error' in p && typeof p.error === 'object') return payload;

      // 501 not-implemented from base class
      if ('object' in p) return payload;

      // Pre-wrapped by override handler (e.g. subscription create under /customers/)
      if ('__skipWrap' in p) {
        const { __skipWrap: _, ...rest } = p;
        return rest;
      }

      // Detect which resource this route returns
      const route = this.findRouteForRequest(req);
      if (!route) return payload;

      // Chargebee wraps in singular resource key: { customer: {...} }
      const singular = resourceSingular(route.resource);
      return { [singular]: payload };
    });

    // ── Register overrides before CRUD scaffolding ──
    this.mountOverrides(store);

    // ── Generated CRUD scaffolding ──
    await this.registerGeneratedRoutes(server, data, store, ns);
  }

  getEndpoints(): EndpointDefinition[] {
    return this.endpointsFromRoutes();
  }

  /**
   * Extract persona ID from Chargebee Basic Auth.
   * Chargebee uses HTTP Basic Auth where the API key is the username.
   * Pattern: test_{site}_{key} or live_{site}_{key}
   */
  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;

    // Basic auth: base64(apiKey:)
    const match = auth.match(/^Basic\s+(.+)$/);
    if (!match) return null;

    try {
      const decoded = Buffer.from(match[1]!, 'base64').toString('utf-8');
      const apiKey = decoded.replace(/:$/, '');
      const keyMatch = apiKey.match(/^test_([a-zA-Z0-9-]+)_/);
      return keyMatch ? keyMatch[1]! : null;
    } catch {
      return null;
    }
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerChargebeeTools(mcpServer, mockBaseUrl);
  }

  // ---------------------------------------------------------------------------
  // Chargebee-specific response formatting
  // ---------------------------------------------------------------------------

  /**
   * Chargebee list format: { list: [{ resource: {...} }], next_offset?: "..." }
   */
  protected override wrapList(
    data: unknown[],
    route: GeneratedRoute,
    hasMore: boolean,
    _query: Record<string, string>,
  ): unknown {
    const singular = resourceSingular(route.resource);
    const wrappedItems = data.map(item => ({ [singular]: item }));
    const result: Record<string, unknown> = { list: wrappedItems };
    if (hasMore) {
      const lastItem = data[data.length - 1] as Record<string, unknown> | undefined;
      result.next_offset = lastItem?.id ?? `offset_${data.length}`;
    }
    return result;
  }

  /**
   * Chargebee uses offset-based pagination with opaque offset tokens.
   */
  protected override paginate(
    items: Record<string, unknown>[],
    query: Record<string, string>,
  ): { data: Record<string, unknown>[]; hasMore: boolean } {
    const limit = Math.min(parseInt(query.limit ?? '10', 10) || 10, 100);
    let startIdx = 0;

    if (query.offset) {
      const idx = items.findIndex(i => i.id === query.offset);
      if (idx >= 0) startIdx = idx + 1;
    }

    const page = items.slice(startIdx, startIdx + limit);
    return { data: page, hasMore: startIdx + limit < items.length };
  }

  /**
   * Chargebee deletes return { customer: { id, deleted: true } }.
   * We return the RAW inner object here; the preSerialization hook adds the wrapper.
   */
  protected override deleteResponse(id: string, _route: GeneratedRoute): unknown {
    return { id, deleted: true };
  }

  /**
   * Chargebee 404 error format.
   */
  protected override notFoundError(resource: string, id: string): NotFoundError {
    const singular = resource.replace(/s$/, '');
    return {
      error: {
        type: 'invalid_request',
        code: 'resource_not_found',
        message: `No such ${singular}: '${id}'`,
        param: null,
      },
    };
  }

  /**
   * Chargebee merges with updated_at + resource_version tracking.
   */
  protected override mergeUpdate(
    existing: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const updated: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(body)) {
      if (k === 'meta_data' && typeof existing.meta_data === 'object' && existing.meta_data !== null) {
        updated.meta_data = { ...(existing.meta_data as Record<string, unknown>), ...(v as Record<string, unknown>) };
      } else {
        updated[k] = v;
      }
    }
    updated.updated_at = unixNow();
    updated.resource_version = unixNow() * 1000;
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private findRouteForRequest(req: FastifyRequest): CBRoute | undefined {
    const routeUrl = (req.routeOptions as { url?: string })?.url;
    const method = req.method;
    if (!routeUrl) return undefined;
    return GENERATED_ROUTES.find(r => r.method === method && r.fastifyPath === routeUrl);
  }

  // ---------------------------------------------------------------------------
  // Override registration
  // ---------------------------------------------------------------------------

  private mountOverrides(store: StateStore): void {
    // ── Subscriptions — create via /customers/{id}/subscription_for_items ──
    this.registerOverride(
      'POST', '/customers/:customer_id/subscription_for_items',
      subOverrides.buildCreateSubscriptionHandler(store),
    );
    this.registerOverride(
      'POST', '/subscriptions/:subscription_id/cancel_for_items',
      subOverrides.buildCancelHandler(store),
    );
    this.registerOverride(
      'POST', '/subscriptions/:subscription_id/reactivate',
      subOverrides.buildReactivateHandler(store),
    );
    this.registerOverride(
      'POST', '/subscriptions/:subscription_id/pause',
      subOverrides.buildPauseHandler(store),
    );
    this.registerOverride(
      'POST', '/subscriptions/:subscription_id/resume',
      subOverrides.buildResumeHandler(store),
    );

    // ── Invoices — create via /invoices/create_for_charge_items_and_charges ──
    this.registerOverride(
      'POST', '/invoices/create_for_charge_items_and_charges',
      invOverrides.buildCreateInvoiceHandler(store),
    );
    this.registerOverride(
      'POST', '/invoices/:invoice_id/void',
      invOverrides.buildVoidHandler(store),
    );
    this.registerOverride(
      'POST', '/invoices/:invoice_id/write_off',
      invOverrides.buildWriteOffHandler(store),
    );
    this.registerOverride(
      'POST', '/invoices/:invoice_id/record_payment',
      invOverrides.buildRecordPaymentHandler(store),
    );

    // ── Coupons — create via /coupons/create_for_items ──
    this.registerOverride(
      'POST', '/coupons/create_for_items',
      async (req, reply) => {
        const body = this.parseBody(req);
        const factory = SCHEMA_DEFAULTS['coupon'];
        const id = (body.id as string) || generateId('', 14);
        const obj = factory!({ id, created_at: unixNow(), ...body });
        store.set(ns('coupons'), id, obj);
        // Return raw — preSerialization hook wraps it
        return reply.code(200).send(obj);
      },
    );
  }
}
