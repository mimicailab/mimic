import type { FastifyInstance, FastifyRequest } from 'fastify';
import formbody from '@fastify/formbody';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData, PromptContext, StateStore } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec } from '@mimicai/core';
import { OpenApiMockAdapter } from '@mimicai/adapter-sdk';
import type { DefaultFactory, NotFoundError, OverrideHandler } from '@mimicai/adapter-sdk';

import meta from './adapter-meta.js';
import type { SlackConfig } from './config.js';
import { registerSlackTools } from './mcp.js';
import { slackError, SLACK_ERROR_CODES } from './slack-errors.js';

import { slackResourceSpecs } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';
import type { GeneratedRoute } from './generated/routes.js';

import * as authHandlers from './overrides/auth.js';
import * as teamHandlers from './overrides/team.js';
import * as userHandlers from './overrides/users.js';
import * as conversationHandlers from './overrides/conversations.js';
import * as chatHandlers from './overrides/chat.js';
import * as reactionHandlers from './overrides/reactions.js';
import * as pinHandlers from './overrides/pins.js';
import * as fileHandlers from './overrides/files.js';
import * as searchHandlers from './overrides/search.js';
import { seedDefaultFixtures } from './overrides/fixtures.js';

const BASE = '/api';

/**
 * Slack route resources don't follow REST conventions, so the namespace
 * function isn't really used by any base CRUD handler — but
 * `registerGeneratedRoutes` requires one. Map every Slack route to a
 * single `slack:<resource>` namespace for consistency.
 */
function ns(resource: string): string {
  return `slack:${resource}`;
}

export class SlackAdapter extends OpenApiMockAdapter<SlackConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;
  readonly resourceSpecs = slackResourceSpecs;

  /** @deprecated Required by base class — use resourceSpecs instead. */
  readonly promptContext: PromptContext = derivePromptContext(slackResourceSpecs);

  /** @deprecated Required by base class — use resourceSpecs instead. */
  readonly dataSpec: DataSpec = deriveDataSpec(slackResourceSpecs);

  protected readonly generatedRoutes: GeneratedRoute[] = GENERATED_ROUTES;
  protected readonly defaultFactories: Record<string, DefaultFactory> = SCHEMA_DEFAULTS;

  /**
   * Slack's REST shape doesn't fit the base CRUD scaffolding — every method
   * is a verb-named POST. We register every generated route as an explicit
   * override (in `mountOverrides`) so `registerGeneratedRoutes` always finds
   * a match and never falls back to its CRUD handlers.
   */
  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // Slack accepts both application/x-www-form-urlencoded and JSON bodies.
    // formbody only registers a parser for the form content-type — it does
    // not interfere with Fastify's built-in JSON parser. `buildTestServer`
    // already registers it, hence the conditional.
    if (!server.hasContentTypeParser('application/x-www-form-urlencoded')) {
      await server.register(formbody);
    }

    // Slack's universal envelope: every successful response carries `ok: true`,
    // every error `ok: false, error: <code>`. Any handler that already returns
    // an object containing an `ok` field is left alone; anything else gets
    // wrapped (so a handler can return `{ channel: ... }` and the wire format
    // becomes `{ ok: true, channel: ... }`).
    server.addHook('preSerialization', async (_req, reply, payload) => {
      if (payload === undefined || payload === null) return payload;
      if (typeof payload !== 'object') return payload;
      const obj = payload as Record<string, unknown>;
      if ('ok' in obj) return obj;
      if (reply.statusCode >= 400) return { ok: false, error: 'unknown_error', ...obj };
      return { ok: true, ...obj };
    });

    // Bootstrap fixtures so an unseeded adapter can answer `auth.test`,
    // `team.info`, and `users.info` for the bot user.
    seedDefaultFixtures(store);

    this.mountOverrides(store);

    // Mount routes via the base class: every Slack route has an override,
    // so the CRUD scaffolding is never hit.
    await this.registerGeneratedRoutes(server, data, store, ns);
  }

  getEndpoints(): EndpointDefinition[] {
    return this.endpointsFromRoutes();
  }

  /**
   * Slack uses bot tokens (`xoxb-...`) and user tokens (`xoxp-...`). For
   * Mimic test usage we accept either with the persona id encoded between
   * dashes, e.g. `Bearer xoxb-northwind-priya-AAAA...`.
   */
  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+xox[bp]-([a-z0-9-]+)-/i);
    return match ? (match[1] ?? null) : null;
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerSlackTools(mcpServer, mockBaseUrl);
  }

  // ---------------------------------------------------------------------------
  // Slack-specific not-found error shape (used if any code path *does* reach
  // the base class's CRUD scaffolding, which we generally avoid).
  // ---------------------------------------------------------------------------

  protected override notFoundError(_resource: string, _id: string): NotFoundError {
    return slackError(SLACK_ERROR_CODES.METHOD_NOT_IMPLEMENTED) as unknown as NotFoundError;
  }

  // ---------------------------------------------------------------------------
  // Override registration
  // ---------------------------------------------------------------------------

  // The HTTP method registered here MUST match what the Slack spec declares
  // for that path (see src/generated/routes.ts) — the override lookup is
  // keyed by `${method}:${path}`, so a mismatch silently falls through to
  // the not-implemented handler.
  private mountOverrides(store: StateStore): void {
    const reg = (method: 'GET' | 'POST', path: string, fn: OverrideHandler) =>
      this.registerOverride(method, `${BASE}${path}`, fn);

    // Auth & team
    reg('GET', '/auth.test', authHandlers.buildAuthTestHandler(store));
    reg('GET', '/team.info', teamHandlers.buildTeamInfoHandler(store));

    // Users
    reg('GET', '/users.list', userHandlers.buildListHandler(store));
    reg('GET', '/users.info', userHandlers.buildInfoHandler(store));
    reg('GET', '/users.lookupByEmail', userHandlers.buildLookupByEmailHandler(store));
    reg('GET', '/users.profile.get', userHandlers.buildProfileGetHandler(store));

    // Conversations
    reg('GET', '/conversations.list', conversationHandlers.buildListHandler(store));
    reg('GET', '/conversations.history', conversationHandlers.buildHistoryHandler(store));
    reg('GET', '/conversations.replies', conversationHandlers.buildRepliesHandler(store));
    reg('GET', '/conversations.info', conversationHandlers.buildInfoHandler(store));
    reg('GET', '/conversations.members', conversationHandlers.buildMembersHandler(store));
    reg('POST', '/conversations.create', conversationHandlers.buildCreateHandler(store));
    reg('POST', '/conversations.open', conversationHandlers.buildOpenHandler(store));

    // Chat (all POST per spec)
    reg('POST', '/chat.postMessage', chatHandlers.buildPostMessageHandler(store));
    reg('POST', '/chat.postEphemeral', chatHandlers.buildPostEphemeralHandler(store));
    reg('POST', '/chat.update', chatHandlers.buildUpdateHandler(store));
    reg('POST', '/chat.delete', chatHandlers.buildDeleteHandler(store));

    // Reactions
    reg('POST', '/reactions.add', reactionHandlers.buildAddHandler(store));
    reg('POST', '/reactions.remove', reactionHandlers.buildRemoveHandler(store));
    reg('GET', '/reactions.get', reactionHandlers.buildGetHandler(store));
    reg('GET', '/reactions.list', reactionHandlers.buildListHandler(store));

    // Pins
    reg('GET', '/pins.list', pinHandlers.buildListHandler(store));
    reg('POST', '/pins.add', pinHandlers.buildAddHandler(store));
    reg('POST', '/pins.remove', pinHandlers.buildRemoveHandler(store));

    // Files
    reg('GET', '/files.list', fileHandlers.buildListHandler(store));
    reg('GET', '/files.info', fileHandlers.buildInfoHandler(store));

    // Search
    reg('GET', '/search.messages', searchHandlers.buildMessagesHandler(store));
  }
}
