import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, DataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId, unixNow } from '@mimicai/adapter-sdk';
import type { ZuoraConfig } from './config.js';
import { notFound } from './zuora-errors.js';
import { registerZuoraTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  accounts: 'zuora_accounts',
  subscriptions: 'zuora_subscriptions',
  orders: 'zuora_orders',
  products: 'zuora_products',
  ratePlans: 'zuora_rate_plans',
  invoices: 'zuora_invoices',
  payments: 'zuora_payments',
  paymentMethods: 'zuora_payment_methods',
  creditMemos: 'zuora_credit_memos',
  debitMemos: 'zuora_debit_memos',
  usageRecords: 'zuora_usage',
  contacts: 'zuora_contacts',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BP = '/zuora/v1';

function zuoraId(): string {
  return generateId('', 32);
}

function isoNow(): string {
  return new Date().toISOString();
}

/** Zuora success wrapper */
function success(data: unknown) {
  return { success: true, ...data as Record<string, unknown> };
}

/** Zuora list pagination */
function paginateList<T>(items: T[], pageSize: number, page: number) {
  const offset = (page - 1) * pageSize;
  const data = items.slice(offset, offset + pageSize);
  return {
    success: true,
    data,
    nextPage: offset + pageSize < items.length ? page + 1 : null,
  };
}

// ---------------------------------------------------------------------------
// Zuora Adapter
// ---------------------------------------------------------------------------

export class ZuoraAdapter extends BaseApiMockAdapter<ZuoraConfig> {
  readonly id = 'zuora';
  readonly name = 'Zuora API';
  readonly basePath = '/zuora/v1';
  readonly versions = ['v1'];

  readonly promptContext = {
    resources: ['accounts', 'subscriptions', 'rate_plans', 'invoices', 'payments', 'product_catalog', 'usage'],
    amountFormat: 'decimal float (e.g. 29.99)',
    relationships: [
      'subscription → account, rate_plan',
      'invoice → account, subscription',
      'payment → account, invoice',
      'rate_plan → product_catalog',
    ],
    requiredFields: {
      accounts: ['id', 'name', 'accountNumber', 'status', 'currency', 'billToContact', 'createdDate'],
      subscriptions: ['id', 'accountId', 'subscriptionNumber', 'status', 'termType', 'contractEffectiveDate', 'serviceActivationDate', 'createdDate'],
      invoices: ['id', 'accountId', 'invoiceNumber', 'status', 'amount', 'balance', 'invoiceDate', 'dueDate'],
      payments: ['id', 'accountId', 'amount', 'status', 'type', 'effectiveDate', 'createdDate'],
    },
    notes: 'Enterprise billing platform. Amounts are decimal floats. Timestamps are ISO 8601 date strings (YYYY-MM-DD). Subscription status: Draft, PendingActivation, Active, Suspended, Cancelled, Expired. Uses camelCase field names.',
  };

  readonly dataSpec: DataSpec = {
    timestampFormat: 'iso8601',
    amountFields: ['amount', 'balance', 'total', 'price'],
    statusEnums: {
      subscriptions: ['Draft', 'PendingActivation', 'Active', 'Suspended', 'Cancelled', 'Expired'],
      accounts: ['Draft', 'Active', 'Canceled'],
      invoices: ['Draft', 'Posted', 'Paid', 'Canceled', 'Error'],
      payments: ['Draft', 'Processing', 'Processed', 'Error', 'Voided'],
    },
    timestampFields: ['createdDate', 'updatedDate', 'contractEffectiveDate', 'serviceActivationDate', 'invoiceDate', 'dueDate', 'effectiveDate'],
  };

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerZuoraTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    // Zuora uses Bearer OAuth2 tokens
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+test_([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    this.seedFromApiResponses(data, store);

    // ── Accounts ──────────────────────────────────────────────────────

    server.post(`${BP}/accounts`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const id = zuoraId();
      const account = {
        id,
        accountNumber: body.accountNumber ?? `A-${id.slice(0, 8)}`,
        name: body.name ?? '',
        status: 'Active',
        currency: body.currency ?? 'USD',
        billCycleDay: body.billCycleDay ?? 1,
        paymentTerm: body.paymentTerm ?? 'Due Upon Receipt',
        billToContact: body.billToContact ?? null,
        soldToContact: body.soldToContact ?? null,
        createdDate: now,
        updatedDate: now,
        ...body,
      };
      store.set(NS.accounts, account.id, account);
      return reply.code(201).send(success({ id: account.id, accountNumber: account.accountNumber }));
    });

    server.get(`${BP}/accounts/:key`, async (req, reply) => {
      const { key } = req.params as { key: string };
      const account = store.get(NS.accounts, key);
      if (!account) return reply.code(404).send(notFound('Account', key));
      return reply.code(200).send(success({ basicInfo: account }));
    });

    server.put(`${BP}/accounts/:key`, async (req, reply) => {
      const { key } = req.params as { key: string };
      const existing = store.get<Record<string, unknown>>(NS.accounts, key);
      if (!existing) return reply.code(404).send(notFound('Account', key));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updatedDate: isoNow() };
      store.set(NS.accounts, key, updated);
      return reply.code(200).send(success({ id: key }));
    });

    server.get(`${BP}/accounts/:key/summary`, async (req, reply) => {
      const { key } = req.params as { key: string };
      const account = store.get<Record<string, unknown>>(NS.accounts, key);
      if (!account) return reply.code(404).send(notFound('Account', key));
      const subs = store.filter<Record<string, unknown>>(NS.subscriptions, (s) => s.accountId === key);
      const invoices = store.filter<Record<string, unknown>>(NS.invoices, (i) => i.accountId === key);
      const payments = store.filter<Record<string, unknown>>(NS.payments, (p) => p.accountId === key);
      return reply.code(200).send(success({
        basicInfo: account,
        subscriptions: subs,
        invoices,
        payments,
      }));
    });

    // ── Subscriptions ─────────────────────────────────────────────────

    server.post(`${BP}/subscriptions`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const id = zuoraId();
      const sub = {
        id,
        subscriptionNumber: body.subscriptionNumber ?? `S-${id.slice(0, 8)}`,
        accountId: body.accountId ?? body.accountKey ?? null,
        status: 'Active',
        termType: body.termType ?? 'TERMED',
        contractEffectiveDate: body.contractEffectiveDate ?? now.split('T')[0],
        serviceActivationDate: body.serviceActivationDate ?? now.split('T')[0],
        termStartDate: body.termStartDate ?? now.split('T')[0],
        termEndDate: body.termEndDate ?? null,
        currentTerm: body.currentTerm ?? 12,
        currentTermPeriodType: body.currentTermPeriodType ?? 'Month',
        renewalTerm: body.renewalTerm ?? 12,
        autoRenew: body.autoRenew ?? true,
        ratePlans: body.ratePlans ?? [],
        createdDate: now,
        updatedDate: now,
        ...body,
      };
      store.set(NS.subscriptions, sub.id, sub);
      return reply.code(201).send(success({ subscriptionId: sub.id, subscriptionNumber: sub.subscriptionNumber }));
    });

    server.get(`${BP}/subscriptions/:key`, async (req, reply) => {
      const { key } = req.params as { key: string };
      const sub = store.get(NS.subscriptions, key);
      if (!sub) return reply.code(404).send(notFound('Subscription', key));
      return reply.code(200).send(success(sub as Record<string, unknown>));
    });

    server.put(`${BP}/subscriptions/:key`, async (req, reply) => {
      const { key } = req.params as { key: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, key);
      if (!existing) return reply.code(404).send(notFound('Subscription', key));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updatedDate: isoNow() };
      store.set(NS.subscriptions, key, updated);
      return reply.code(200).send(success({ subscriptionId: key }));
    });

    server.put(`${BP}/subscriptions/:key/cancel`, async (req, reply) => {
      const { key } = req.params as { key: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, key);
      if (!existing) return reply.code(404).send(notFound('Subscription', key));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = {
        ...existing,
        ...body,
        status: 'Cancelled',
        cancelledDate: isoNow(),
        updatedDate: isoNow(),
      };
      store.set(NS.subscriptions, key, updated);
      return reply.code(200).send(success({ subscriptionId: key }));
    });

    server.put(`${BP}/subscriptions/:key/renew`, async (req, reply) => {
      const { key } = req.params as { key: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, key);
      if (!existing) return reply.code(404).send(notFound('Subscription', key));
      const updated = {
        ...existing,
        status: 'Active',
        updatedDate: isoNow(),
      };
      store.set(NS.subscriptions, key, updated);
      return reply.code(200).send(success({ subscriptionId: key }));
    });

    server.put(`${BP}/subscriptions/:key/suspend`, async (req, reply) => {
      const { key } = req.params as { key: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, key);
      if (!existing) return reply.code(404).send(notFound('Subscription', key));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = {
        ...existing,
        ...body,
        status: 'Suspended',
        suspendedDate: isoNow(),
        updatedDate: isoNow(),
      };
      store.set(NS.subscriptions, key, updated);
      return reply.code(200).send(success({ subscriptionId: key }));
    });

    server.put(`${BP}/subscriptions/:key/resume`, async (req, reply) => {
      const { key } = req.params as { key: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, key);
      if (!existing) return reply.code(404).send(notFound('Subscription', key));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = {
        ...existing,
        ...body,
        status: 'Active',
        suspendedDate: null,
        updatedDate: isoNow(),
      };
      store.set(NS.subscriptions, key, updated);
      return reply.code(200).send(success({ subscriptionId: key }));
    });

    server.get(`${BP}/subscriptions/accounts/:key`, async (req, reply) => {
      const { key } = req.params as { key: string };
      const query = req.query as Record<string, string>;
      let subs = store.filter<Record<string, unknown>>(NS.subscriptions, (s) => s.accountId === key);
      if (query.status) subs = subs.filter((s) => s.status === query.status);
      const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
      const page = query.page ? parseInt(query.page, 10) : 1;
      return reply.code(200).send(paginateList(subs, pageSize, page));
    });

    // ── Orders ────────────────────────────────────────────────────────

    server.post(`${BP}/orders`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const id = zuoraId();
      const order = {
        id,
        orderNumber: body.orderNumber ?? `O-${id.slice(0, 8)}`,
        accountId: body.existingAccountNumber ?? body.accountId ?? null,
        status: 'Completed',
        orderDate: body.orderDate ?? now.split('T')[0],
        description: body.description ?? null,
        subscriptions: body.subscriptions ?? [],
        createdDate: now,
        updatedDate: now,
        ...body,
      };
      store.set(NS.orders, order.orderNumber as string, order);
      return reply.code(201).send(success({ orderNumber: order.orderNumber }));
    });

    server.get(`${BP}/orders`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let orders = store.list<Record<string, unknown>>(NS.orders);
      if (query.accountId) orders = orders.filter((o) => o.accountId === query.accountId);
      const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
      const page = query.page ? parseInt(query.page, 10) : 1;
      return reply.code(200).send(paginateList(orders, pageSize, page));
    });

    server.get(`${BP}/orders/:number`, async (req, reply) => {
      const { number } = req.params as { number: string };
      const order = store.get(NS.orders, number);
      if (!order) return reply.code(404).send(notFound('Order', number));
      return reply.code(200).send(success({ order: order as Record<string, unknown> }));
    });

    server.delete(`${BP}/orders/:number`, async (req, reply) => {
      const { number } = req.params as { number: string };
      const existing = store.get(NS.orders, number);
      if (!existing) return reply.code(404).send(notFound('Order', number));
      store.delete(NS.orders, number);
      return reply.code(200).send(success({}));
    });

    server.get(`${BP}/orders/subscription/:number`, async (req, reply) => {
      const { number } = req.params as { number: string };
      const query = req.query as Record<string, string>;
      let orders = store.list<Record<string, unknown>>(NS.orders);
      orders = orders.filter((o) => {
        const subs = o.subscriptions as Record<string, unknown>[] | undefined;
        return subs?.some((s) => s.subscriptionNumber === number);
      });
      const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
      const page = query.page ? parseInt(query.page, 10) : 1;
      return reply.code(200).send(paginateList(orders, pageSize, page));
    });

    // ── Products (Catalog) ────────────────────────────────────────────

    server.get(`${BP}/catalog/products`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      const products = store.list<Record<string, unknown>>(NS.products);
      const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
      const page = query.page ? parseInt(query.page, 10) : 1;
      return reply.code(200).send(paginateList(products, pageSize, page));
    });

    server.get(`${BP}/catalog/product/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const product = store.get(NS.products, id);
      if (!product) return reply.code(404).send(notFound('Product', id));
      return reply.code(200).send(success(product as Record<string, unknown>));
    });

    server.post(`${BP}/object/product`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const id = zuoraId();
      const product = {
        Id: id,
        Name: body.Name ?? '',
        SKU: body.SKU ?? `SKU-${id.slice(0, 8)}`,
        Description: body.Description ?? null,
        EffectiveStartDate: body.EffectiveStartDate ?? now.split('T')[0],
        EffectiveEndDate: body.EffectiveEndDate ?? '2099-12-31',
        CreatedDate: now,
        UpdatedDate: now,
        ...body,
      };
      store.set(NS.products, product.Id, product);
      return reply.code(201).send(success({ Id: product.Id }));
    });

    server.put(`${BP}/object/product/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.products, id);
      if (!existing) return reply.code(404).send(notFound('Product', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, UpdatedDate: isoNow() };
      store.set(NS.products, id, updated);
      return reply.code(200).send(success({ Id: id }));
    });

    // ── Product Rate Plans ────────────────────────────────────────────

    server.get(`${BP}/rateplan/:productId/productRatePlans`, async (req, reply) => {
      const { productId } = req.params as { productId: string };
      const query = req.query as Record<string, string>;
      let plans = store.filter<Record<string, unknown>>(NS.ratePlans, (p) => p.ProductId === productId);
      const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
      const page = query.page ? parseInt(query.page, 10) : 1;
      return reply.code(200).send(paginateList(plans, pageSize, page));
    });

    server.post(`${BP}/object/product-rate-plan`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const id = zuoraId();
      const ratePlan = {
        Id: id,
        ProductId: body.ProductId ?? null,
        Name: body.Name ?? '',
        Description: body.Description ?? null,
        EffectiveStartDate: body.EffectiveStartDate ?? now.split('T')[0],
        EffectiveEndDate: body.EffectiveEndDate ?? '2099-12-31',
        CreatedDate: now,
        UpdatedDate: now,
        ...body,
      };
      store.set(NS.ratePlans, ratePlan.Id, ratePlan);
      return reply.code(201).send(success({ Id: ratePlan.Id }));
    });

    server.get(`${BP}/object/product-rate-plan/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const plan = store.get(NS.ratePlans, id);
      if (!plan) return reply.code(404).send(notFound('Product rate plan', id));
      return reply.code(200).send(success(plan as Record<string, unknown>));
    });

    server.put(`${BP}/object/product-rate-plan/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.ratePlans, id);
      if (!existing) return reply.code(404).send(notFound('Product rate plan', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, UpdatedDate: isoNow() };
      store.set(NS.ratePlans, id, updated);
      return reply.code(200).send(success({ Id: id }));
    });

    // ── Invoices ──────────────────────────────────────────────────────

    server.post(`${BP}/invoices`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const id = zuoraId();
      const invoice = {
        id,
        invoiceNumber: `INV-${id.slice(0, 8)}`,
        accountId: body.accountId ?? null,
        status: body.status ?? 'Draft',
        amount: body.amount ?? 0,
        balance: body.balance ?? body.amount ?? 0,
        currency: body.currency ?? 'USD',
        invoiceDate: body.invoiceDate ?? now.split('T')[0],
        dueDate: body.dueDate ?? now.split('T')[0],
        createdDate: now,
        updatedDate: now,
        ...body,
      };
      store.set(NS.invoices, invoice.id, invoice);
      return reply.code(201).send(success({ id: invoice.id, invoiceNumber: invoice.invoiceNumber }));
    });

    server.get(`${BP}/invoices`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let invoices = store.list<Record<string, unknown>>(NS.invoices);
      if (query.accountId) invoices = invoices.filter((i) => i.accountId === query.accountId);
      if (query.status) invoices = invoices.filter((i) => i.status === query.status);
      const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
      const page = query.page ? parseInt(query.page, 10) : 1;
      return reply.code(200).send(paginateList(invoices, pageSize, page));
    });

    server.get(`${BP}/invoices/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get(NS.invoices, id);
      if (!invoice) return reply.code(404).send(notFound('Invoice', id));
      return reply.code(200).send(success(invoice as Record<string, unknown>));
    });

    server.put(`${BP}/invoices/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.invoices, id);
      if (!existing) return reply.code(404).send(notFound('Invoice', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updatedDate: isoNow() };
      store.set(NS.invoices, id, updated);
      return reply.code(200).send(success({ id }));
    });

    server.post(`${BP}/operations/invoice-collect`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const invId = zuoraId();
      const invoice = {
        id: invId,
        invoiceNumber: `INV-${invId.slice(0, 8)}`,
        accountId: body.accountId ?? null,
        status: 'Posted',
        amount: body.invoiceAmount ?? 0,
        balance: 0,
        currency: 'USD',
        invoiceDate: now.split('T')[0],
        dueDate: now.split('T')[0],
        createdDate: now,
        updatedDate: now,
      };
      store.set(NS.invoices, invoice.id, invoice);

      const pmtId = zuoraId();
      const payment = {
        id: pmtId,
        paymentNumber: `P-${pmtId.slice(0, 8)}`,
        accountId: body.accountId ?? null,
        amount: body.invoiceAmount ?? 0,
        status: 'Processed',
        type: 'Electronic',
        invoiceId: invId,
        effectiveDate: now.split('T')[0],
        createdDate: now,
        updatedDate: now,
      };
      store.set(NS.payments, payment.id, payment);

      return reply.code(200).send(success({ invoiceId: invId, paymentId: pmtId }));
    });

    // ── Payments ──────────────────────────────────────────────────────

    server.post(`${BP}/payments`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const id = zuoraId();
      const payment = {
        id,
        paymentNumber: `P-${id.slice(0, 8)}`,
        accountId: body.accountId ?? null,
        amount: body.amount ?? 0,
        currency: body.currency ?? 'USD',
        status: 'Processed',
        type: body.type ?? 'Electronic',
        effectiveDate: body.effectiveDate ?? now.split('T')[0],
        createdDate: now,
        updatedDate: now,
        ...body,
      };
      store.set(NS.payments, payment.id, payment);
      return reply.code(201).send(success({ id: payment.id, paymentNumber: payment.paymentNumber }));
    });

    server.get(`${BP}/payments`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let payments = store.list<Record<string, unknown>>(NS.payments);
      if (query.accountId) payments = payments.filter((p) => p.accountId === query.accountId);
      const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
      const page = query.page ? parseInt(query.page, 10) : 1;
      return reply.code(200).send(paginateList(payments, pageSize, page));
    });

    server.get(`${BP}/payments/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const payment = store.get(NS.payments, id);
      if (!payment) return reply.code(404).send(notFound('Payment', id));
      return reply.code(200).send(success(payment as Record<string, unknown>));
    });

    server.put(`${BP}/payments/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.payments, id);
      if (!existing) return reply.code(404).send(notFound('Payment', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updatedDate: isoNow() };
      store.set(NS.payments, id, updated);
      return reply.code(200).send(success({ id }));
    });

    // ── Payment Methods ───────────────────────────────────────────────

    server.post(`${BP}/payment-methods`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const id = zuoraId();
      const pm = {
        id,
        accountId: body.accountId ?? null,
        type: body.type ?? 'CreditCard',
        isDefault: body.isDefault ?? false,
        status: 'Active',
        createdDate: now,
        updatedDate: now,
        ...body,
      };
      store.set(NS.paymentMethods, pm.id, pm);
      return reply.code(201).send(success({ id: pm.id }));
    });

    server.get(`${BP}/payment-methods`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let methods = store.list<Record<string, unknown>>(NS.paymentMethods);
      if (query.accountId) methods = methods.filter((m) => m.accountId === query.accountId);
      const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
      const page = query.page ? parseInt(query.page, 10) : 1;
      return reply.code(200).send(paginateList(methods, pageSize, page));
    });

    server.get(`${BP}/payment-methods/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const pm = store.get(NS.paymentMethods, id);
      if (!pm) return reply.code(404).send(notFound('Payment method', id));
      return reply.code(200).send(success(pm as Record<string, unknown>));
    });

    server.put(`${BP}/payment-methods/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.paymentMethods, id);
      if (!existing) return reply.code(404).send(notFound('Payment method', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updatedDate: isoNow() };
      store.set(NS.paymentMethods, id, updated);
      return reply.code(200).send(success({ id }));
    });

    server.delete(`${BP}/payment-methods/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get(NS.paymentMethods, id);
      if (!existing) return reply.code(404).send(notFound('Payment method', id));
      store.delete(NS.paymentMethods, id);
      return reply.code(200).send(success({}));
    });

    // ── Credit Memos ──────────────────────────────────────────────────

    server.post(`${BP}/creditmemos`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const id = zuoraId();
      const memo = {
        id,
        memoNumber: `CM-${id.slice(0, 8)}`,
        accountId: body.accountId ?? null,
        status: 'Draft',
        amount: body.amount ?? 0,
        currency: body.currency ?? 'USD',
        reasonCode: body.reasonCode ?? null,
        comment: body.comment ?? null,
        memoDate: body.memoDate ?? now.split('T')[0],
        createdDate: now,
        updatedDate: now,
        ...body,
      };
      store.set(NS.creditMemos, memo.id, memo);
      return reply.code(201).send(success({ id: memo.id, memoNumber: memo.memoNumber }));
    });

    server.get(`${BP}/creditmemos`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let memos = store.list<Record<string, unknown>>(NS.creditMemos);
      if (query.accountId) memos = memos.filter((m) => m.accountId === query.accountId);
      if (query.status) memos = memos.filter((m) => m.status === query.status);
      const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
      const page = query.page ? parseInt(query.page, 10) : 1;
      return reply.code(200).send(paginateList(memos, pageSize, page));
    });

    server.get(`${BP}/creditmemos/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const memo = store.get(NS.creditMemos, id);
      if (!memo) return reply.code(404).send(notFound('Credit memo', id));
      return reply.code(200).send(success(memo as Record<string, unknown>));
    });

    server.put(`${BP}/creditmemos/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.creditMemos, id);
      if (!existing) return reply.code(404).send(notFound('Credit memo', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updatedDate: isoNow() };
      store.set(NS.creditMemos, id, updated);
      return reply.code(200).send(success({ id }));
    });

    server.put(`${BP}/creditmemos/:id/apply`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.creditMemos, id);
      if (!existing) return reply.code(404).send(notFound('Credit memo', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = {
        ...existing,
        ...body,
        status: 'Posted',
        updatedDate: isoNow(),
      };
      store.set(NS.creditMemos, id, updated);
      return reply.code(200).send(success({ id }));
    });

    server.post(`${BP}/creditmemos/invoice/:invoiceId`, async (req, reply) => {
      const { invoiceId } = req.params as { invoiceId: string };
      const invoice = store.get<Record<string, unknown>>(NS.invoices, invoiceId);
      if (!invoice) return reply.code(404).send(notFound('Invoice', invoiceId));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const id = zuoraId();
      const memo = {
        id,
        memoNumber: `CM-${id.slice(0, 8)}`,
        accountId: invoice.accountId,
        invoiceId,
        status: 'Draft',
        amount: body.amount ?? invoice.amount ?? 0,
        currency: invoice.currency ?? 'USD',
        reasonCode: body.reasonCode ?? null,
        comment: body.comment ?? null,
        memoDate: now.split('T')[0],
        createdDate: now,
        updatedDate: now,
        ...body,
      };
      store.set(NS.creditMemos, memo.id, memo);
      return reply.code(201).send(success({ id: memo.id, memoNumber: memo.memoNumber }));
    });

    // ── Debit Memos ───────────────────────────────────────────────────

    server.post(`${BP}/debitmemos`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const id = zuoraId();
      const memo = {
        id,
        memoNumber: `DM-${id.slice(0, 8)}`,
        accountId: body.accountId ?? null,
        status: 'Draft',
        amount: body.amount ?? 0,
        currency: body.currency ?? 'USD',
        reasonCode: body.reasonCode ?? null,
        comment: body.comment ?? null,
        memoDate: body.memoDate ?? now.split('T')[0],
        createdDate: now,
        updatedDate: now,
        ...body,
      };
      store.set(NS.debitMemos, memo.id, memo);
      return reply.code(201).send(success({ id: memo.id, memoNumber: memo.memoNumber }));
    });

    server.get(`${BP}/debitmemos`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let memos = store.list<Record<string, unknown>>(NS.debitMemos);
      if (query.accountId) memos = memos.filter((m) => m.accountId === query.accountId);
      if (query.status) memos = memos.filter((m) => m.status === query.status);
      const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
      const page = query.page ? parseInt(query.page, 10) : 1;
      return reply.code(200).send(paginateList(memos, pageSize, page));
    });

    server.get(`${BP}/debitmemos/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const memo = store.get(NS.debitMemos, id);
      if (!memo) return reply.code(404).send(notFound('Debit memo', id));
      return reply.code(200).send(success(memo as Record<string, unknown>));
    });

    server.put(`${BP}/debitmemos/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.debitMemos, id);
      if (!existing) return reply.code(404).send(notFound('Debit memo', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updatedDate: isoNow() };
      store.set(NS.debitMemos, id, updated);
      return reply.code(200).send(success({ id }));
    });

    // ── Usage ─────────────────────────────────────────────────────────

    server.post(`${BP}/usage`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const id = zuoraId();
      const usage = {
        id,
        accountId: body.accountId ?? body.AccountId ?? null,
        subscriptionId: body.subscriptionId ?? body.SubscriptionId ?? null,
        chargeId: body.chargeId ?? body.ChargeId ?? null,
        quantity: body.quantity ?? body.Quantity ?? 0,
        startDateTime: body.startDateTime ?? body.StartDateTime ?? now,
        unitOfMeasure: body.unitOfMeasure ?? body.UnitOfMeasure ?? null,
        description: body.description ?? body.Description ?? null,
        createdDate: now,
        updatedDate: now,
        ...body,
      };
      store.set(NS.usageRecords, usage.id, usage);
      return reply.code(201).send(success({ id: usage.id }));
    });

    server.get(`${BP}/usage/accounts/:key`, async (req, reply) => {
      const { key } = req.params as { key: string };
      const query = req.query as Record<string, string>;
      let usages = store.filter<Record<string, unknown>>(NS.usageRecords, (u) => u.accountId === key);
      const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
      const page = query.page ? parseInt(query.page, 10) : 1;
      return reply.code(200).send(paginateList(usages, pageSize, page));
    });

    // ── Contacts ──────────────────────────────────────────────────────

    server.post(`${BP}/object/contact`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const id = zuoraId();
      const contact = {
        Id: id,
        AccountId: body.AccountId ?? null,
        FirstName: body.FirstName ?? null,
        LastName: body.LastName ?? null,
        WorkEmail: body.WorkEmail ?? null,
        WorkPhone: body.WorkPhone ?? null,
        Address1: body.Address1 ?? null,
        City: body.City ?? null,
        State: body.State ?? null,
        PostalCode: body.PostalCode ?? null,
        Country: body.Country ?? null,
        CreatedDate: now,
        UpdatedDate: now,
        ...body,
      };
      store.set(NS.contacts, contact.Id, contact);
      return reply.code(201).send(success({ Id: contact.Id }));
    });

    server.get(`${BP}/object/contact/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const contact = store.get(NS.contacts, id);
      if (!contact) return reply.code(404).send(notFound('Contact', id));
      return reply.code(200).send(success(contact as Record<string, unknown>));
    });

    server.put(`${BP}/object/contact/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.contacts, id);
      if (!existing) return reply.code(404).send(notFound('Contact', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, UpdatedDate: isoNow() };
      store.set(NS.contacts, id, updated);
      return reply.code(200).send(success({ Id: id }));
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Accounts
      { method: 'POST', path: `${BP}/accounts`, description: 'Create account' },
      { method: 'GET', path: `${BP}/accounts/:key`, description: 'Get account' },
      { method: 'PUT', path: `${BP}/accounts/:key`, description: 'Update account' },
      { method: 'GET', path: `${BP}/accounts/:key/summary`, description: 'Get account summary' },

      // Subscriptions
      { method: 'POST', path: `${BP}/subscriptions`, description: 'Create subscription' },
      { method: 'GET', path: `${BP}/subscriptions/:key`, description: 'Get subscription' },
      { method: 'PUT', path: `${BP}/subscriptions/:key`, description: 'Update subscription' },
      { method: 'PUT', path: `${BP}/subscriptions/:key/cancel`, description: 'Cancel subscription' },
      { method: 'PUT', path: `${BP}/subscriptions/:key/renew`, description: 'Renew subscription' },
      { method: 'PUT', path: `${BP}/subscriptions/:key/suspend`, description: 'Suspend subscription' },
      { method: 'PUT', path: `${BP}/subscriptions/:key/resume`, description: 'Resume subscription' },
      { method: 'GET', path: `${BP}/subscriptions/accounts/:key`, description: 'List subscriptions by account' },

      // Orders
      { method: 'POST', path: `${BP}/orders`, description: 'Create order' },
      { method: 'GET', path: `${BP}/orders`, description: 'List orders' },
      { method: 'GET', path: `${BP}/orders/:number`, description: 'Get order' },
      { method: 'DELETE', path: `${BP}/orders/:number`, description: 'Delete order' },
      { method: 'GET', path: `${BP}/orders/subscription/:number`, description: 'List orders by subscription' },

      // Products
      { method: 'GET', path: `${BP}/catalog/products`, description: 'List products' },
      { method: 'GET', path: `${BP}/catalog/product/:id`, description: 'Get product' },
      { method: 'POST', path: `${BP}/object/product`, description: 'Create product' },
      { method: 'PUT', path: `${BP}/object/product/:id`, description: 'Update product' },

      // Product Rate Plans
      { method: 'GET', path: `${BP}/rateplan/:productId/productRatePlans`, description: 'List rate plans' },
      { method: 'POST', path: `${BP}/object/product-rate-plan`, description: 'Create rate plan' },
      { method: 'GET', path: `${BP}/object/product-rate-plan/:id`, description: 'Get rate plan' },
      { method: 'PUT', path: `${BP}/object/product-rate-plan/:id`, description: 'Update rate plan' },

      // Invoices
      { method: 'POST', path: `${BP}/invoices`, description: 'Create invoice' },
      { method: 'GET', path: `${BP}/invoices`, description: 'List invoices' },
      { method: 'GET', path: `${BP}/invoices/:id`, description: 'Get invoice' },
      { method: 'PUT', path: `${BP}/invoices/:id`, description: 'Update invoice' },
      { method: 'POST', path: `${BP}/operations/invoice-collect`, description: 'Invoice and collect' },

      // Payments
      { method: 'POST', path: `${BP}/payments`, description: 'Create payment' },
      { method: 'GET', path: `${BP}/payments`, description: 'List payments' },
      { method: 'GET', path: `${BP}/payments/:id`, description: 'Get payment' },
      { method: 'PUT', path: `${BP}/payments/:id`, description: 'Update payment' },

      // Payment Methods
      { method: 'POST', path: `${BP}/payment-methods`, description: 'Create payment method' },
      { method: 'GET', path: `${BP}/payment-methods`, description: 'List payment methods' },
      { method: 'GET', path: `${BP}/payment-methods/:id`, description: 'Get payment method' },
      { method: 'PUT', path: `${BP}/payment-methods/:id`, description: 'Update payment method' },
      { method: 'DELETE', path: `${BP}/payment-methods/:id`, description: 'Delete payment method' },

      // Credit Memos
      { method: 'POST', path: `${BP}/creditmemos`, description: 'Create credit memo' },
      { method: 'GET', path: `${BP}/creditmemos`, description: 'List credit memos' },
      { method: 'GET', path: `${BP}/creditmemos/:id`, description: 'Get credit memo' },
      { method: 'PUT', path: `${BP}/creditmemos/:id`, description: 'Update credit memo' },
      { method: 'PUT', path: `${BP}/creditmemos/:id/apply`, description: 'Apply credit memo' },
      { method: 'POST', path: `${BP}/creditmemos/invoice/:invoiceId`, description: 'Credit memo from invoice' },

      // Debit Memos
      { method: 'POST', path: `${BP}/debitmemos`, description: 'Create debit memo' },
      { method: 'GET', path: `${BP}/debitmemos`, description: 'List debit memos' },
      { method: 'GET', path: `${BP}/debitmemos/:id`, description: 'Get debit memo' },
      { method: 'PUT', path: `${BP}/debitmemos/:id`, description: 'Update debit memo' },

      // Usage
      { method: 'POST', path: `${BP}/usage`, description: 'Create usage record' },
      { method: 'GET', path: `${BP}/usage/accounts/:key`, description: 'List usage by account' },

      // Contacts
      { method: 'POST', path: `${BP}/object/contact`, description: 'Create contact' },
      { method: 'GET', path: `${BP}/object/contact/:id`, description: 'Get contact' },
      { method: 'PUT', path: `${BP}/object/contact/:id`, description: 'Update contact' },
    ];
  }

  // ── Cross-surface seeding ───────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    accounts: NS.accounts,
    subscriptions: NS.subscriptions,
    orders: NS.orders,
    products: NS.products,
    rate_plans: NS.ratePlans,
    invoices: NS.invoices,
    payments: NS.payments,
    payment_methods: NS.paymentMethods,
    credit_memos: NS.creditMemos,
    debit_memos: NS.debitMemos,
    usage: NS.usageRecords,
    contacts: NS.contacts,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const zuoraData = expanded.apiResponses?.zuora;
      if (!zuoraData) continue;

      for (const [resourceType, responses] of Object.entries(zuoraData.responses)) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          const id = (body.id ?? body.Id) as string;
          if (!id) continue;

          const enriched = {
            createdDate: body.createdDate ?? body.CreatedDate ?? isoNow(),
            updatedDate: body.updatedDate ?? body.UpdatedDate ?? isoNow(),
            ...body,
          };

          store.set(namespace, id, enriched);
        }
      }
    }
  }
}
