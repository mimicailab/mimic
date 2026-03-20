import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec, generateId } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { OpenApiMockAdapter } from '@mimicai/adapter-sdk';
import type { DefaultFactory, NotFoundError } from '@mimicai/adapter-sdk';
import type { GeneratedRoute } from '@mimicai/adapter-sdk';
import type { ZuoraConfig } from './config.js';
import { registerZuoraTools } from './mcp.js';
import { notFound } from './zuora-errors.js';
import meta from './adapter-meta.js';

// Generated files
import { zuoraResourceSpecs } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS, defaultAccount, defaultSubscription, defaultOrder, defaultProduct, defaultProductRatePlan, defaultInvoice, defaultPayment, defaultPaymentMethod, defaultCreditMemo, defaultDebitMemo, defaultUsage, defaultContact } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';

// Overrides
import * as subOverrides from './overrides/subscriptions.js';
import * as acctOverrides from './overrides/accounts.js';
import * as opsOverrides from './overrides/operations.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ns(resource: string): string {
  return `zuora:${resource}`;
}

function zuoraId(): string {
  return generateId('', 32);
}

function isoNow(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// ZuoraAdapter
// ---------------------------------------------------------------------------

export class ZuoraAdapter extends OpenApiMockAdapter<ZuoraConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;

  readonly resourceSpecs = zuoraResourceSpecs;

  /** @deprecated Use resourceSpecs. */
  readonly promptContext = derivePromptContext(zuoraResourceSpecs);

  /** @deprecated Use resourceSpecs. */
  readonly dataSpec: DataSpec = deriveDataSpec(zuoraResourceSpecs);

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
    // ── Zuora success wrapper: { success: true, ...response } ──
    server.addHook('preSerialization', async (_req, _reply, payload) => {
      if (!payload || typeof payload !== 'object') return payload;
      const p = payload as Record<string, unknown>;

      // Already has success flag (error or pre-wrapped)
      if ('success' in p) return payload;

      // Error from notFoundError (cast shape) or base class 501
      if ('error' in p && typeof p.error === 'object') return payload;

      return { success: true, ...p };
    });

    // Register overrides before CRUD scaffolding
    this.mountOverrides(server, store);

    // Generated CRUD scaffolding
    await this.registerGeneratedRoutes(server, data, store, ns);
  }

  getEndpoints(): EndpointDefinition[] {
    return this.endpointsFromRoutes();
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+test_([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerZuoraTools(mcpServer, mockBaseUrl);
  }

  // ---------------------------------------------------------------------------
  // Zuora response formatting
  // ---------------------------------------------------------------------------

  /** Zuora page-based list: { data, nextPage } (hook adds success) */
  protected override wrapList(
    data: unknown[],
    _route: GeneratedRoute,
    hasMore: boolean,
    query: Record<string, string>,
  ): unknown {
    const page = query.page ? parseInt(query.page, 10) : 1;
    const result: Record<string, unknown> = { data };
    result.nextPage = hasMore ? page + 1 : null;
    return result;
  }

  /** Zuora uses page-based pagination (pageSize + page) */
  protected override paginate(
    items: Record<string, unknown>[],
    query: Record<string, string>,
  ): { data: Record<string, unknown>[]; hasMore: boolean } {
    const pageSize = Math.min(parseInt(query.pageSize ?? '20', 10) || 20, 100);
    const page = Math.max(parseInt(query.page ?? '1', 10) || 1, 1);
    const offset = (page - 1) * pageSize;
    const data = items.slice(offset, offset + pageSize);
    return { data, hasMore: offset + pageSize < items.length };
  }

  /** Zuora delete: hook adds { success: true } */
  protected override deleteResponse(_id: string, _route: GeneratedRoute): unknown {
    return {};
  }

  /** Zuora 404 format: { success: false, reasons: [...] } */
  protected override notFoundError(resource: string, id: string): NotFoundError {
    return notFound(resource, id);
  }

  /** Zuora update: shallow merge + updatedDate */
  protected override mergeUpdate(
    existing: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    return { ...existing, ...body, updatedDate: isoNow() };
  }

  // ---------------------------------------------------------------------------
  // Override registration
  // ---------------------------------------------------------------------------

  private mountOverrides(server: FastifyInstance, store: StateStore): void {
    const BP = '/v1';

    // ── Accounts ──────────────────────────────────────────────────────
    this.registerOverride('POST', `${BP}/accounts`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = zuoraId();
      const account = defaultAccount({ id, ...body });
      store.set(ns('accounts'), account.id as string, account);
      return reply.code(201).send({ id: account.id, accountNumber: account.accountNumber });
    });

    this.registerOverride('GET', `${BP}/accounts/:accountKey`,
      acctOverrides.buildGetAccountHandler(store));

    this.registerOverride('PUT', `${BP}/accounts/:accountKey`, async (req, reply) => {
      const { accountKey } = req.params as { accountKey: string };
      const existing = store.get<Record<string, unknown>>(ns('accounts'), accountKey);
      if (!existing) return reply.code(404).send(notFound('Account', accountKey));
      const body = (req.body ?? {}) as Record<string, unknown>;
      store.set(ns('accounts'), accountKey, { ...existing, ...body, updatedDate: isoNow() });
      return reply.code(200).send({ id: accountKey });
    });

    this.registerOverride('GET', `${BP}/accounts/:accountKey/summary`,
      acctOverrides.buildSummaryHandler(store));

    // ── Subscriptions ─────────────────────────────────────────────────
    this.registerOverride('POST', `${BP}/subscriptions`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = zuoraId();
      const sub = defaultSubscription({
        id,
        accountId: body.accountId ?? body.accountKey ?? null,
        ...body,
      });
      store.set(ns('subscriptions'), sub.id as string, sub);
      return reply.code(201).send({ subscriptionId: sub.id, subscriptionNumber: sub.subscriptionNumber });
    });

    this.registerOverride('PUT', `${BP}/subscriptions/:subscriptionKey`, async (req, reply) => {
      const { subscriptionKey } = req.params as { subscriptionKey: string };
      const existing = store.get<Record<string, unknown>>(ns('subscriptions'), subscriptionKey);
      if (!existing) return reply.code(404).send(notFound('Subscription', subscriptionKey));
      const body = (req.body ?? {}) as Record<string, unknown>;
      store.set(ns('subscriptions'), subscriptionKey, { ...existing, ...body, updatedDate: isoNow() });
      return reply.code(200).send({ subscriptionId: subscriptionKey });
    });

    this.registerOverride('PUT', `${BP}/subscriptions/:subscriptionKey/cancel`,
      subOverrides.buildCancelHandler(store));
    this.registerOverride('PUT', `${BP}/subscriptions/:subscriptionKey/renew`,
      subOverrides.buildRenewHandler(store));
    this.registerOverride('PUT', `${BP}/subscriptions/:subscriptionKey/suspend`,
      subOverrides.buildSuspendHandler(store));
    this.registerOverride('PUT', `${BP}/subscriptions/:subscriptionKey/resume`,
      subOverrides.buildResumeHandler(store));
    this.registerOverride('GET', `${BP}/subscriptions/accounts/:accountKey`,
      subOverrides.buildListByAccountHandler(store));

    // ── Orders ────────────────────────────────────────────────────────
    this.registerOverride('POST', `${BP}/orders`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = zuoraId();
      const order = defaultOrder({
        id,
        accountId: body.existingAccountNumber ?? body.accountId ?? null,
        ...body,
      });
      store.set(ns('orders'), order.orderNumber as string, order);
      return reply.code(201).send({ orderNumber: order.orderNumber });
    });

    this.registerOverride('GET', `${BP}/orders/:orderNumber`, async (req, reply) => {
      const { orderNumber } = req.params as { orderNumber: string };
      const order = store.get(ns('orders'), orderNumber);
      if (!order) return reply.code(404).send(notFound('Order', orderNumber));
      return reply.code(200).send({ order: order as Record<string, unknown> });
    });

    this.registerOverride('DELETE', `${BP}/orders/:orderNumber`, async (req, reply) => {
      const { orderNumber } = req.params as { orderNumber: string };
      const existing = store.get(ns('orders'), orderNumber);
      if (!existing) return reply.code(404).send(notFound('Order', orderNumber));
      store.delete(ns('orders'), orderNumber);
      return reply.code(200).send({});
    });

    this.registerOverride('GET', `${BP}/orders/subscription/:subscriptionNumber`,
      opsOverrides.buildOrdersBySubscriptionHandler(store));

    // ── Products (Catalog + Object) ───────────────────────────────────
    this.registerOverride('POST', `${BP}/object/product`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = zuoraId();
      const product = defaultProduct({ id, ...body });
      store.set(ns('products'), product.id as string, product);
      return reply.code(201).send({ Id: product.id });
    });

    this.registerOverride('PUT', `${BP}/object/product/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(ns('products'), id);
      if (!existing) return reply.code(404).send(notFound('Product', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      store.set(ns('products'), id, { ...existing, ...body, updatedDate: isoNow() });
      return reply.code(200).send({ Id: id });
    });

    // ── Product Rate Plans ────────────────────────────────────────────
    this.registerOverride('GET', `${BP}/products/:productKey/product-rate-plans`,
      opsOverrides.buildRatePlansByProductHandler(store));

    this.registerOverride('POST', `${BP}/object/product-rate-plan`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = zuoraId();
      const plan = defaultProductRatePlan({ id, ...body });
      store.set(ns('product-rate-plans'), plan.id as string, plan);
      return reply.code(201).send({ Id: plan.id });
    });

    this.registerOverride('PUT', `${BP}/object/product-rate-plan/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(ns('product-rate-plans'), id);
      if (!existing) return reply.code(404).send(notFound('Product rate plan', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      store.set(ns('product-rate-plans'), id, { ...existing, ...body, updatedDate: isoNow() });
      return reply.code(200).send({ Id: id });
    });

    // ── Invoices ──────────────────────────────────────────────────────
    this.registerOverride('POST', `${BP}/invoices`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = zuoraId();
      const invoice = defaultInvoice({
        id,
        balance: body.balance ?? body.amount ?? 0,
        ...body,
      });
      store.set(ns('invoices'), invoice.id as string, invoice);
      return reply.code(201).send({ id: invoice.id, invoiceNumber: invoice.invoiceNumber });
    });

    this.registerOverride('PUT', `${BP}/invoices/:invoiceKey`, async (req, reply) => {
      const { invoiceKey } = req.params as { invoiceKey: string };
      const existing = store.get<Record<string, unknown>>(ns('invoices'), invoiceKey);
      if (!existing) return reply.code(404).send(notFound('Invoice', invoiceKey));
      const body = (req.body ?? {}) as Record<string, unknown>;
      store.set(ns('invoices'), invoiceKey, { ...existing, ...body, updatedDate: isoNow() });
      return reply.code(200).send({ id: invoiceKey });
    });

    this.registerOverride('POST', `${BP}/operations/invoice-collect`,
      opsOverrides.buildInvoiceCollectHandler(store));

    // ── Payments ──────────────────────────────────────────────────────
    this.registerOverride('POST', `${BP}/payments`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = zuoraId();
      const payment = defaultPayment({ id, ...body });
      store.set(ns('payments'), payment.id as string, payment);
      return reply.code(201).send({ id: payment.id, paymentNumber: payment.paymentNumber });
    });

    this.registerOverride('PUT', `${BP}/payments/:paymentKey`, async (req, reply) => {
      const { paymentKey } = req.params as { paymentKey: string };
      const existing = store.get<Record<string, unknown>>(ns('payments'), paymentKey);
      if (!existing) return reply.code(404).send(notFound('Payment', paymentKey));
      const body = (req.body ?? {}) as Record<string, unknown>;
      store.set(ns('payments'), paymentKey, { ...existing, ...body, updatedDate: isoNow() });
      return reply.code(200).send({ id: paymentKey });
    });

    // ── Payment Methods ───────────────────────────────────────────────
    this.registerOverride('POST', `${BP}/payment-methods`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = zuoraId();
      const pm = defaultPaymentMethod({ id, ...body });
      store.set(ns('payment-methods'), pm.id as string, pm);
      return reply.code(201).send({ id: pm.id });
    });

    this.registerOverride('PUT', `${BP}/payment-methods/:paymentMethodId`, async (req, reply) => {
      const { paymentMethodId } = req.params as { paymentMethodId: string };
      const existing = store.get<Record<string, unknown>>(ns('payment-methods'), paymentMethodId);
      if (!existing) return reply.code(404).send(notFound('Payment method', paymentMethodId));
      const body = (req.body ?? {}) as Record<string, unknown>;
      store.set(ns('payment-methods'), paymentMethodId, { ...existing, ...body, updatedDate: isoNow() });
      return reply.code(200).send({ id: paymentMethodId });
    });

    this.registerOverride('DELETE', `${BP}/payment-methods/:paymentMethodId`, async (req, reply) => {
      const { paymentMethodId } = req.params as { paymentMethodId: string };
      const existing = store.get(ns('payment-methods'), paymentMethodId);
      if (!existing) return reply.code(404).send(notFound('Payment method', paymentMethodId));
      store.delete(ns('payment-methods'), paymentMethodId);
      return reply.code(200).send({});
    });

    // ── Credit Memos ──────────────────────────────────────────────────
    this.registerOverride('POST', `${BP}/credit-memos`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = zuoraId();
      const memo = defaultCreditMemo({ id, ...body });
      store.set(ns('credit-memos'), memo.id as string, memo);
      return reply.code(201).send({ id: memo.id, memoNumber: memo.memoNumber });
    });

    this.registerOverride('PUT', `${BP}/credit-memos/:creditMemoKey`, async (req, reply) => {
      const { creditMemoKey } = req.params as { creditMemoKey: string };
      const existing = store.get<Record<string, unknown>>(ns('credit-memos'), creditMemoKey);
      if (!existing) return reply.code(404).send(notFound('Credit memo', creditMemoKey));
      const body = (req.body ?? {}) as Record<string, unknown>;
      store.set(ns('credit-memos'), creditMemoKey, { ...existing, ...body, updatedDate: isoNow() });
      return reply.code(200).send({ id: creditMemoKey });
    });

    this.registerOverride('PUT', `${BP}/credit-memos/:creditMemoKey/apply`,
      opsOverrides.buildApplyCreditMemoHandler(store));

    this.registerOverride('POST', `${BP}/credit-memos/invoice/:invoiceKey`,
      opsOverrides.buildCreditMemoFromInvoiceHandler(store));

    // ── Debit Memos ───────────────────────────────────────────────────
    this.registerOverride('POST', `${BP}/debit-memos`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = zuoraId();
      const memo = defaultDebitMemo({ id, ...body });
      store.set(ns('debit-memos'), memo.id as string, memo);
      return reply.code(201).send({ id: memo.id, memoNumber: memo.memoNumber });
    });

    this.registerOverride('PUT', `${BP}/debit-memos/:debitMemoKey`, async (req, reply) => {
      const { debitMemoKey } = req.params as { debitMemoKey: string };
      const existing = store.get<Record<string, unknown>>(ns('debit-memos'), debitMemoKey);
      if (!existing) return reply.code(404).send(notFound('Debit memo', debitMemoKey));
      const body = (req.body ?? {}) as Record<string, unknown>;
      store.set(ns('debit-memos'), debitMemoKey, { ...existing, ...body, updatedDate: isoNow() });
      return reply.code(200).send({ id: debitMemoKey });
    });

    // ── Usage ─────────────────────────────────────────────────────────
    this.registerOverride('POST', `${BP}/usage`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = zuoraId();
      const usage = defaultUsage({
        id,
        accountId: body.accountId ?? body.AccountId ?? null,
        subscriptionId: body.subscriptionId ?? body.SubscriptionId ?? null,
        chargeId: body.chargeId ?? body.ChargeId ?? null,
        quantity: body.quantity ?? body.Quantity ?? 0,
        startDateTime: body.startDateTime ?? body.StartDateTime ?? isoNow(),
        unitOfMeasure: body.unitOfMeasure ?? body.UnitOfMeasure ?? null,
        description: body.description ?? body.Description ?? null,
        ...body,
      });
      store.set(ns('usage'), usage.id as string, usage);
      return reply.code(201).send({ id: usage.id });
    });

    // ── Manual list routes (not in Zuora OpenAPI spec) ──────────────
    // Usage by account
    server.route({
      method: 'GET',
      url: `${BP}/usage/accounts/:accountKey`,
      handler: opsOverrides.buildUsageByAccountHandler(store),
    });

    // Invoice list (Zuora uses ZOQL, but we provide a convenience list)
    server.route({
      method: 'GET',
      url: `${BP}/invoices`,
      handler: async (req, reply) => {
        const query = (req.query ?? {}) as Record<string, string>;
        const items = store.list<Record<string, unknown>>(ns('invoices'));
        const { data, hasMore } = this.paginate(items, query);
        return reply.send(this.wrapList(data, {} as GeneratedRoute, hasMore, query));
      },
    });

    // Payment methods list
    server.route({
      method: 'GET',
      url: `${BP}/payment-methods`,
      handler: async (req, reply) => {
        const query = (req.query ?? {}) as Record<string, string>;
        const items = store.list<Record<string, unknown>>(ns('payment-methods'));
        const { data, hasMore } = this.paginate(items, query);
        return reply.send(this.wrapList(data, {} as GeneratedRoute, hasMore, query));
      },
    });

    // ── Contacts ──────────────────────────────────────────────────────
    // Contacts use /contacts/:contactId paths (REST API). The factory
    // produces camelCase fields (id, firstName, lastName, workEmail, etc.)
    this.registerOverride('POST', `${BP}/contacts`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = zuoraId();
      const contact = defaultContact({ id, ...body });
      store.set(ns('contacts'), contact.id as string, contact);
      return reply.code(201).send({ id: contact.id });
    });

    this.registerOverride('PUT', `${BP}/contacts/:contactId`, async (req, reply) => {
      const { contactId } = req.params as { contactId: string };
      const existing = store.get<Record<string, unknown>>(ns('contacts'), contactId);
      if (!existing) return reply.code(404).send(notFound('Contact', contactId));
      const body = (req.body ?? {}) as Record<string, unknown>;
      store.set(ns('contacts'), contactId, { ...existing, ...body, updatedDate: isoNow() });
      return reply.code(200).send({ id: contactId });
    });
  }
}
