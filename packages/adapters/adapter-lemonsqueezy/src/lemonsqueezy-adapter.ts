import type { FastifyInstance, FastifyRequest, FastifyReply, RouteHandlerMethod } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { OpenApiMockAdapter } from '@mimicai/adapter-sdk';
import type { DefaultFactory, NotFoundError } from '@mimicai/adapter-sdk';
import type { LemonSqueezyConfig } from './config.js';
import { registerLemonSqueezyTools } from './mcp.js';
import { lsNotFound } from './lemonsqueezy-errors.js';
import meta from './adapter-meta.js';

// Generated files
import { lemonsqueezyResourceSpecs } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';
import type { GeneratedRoute } from './generated/routes.js';

// Override handlers
import * as subOverrides from './overrides/subscriptions.js';

function ns(resource: string): string {
  return `lemonsqueezy:${resource}`;
}

/**
 * Wrap a flat resource object in JSON:API format.
 */
function wrapJsonApi(type: string, obj: Record<string, unknown>): unknown {
  const { id, ...attributes } = obj;
  return {
    jsonapi: { version: '1.0' },
    links: { self: `https://api.lemonsqueezy.com/v1/${type}/${id}` },
    data: {
      type,
      id: String(id),
      attributes,
      relationships: {},
    },
  };
}

/**
 * Extract attributes from a JSON:API request body.
 * Handles both JSON:API format { data: { attributes: {...} } } and plain objects.
 */
function extractJsonApiBody(body: Record<string, unknown>): Record<string, unknown> {
  const data = body.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object' && data.attributes) {
    return data.attributes as Record<string, unknown>;
  }
  // Fall back to plain body (for simpler testing)
  return body;
}

export class LemonSqueezyAdapter extends OpenApiMockAdapter<LemonSqueezyConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;

  readonly resourceSpecs = lemonsqueezyResourceSpecs;

  /** @deprecated Use resourceSpecs. */
  readonly promptContext = derivePromptContext(lemonsqueezyResourceSpecs);

  /** @deprecated Use resourceSpecs. */
  readonly dataSpec: DataSpec = deriveDataSpec(lemonsqueezyResourceSpecs);

  protected readonly generatedRoutes: GeneratedRoute[] = GENERATED_ROUTES;
  protected readonly defaultFactories: Record<string, DefaultFactory> = SCHEMA_DEFAULTS;

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    this.mountOverrides(store);
    await this.registerGeneratedRoutes(server, data, store, ns);
  }

  getEndpoints(): EndpointDefinition[] {
    return this.endpointsFromRoutes();
  }

  resolvePersona(req: FastifyRequest): string | null {
    // Lemon Squeezy uses Bearer token auth
    // Parse persona from: test_{persona}_{key}
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const token = match[1]!;
    const personaMatch = token.match(/^test_([a-z0-9-]+)_/);
    return personaMatch ? personaMatch[1]! : null;
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerLemonSqueezyTools(mcpServer, mockBaseUrl);
  }

  // ---------------------------------------------------------------------------
  // JSON:API response format overrides
  // ---------------------------------------------------------------------------

  /**
   * Wrap list in Lemon Squeezy's JSON:API format with page-based pagination.
   */
  protected override wrapList(
    data: unknown[],
    route: GeneratedRoute,
    hasMore: boolean,
    query: Record<string, string>,
  ): unknown {
    const pageNumber = parseInt(query['page[number]'] ?? '1', 10) || 1;
    const pageSize = parseInt(query['page[size]'] ?? '10', 10) || 10;
    const total = hasMore ? pageNumber * pageSize + 1 : (pageNumber - 1) * pageSize + data.length;
    const lastPage = Math.ceil(total / pageSize);

    const jsonApiData = data.map(item => {
      const obj = item as Record<string, unknown>;
      const { id, ...attributes } = obj;
      return {
        type: route.objectType ?? route.resource,
        id: String(id),
        attributes,
        relationships: {},
      };
    });

    return {
      jsonapi: { version: '1.0' },
      meta: {
        page: {
          currentPage: pageNumber,
          from: data.length > 0 ? (pageNumber - 1) * pageSize + 1 : null,
          lastPage,
          perPage: pageSize,
          to: data.length > 0 ? (pageNumber - 1) * pageSize + data.length : null,
          total,
        },
      },
      links: {
        first: `https://api.lemonsqueezy.com/v1/${route.resource}?page%5Bnumber%5D=1&page%5Bsize%5D=${pageSize}`,
        last: `https://api.lemonsqueezy.com/v1/${route.resource}?page%5Bnumber%5D=${lastPage}&page%5Bsize%5D=${pageSize}`,
      },
      data: jsonApiData,
    };
  }

  /**
   * Page-based pagination for Lemon Squeezy.
   */
  protected override paginate(
    items: Record<string, unknown>[],
    query: Record<string, string>,
  ): { data: Record<string, unknown>[]; hasMore: boolean } {
    const pageSize = Math.min(parseInt(query['page[size]'] ?? '10', 10) || 10, 100);
    const pageNumber = parseInt(query['page[number]'] ?? '1', 10) || 1;
    const startIdx = (pageNumber - 1) * pageSize;
    const page = items.slice(startIdx, startIdx + pageSize);
    return { data: page, hasMore: startIdx + pageSize < items.length };
  }

  /**
   * Lemon Squeezy DELETE returns 204 No Content.
   */
  protected override deleteResponse(_id: string, _route: GeneratedRoute): unknown {
    return null; // We'll handle the 204 in a custom delete handler
  }

  /**
   * Lemon Squeezy error format.
   */
  protected override notFoundError(resource: string, id: string): NotFoundError {
    // Cast to NotFoundError shape for compatibility
    return lsNotFound(resource, id) as unknown as NotFoundError;
  }

  /**
   * Parse JSON:API request body - extract attributes from the data envelope.
   */
  protected override parseBody(req: FastifyRequest): Record<string, unknown> {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    return extractJsonApiBody(raw);
  }

  // ---------------------------------------------------------------------------
  // Override registration
  // ---------------------------------------------------------------------------

  private mountOverrides(store: StateStore): void {
    // ── Subscriptions ─────────────────────────────────────────────────────
    // Cancel via DELETE sets status to 'cancelled'
    this.registerOverride(
      'DELETE', '/lemonsqueezy/v1/subscriptions/:id',
      subOverrides.buildCancelHandler(store),
    );

    // Update via PATCH handles pause/unpause, cancel/uncancel
    this.registerOverride(
      'PATCH', '/lemonsqueezy/v1/subscriptions/:id',
      subOverrides.buildUpdateHandler(store),
    );

    // ── Discounts ─────────────────────────────────────────────────────────
    // DELETE returns 204 No Content
    this.registerOverride(
      'DELETE', '/lemonsqueezy/v1/discounts/:id',
      this.buildNoContentDeleteHandler(store, 'discounts'),
    );

    // ── Webhooks ──────────────────────────────────────────────────────────
    // DELETE returns 204 No Content
    this.registerOverride(
      'DELETE', '/lemonsqueezy/v1/webhooks/:id',
      this.buildNoContentDeleteHandler(store, 'webhooks'),
    );

    // ── Create overrides (JSON:API wrapping) ─────────────────────────────
    // Override create handlers to return JSON:API format
    for (const route of this.generatedRoutes) {
      if (route.operation === 'create') {
        this.registerOverride(
          route.method as any,
          route.fastifyPath,
          this.buildJsonApiCreateHandler(store, route),
        );
      } else if (route.operation === 'retrieve') {
        this.registerOverride(
          route.method as any,
          route.fastifyPath,
          this.buildJsonApiRetrieveHandler(store, route),
        );
      } else if (route.operation === 'update' && !this.hasOverride(route)) {
        this.registerOverride(
          route.method as any,
          route.fastifyPath,
          this.buildJsonApiUpdateHandler(store, route),
        );
      }
    }
  }

  private hasOverride(route: GeneratedRoute): boolean {
    // Check if we already registered an override for subscriptions
    return route.resource === 'subscriptions' && route.operation === 'update';
  }

  private buildJsonApiCreateHandler(store: StateStore, route: GeneratedRoute): (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
    const factory = this.defaultFactories[route.resource];
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const body = this.parseBody(req);
      const obj = factory
        ? factory(body)
        : { id: (body.id as string) || require('@mimicai/core').generateId('', 14), ...body };
      store.set(ns(route.resource), obj.id as string, obj);
      return reply.code(201).send(wrapJsonApi(route.objectType ?? route.resource, obj));
    };
  }

  private buildJsonApiRetrieveHandler(store: StateStore, route: GeneratedRoute): (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as Record<string, string>;

      // Special case: /v1/users/me
      if (route.resource === 'users' && route.idParam === 'me') {
        const users = store.list<Record<string, unknown>>(ns('users'));
        const user = users[0] ?? this.defaultFactories['users']!({ name: 'Test User', email: 'test@example.com' });
        if (!users.length) store.set(ns('users'), user.id as string, user);
        return reply.code(200).send(wrapJsonApi('users', user));
      }

      const id = route.idParam ? params[route.idParam] : Object.values(params)[0];
      if (!id) {
        return reply.code(400).send(lsNotFound(route.resource, '(no id)'));
      }
      const obj = store.get<Record<string, unknown>>(ns(route.resource), id);
      if (!obj) {
        return reply.code(404).send(lsNotFound(route.resource, id));
      }
      return reply.code(200).send(wrapJsonApi(route.objectType ?? route.resource, obj));
    };
  }

  private buildJsonApiUpdateHandler(store: StateStore, route: GeneratedRoute): (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as Record<string, string>;
      const id = route.idParam ? params[route.idParam] : Object.values(params)[0];
      if (!id) {
        return reply.code(400).send(lsNotFound(route.resource, '(no id)'));
      }
      const existing = store.get<Record<string, unknown>>(ns(route.resource), id);
      if (!existing) {
        return reply.code(404).send(lsNotFound(route.resource, id));
      }
      const body = this.parseBody(req);
      const updated = { ...existing, ...body, updated_at: new Date().toISOString() };
      store.set(ns(route.resource), id, updated);
      return reply.code(200).send(wrapJsonApi(route.objectType ?? route.resource, updated));
    };
  }

  private buildNoContentDeleteHandler(store: StateStore, resource: string): (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as Record<string, string>;
      const id = params.id;
      if (!id) {
        return reply.code(400).send(lsNotFound(resource, '(no id)'));
      }
      store.delete(ns(resource), id);
      return reply.code(204).send();
    };
  }
}
