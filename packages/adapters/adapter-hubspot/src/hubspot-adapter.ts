import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData, PromptContext, StateStore } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec } from '@mimicai/core';
import { OpenApiMockAdapter } from '@mimicai/adapter-sdk';
import type { DefaultFactory, Marshaller, NotFoundError, OverrideHandler } from '@mimicai/adapter-sdk';

import meta from './adapter-meta.js';
import type { HubSpotConfig } from './config.js';
import { registerHubSpotTools } from './mcp.js';
import { hubspotNotFoundAsBase } from './hubspot-errors.js';

import { hubspotResourceSpecs } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS, GENERIC_FACTORY } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';
import type { GeneratedRoute, RouteMethod } from './generated/routes.js';

/**
 * Real HubSpot exposes the same CRM-resource APIs under two version schemes:
 *   - dated:   /crm/<noun>/2026-03/...   (the spec collection we ship)
 *   - v3:      /crm/v3/<noun>/...        (the older but still-supported surface)
 *
 * Any client that targets the documented v3 surface (briefing-skill curl
 * examples, older SDKs) would otherwise 404 against the mock. Mirror real
 * HubSpot by aliasing the major CRM resources so both shapes resolve.
 *
 * Note the path-shape flip: dated puts version AFTER the noun
 * (`/crm/objects/2026-03/...`), v3 puts it BEFORE (`/crm/v3/objects/...`).
 */
const V3_ALIASED_NOUNS = ['objects', 'properties', 'pipelines', 'owners', 'associations', 'lists'];

function buildV3Aliases(routes: readonly GeneratedRoute[]): GeneratedRoute[] {
  const aliases: GeneratedRoute[] = [];
  for (const r of routes) {
    for (const noun of V3_ALIASED_NOUNS) {
      const datedPrefix = `/crm/${noun}/2026-03/`;
      const datedExact = `/crm/${noun}/2026-03`;
      const v3Prefix = `/crm/v3/${noun}/`;
      const v3Exact = `/crm/v3/${noun}`;
      let v3Fastify: string | null = null;
      let v3Spec: string | null = null;
      if (r.fastifyPath.startsWith(datedPrefix)) {
        v3Fastify = r.fastifyPath.replace(datedPrefix, v3Prefix);
        v3Spec = r.stripePath.replace(`/crm/${noun}/2026-03/`, `/crm/v3/${noun}/`);
      } else if (r.fastifyPath === datedExact) {
        v3Fastify = v3Exact;
        v3Spec = r.stripePath.replace(`/crm/${noun}/2026-03`, `/crm/v3/${noun}`);
      }
      if (v3Fastify && v3Spec) {
        aliases.push({ ...r, fastifyPath: v3Fastify, stripePath: v3Spec });
        break;
      }
    }
  }
  return aliases;
}

const V3_ALIAS_ROUTES = buildV3Aliases(GENERATED_ROUTES);
const ALL_ROUTES: GeneratedRoute[] = [...GENERATED_ROUTES, ...V3_ALIAS_ROUTES];

import { seedDefaultFixtures } from './overrides/fixtures.js';
import { buildHubSpotCrmMarshallers } from './overrides/marshallers.js';
import * as crmObjects from './overrides/crm_objects.js';
import * as searchOverrides from './overrides/search.js';
import * as batch from './overrides/batch.js';
import * as oauth from './overrides/oauth.js';
import * as accountInfo from './overrides/account_info.js';
import * as pipelines from './overrides/pipelines.js';

/**
 * Namespace function: maps a route's `resource` to a StateStore namespace.
 * For the unified `crm_objects` resource we DON'T return a static namespace
 * — those routes are all handled by overrides that namespace per-objectType.
 */
function ns(resource: string): string {
  return `hubspot:${resource}`;
}

export class HubSpotAdapter extends OpenApiMockAdapter<HubSpotConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;
  readonly resourceSpecs = hubspotResourceSpecs;

  /** @deprecated Required by base class — use resourceSpecs instead. */
  readonly promptContext: PromptContext = derivePromptContext(hubspotResourceSpecs);

  /** @deprecated Required by base class — use resourceSpecs instead. */
  readonly dataSpec: DataSpec = deriveDataSpec(hubspotResourceSpecs);

  protected readonly generatedRoutes: GeneratedRoute[] = ALL_ROUTES;
  protected readonly defaultFactories: Record<string, DefaultFactory> = SCHEMA_DEFAULTS;

  /**
   * Polymorphic CRM-object envelope is wrapped declaratively. See
   * `overrides/marshallers.ts` for the per-type property builders.
   */
  private readonly _marshallers: readonly Marshaller[] = buildHubSpotCrmMarshallers();
  protected override get marshallers(): readonly Marshaller[] {
    return this._marshallers;
  }

  /**
   * 1056 routes is a lot. We rely on the base class's CRUD scaffolding for
   * 80%+ of them and selectively override:
   *   - The unified CRM Objects API (dynamic :objectType namespacing)
   *   - Every `POST /xxx/search` (filterGroups + paging.next.after envelope)
   *   - Every `POST /xxx/batch/<verb>` (HubSpot's bulk operation shape)
   *   - OAuth token + introspection stubs
   */
  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    seedDefaultFixtures(store, this.config);

    // 1. Unified CRM Objects API — dynamic per-objectType namespacing
    this.mountCrmObjectsOverrides(store);

    // 2. Auto-register search + batch overrides for every spec route that
    //    matches the well-known shapes. One pass through the route table.
    this.mountSearchAndBatchOverrides(store);

    // 3. OAuth flow stubs
    this.mountOAuthOverrides();

    // 4. /account-info/<version>/details flat envelope (vs. base CRUD's `{ results }`)
    for (const route of this.generatedRoutes) {
      if (
        route.method === 'GET' &&
        route.fastifyPath.startsWith('/account-info/') &&
        route.fastifyPath.endsWith('/details')
      ) {
        this.registerOverride('GET', route.fastifyPath, accountInfo.buildDetailsHandler(store));
      }
    }

    // 5. Pipelines — codegen mis-classifies `/crm/pipelines/<v>/:objectType` as
    //    retrieve (trailing param). Override to return pipelines filtered by
    //    objectType, plus the deeper stages routes. Handles both dated
    //    (/crm/pipelines/<version>/...) and v3 (/crm/v3/pipelines/...) forms.
    for (const route of this.generatedRoutes) {
      const segs = route.fastifyPath.split('/').filter(Boolean);
      let tail: string[] | null = null;
      // Dated:  segs = ['crm','pipelines','<version>', ...rest]   → tail = rest
      if (segs[0] === 'crm' && segs[1] === 'pipelines' && segs.length >= 3) {
        tail = segs.slice(3);
      }
      // v3:     segs = ['crm','v3','pipelines', ...rest]          → tail = rest
      else if (segs[0] === 'crm' && segs[1] === 'v3' && segs[2] === 'pipelines' && segs.length >= 3) {
        tail = segs.slice(3);
      }
      if (!tail) continue;
      if (route.method === 'GET' && tail.length === 1 && tail[0] === ':objectType') {
        this.registerOverride('GET', route.fastifyPath, pipelines.buildListByObjectTypeHandler(store));
      } else if (route.method === 'GET' && tail.length === 2 && tail[0] === ':objectType' && tail[1] === ':pipelineId') {
        this.registerOverride('GET', route.fastifyPath, pipelines.buildRetrieveHandler(store));
      } else if (route.method === 'GET' && tail.length === 3 && tail[0] === ':objectType' && tail[1] === ':pipelineId' && tail[2] === 'stages') {
        this.registerOverride('GET', route.fastifyPath, pipelines.buildListStagesHandler(store));
      }
    }

    // 4. CRM Owners — the spec uses /v3 with no createdAt filter on collection;
    //    point the resource alias so the base CRUD scaffolding finds the factory.
    //    (Already handled by SCHEMA_DEFAULTS aliases — nothing extra to do.)

    // 5. Mount generated routes — anything not overridden falls back to base CRUD
    await this.registerGeneratedRoutes(server, data, store, ns);
  }

  getEndpoints(): EndpointDefinition[] {
    return this.endpointsFromRoutes();
  }

  /**
   * HubSpot uses Bearer tokens (`pat-na1-<uuid>` for private apps, OAuth
   * access tokens, or developer API keys). For Mimic test traffic, encode
   * the persona id with `Bearer pat-test-<persona-id>-<rest>`.
   */
  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    // Match `Bearer pat-test-<persona>-<rest>` or `Bearer test_<persona>_<rest>`
    const m1 = auth.match(/^Bearer\s+pat-test-([a-z0-9-]+?)-/i);
    if (m1) return m1[1] ?? null;
    const m2 = auth.match(/^Bearer\s+test_([a-z0-9-]+)_/i);
    return m2 ? (m2[1] ?? null) : null;
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerHubSpotTools(mcpServer, mockBaseUrl);
  }

  // ---------------------------------------------------------------------------
  // Response/error overrides
  // ---------------------------------------------------------------------------

  /** HubSpot list envelope: `{ results: [...], paging?: { next: { after } } }`. */
  protected override wrapList(
    data: unknown[],
    _route: GeneratedRoute,
    hasMore: boolean,
    _query: Record<string, string>,
  ): unknown {
    if (data.length === 0) return { results: [] };
    if (hasMore) {
      const last = data[data.length - 1] as { id?: string; listId?: string };
      const nextAfter = last?.id ?? last?.listId;
      if (nextAfter) {
        return { results: data, paging: { next: { after: nextAfter } } };
      }
    }
    return { results: data };
  }

  /** HubSpot pagination: `limit` (default 10, max 100) + `after` cursor. */
  protected override paginate(
    items: Record<string, unknown>[],
    query: Record<string, string>,
  ): { data: Record<string, unknown>[]; hasMore: boolean } {
    const limit = Math.min(parseInt(query.limit ?? '10', 10) || 10, 100);
    const after = query.after;
    let startIdx = 0;
    if (after) {
      const idx = items.findIndex((x) => (x as { id?: string; listId?: string }).id === after || (x as { listId?: string }).listId === after);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = items.slice(startIdx, startIdx + limit);
    return { data: page, hasMore: startIdx + limit < items.length };
  }

  /** PATCH semantics: HubSpot deep-merges `properties`. */
  protected override mergeUpdate(
    existing: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const updated: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(body)) {
      if (k === 'properties' && typeof existing.properties === 'object' && existing.properties !== null) {
        updated.properties = {
          ...(existing.properties as Record<string, unknown>),
          ...(v as Record<string, unknown>),
        };
      } else {
        updated[k] = v;
      }
    }
    updated.updatedAt = new Date().toISOString();
    return updated;
  }

  /** HubSpot's standard error format. */
  protected override notFoundError(resource: string, id: string): NotFoundError {
    return hubspotNotFoundAsBase(resource, id);
  }

  /** HubSpot DELETE returns 204 No Content (archive). */
  protected override deleteResponse(): unknown {
    return {};
  }

  // ---------------------------------------------------------------------------
  // CRM Objects (unified API) overrides
  // ---------------------------------------------------------------------------

  private mountCrmObjectsOverrides(store: StateStore): void {
    const reg = (method: RouteMethod, path: string, fn: OverrideHandler) =>
      this.registerOverride(method, path, fn);

    // Match every route under the CRM Objects API in either version scheme:
    //   - dated:  /crm/objects/<version>/...   (e.g. /crm/objects/2026-03/...)
    //   - v3:     /crm/v3/objects/...
    // Plus typed-per-resource forms (`tickets`, `contacts`, etc., from the
    // per-type CRM specs). Override handlers extract the object type from
    // path params OR by parsing the URL, so the same handler works for both.
    for (const route of this.generatedRoutes) {
      const segs = route.fastifyPath.split('/').filter(Boolean);
      // Dated form:  ['crm', 'objects', '<version>', '<objectType>', ...]   → tail starts at index 4
      // v3 form:     ['crm', 'v3', 'objects', '<objectType>', ...]          → tail starts at index 4 too
      const isDated = segs[0] === 'crm' && segs[1] === 'objects' && segs.length >= 4;
      const isV3 = segs[0] === 'crm' && segs[1] === 'v3' && segs[2] === 'objects' && segs.length >= 4;
      if (!isDated && !isV3) continue;

      const tail = segs.slice(4);
      // List + create (collection root)
      if (tail.length === 0) {
        if (route.method === 'GET') reg('GET', route.fastifyPath, crmObjects.buildListHandler(store));
        if (route.method === 'POST') reg('POST', route.fastifyPath, crmObjects.buildCreateHandler(store));
        continue;
      }
      // Search
      if (tail.length === 1 && tail[0] === 'search' && route.method === 'POST') {
        reg('POST', route.fastifyPath, crmObjects.buildSearchHandler(store));
        continue;
      }
      // Batch verbs
      if (tail.length === 2 && tail[0] === 'batch' && route.method === 'POST') {
        const verb = tail[1];
        if (verb === 'create') reg('POST', route.fastifyPath, crmObjects.buildBatchCreateHandler(store));
        else if (verb === 'read') reg('POST', route.fastifyPath, crmObjects.buildBatchReadHandler(store));
        else if (verb === 'update') reg('POST', route.fastifyPath, crmObjects.buildBatchUpdateHandler(store));
        else if (verb === 'upsert') reg('POST', route.fastifyPath, crmObjects.buildBatchUpsertHandler(store));
        else if (verb === 'archive') reg('POST', route.fastifyPath, crmObjects.buildBatchArchiveHandler(store));
        continue;
      }
      // CRUD on /<id-segment> — accept either `:objectId` (placeholder) or any
      // typed `:xxxId` param (e.g. `:ticketId`, `:contactId`).
      if (tail.length === 1 && tail[0]!.startsWith(':')) {
        if (route.method === 'GET') reg('GET', route.fastifyPath, crmObjects.buildRetrieveHandler(store));
        else if (route.method === 'PATCH') reg('PATCH', route.fastifyPath, crmObjects.buildUpdateHandler(store));
        else if (route.method === 'DELETE') reg('DELETE', route.fastifyPath, crmObjects.buildDeleteHandler(store));
        continue;
      }
      // Deeper paths (associations, GDPR, merge) — fall through to base CRUD
      // (which will return 501 for unimplemented actions).
    }
  }

  // ---------------------------------------------------------------------------
  // Search + batch auto-registration
  // ---------------------------------------------------------------------------

  /**
   * Scan every generated route. Routes ending in `/search` (POST) get a
   * generic search handler. Routes matching `/batch/<verb>` (POST) get
   * the matching batch handler. Resource → namespace lookup uses
   * `route.resource` (which is what the base class would also use).
   */
  private mountSearchAndBatchOverrides(store: StateStore): void {
    const reg = (method: RouteMethod, path: string, fn: OverrideHandler) =>
      this.registerOverride(method, path, fn);

    for (const route of this.generatedRoutes) {
      // Skip CRM Objects routes (both dated + v3 alias forms) — already handled above
      if (route.fastifyPath.startsWith('/crm/objects/')) continue;
      if (route.fastifyPath.startsWith('/crm/v3/objects/')) continue;

      const segs = route.fastifyPath.split('/').filter(Boolean);
      const last = segs[segs.length - 1] ?? '';
      const secondLast = segs.length >= 2 ? segs[segs.length - 2]! : '';

      const factory = this.defaultFactories[route.resource] ?? GENERIC_FACTORY;
      const namespace = ns(route.resource);

      // POST /xxx/search
      if (route.method === 'POST' && last === 'search') {
        reg('POST', route.fastifyPath, searchOverrides.buildSearchHandler(store, namespace));
        continue;
      }

      // POST /xxx/batch/<verb>
      if (route.method === 'POST' && secondLast === 'batch') {
        if (last === 'create') reg('POST', route.fastifyPath, batch.buildBatchCreateHandler(store, namespace, factory));
        else if (last === 'read') reg('POST', route.fastifyPath, batch.buildBatchReadHandler(store, namespace));
        else if (last === 'update') reg('POST', route.fastifyPath, batch.buildBatchUpdateHandler(store, namespace));
        else if (last === 'upsert') reg('POST', route.fastifyPath, batch.buildBatchUpsertHandler(store, namespace, factory));
        else if (last === 'archive') reg('POST', route.fastifyPath, batch.buildBatchArchiveHandler(store, namespace));
        continue;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // OAuth stubs
  // ---------------------------------------------------------------------------

  private mountOAuthOverrides(): void {
    // Spec paths for OAuth — version is 2026-03 per the catalog
    for (const route of this.generatedRoutes) {
      if (!route.fastifyPath.startsWith('/oauth/')) continue;
      const segs = route.fastifyPath.split('/').filter(Boolean);
      const last = segs[segs.length - 1] ?? '';
      const secondLast = segs.length >= 2 ? segs[segs.length - 2]! : '';

      if (route.method === 'POST' && last === 'token') {
        this.registerOverride('POST', route.fastifyPath, oauth.buildTokenHandler());
      } else if (route.method === 'GET' && secondLast === 'access-tokens') {
        this.registerOverride('GET', route.fastifyPath, oauth.buildAccessTokenInfoHandler());
      } else if (route.method === 'GET' && secondLast === 'refresh-tokens') {
        this.registerOverride('GET', route.fastifyPath, oauth.buildRefreshTokenInfoHandler());
      }
    }
  }
}

// Suppress unused-imports lint when no current file in this package uses these
void (async (_a: FastifyReply, _b: FastifyRequest) => undefined);
