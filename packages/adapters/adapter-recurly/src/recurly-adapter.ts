import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { OpenApiMockAdapter } from '@mimicai/adapter-sdk';
import type { DefaultFactory, NotFoundError } from '@mimicai/adapter-sdk';
import type { RecurlyConfig } from './config.js';
import { registerRecurlyTools } from './mcp.js';
import { recurlyNotFound } from './recurly-errors.js';
import meta from './adapter-meta.js';

// Generated files
import { recurlyResourceSpecs } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';
import type { GeneratedRoute } from './generated/routes.js';

// Override handlers
import * as subOverrides from './overrides/subscriptions.js';
import * as invOverrides from './overrides/invoices.js';
import * as acctOverrides from './overrides/accounts.js';

function ns(resource: string): string {
  return `recurly:${resource}`;
}

export class RecurlyAdapter extends OpenApiMockAdapter<RecurlyConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;

  readonly resourceSpecs = recurlyResourceSpecs;

  /** @deprecated Use resourceSpecs. */
  readonly promptContext = derivePromptContext(recurlyResourceSpecs);

  /** @deprecated Use resourceSpecs. */
  readonly dataSpec: DataSpec = deriveDataSpec(recurlyResourceSpecs);

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
    // Recurly uses HTTP Basic auth: base64(api_key:)
    // We parse persona from: test_{persona}_{key}
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Basic\s+(.+)$/i);
    if (!match) return null;
    try {
      const decoded = Buffer.from(match[1]!, 'base64').toString('utf-8');
      const apiKey = decoded.split(':')[0]!;
      const personaMatch = apiKey.match(/^test_([a-z0-9-]+)_/);
      return personaMatch ? personaMatch[1]! : null;
    } catch {
      return null;
    }
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerRecurlyTools(mcpServer, mockBaseUrl);
  }

  // Override list response to match Recurly format
  protected override wrapList(
    data: unknown[],
    route: GeneratedRoute,
    hasMore: boolean,
    _query: Record<string, string>,
  ): unknown {
    return {
      object: 'list',
      has_more: hasMore,
      next: hasMore ? `/${route.resource}?cursor=next` : null,
      data,
    };
  }

  // Recurly returns the full deleted object (with state=closed/deleted_at set)
  protected override deleteResponse(id: string, route: GeneratedRoute): unknown {
    return {
      id,
      object: route.objectType ?? route.resource.replace(/s$/, ''),
      deleted_at: new Date().toISOString(),
    };
  }

  // Recurly error format
  protected override notFoundError(resource: string, id: string): NotFoundError {
    return recurlyNotFound(resource, id);
  }

  private mountOverrides(store: StateStore): void {
    // ── Accounts ──────────────────────────────────────────────────────────
    this.registerOverride(
      'DELETE', '/accounts/:account_id',
      acctOverrides.buildDeactivateHandler(store),
    );
    this.registerOverride(
      'PUT', '/accounts/:account_id/reactivate',
      acctOverrides.buildReactivateHandler(store),
    );

    // ── Subscriptions ─────────────────────────────────────────────────────
    this.registerOverride(
      'PUT', '/subscriptions/:subscription_id/cancel',
      subOverrides.buildCancelHandler(store),
    );
    this.registerOverride(
      'PUT', '/subscriptions/:subscription_id/pause',
      subOverrides.buildPauseHandler(store),
    );
    this.registerOverride(
      'PUT', '/subscriptions/:subscription_id/resume',
      subOverrides.buildResumeHandler(store),
    );
    this.registerOverride(
      'PUT', '/subscriptions/:subscription_id/reactivate',
      subOverrides.buildReactivateHandler(store),
    );
    this.registerOverride(
      'PUT', '/subscriptions/:subscription_id/convert_trial',
      subOverrides.buildConvertTrialHandler(store),
    );
    // DELETE /subscriptions/:id is "terminate" in Recurly
    this.registerOverride(
      'DELETE', '/subscriptions/:subscription_id',
      subOverrides.buildTerminateHandler(store),
    );

    // ── Invoices ──────────────────────────────────────────────────────────
    this.registerOverride(
      'PUT', '/invoices/:invoice_id/collect',
      invOverrides.buildCollectHandler(store),
    );
    this.registerOverride(
      'PUT', '/invoices/:invoice_id/void',
      invOverrides.buildVoidHandler(store),
    );
    this.registerOverride(
      'PUT', '/invoices/:invoice_id/mark_failed',
      invOverrides.buildMarkFailedHandler(store),
    );
    this.registerOverride(
      'PUT', '/invoices/:invoice_id/mark_successful',
      invOverrides.buildMarkSuccessfulHandler(store),
    );
    this.registerOverride(
      'PUT', '/invoices/:invoice_id/reopen',
      invOverrides.buildReopenHandler(store),
    );
  }
}
