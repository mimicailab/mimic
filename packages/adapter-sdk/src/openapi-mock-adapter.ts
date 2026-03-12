import type { FastifyInstance, FastifyRequest, FastifyReply, RouteHandlerMethod } from 'fastify';
import type {
  AdapterResourceSpecs,
  DataSpec,
  EndpointDefinition,
  ExpandedData,
  PromptContext,
} from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { generateId } from '@mimicai/core';
import { BaseApiMockAdapter } from './base-api-mock-adapter.js';
import { unixNow } from './format-helpers.js';
import type { GeneratedRoute, RouteMethod } from './openapi-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Handler function matching Fastify's RouteHandlerMethod signature */
export type OverrideHandler = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

/** Map of route override handlers. Key = "{METHOD}:{fastifyPath}" */
export type OverrideMap = Map<string, OverrideHandler>;

/** Factory function that produces a full resource default object */
export type DefaultFactory = (overrides?: Record<string, unknown>) => Record<string, unknown>;

/** Standard list response envelope */
export interface ListResponse {
  object: 'list';
  data: unknown[];
  has_more: boolean;
  url: string;
}

/** Standard resource-not-found error body */
export interface NotFoundError {
  error: {
    type: string;
    code: string;
    message: string;
    param: string | null;
  };
}

/** @deprecated Use NotFoundError */
export type StripeNotFoundError = NotFoundError;

// ---------------------------------------------------------------------------
// OpenApiMockAdapter
// ---------------------------------------------------------------------------

/**
 * Abstract adapter driven by a generated OpenAPI route table and schema
 * default factories.
 *
 * Extends `BaseApiMockAdapter` (which provides lifecycle defaults) and adds:
 *   - Generated route registration with CRUD scaffolding
 *   - Override system for state-machine / non-CRUD endpoints
 *   - Seeding from ExpandedData
 *
 * Platform-specific response shapes (list envelope, error format, pagination,
 * delete response) are exposed as protected methods that subclasses can
 * override. The defaults follow a Stripe-like convention, but adapters for
 * other platforms can customize freely.
 *
 * Subclasses must implement:
 *   - `registerRoutes()` — call `this.registerGeneratedRoutes()` then mount overrides
 *   - `getEndpoints()` — derive from the generated route table
 *   - `resolvePersona()` — platform-specific auth header parsing
 *   - `resourceSpecs` — point to the generated AdapterResourceSpecs
 *   - `defaultFactories` — map of resourceId → DefaultFactory from generated schemas.ts
 *   - `generatedRoutes` — the generated route table from routes.ts
 */
export abstract class OpenApiMockAdapter<TConfig = unknown> extends BaseApiMockAdapter<TConfig> {
  /** Full AdapterResourceSpecs from generated/resource-specs.ts */
  abstract override readonly resourceSpecs: AdapterResourceSpecs;

  /** @deprecated Use resourceSpecs. Will be removed. */
  abstract override readonly promptContext: PromptContext;

  /** @deprecated Use resourceSpecs. Will be removed. */
  abstract override readonly dataSpec: DataSpec;

  /** Generated route table from generated/routes.ts */
  protected abstract readonly generatedRoutes: GeneratedRoute[];

  /** Default factories from generated/schemas.ts */
  protected abstract readonly defaultFactories: Record<string, DefaultFactory>;

  /** Override handlers registered by subclass before route registration */
  private readonly overrides: OverrideMap = new Map();

  // ---------------------------------------------------------------------------
  // Override registration
  // ---------------------------------------------------------------------------

  /**
   * Register a custom handler that replaces the generated CRUD handler for a
   * specific route. Must be called before `registerGeneratedRoutes()`.
   *
   * @param method HTTP method
   * @param fastifyPath Fastify path string matching the route in generatedRoutes
   * @param handler Async Fastify handler
   */
  protected registerOverride(method: RouteMethod, fastifyPath: string, handler: OverrideHandler): void {
    this.overrides.set(`${method}:${fastifyPath}`, handler);
  }

  // ---------------------------------------------------------------------------
  // Generated route registration
  // ---------------------------------------------------------------------------

  /**
   * Register all routes from the generated route table.
   *
   * Routes that have a registered override handler use the override.
   * CRUD routes (list/create/retrieve/update/delete) get the standard scaffold.
   * Action routes without an override get a 501 Not Implemented response.
   *
   * Seeding: any ExpandedData in `data` keyed by adapterId is loaded into the
   * StateStore before route registration.
   */
  protected async registerGeneratedRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
    namespace: (resource: string) => string,
  ): Promise<void> {
    this.seedExpandedData(data, store, namespace);

    for (const route of this.generatedRoutes) {
      const key = `${route.method}:${route.fastifyPath}`;
      const override = this.overrides.get(key);

      if (override) {
        server.route({
          method: route.method,
          url: route.fastifyPath,
          handler: override as RouteHandlerMethod,
        });
        continue;
      }

      const ns = namespace(route.resource);
      const factory = this.defaultFactories[route.resource];

      switch (route.operation) {
        case 'list':
          server.route({
            method: route.method,
            url: route.fastifyPath,
            handler: this.buildListHandler(ns, route, store),
          });
          break;

        case 'create':
          if (!factory) {
            server.route({
              method: route.method,
              url: route.fastifyPath,
              handler: this.buildGenericCreateHandler(ns, store),
            });
          } else {
            server.route({
              method: route.method,
              url: route.fastifyPath,
              handler: this.buildCreateHandler(ns, route, store, factory),
            });
          }
          break;

        case 'retrieve':
          server.route({
            method: route.method,
            url: route.fastifyPath,
            handler: this.buildRetrieveHandler(ns, route, store),
          });
          break;

        case 'update':
          server.route({
            method: route.method,
            url: route.fastifyPath,
            handler: this.buildUpdateHandler(ns, route, store),
          });
          break;

        case 'delete':
          server.route({
            method: route.method,
            url: route.fastifyPath,
            handler: this.buildDeleteHandler(ns, route, store),
          });
          break;

        case 'action':
          server.route({
            method: route.method,
            url: route.fastifyPath,
            handler: this.buildNotImplementedHandler(route),
          });
          break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD scaffold handlers
  // ---------------------------------------------------------------------------

  private buildListHandler(
    ns: string,
    route: GeneratedRoute,
    store: StateStore,
  ): RouteHandlerMethod {
    return async (req, reply) => {
      const query = (req.query ?? {}) as Record<string, string>;

      let items = store.list<Record<string, unknown>>(ns);

      for (const filterKey of route.queryFilters) {
        const filterVal = query[filterKey];
        if (filterVal === undefined) continue;
        if (['limit', 'starting_after', 'ending_before', 'expand', 'page', 'page_size'].includes(filterKey)) continue;
        items = items.filter(item => String(item[filterKey]) === filterVal);
      }

      const page = this.paginate(items, query);
      return reply.code(200).send(this.wrapList(page.data, route, page.hasMore, query));
    };
  }

  private buildCreateHandler(
    ns: string,
    _route: GeneratedRoute,
    store: StateStore,
    factory: DefaultFactory,
  ): RouteHandlerMethod {
    return async (req, reply) => {
      const body = this.parseBody(req);
      const newId = generateId(this.idPrefixForFactory(factory), 14);
      const obj = factory({ id: newId, created: unixNow(), ...body });
      store.set(ns, obj.id as string, obj);
      return reply.code(200).send(obj);
    };
  }

  private buildGenericCreateHandler(ns: string, store: StateStore): RouteHandlerMethod {
    return async (req, reply) => {
      const body = this.parseBody(req);
      const id = (body.id as string) || generateId('', 14);
      const obj = { id, created: unixNow(), livemode: false, ...body };
      store.set(ns, id, obj);
      return reply.code(200).send(obj);
    };
  }

  private buildRetrieveHandler(
    ns: string,
    route: GeneratedRoute,
    store: StateStore,
  ): RouteHandlerMethod {
    return async (req, reply) => {
      const params = req.params as Record<string, string>;
      const id = route.idParam ? params[route.idParam] : Object.values(params)[0];
      if (!id) {
        return reply.code(400).send(this.notFoundError(route.resource, '(no id)'));
      }
      const obj = store.get(ns, id);
      if (!obj) {
        return reply.code(404).send(this.notFoundError(route.resource, id));
      }
      return reply.code(200).send(obj);
    };
  }

  private buildUpdateHandler(
    ns: string,
    route: GeneratedRoute,
    store: StateStore,
  ): RouteHandlerMethod {
    return async (req, reply) => {
      const params = req.params as Record<string, string>;
      const id = route.idParam ? params[route.idParam] : Object.values(params)[0];
      if (!id) {
        return reply.code(400).send(this.notFoundError(route.resource, '(no id)'));
      }
      const existing = store.get<Record<string, unknown>>(ns, id);
      if (!existing) {
        return reply.code(404).send(this.notFoundError(route.resource, id));
      }
      const body = this.parseBody(req);
      const updated = this.mergeUpdate(existing, body);
      store.set(ns, id, updated);
      return reply.code(200).send(updated);
    };
  }

  private buildDeleteHandler(
    ns: string,
    route: GeneratedRoute,
    store: StateStore,
  ): RouteHandlerMethod {
    return async (req, reply) => {
      const params = req.params as Record<string, string>;
      const id = route.idParam ? params[route.idParam] : Object.values(params)[0];
      if (!id) {
        return reply.code(400).send(this.notFoundError(route.resource, '(no id)'));
      }
      store.delete(ns, id);
      return reply.code(200).send(this.deleteResponse(id, route));
    };
  }

  private buildNotImplementedHandler(route: GeneratedRoute): RouteHandlerMethod {
    return async (_req, reply) => {
      return reply.code(501).send({
        error: {
          type: 'invalid_request_error',
          code: 'not_implemented',
          message: `${route.method} ${route.stripePath} is not implemented in this mock. Register an override handler.`,
          param: null,
        },
      });
    };
  }

  // ---------------------------------------------------------------------------
  // Seeding
  // ---------------------------------------------------------------------------

  private seedExpandedData(
    data: Map<string, ExpandedData>,
    store: StateStore,
    namespace: (resource: string) => string,
  ): void {
    // Build objectType→route.resource map so we can normalise API response
    // keys (singular, e.g. "customer") to the route resource keys (plural,
    // e.g. "customers") that the CRUD handlers use for StateStore lookups.
    const objectTypeToRoute = new Map<string, string>();
    for (const route of this.generatedRoutes) {
      if (route.objectType && !objectTypeToRoute.has(route.objectType)) {
        objectTypeToRoute.set(route.objectType, route.resource);
      }
    }

    for (const [, expandedData] of data) {
      const apiResponses = expandedData.apiResponses;
      if (!apiResponses) continue;

      for (const [adapterId, responseSet] of Object.entries(apiResponses)) {
        if (adapterId !== this.id) continue;

        for (const [resourceType, responses] of Object.entries(responseSet.responses)) {
          const routeKey = objectTypeToRoute.get(resourceType) ?? resourceType;
          const ns = namespace(routeKey);
          const factory = this.defaultFactories[resourceType] ?? this.defaultFactories[routeKey];
          for (const response of responses) {
            const body = response.body as Record<string, unknown> | null | undefined;
            const id = body?.id as string | undefined;
            if (id) {
              const enriched = factory
                ? factory(body as Record<string, unknown>)
                : (body as Record<string, unknown>);
              store.set(ns, id, enriched);
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Overridable platform conventions
  //
  // These methods define how the adapter formats responses, handles pagination,
  // merges updates, and constructs errors. Override them in subclasses to match
  // the target API's conventions.
  // ---------------------------------------------------------------------------

  /**
   * Wrap an array of items in the platform's list response envelope.
   * Default: Stripe-style `{ object: 'list', data, has_more, url }`.
   *
   * Override for platforms using different envelopes, e.g.:
   *   - Paddle: `{ data, meta: { pagination } }`
   *   - PayPal: `{ items, total_items, links }`
   */
  protected wrapList(
    data: unknown[],
    route: GeneratedRoute,
    hasMore: boolean,
    _query: Record<string, string>,
  ): unknown {
    return {
      object: 'list',
      data,
      has_more: hasMore,
      url: `/v1/${route.resource}`,
    };
  }

  /**
   * Apply cursor/offset pagination to a full list of items.
   * Default: Stripe-style cursor pagination with `starting_after` / `ending_before`.
   *
   * Override for offset-based or page-based pagination.
   */
  protected paginate(
    items: Record<string, unknown>[],
    query: Record<string, string>,
  ): { data: Record<string, unknown>[]; hasMore: boolean } {
    const limit = Math.min(parseInt(query.limit ?? '10', 10) || 10, 100);
    let startIdx = 0;
    if (query.starting_after) {
      const idx = items.findIndex(i => i.id === query.starting_after);
      if (idx >= 0) startIdx = idx + 1;
    } else if (query.ending_before) {
      const idx = items.findIndex(i => i.id === query.ending_before);
      if (idx >= 0) startIdx = Math.max(0, idx - limit);
    }
    const page = items.slice(startIdx, startIdx + limit);
    return { data: page, hasMore: startIdx + limit < items.length };
  }

  /**
   * Merge request body into an existing resource for updates.
   * Default: shallow merge with deep-merge for `metadata` (Stripe convention).
   *
   * Override for platforms with different merge semantics (e.g. JSON Merge Patch).
   */
  protected mergeUpdate(
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
   * Build the response body for a DELETE operation.
   * Default: Stripe-style `{ id, object, deleted: true }`.
   *
   * Override for platforms that return 204 No Content or a full object.
   */
  protected deleteResponse(id: string, route: GeneratedRoute): unknown {
    return {
      id,
      object: route.objectType ?? route.resource.replace(/s$/, ''),
      deleted: true,
    };
  }

  /**
   * Build a resource-not-found error response.
   * Default: Stripe-style `{ error: { type, code, message, param } }`.
   */
  protected notFoundError(resource: string, id: string): NotFoundError {
    const singular = resource.replace(/s$/, '');
    return {
      error: {
        type: 'invalid_request_error',
        code: 'resource_missing',
        message: `No such ${singular}: '${id}'`,
        param: null,
      },
    };
  }

  /** Parse request body — handles JSON and form-encoded bodies */
  protected parseBody(req: FastifyRequest): Record<string, unknown> {
    return (req.body ?? {}) as Record<string, unknown>;
  }

  /**
   * Extract the ID prefix from a default factory by calling it and reading the id.
   */
  private idPrefixForFactory(factory: DefaultFactory): string {
    try {
      const sample = factory();
      const id = sample.id as string | undefined;
      if (!id) return '';
      const match = id.match(/^([a-z_]+_)/);
      return match ? match[1]! : '';
    } catch {
      return '';
    }
  }

  /**
   * Derive EndpointDefinition[] from the generated route table.
   * Call this in your `getEndpoints()` implementation.
   */
  protected endpointsFromRoutes(): EndpointDefinition[] {
    return this.generatedRoutes.map(r => ({
      method: r.method,
      path: r.fastifyPath,
      description: r.description,
    }));
  }
}
