import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData, PromptContext } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { OpenApiMockAdapter } from '@mimicai/adapter-sdk';
import type { DefaultFactory, NotFoundError } from '@mimicai/adapter-sdk';

import meta from './adapter-meta.js';
import type { GmailConfig } from './config.js';
import { registerGmailTools } from './mcp.js';
import { gmailNotFound } from './gmail-errors.js';

import { gmailResourceSpecs } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';
import type { GeneratedRoute } from './generated/routes.js';

import * as profileOverrides from './overrides/profile.js';
import * as messageOverrides from './overrides/messages.js';
import * as threadOverrides from './overrides/threads.js';
import * as draftOverrides from './overrides/drafts.js';
import * as historyOverrides from './overrides/history.js';
import { seedSystemLabels } from './overrides/labels.js';

const BASE = '/gmail/v1/users/:userId';

function ns(resource: string): string {
  return `gmail:${resource}`;
}

export class GmailAdapter extends OpenApiMockAdapter<GmailConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;
  readonly resourceSpecs = gmailResourceSpecs;

  /** @deprecated Required by base class — use resourceSpecs instead. */
  readonly promptContext: PromptContext = derivePromptContext(gmailResourceSpecs);

  /** @deprecated Required by base class — use resourceSpecs instead. */
  readonly dataSpec: DataSpec = deriveDataSpec(gmailResourceSpecs);

  protected readonly generatedRoutes: GeneratedRoute[] = GENERATED_ROUTES;
  protected readonly defaultFactories: Record<string, DefaultFactory> = SCHEMA_DEFAULTS;

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // 1. Custom overrides FIRST — Gmail has many non-CRUD verbs (modify/trash/send/...).
    this.mountOverrides(store);

    // 2. CRUD scaffolding for the rest.
    await this.registerGeneratedRoutes(server, data, store, ns);
  }

  getEndpoints(): EndpointDefinition[] {
    return this.endpointsFromRoutes();
  }

  /**
   * Gmail uses OAuth 2.0 Bearer tokens. For test/mock usage we accept the
   * convention `Bearer mimic_${personaId}_...` — same shape used by other
   * Mimic adapters. Real Google access tokens are opaque, so personas can't
   * be encoded in them; the test convention is the practical alternative.
   */
  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+mimic_([a-z0-9-]+)_/);
    return match ? match[1]! : null;
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerGmailTools(mcpServer, mockBaseUrl);
  }

  // ---------------------------------------------------------------------------
  // Gmail-specific response conventions
  // ---------------------------------------------------------------------------

  /**
   * Gmail list responses use the shape `{ messages|threads|labels|...: [...], nextPageToken?, resultSizeEstimate? }`.
   * The base class default ({ object: 'list', data, has_more, url }) is Stripe-shaped, so we override.
   */
  protected override wrapList(
    data: unknown[],
    route: GeneratedRoute,
    hasMore: boolean,
    _query: Record<string, string>,
  ): unknown {
    const key = route.resource; // 'messages' | 'threads' | 'labels' | 'drafts' | 'history'
    const out: Record<string, unknown> = { [key]: data, resultSizeEstimate: data.length };
    if (hasMore) {
      const last = data[data.length - 1] as { id?: string } | undefined;
      out.nextPageToken = last?.id ? `pt_${last.id}` : `pt_${Date.now()}`;
    }
    return out;
  }

  /** Gmail uses `pageToken` (opaque) + `maxResults` (default 100, max 500). */
  protected override paginate(
    items: Record<string, unknown>[],
    query: Record<string, string>,
  ): { data: Record<string, unknown>[]; hasMore: boolean } {
    const maxResults = Math.min(parseInt(query.maxResults ?? '100', 10) || 100, 500);
    let startIdx = 0;

    if (query.pageToken) {
      // Our wrapList encodes the cursor as `pt_{id}`. Find the next item after that id.
      const afterId = query.pageToken.startsWith('pt_') ? query.pageToken.slice(3) : null;
      if (afterId) {
        const idx = items.findIndex(i => i.id === afterId);
        if (idx >= 0) startIdx = idx + 1;
      }
    }

    const page = items.slice(startIdx, startIdx + maxResults);
    return { data: page, hasMore: startIdx + maxResults < items.length };
  }

  /** Gmail mutations don't return an `updated` timestamp on every entity, so just shallow-merge. */
  protected override mergeUpdate(
    existing: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    return { ...existing, ...body };
  }

  /** Gmail DELETE typically returns 204 No Content; we return an empty body envelope. */
  protected override deleteResponse(_id: string, _route: GeneratedRoute): unknown {
    return {};
  }

  protected override notFoundError(resource: string, id: string): NotFoundError {
    return gmailNotFound(resource, id) as unknown as NotFoundError;
  }

  // ---------------------------------------------------------------------------
  // Override registration
  // ---------------------------------------------------------------------------

  private mountOverrides(store: StateStore): void {
    // Seed Gmail's eight always-on system labels so labels.list returns them
    // even before a persona dataset is loaded.
    seedSystemLabels(store);

    // --- Profile / push notifications -------------------------------------
    this.registerOverride('GET', `${BASE}/profile`, profileOverrides.buildGetProfileHandler(store));
    this.registerOverride('POST', `${BASE}/watch`, profileOverrides.buildWatchHandler(store));
    this.registerOverride('POST', `${BASE}/stop`, profileOverrides.buildStopHandler());

    // --- Messages ---------------------------------------------------------
    this.registerOverride('GET', `${BASE}/messages`, messageOverrides.buildListHandler(store));
    this.registerOverride('POST', `${BASE}/messages/send`, messageOverrides.buildSendHandler(store));
    this.registerOverride('POST', `${BASE}/messages/batchModify`, messageOverrides.buildBatchModifyHandler(store));
    this.registerOverride('POST', `${BASE}/messages/batchDelete`, messageOverrides.buildBatchDeleteHandler(store));
    this.registerOverride('POST', `${BASE}/messages/:id/modify`, messageOverrides.buildModifyHandler(store));
    this.registerOverride('POST', `${BASE}/messages/:id/trash`, messageOverrides.buildTrashHandler(store));
    this.registerOverride('POST', `${BASE}/messages/:id/untrash`, messageOverrides.buildUntrashHandler(store));

    // --- Threads ----------------------------------------------------------
    this.registerOverride('GET', `${BASE}/threads`, threadOverrides.buildListHandler(store));
    this.registerOverride('POST', `${BASE}/threads/:id/modify`, threadOverrides.buildModifyHandler(store));
    this.registerOverride('POST', `${BASE}/threads/:id/trash`, threadOverrides.buildTrashHandler(store));
    this.registerOverride('POST', `${BASE}/threads/:id/untrash`, threadOverrides.buildUntrashHandler(store));

    // --- Drafts -----------------------------------------------------------
    this.registerOverride('POST', `${BASE}/drafts`, draftOverrides.buildCreateHandler(store));
    this.registerOverride('PUT', `${BASE}/drafts/:id`, draftOverrides.buildUpdateHandler(store));
    this.registerOverride('POST', `${BASE}/drafts/send`, draftOverrides.buildSendHandler(store));

    // --- History ----------------------------------------------------------
    this.registerOverride('GET', `${BASE}/history`, historyOverrides.buildListHandler(store));
  }
}
