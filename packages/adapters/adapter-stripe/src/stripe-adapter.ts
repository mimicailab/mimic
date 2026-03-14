import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec, generateId } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { OpenApiMockAdapter, unixNow } from '@mimicai/adapter-sdk';
import type { DefaultFactory } from '@mimicai/adapter-sdk';
import type { StripeConfig } from './config.js';
import { registerStripeTools } from './mcp.js';
import meta from './adapter-meta.js';

// Generated files — do not edit directly; run `pnpm generate` to regenerate
import { stripeResourceSpecs } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';
import type { GeneratedRoute } from './generated/routes.js';

// State-machine overrides
import * as piOverrides from './overrides/payment-intents.js';
import * as siOverrides from './overrides/setup-intents.js';
import * as invOverrides from './overrides/invoices.js';
import * as chOverrides from './overrides/charges.js';
import * as bpOverrides from './overrides/billing-portal.js';
import * as refundOverrides from './overrides/refunds.js';
import * as pmOverrides from './overrides/payment-methods.js';
import * as custOverrides from './overrides/customers.js';
import * as subItemOverrides from './overrides/subscription-items.js';

// ---------------------------------------------------------------------------
// Namespace helper
// ---------------------------------------------------------------------------

/** StateStore namespace key for a Stripe resource type. */
function ns(resource: string): string {
  return `stripe:${resource}`;
}

// ---------------------------------------------------------------------------
// StripeAdapter
// ---------------------------------------------------------------------------

export class StripeAdapter extends OpenApiMockAdapter<StripeConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;

  /** Full resource specs generated from the Stripe OpenAPI spec (1335 schemas → 142 resources, 2262 fields) */
  readonly resourceSpecs = stripeResourceSpecs;

  /** @deprecated Use resourceSpecs. */
  readonly promptContext = derivePromptContext(stripeResourceSpecs);

  /** @deprecated Use resourceSpecs. */
  readonly dataSpec: DataSpec = deriveDataSpec(stripeResourceSpecs);

  protected readonly generatedRoutes: GeneratedRoute[] = GENERATED_ROUTES;
  protected readonly defaultFactories: Record<string, DefaultFactory> = SCHEMA_DEFAULTS;

  // ---------------------------------------------------------------------------
  // Route registration
  // ---------------------------------------------------------------------------

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // ── Register all override handlers before CRUD scaffolding ───────────────
    // Overrides are accumulated first so that registerGeneratedRoutes()
    // skips these routes and lets the override handler take precedence.
    // This includes both state-machine actions (confirm/capture/cancel/pay/etc.)
    // and singleton resources (balance, account) that aren't standard CRUD.
    this.mountOverrides(store);

    // ── Generated CRUD scaffolding (617 routes across v1 + v2 Stripe paths) ───
    await this.registerGeneratedRoutes(server, data, store, ns);
  }

  getEndpoints(): EndpointDefinition[] {
    return this.endpointsFromRoutes();
  }

  resolvePersona(req: FastifyRequest): string | null {
    // Extract persona ID from test-mode API key: sk_test_{personaId}_
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+sk_test_([a-z0-9-]+)_/);
    return match ? match[1]! : null;
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerStripeTools(mcpServer, mockBaseUrl);
  }

  // ---------------------------------------------------------------------------
  // Override registration
  // ---------------------------------------------------------------------------

  /**
   * Register all state-machine and singleton override handlers.
   * Called before `registerGeneratedRoutes()` so the CRUD scaffolding
   * skips these paths and uses the override handlers instead.
   */
  private mountOverrides(store: StateStore): void {
    // ── Payment Intents ───────────────────────────────────────────────────────
    this.registerOverride(
      'POST', '/stripe/v1/payment_intents/:intent/confirm',
      piOverrides.buildConfirmHandler(store),
    );
    this.registerOverride(
      'POST', '/stripe/v1/payment_intents/:intent/capture',
      piOverrides.buildCaptureHandler(store),
    );
    this.registerOverride(
      'POST', '/stripe/v1/payment_intents/:intent/cancel',
      piOverrides.buildCancelHandler(store),
    );

    // ── Setup Intents ─────────────────────────────────────────────────────────
    this.registerOverride(
      'POST', '/stripe/v1/setup_intents/:intent/confirm',
      siOverrides.buildConfirmHandler(store),
    );
    this.registerOverride(
      'POST', '/stripe/v1/setup_intents/:intent/cancel',
      siOverrides.buildCancelHandler(store),
    );

    // ── Invoices ──────────────────────────────────────────────────────────────
    this.registerOverride(
      'POST', '/stripe/v1/invoices/:invoice/finalize',
      invOverrides.buildFinalizeHandler(store),
    );
    this.registerOverride(
      'POST', '/stripe/v1/invoices/:invoice/pay',
      invOverrides.buildPayHandler(store),
    );
    this.registerOverride(
      'POST', '/stripe/v1/invoices/:invoice/void',
      invOverrides.buildVoidHandler(store),
    );
    this.registerOverride(
      'POST', '/stripe/v1/invoices/:invoice/mark_uncollectible',
      invOverrides.buildMarkUncollectibleHandler(store),
    );
    this.registerOverride(
      'POST', '/stripe/v1/invoices/:invoice/send',
      invOverrides.buildSendHandler(store),
    );

    // ── Charges ───────────────────────────────────────────────────────────────
    this.registerOverride(
      'POST', '/stripe/v1/charges/:charge/capture',
      chOverrides.buildCaptureHandler(store),
    );

    // ── Billing Portal ────────────────────────────────────────────────────────
    this.registerOverride(
      'POST', '/stripe/v1/billing_portal/sessions',
      bpOverrides.buildCreateSessionHandler(store),
    );

    // ── Subscriptions — create converts items array to Stripe list format ────────
    this.registerOverride(
      'POST', '/stripe/v1/subscriptions',
      async (req, reply) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const now = unixNow();
        const subId = generateId('sub_', 14);

        // Convert items array → subscription items with proper si_ IDs
        const rawItems = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
        const itemObjects = rawItems.map((item: Record<string, unknown>) => ({
          id: generateId('si_', 14),
          object: 'subscription_item',
          created: now,
          metadata: {},
          price: item.price ?? null,
          quantity: item.quantity ?? 1,
          subscription: subId,
          tax_rates: [],
          billing_thresholds: null,
          discounts: [],
        }));

        const sub: Record<string, unknown> = {
          id: subId,
          object: 'subscription',
          cancel_at_period_end: false,
          collection_method: 'charge_automatically',
          created: now,
          currency: body.currency ?? 'usd',
          customer: body.customer ?? '',
          default_payment_method: body.default_payment_method ?? null,
          description: body.description ?? null,
          discounts: [],
          items: { object: 'list', data: itemObjects, has_more: false, url: '/v1/subscription_items' },
          latest_invoice: null,
          livemode: false,
          metadata: (body.metadata as Record<string, unknown>) ?? {},
          payment_settings: null,
          pending_setup_intent: null,
          pending_update: null,
          schedule: null,
          start_date: now,
          status: 'active',
          trial_end: body.trial_end ?? null,
          trial_start: null,
        };
        store.set(ns('subscriptions'), subId, sub);
        return reply.code(200).send(sub);
      },
    );

    // ── Subscriptions — cancel returns updated object, not deleted stub ────────
    this.registerOverride(
      'DELETE', '/stripe/v1/subscriptions/:subscription_exposed_id',
      async (req, reply) => {
        const { subscription_exposed_id } = (req.params as { subscription_exposed_id: string });
        const sub = store.get<Record<string, unknown>>(ns('subscriptions'), subscription_exposed_id);
        if (!sub) {
          return reply.code(404).send({
            error: { type: 'invalid_request_error', code: 'resource_missing',
              message: `No such subscription: '${subscription_exposed_id}'`, param: null },
          });
        }
        const canceled = { ...sub, status: 'canceled', canceled_at: Math.floor(Date.now() / 1000) };
        store.set(ns('subscriptions'), subscription_exposed_id, canceled);
        return reply.code(200).send(canceled);
      },
    );

    // ── Refunds — sync charge.amount_refunded on create/cancel ───────────────
    this.registerOverride(
      'POST', '/stripe/v1/refunds',
      refundOverrides.buildCreateHandler(store),
    );
    this.registerOverride(
      'POST', '/stripe/v1/refunds/:refund/cancel',
      refundOverrides.buildCancelHandler(store),
    );

    // ── Payment Methods — attach/detach mutate existing PM, not create new ────
    this.registerOverride(
      'POST', '/stripe/v1/payment_methods/:payment_method/attach',
      pmOverrides.buildAttachHandler(store),
    );
    this.registerOverride(
      'POST', '/stripe/v1/payment_methods/:payment_method/detach',
      pmOverrides.buildDetachHandler(store),
    );

    // ── Customers — cascade-cancel subscriptions on delete ───────────────────
    this.registerOverride(
      'DELETE', '/stripe/v1/customers/:customer',
      custOverrides.buildDeleteHandler(store),
    );

    // ── Invoices — only draft invoices can be deleted ─────────────────────────
    this.registerOverride(
      'DELETE', '/stripe/v1/invoices/:invoice',
      invOverrides.buildDeleteHandler(store),
    );

    // ── Subscription Items — keep parent subscription.items in sync ───────────
    this.registerOverride(
      'POST', '/stripe/v1/subscription_items',
      subItemOverrides.buildCreateHandler(store),
    );
    this.registerOverride(
      'DELETE', '/stripe/v1/subscription_items/:item',
      subItemOverrides.buildDeleteHandler(store),
    );

    // ── Balance — computed from store charges/refunds ─────────────────────────
    this.registerOverride(
      'GET', '/stripe/v1/balance',
      async (_req, reply) => {
        const charges = store.list<Record<string, unknown>>(ns('charges'));
        const refunds = store.list<Record<string, unknown>>(ns('refunds'));
        const collected = charges
          .filter(c => c.status === 'succeeded' && c.captured)
          .reduce((sum, c) => sum + ((c.amount_captured as number) ?? (c.amount as number) ?? 0), 0);
        const refunded = refunds
          .filter(r => r.status === 'succeeded')
          .reduce((sum, r) => sum + ((r.amount as number) ?? 0), 0);
        const available = Math.max(0, collected - refunded);
        return reply.code(200).send({
          object: 'balance',
          available: [{ amount: available, currency: 'usd', source_types: { card: available } }],
          connect_reserved: [],
          instant_available: [],
          issuing: { available: [] },
          livemode: false,
          pending: [{ amount: 0, currency: 'usd', source_types: { card: 0 } }],
        });
      },
    );

    // ── Account — return first seeded account or domain-derived default ────────
    this.registerOverride(
      'GET', '/stripe/v1/account',
      async (_req, reply) => {
        const accounts = store.list<Record<string, unknown>>(ns('accounts'));
        if (accounts.length > 0) {
          return reply.code(200).send(accounts[0]);
        }

        // Build a realistic account from the domain/persona config
        const domain = this.context?.config?.domain ?? '';
        const companyName = extractCompanyName(domain) || 'Acme Inc';
        const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const sixMonthsAgo = unixNow() - 180 * 86400;

        return reply.code(200).send({
          id: generateId('acct_', 16),
          object: 'account',
          business_profile: {
            mcc: '5734',
            name: companyName,
            product_description: domain.split('.')[0] || null,
            support_email: `billing@${slug}.com`,
            support_phone: null,
            support_url: `https://${slug}.com/support`,
            url: `https://${slug}.com`,
          },
          business_type: 'company',
          capabilities: {
            card_payments: 'active',
            transfers: 'active',
          },
          charges_enabled: true,
          country: 'US',
          created: sixMonthsAgo,
          default_currency: 'usd',
          details_submitted: true,
          email: `billing@${slug}.com`,
          livemode: false,
          metadata: {},
          payouts_enabled: true,
          settings: {
            branding: { icon: null, logo: null, primary_color: null, secondary_color: null },
            dashboard: { display_name: companyName, timezone: 'America/Los_Angeles' },
            payments: { statement_descriptor: slug.toUpperCase().slice(0, 22) },
          },
          type: 'standard',
        });
      },
    );
  }
}

/**
 * Extract a company name from the domain description string.
 * Looks for parenthesized names like "(NovaDev)" or capitalized multi-word
 * phrases that look like company names.
 */
function extractCompanyName(domain: string): string {
  const parenMatch = domain.match(/\(([A-Z][A-Za-z0-9 &.-]+)\)/);
  if (parenMatch) return parenMatch[1]!;

  const nameMatch = domain.match(/(?:called|named|company)\s+([A-Z][A-Za-z0-9 &.-]+?)(?:\s+(?:that|which|is|—|-|,|\.))/i);
  if (nameMatch) return nameMatch[1]!;

  return '';
}
