import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId, unixNow } from '@mimicai/adapter-sdk';
import type { RecurlyConfig } from './config.js';
import { notFound } from './recurly-errors.js';
import { registerRecurlyTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  accounts: 'recurly_accounts',
  subscriptions: 'recurly_subscriptions',
  plans: 'recurly_plans',
  addOns: 'recurly_add_ons',
  invoices: 'recurly_invoices',
  lineItems: 'recurly_line_items',
  transactions: 'recurly_transactions',
  billingInfos: 'recurly_billing_infos',
  coupons: 'recurly_coupons',
  couponRedemptions: 'recurly_coupon_redemptions',
  usageRecords: 'recurly_usage_records',
  shippingAddresses: 'recurly_shipping_addresses',
  entitlements: 'recurly_entitlements',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BP = '/recurly/v2021-02-25';

function recurlyId(): string {
  return generateId('', 20);
}

function isoNow(): string {
  return new Date().toISOString();
}

/** Recurly uses has_more cursor pagination */
function paginateList<T>(items: T[], limit: number, offset: number) {
  const page = items.slice(offset, offset + limit);
  return {
    object: 'list',
    has_more: offset + limit < items.length,
    data: page,
  };
}

// ---------------------------------------------------------------------------
// Recurly Adapter
// ---------------------------------------------------------------------------

export class RecurlyAdapter extends BaseApiMockAdapter<RecurlyConfig> {
  readonly id = 'recurly';
  readonly name = 'Recurly API';
  readonly basePath = '/recurly/v2021-02-25';
  readonly versions = ['v2021-02-25'];

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerRecurlyTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    // Recurly uses HTTP Basic auth: api_key as username, empty password
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Basic\s+(.+)$/);
    if (!match) return null;
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
      const key = decoded.split(':')[0];
      const personaMatch = key.match(/^test_([a-z0-9-]+)_/);
      return personaMatch ? personaMatch[1] : null;
    } catch {
      return null;
    }
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
      const account = {
        id: (body.id as string) || recurlyId(),
        object: 'account',
        code: body.code ?? recurlyId(),
        email: body.email ?? null,
        first_name: body.first_name ?? null,
        last_name: body.last_name ?? null,
        company: body.company ?? null,
        state: 'active',
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.accounts, account.id, account);
      return reply.code(201).send(account);
    });

    server.get(`${BP}/accounts/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const account = store.get(NS.accounts, id);
      if (!account) return reply.code(404).send(notFound('Account', id));
      return reply.code(200).send(account);
    });

    server.get(`${BP}/accounts`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let accounts = store.list<Record<string, unknown>>(NS.accounts);
      if (query.email) accounts = accounts.filter((a) => a.email === query.email);
      if (query.state) accounts = accounts.filter((a) => a.state === query.state);
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      return reply.code(200).send(paginateList(accounts, limit, offset));
    });

    server.put(`${BP}/accounts/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.accounts, id);
      if (!existing) return reply.code(404).send(notFound('Account', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.accounts, id, updated);
      return reply.code(200).send(updated);
    });

    server.delete(`${BP}/accounts/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.accounts, id);
      if (!existing) return reply.code(404).send(notFound('Account', id));
      const updated = { ...existing, state: 'closed', updated_at: isoNow() };
      store.set(NS.accounts, id, updated);
      return reply.code(200).send(updated);
    });

    // ── Subscriptions ─────────────────────────────────────────────────

    server.post(`${BP}/subscriptions`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const nowUnix = unixNow();
      const sub = {
        id: recurlyId(),
        object: 'subscription',
        account: body.account ?? null,
        plan_code: body.plan_code ?? null,
        state: 'active',
        quantity: body.quantity ?? 1,
        unit_amount: body.unit_amount ?? 0,
        currency: body.currency ?? 'USD',
        current_period_started_at: now,
        current_period_ends_at: new Date((nowUnix + 30 * 86400) * 1000).toISOString(),
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.subscriptions, sub.id, sub);
      return reply.code(201).send(sub);
    });

    server.get(`${BP}/subscriptions/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get(NS.subscriptions, id);
      if (!sub) return reply.code(404).send(notFound('Subscription', id));
      return reply.code(200).send(sub);
    });

    server.get(`${BP}/subscriptions`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let subs = store.list<Record<string, unknown>>(NS.subscriptions);
      if (query.state) subs = subs.filter((s) => s.state === query.state);
      if (query.account_id) subs = subs.filter((s) => {
        const acc = s.account as Record<string, unknown> | null;
        return acc?.id === query.account_id || s.account_id === query.account_id;
      });
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      return reply.code(200).send(paginateList(subs, limit, offset));
    });

    server.put(`${BP}/subscriptions/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(updated);
    });

    server.put(`${BP}/subscriptions/:id/cancel`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const updated = {
        ...existing,
        state: 'canceled',
        canceled_at: isoNow(),
        updated_at: isoNow(),
      };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(updated);
    });

    server.put(`${BP}/subscriptions/:id/terminate`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const updated = {
        ...existing,
        state: 'expired',
        expired_at: isoNow(),
        updated_at: isoNow(),
      };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(updated);
    });

    server.put(`${BP}/subscriptions/:id/reactivate`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const updated = {
        ...existing,
        state: 'active',
        canceled_at: null,
        updated_at: isoNow(),
      };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(updated);
    });

    server.put(`${BP}/subscriptions/:id/pause`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = {
        ...existing,
        ...body,
        state: 'paused',
        paused_at: isoNow(),
        updated_at: isoNow(),
      };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(updated);
    });

    server.put(`${BP}/subscriptions/:id/resume`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const updated = {
        ...existing,
        state: 'active',
        paused_at: null,
        updated_at: isoNow(),
      };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(updated);
    });

    // ── Plans ─────────────────────────────────────────────────────────

    server.post(`${BP}/plans`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const plan = {
        id: recurlyId(),
        object: 'plan',
        code: body.code ?? recurlyId(),
        name: body.name ?? '',
        state: 'active',
        interval_unit: body.interval_unit ?? 'months',
        interval_length: body.interval_length ?? 1,
        currencies: body.currencies ?? [],
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.plans, plan.id, plan);
      return reply.code(201).send(plan);
    });

    server.get(`${BP}/plans/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const plan = store.get(NS.plans, id);
      if (!plan) return reply.code(404).send(notFound('Plan', id));
      return reply.code(200).send(plan);
    });

    server.get(`${BP}/plans`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let plans = store.list<Record<string, unknown>>(NS.plans);
      if (query.state) plans = plans.filter((p) => p.state === query.state);
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      return reply.code(200).send(paginateList(plans, limit, offset));
    });

    server.put(`${BP}/plans/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.plans, id);
      if (!existing) return reply.code(404).send(notFound('Plan', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.plans, id, updated);
      return reply.code(200).send(updated);
    });

    // ── Add-Ons ───────────────────────────────────────────────────────

    server.post(`${BP}/plans/:planId/add_ons`, async (req, reply) => {
      const { planId } = req.params as { planId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const addOn = {
        id: recurlyId(),
        object: 'add_on',
        plan_id: planId,
        code: body.code ?? recurlyId(),
        name: body.name ?? '',
        state: 'active',
        add_on_type: body.add_on_type ?? 'fixed',
        currencies: body.currencies ?? [],
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.addOns, addOn.id, addOn);
      return reply.code(201).send(addOn);
    });

    server.get(`${BP}/plans/:planId/add_ons/:id`, async (req, reply) => {
      const { id } = req.params as { planId: string; id: string };
      const addOn = store.get(NS.addOns, id);
      if (!addOn) return reply.code(404).send(notFound('Add-on', id));
      return reply.code(200).send(addOn);
    });

    server.get(`${BP}/plans/:planId/add_ons`, async (req, reply) => {
      const { planId } = req.params as { planId: string };
      const query = req.query as Record<string, string>;
      let addOns = store.filter<Record<string, unknown>>(NS.addOns, (a) => a.plan_id === planId);
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      return reply.code(200).send(paginateList(addOns, limit, offset));
    });

    server.put(`${BP}/plans/:planId/add_ons/:id`, async (req, reply) => {
      const { id } = req.params as { planId: string; id: string };
      const existing = store.get<Record<string, unknown>>(NS.addOns, id);
      if (!existing) return reply.code(404).send(notFound('Add-on', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.addOns, id, updated);
      return reply.code(200).send(updated);
    });

    server.delete(`${BP}/plans/:planId/add_ons/:id`, async (req, reply) => {
      const { id } = req.params as { planId: string; id: string };
      const existing = store.get<Record<string, unknown>>(NS.addOns, id);
      if (!existing) return reply.code(404).send(notFound('Add-on', id));
      store.delete(NS.addOns, id);
      return reply.code(204).send();
    });

    // ── Invoices ──────────────────────────────────────────────────────

    server.get(`${BP}/invoices/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get(NS.invoices, id);
      if (!invoice) return reply.code(404).send(notFound('Invoice', id));
      return reply.code(200).send(invoice);
    });

    server.get(`${BP}/invoices`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let invoices = store.list<Record<string, unknown>>(NS.invoices);
      if (query.account_id) invoices = invoices.filter((i) => i.account_id === query.account_id);
      if (query.state) invoices = invoices.filter((i) => i.state === query.state);
      if (query.subscription_id) invoices = invoices.filter((i) => i.subscription_id === query.subscription_id);
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      return reply.code(200).send(paginateList(invoices, limit, offset));
    });

    server.post(`${BP}/invoices/:id/collect`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get<Record<string, unknown>>(NS.invoices, id);
      if (!invoice) return reply.code(404).send(notFound('Invoice', id));
      const updated = {
        ...invoice,
        state: 'paid',
        closed_at: isoNow(),
        updated_at: isoNow(),
      };
      store.set(NS.invoices, id, updated);
      return reply.code(200).send(updated);
    });

    server.put(`${BP}/invoices/:id/void`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get<Record<string, unknown>>(NS.invoices, id);
      if (!invoice) return reply.code(404).send(notFound('Invoice', id));
      const updated = {
        ...invoice,
        state: 'voided',
        voided_at: isoNow(),
        updated_at: isoNow(),
      };
      store.set(NS.invoices, id, updated);
      return reply.code(200).send(updated);
    });

    server.put(`${BP}/invoices/:id/mark_failed`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get<Record<string, unknown>>(NS.invoices, id);
      if (!invoice) return reply.code(404).send(notFound('Invoice', id));
      const updated = {
        ...invoice,
        state: 'failed',
        updated_at: isoNow(),
      };
      store.set(NS.invoices, id, updated);
      return reply.code(200).send(updated);
    });

    // ── Line Items ────────────────────────────────────────────────────

    server.post(`${BP}/accounts/:accountId/line_items`, async (req, reply) => {
      const { accountId } = req.params as { accountId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const lineItem = {
        id: recurlyId(),
        object: 'line_item',
        account_id: accountId,
        type: body.type ?? 'charge',
        currency: body.currency ?? 'USD',
        unit_amount: body.unit_amount ?? 0,
        quantity: body.quantity ?? 1,
        description: body.description ?? null,
        state: 'pending',
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.lineItems, lineItem.id, lineItem);
      return reply.code(201).send(lineItem);
    });

    server.get(`${BP}/accounts/:accountId/line_items`, async (req, reply) => {
      const { accountId } = req.params as { accountId: string };
      const query = req.query as Record<string, string>;
      let items = store.filter<Record<string, unknown>>(NS.lineItems, (i) => i.account_id === accountId);
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      return reply.code(200).send(paginateList(items, limit, offset));
    });

    server.delete(`${BP}/line_items/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get(NS.lineItems, id);
      if (!existing) return reply.code(404).send(notFound('Line item', id));
      store.delete(NS.lineItems, id);
      return reply.code(204).send();
    });

    // ── Transactions ──────────────────────────────────────────────────

    server.get(`${BP}/transactions/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const txn = store.get(NS.transactions, id);
      if (!txn) return reply.code(404).send(notFound('Transaction', id));
      return reply.code(200).send(txn);
    });

    server.get(`${BP}/transactions`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let txns = store.list<Record<string, unknown>>(NS.transactions);
      if (query.account_id) txns = txns.filter((t) => t.account_id === query.account_id);
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      return reply.code(200).send(paginateList(txns, limit, offset));
    });

    // ── Billing Info ──────────────────────────────────────────────────

    server.put(`${BP}/accounts/:id/billing_info`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const billingInfo = {
        id: recurlyId(),
        object: 'billing_info',
        account_id: id,
        payment_method: body.payment_method ?? { object: 'payment_method' },
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.billingInfos, id, billingInfo);
      return reply.code(200).send(billingInfo);
    });

    server.get(`${BP}/accounts/:id/billing_info`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const info = store.get(NS.billingInfos, id);
      if (!info) return reply.code(404).send(notFound('Billing info', id));
      return reply.code(200).send(info);
    });

    server.delete(`${BP}/accounts/:id/billing_info`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get(NS.billingInfos, id);
      if (!existing) return reply.code(404).send(notFound('Billing info', id));
      store.delete(NS.billingInfos, id);
      return reply.code(204).send();
    });

    // ── Coupons ───────────────────────────────────────────────────────

    server.post(`${BP}/coupons`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const coupon = {
        id: recurlyId(),
        object: 'coupon',
        code: body.code ?? recurlyId(),
        name: body.name ?? '',
        state: 'redeemable',
        discount_type: body.discount_type ?? 'percent',
        discount_percent: body.discount_percent ?? null,
        discount_fixed: body.discount_fixed ?? null,
        duration: body.duration ?? 'single_use',
        max_redemptions: body.max_redemptions ?? null,
        redemptions_remaining: body.max_redemptions ?? null,
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.coupons, coupon.id, coupon);
      return reply.code(201).send(coupon);
    });

    server.get(`${BP}/coupons/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const coupon = store.get(NS.coupons, id);
      if (!coupon) return reply.code(404).send(notFound('Coupon', id));
      return reply.code(200).send(coupon);
    });

    server.get(`${BP}/coupons`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let coupons = store.list<Record<string, unknown>>(NS.coupons);
      if (query.state) coupons = coupons.filter((c) => c.state === query.state);
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      return reply.code(200).send(paginateList(coupons, limit, offset));
    });

    server.post(`${BP}/accounts/:id/coupon_redemptions`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const redemption = {
        id: recurlyId(),
        object: 'coupon_redemption',
        account_id: id,
        coupon_id: body.coupon_id ?? null,
        state: 'active',
        currency: body.currency ?? 'USD',
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.couponRedemptions, redemption.id, redemption);
      return reply.code(201).send(redemption);
    });

    // ── Usage Records ─────────────────────────────────────────────────

    server.post(`${BP}/subscriptions/:subId/add_ons/:addOnId/usage`, async (req, reply) => {
      const { subId, addOnId } = req.params as { subId: string; addOnId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const usage = {
        id: recurlyId(),
        object: 'usage',
        subscription_id: subId,
        add_on_id: addOnId,
        measured_unit_id: body.measured_unit_id ?? null,
        amount: body.amount ?? 0,
        merchant_tag: body.merchant_tag ?? null,
        recording_timestamp: body.recording_timestamp ?? now,
        usage_timestamp: body.usage_timestamp ?? now,
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.usageRecords, usage.id, usage);
      return reply.code(201).send(usage);
    });

    server.get(`${BP}/subscriptions/:subId/add_ons/:addOnId/usage`, async (req, reply) => {
      const { subId, addOnId } = req.params as { subId: string; addOnId: string };
      const query = req.query as Record<string, string>;
      let usages = store.filter<Record<string, unknown>>(
        NS.usageRecords,
        (u) => u.subscription_id === subId && u.add_on_id === addOnId,
      );
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      return reply.code(200).send(paginateList(usages, limit, offset));
    });

    // ── Shipping Addresses ────────────────────────────────────────────

    server.post(`${BP}/accounts/:id/shipping_addresses`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const address = {
        id: recurlyId(),
        object: 'shipping_address',
        account_id: id,
        first_name: body.first_name ?? null,
        last_name: body.last_name ?? null,
        street1: body.street1 ?? null,
        street2: body.street2 ?? null,
        city: body.city ?? null,
        region: body.region ?? null,
        postal_code: body.postal_code ?? null,
        country: body.country ?? null,
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.shippingAddresses, address.id, address);
      return reply.code(201).send(address);
    });

    server.get(`${BP}/accounts/:id/shipping_addresses`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const query = req.query as Record<string, string>;
      let addresses = store.filter<Record<string, unknown>>(NS.shippingAddresses, (a) => a.account_id === id);
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      return reply.code(200).send(paginateList(addresses, limit, offset));
    });

    server.put(`${BP}/accounts/:id/shipping_addresses/:addressId`, async (req, reply) => {
      const { addressId } = req.params as { id: string; addressId: string };
      const existing = store.get<Record<string, unknown>>(NS.shippingAddresses, addressId);
      if (!existing) return reply.code(404).send(notFound('Shipping address', addressId));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.shippingAddresses, addressId, updated);
      return reply.code(200).send(updated);
    });

    server.delete(`${BP}/accounts/:id/shipping_addresses/:addressId`, async (req, reply) => {
      const { addressId } = req.params as { id: string; addressId: string };
      const existing = store.get(NS.shippingAddresses, addressId);
      if (!existing) return reply.code(404).send(notFound('Shipping address', addressId));
      store.delete(NS.shippingAddresses, addressId);
      return reply.code(204).send();
    });

    // ── Entitlements ──────────────────────────────────────────────────

    server.get(`${BP}/accounts/:id/entitlements`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const query = req.query as Record<string, string>;
      let entitlements = store.filter<Record<string, unknown>>(NS.entitlements, (e) => e.account_id === id);
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      return reply.code(200).send(paginateList(entitlements, limit, offset));
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Accounts
      { method: 'POST', path: `${BP}/accounts`, description: 'Create account' },
      { method: 'GET', path: `${BP}/accounts/:id`, description: 'Get account' },
      { method: 'GET', path: `${BP}/accounts`, description: 'List accounts' },
      { method: 'PUT', path: `${BP}/accounts/:id`, description: 'Update account' },
      { method: 'DELETE', path: `${BP}/accounts/:id`, description: 'Deactivate account' },

      // Subscriptions
      { method: 'POST', path: `${BP}/subscriptions`, description: 'Create subscription' },
      { method: 'GET', path: `${BP}/subscriptions/:id`, description: 'Get subscription' },
      { method: 'GET', path: `${BP}/subscriptions`, description: 'List subscriptions' },
      { method: 'PUT', path: `${BP}/subscriptions/:id`, description: 'Update subscription' },
      { method: 'PUT', path: `${BP}/subscriptions/:id/cancel`, description: 'Cancel subscription' },
      { method: 'PUT', path: `${BP}/subscriptions/:id/terminate`, description: 'Terminate subscription' },
      { method: 'PUT', path: `${BP}/subscriptions/:id/reactivate`, description: 'Reactivate subscription' },
      { method: 'PUT', path: `${BP}/subscriptions/:id/pause`, description: 'Pause subscription' },
      { method: 'PUT', path: `${BP}/subscriptions/:id/resume`, description: 'Resume subscription' },

      // Plans
      { method: 'POST', path: `${BP}/plans`, description: 'Create plan' },
      { method: 'GET', path: `${BP}/plans/:id`, description: 'Get plan' },
      { method: 'GET', path: `${BP}/plans`, description: 'List plans' },
      { method: 'PUT', path: `${BP}/plans/:id`, description: 'Update plan' },

      // Add-Ons
      { method: 'POST', path: `${BP}/plans/:planId/add_ons`, description: 'Create add-on' },
      { method: 'GET', path: `${BP}/plans/:planId/add_ons/:id`, description: 'Get add-on' },
      { method: 'GET', path: `${BP}/plans/:planId/add_ons`, description: 'List add-ons' },
      { method: 'PUT', path: `${BP}/plans/:planId/add_ons/:id`, description: 'Update add-on' },
      { method: 'DELETE', path: `${BP}/plans/:planId/add_ons/:id`, description: 'Delete add-on' },

      // Invoices
      { method: 'GET', path: `${BP}/invoices/:id`, description: 'Get invoice' },
      { method: 'GET', path: `${BP}/invoices`, description: 'List invoices' },
      { method: 'POST', path: `${BP}/invoices/:id/collect`, description: 'Collect invoice payment' },
      { method: 'PUT', path: `${BP}/invoices/:id/void`, description: 'Void invoice' },
      { method: 'PUT', path: `${BP}/invoices/:id/mark_failed`, description: 'Mark invoice as failed' },

      // Line Items
      { method: 'POST', path: `${BP}/accounts/:accountId/line_items`, description: 'Create line item' },
      { method: 'GET', path: `${BP}/accounts/:accountId/line_items`, description: 'List line items' },
      { method: 'DELETE', path: `${BP}/line_items/:id`, description: 'Delete line item' },

      // Transactions
      { method: 'GET', path: `${BP}/transactions/:id`, description: 'Get transaction' },
      { method: 'GET', path: `${BP}/transactions`, description: 'List transactions' },

      // Billing Info
      { method: 'PUT', path: `${BP}/accounts/:id/billing_info`, description: 'Update billing info' },
      { method: 'GET', path: `${BP}/accounts/:id/billing_info`, description: 'Get billing info' },
      { method: 'DELETE', path: `${BP}/accounts/:id/billing_info`, description: 'Remove billing info' },

      // Coupons
      { method: 'POST', path: `${BP}/coupons`, description: 'Create coupon' },
      { method: 'GET', path: `${BP}/coupons/:id`, description: 'Get coupon' },
      { method: 'GET', path: `${BP}/coupons`, description: 'List coupons' },
      { method: 'POST', path: `${BP}/accounts/:id/coupon_redemptions`, description: 'Redeem coupon' },

      // Usage Records
      { method: 'POST', path: `${BP}/subscriptions/:subId/add_ons/:addOnId/usage`, description: 'Create usage record' },
      { method: 'GET', path: `${BP}/subscriptions/:subId/add_ons/:addOnId/usage`, description: 'List usage records' },

      // Shipping Addresses
      { method: 'POST', path: `${BP}/accounts/:id/shipping_addresses`, description: 'Create shipping address' },
      { method: 'GET', path: `${BP}/accounts/:id/shipping_addresses`, description: 'List shipping addresses' },
      { method: 'PUT', path: `${BP}/accounts/:id/shipping_addresses/:addressId`, description: 'Update shipping address' },
      { method: 'DELETE', path: `${BP}/accounts/:id/shipping_addresses/:addressId`, description: 'Delete shipping address' },

      // Entitlements
      { method: 'GET', path: `${BP}/accounts/:id/entitlements`, description: 'List entitlements' },
    ];
  }

  // ── Cross-surface seeding ───────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    accounts: NS.accounts,
    subscriptions: NS.subscriptions,
    plans: NS.plans,
    add_ons: NS.addOns,
    invoices: NS.invoices,
    line_items: NS.lineItems,
    transactions: NS.transactions,
    billing_infos: NS.billingInfos,
    coupons: NS.coupons,
    usage_records: NS.usageRecords,
    shipping_addresses: NS.shippingAddresses,
    entitlements: NS.entitlements,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const recurlyData = expanded.apiResponses?.recurly;
      if (!recurlyData) continue;

      for (const [resourceType, responses] of Object.entries(recurlyData.responses)) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          if (!body.id) continue;

          const enriched = {
            created_at: body.created_at ?? isoNow(),
            updated_at: body.updated_at ?? isoNow(),
            ...body,
          };

          store.set(namespace, String(body.id), enriched);
        }
      }
    }
  }
}
