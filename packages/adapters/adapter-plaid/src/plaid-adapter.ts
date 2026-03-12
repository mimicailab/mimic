import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData, PromptContext } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { OpenApiMockAdapter } from '@mimicai/adapter-sdk';
import type { DefaultFactory } from '@mimicai/adapter-sdk';
import meta from './adapter-meta.js';
import type { PlaidConfig } from './config.js';
import { registerPlaidTools } from './mcp.js';
import { plaidResponse } from './plaid-errors.js';

// Generated files — do not edit directly; run `pnpm generate` to regenerate
import { plaidResourceSpecs } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';
import type { GeneratedRoute } from './generated/routes.js';

// Override handlers
import * as coreOverrides from './overrides/core.js';

// ---------------------------------------------------------------------------
// Namespace helper
// ---------------------------------------------------------------------------

function ns(resource: string): string {
  return `plaid:${resource}`;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class PlaidAdapter extends OpenApiMockAdapter<PlaidConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;
  readonly resourceSpecs = plaidResourceSpecs;

  /** @deprecated Use resourceSpecs. */
  readonly promptContext = derivePromptContext(plaidResourceSpecs);

  /** @deprecated Use resourceSpecs. */
  readonly dataSpec: DataSpec = deriveDataSpec(plaidResourceSpecs);

  protected readonly generatedRoutes: GeneratedRoute[] = GENERATED_ROUTES;
  protected readonly defaultFactories: Record<string, DefaultFactory> = SCHEMA_DEFAULTS;

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // 1. Register overrides FIRST (before CRUD scaffolding)
    this.mountOverrides(store);

    // 2. CRUD scaffolding auto-handles any remaining routes
    await this.registerGeneratedRoutes(server, data, store, ns);
  }

  getEndpoints(): EndpointDefinition[] {
    return this.endpointsFromRoutes();
  }

  resolvePersona(req: FastifyRequest): string | null {
    // Plaid auth is via PLAID-CLIENT-ID header or client_id in body
    const clientId = req.headers['plaid-client-id'] as string | undefined;
    if (clientId) return clientId;

    // Fall back to body (if parsed)
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.client_id === 'string') return body.client_id;

    return null;
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerPlaidTools(mcpServer, mockBaseUrl);
  }

  // ---------------------------------------------------------------------------
  // Plaid responses wrap data with request_id
  // ---------------------------------------------------------------------------

  protected wrapList(
    data: Record<string, unknown>[],
    _route: GeneratedRoute,
    _hasMore: boolean,
    _query: Record<string, unknown>,
  ): unknown {
    return plaidResponse({ data, total: data.length });
  }

  protected notFoundError(resource: string, id: string) {
    return {
      error: {
        type: 'INVALID_REQUEST',
        code: 'INVALID_FIELD',
        message: `Unable to find ${resource} with id: ${id}`,
        param: null,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Override registration
  // ---------------------------------------------------------------------------

  private mountOverrides(store: StateStore): void {
    // ── Link Token ──────────────────────────────────────────────────────
    this.registerOverride('POST', '/plaid/link/token/create',
      coreOverrides.buildLinkTokenCreateHandler(store));

    // ── Sandbox ─────────────────────────────────────────────────────────
    this.registerOverride('POST', '/plaid/sandbox/public_token/create',
      coreOverrides.buildSandboxPublicTokenCreateHandler(store));
    this.registerOverride('POST', '/plaid/sandbox/item/reset_login',
      coreOverrides.buildSandboxItemResetLoginHandler(store));

    // ── Item / Token Exchange ───────────────────────────────────────────
    this.registerOverride('POST', '/plaid/item/public_token/exchange',
      coreOverrides.buildItemPublicTokenExchangeHandler(store));
    this.registerOverride('POST', '/plaid/item/get',
      coreOverrides.buildItemGetHandler(store));
    this.registerOverride('POST', '/plaid/item/remove',
      coreOverrides.buildItemRemoveHandler(store));

    // ── Accounts ────────────────────────────────────────────────────────
    this.registerOverride('POST', '/plaid/accounts/get',
      coreOverrides.buildAccountsGetHandler(store));
    this.registerOverride('POST', '/plaid/accounts/balance/get',
      coreOverrides.buildAccountsBalanceGetHandler(store));

    // ── Auth ────────────────────────────────────────────────────────────
    this.registerOverride('POST', '/plaid/auth/get',
      coreOverrides.buildAuthGetHandler(store));

    // ── Transactions ────────────────────────────────────────────────────
    this.registerOverride('POST', '/plaid/transactions/get',
      coreOverrides.buildTransactionsGetHandler(store));
    this.registerOverride('POST', '/plaid/transactions/sync',
      coreOverrides.buildTransactionsSyncHandler(store));
    this.registerOverride('POST', '/plaid/transactions/refresh',
      coreOverrides.buildTransactionsRefreshHandler(store));

    // ── Identity ────────────────────────────────────────────────────────
    this.registerOverride('POST', '/plaid/identity/get',
      coreOverrides.buildIdentityGetHandler(store));

    // ── Institutions ────────────────────────────────────────────────────
    this.registerOverride('POST', '/plaid/institutions/get',
      coreOverrides.buildInstitutionsGetHandler(store));
    this.registerOverride('POST', '/plaid/institutions/get_by_id',
      coreOverrides.buildInstitutionsGetByIdHandler(store));
    this.registerOverride('POST', '/plaid/institutions/search',
      coreOverrides.buildInstitutionsSearchHandler(store));

    // ── Investments ─────────────────────────────────────────────────────
    this.registerOverride('POST', '/plaid/investments/holdings/get',
      coreOverrides.buildInvestmentsHoldingsGetHandler(store));
    this.registerOverride('POST', '/plaid/investments/transactions/get',
      coreOverrides.buildInvestmentsTransactionsGetHandler(store));

    // ── Categories ──────────────────────────────────────────────────────
    this.registerOverride('POST', '/plaid/categories/get',
      coreOverrides.buildCategoriesGetHandler());
  }
}
