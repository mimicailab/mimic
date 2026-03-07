import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { GoCardlessConfig } from './config.js';
import { notFound } from './gocardless-errors.js';
import { registerGoCardlessTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  customers: 'gc_customers',
  bankAccounts: 'gc_bank_accounts',
  mandates: 'gc_mandates',
  payments: 'gc_payments',
  subscriptions: 'gc_subscriptions',
  refunds: 'gc_refunds',
  payouts: 'gc_payouts',
  payoutItems: 'gc_payout_items',
  instalmentSchedules: 'gc_instalment_schedules',
  billingRequests: 'gc_billing_requests',
  creditors: 'gc_creditors',
  events: 'gc_events',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** GoCardless IDs: 2-letter prefix + 12 alphanumeric */
function gcId(prefix: string): string {
  return `${prefix}${generateId('', 12)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

/** GoCardless wraps single objects by resource name: `{ customers: {...} }` */
function wrapSingle(resource: string, obj: unknown) {
  return { [resource]: obj };
}

/** GoCardless list: `{ resource: [...], meta: { cursors: {}, limit } }` */
function wrapList(resource: string, items: unknown[], limit = 50) {
  return {
    [resource]: items,
    meta: {
      cursors: { before: null, after: items.length > 0 ? 'cursor' : null },
      limit,
    },
  };
}

// ---------------------------------------------------------------------------
// GoCardless Adapter
// ---------------------------------------------------------------------------

export class GoCardlessAdapter extends BaseApiMockAdapter<GoCardlessConfig> {
  readonly id = 'gocardless';
  readonly name = 'GoCardless API';
  readonly basePath = '/gocardless';
  readonly versions = ['2015-07-06'];

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerGoCardlessTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+sandbox_([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    this.seedFromApiResponses(data, store);

    // ── Customers ───────────────────────────────────────────────────────

    server.post('/gocardless/customers', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = (body.customers ?? body) as Record<string, unknown>;
      const customer = {
        id: gcId('CU'),
        created_at: isoNow(),
        email: input.email ?? null,
        given_name: input.given_name ?? null,
        family_name: input.family_name ?? null,
        company_name: input.company_name ?? null,
        address_line1: input.address_line1 ?? null,
        city: input.city ?? null,
        postal_code: input.postal_code ?? null,
        country_code: input.country_code ?? null,
        language: input.language ?? 'en',
        metadata: input.metadata ?? {},
        ...input,
      };
      store.set(NS.customers, customer.id, customer);
      return reply.code(201).send(wrapSingle('customers', customer));
    });

    server.get('/gocardless/customers/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = store.get(NS.customers, id);
      if (!customer) return reply.code(404).send(notFound('Customer', id));
      return reply.code(200).send(wrapSingle('customers', customer));
    });

    server.get('/gocardless/customers', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let customers = store.list<Record<string, unknown>>(NS.customers);
      if (query.email) customers = customers.filter((c) => c.email === query.email);
      return reply.code(200).send(wrapList('customers', customers));
    });

    server.put('/gocardless/customers/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.customers, id);
      if (!existing) return reply.code(404).send(notFound('Customer', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = (body.customers ?? body) as Record<string, unknown>;
      const updated = { ...existing, ...input };
      store.set(NS.customers, id, updated);
      return reply.code(200).send(wrapSingle('customers', updated));
    });

    // ── Customer Bank Accounts ──────────────────────────────────────────

    server.post('/gocardless/customer_bank_accounts', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = (body.customer_bank_accounts ?? body) as Record<string, unknown>;
      const account = {
        id: gcId('BA'),
        created_at: isoNow(),
        account_holder_name: input.account_holder_name ?? null,
        account_number_ending: input.account_number_ending ?? (input.account_number as string)?.slice(-4) ?? '0000',
        bank_name: input.bank_name ?? 'Mock Bank',
        currency: input.currency ?? 'GBP',
        country_code: input.country_code ?? 'GB',
        enabled: true,
        links: { customer: input.customer ?? null },
        metadata: input.metadata ?? {},
        ...input,
      };
      store.set(NS.bankAccounts, account.id, account);
      return reply.code(201).send(wrapSingle('customer_bank_accounts', account));
    });

    server.get('/gocardless/customer_bank_accounts/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const account = store.get(NS.bankAccounts, id);
      if (!account) return reply.code(404).send(notFound('Customer bank account', id));
      return reply.code(200).send(wrapSingle('customer_bank_accounts', account));
    });

    server.get('/gocardless/customer_bank_accounts', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let accounts = store.list<Record<string, unknown>>(NS.bankAccounts);
      if (query.customer) accounts = accounts.filter((a) => (a.links as any)?.customer === query.customer);
      return reply.code(200).send(wrapList('customer_bank_accounts', accounts));
    });

    server.post('/gocardless/customer_bank_accounts/:id/actions/disable', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.bankAccounts, id);
      if (!existing) return reply.code(404).send(notFound('Customer bank account', id));
      const updated = { ...existing, enabled: false };
      store.set(NS.bankAccounts, id, updated);
      return reply.code(200).send(wrapSingle('customer_bank_accounts', updated));
    });

    // ── Mandates ────────────────────────────────────────────────────────

    server.post('/gocardless/mandates', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = (body.mandates ?? body) as Record<string, unknown>;
      const mandate = {
        id: gcId('MD'),
        created_at: isoNow(),
        scheme: input.scheme ?? 'bacs',
        status: 'pending_submission',
        reference: input.reference ?? `MANDATE-${Date.now()}`,
        links: {
          customer_bank_account: input.customer_bank_account ?? (input.links as any)?.customer_bank_account ?? null,
          creditor: input.creditor ?? (input.links as any)?.creditor ?? null,
          customer: input.customer ?? (input.links as any)?.customer ?? null,
        },
        metadata: input.metadata ?? {},
        ...input,
      };
      store.set(NS.mandates, mandate.id, mandate);
      return reply.code(201).send(wrapSingle('mandates', mandate));
    });

    server.get('/gocardless/mandates/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const mandate = store.get(NS.mandates, id);
      if (!mandate) return reply.code(404).send(notFound('Mandate', id));
      return reply.code(200).send(wrapSingle('mandates', mandate));
    });

    server.get('/gocardless/mandates', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let mandates = store.list<Record<string, unknown>>(NS.mandates);
      if (query.customer) mandates = mandates.filter((m) => (m.links as any)?.customer === query.customer);
      if (query.status) mandates = mandates.filter((m) => m.status === query.status);
      return reply.code(200).send(wrapList('mandates', mandates));
    });

    server.post('/gocardless/mandates/:id/actions/cancel', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.mandates, id);
      if (!existing) return reply.code(404).send(notFound('Mandate', id));
      const updated = { ...existing, status: 'cancelled' };
      store.set(NS.mandates, id, updated);
      return reply.code(200).send(wrapSingle('mandates', updated));
    });

    server.post('/gocardless/mandates/:id/actions/reinstate', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.mandates, id);
      if (!existing) return reply.code(404).send(notFound('Mandate', id));
      const updated = { ...existing, status: 'active' };
      store.set(NS.mandates, id, updated);
      return reply.code(200).send(wrapSingle('mandates', updated));
    });

    // ── Payments ────────────────────────────────────────────────────────

    server.post('/gocardless/payments', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = (body.payments ?? body) as Record<string, unknown>;
      const payment = {
        id: gcId('PM'),
        created_at: isoNow(),
        charge_date: input.charge_date ?? new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
        amount: input.amount ?? 0,
        currency: input.currency ?? 'GBP',
        status: 'pending_submission',
        description: input.description ?? null,
        reference: input.reference ?? null,
        retry_if_possible: input.retry_if_possible ?? true,
        links: {
          mandate: input.mandate ?? (input.links as any)?.mandate ?? null,
          creditor: null,
        },
        metadata: input.metadata ?? {},
        ...input,
      };
      store.set(NS.payments, payment.id, payment);
      return reply.code(201).send(wrapSingle('payments', payment));
    });

    server.get('/gocardless/payments/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const payment = store.get(NS.payments, id);
      if (!payment) return reply.code(404).send(notFound('Payment', id));
      return reply.code(200).send(wrapSingle('payments', payment));
    });

    server.get('/gocardless/payments', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let payments = store.list<Record<string, unknown>>(NS.payments);
      if (query.mandate) payments = payments.filter((p) => (p.links as any)?.mandate === query.mandate);
      if (query.subscription) payments = payments.filter((p) => (p.links as any)?.subscription === query.subscription);
      if (query.status) payments = payments.filter((p) => p.status === query.status);
      return reply.code(200).send(wrapList('payments', payments));
    });

    server.post('/gocardless/payments/:id/actions/cancel', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.payments, id);
      if (!existing) return reply.code(404).send(notFound('Payment', id));
      const updated = { ...existing, status: 'cancelled' };
      store.set(NS.payments, id, updated);
      return reply.code(200).send(wrapSingle('payments', updated));
    });

    server.post('/gocardless/payments/:id/actions/retry', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.payments, id);
      if (!existing) return reply.code(404).send(notFound('Payment', id));
      const updated = { ...existing, status: 'pending_submission' };
      store.set(NS.payments, id, updated);
      return reply.code(200).send(wrapSingle('payments', updated));
    });

    // ── Subscriptions ───────────────────────────────────────────────────

    server.post('/gocardless/subscriptions', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = (body.subscriptions ?? body) as Record<string, unknown>;
      const sub = {
        id: gcId('SB'),
        created_at: isoNow(),
        amount: input.amount ?? 0,
        currency: input.currency ?? 'GBP',
        status: 'active',
        name: input.name ?? null,
        interval: input.interval ?? 1,
        interval_unit: input.interval_unit ?? 'monthly',
        day_of_month: input.day_of_month ?? null,
        month: input.month ?? null,
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
        count: input.count ?? null,
        upcoming_payments: [],
        links: {
          mandate: input.mandate ?? (input.links as any)?.mandate ?? null,
        },
        metadata: input.metadata ?? {},
        ...input,
      };
      store.set(NS.subscriptions, sub.id, sub);
      return reply.code(201).send(wrapSingle('subscriptions', sub));
    });

    server.get('/gocardless/subscriptions/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get(NS.subscriptions, id);
      if (!sub) return reply.code(404).send(notFound('Subscription', id));
      return reply.code(200).send(wrapSingle('subscriptions', sub));
    });

    server.get('/gocardless/subscriptions', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let subs = store.list<Record<string, unknown>>(NS.subscriptions);
      if (query.mandate) subs = subs.filter((s) => (s.links as any)?.mandate === query.mandate);
      if (query.customer) subs = subs.filter((s) => (s.links as any)?.customer === query.customer);
      if (query.status) subs = subs.filter((s) => s.status === query.status);
      return reply.code(200).send(wrapList('subscriptions', subs));
    });

    server.post('/gocardless/subscriptions/:id/actions/cancel', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const updated = { ...existing, status: 'cancelled' };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapSingle('subscriptions', updated));
    });

    server.post('/gocardless/subscriptions/:id/actions/pause', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const updated = { ...existing, status: 'paused' };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapSingle('subscriptions', updated));
    });

    server.post('/gocardless/subscriptions/:id/actions/resume', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const updated = { ...existing, status: 'active' };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapSingle('subscriptions', updated));
    });

    // ── Refunds ─────────────────────────────────────────────────────────

    server.post('/gocardless/refunds', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = (body.refunds ?? body) as Record<string, unknown>;
      const refund = {
        id: gcId('RF'),
        created_at: isoNow(),
        amount: input.amount ?? 0,
        currency: input.currency ?? 'GBP',
        reference: input.reference ?? null,
        links: {
          payment: input.payment ?? (input.links as any)?.payment ?? null,
          mandate: null,
        },
        metadata: input.metadata ?? {},
        ...input,
      };
      store.set(NS.refunds, refund.id, refund);
      return reply.code(201).send(wrapSingle('refunds', refund));
    });

    server.get('/gocardless/refunds/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const refund = store.get(NS.refunds, id);
      if (!refund) return reply.code(404).send(notFound('Refund', id));
      return reply.code(200).send(wrapSingle('refunds', refund));
    });

    server.get('/gocardless/refunds', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let refunds = store.list<Record<string, unknown>>(NS.refunds);
      if (query.payment) refunds = refunds.filter((r) => (r.links as any)?.payment === query.payment);
      return reply.code(200).send(wrapList('refunds', refunds));
    });

    // ── Payouts ─────────────────────────────────────────────────────────

    server.get('/gocardless/payouts', async (_req, reply) => {
      const payouts = store.list(NS.payouts);
      return reply.code(200).send(wrapList('payouts', payouts));
    });

    server.get('/gocardless/payouts/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const payout = store.get(NS.payouts, id);
      if (!payout) return reply.code(404).send(notFound('Payout', id));
      return reply.code(200).send(wrapSingle('payouts', payout));
    });

    // ── Payout Items ────────────────────────────────────────────────────

    server.get('/gocardless/payout_items', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let items = store.list<Record<string, unknown>>(NS.payoutItems);
      if (query.payout) items = items.filter((i) => (i.links as any)?.payout === query.payout);
      return reply.code(200).send(wrapList('payout_items', items));
    });

    // ── Instalment Schedules ────────────────────────────────────────────

    server.post('/gocardless/instalment_schedules', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = (body.instalment_schedules ?? body) as Record<string, unknown>;
      const schedule = {
        id: gcId('IS'),
        created_at: isoNow(),
        currency: input.currency ?? 'GBP',
        status: 'pending',
        total_amount: input.total_amount ?? 0,
        instalments: input.instalments ?? [],
        links: {
          mandate: input.mandate ?? (input.links as any)?.mandate ?? null,
        },
        metadata: input.metadata ?? {},
        ...input,
      };
      store.set(NS.instalmentSchedules, schedule.id, schedule);
      return reply.code(201).send(wrapSingle('instalment_schedules', schedule));
    });

    server.get('/gocardless/instalment_schedules/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const schedule = store.get(NS.instalmentSchedules, id);
      if (!schedule) return reply.code(404).send(notFound('Instalment schedule', id));
      return reply.code(200).send(wrapSingle('instalment_schedules', schedule));
    });

    server.get('/gocardless/instalment_schedules', async (_req, reply) => {
      const schedules = store.list(NS.instalmentSchedules);
      return reply.code(200).send(wrapList('instalment_schedules', schedules));
    });

    server.post('/gocardless/instalment_schedules/:id/actions/cancel', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.instalmentSchedules, id);
      if (!existing) return reply.code(404).send(notFound('Instalment schedule', id));
      const updated = { ...existing, status: 'cancelled' };
      store.set(NS.instalmentSchedules, id, updated);
      return reply.code(200).send(wrapSingle('instalment_schedules', updated));
    });

    // ── Billing Requests ────────────────────────────────────────────────

    server.post('/gocardless/billing_requests', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = (body.billing_requests ?? body) as Record<string, unknown>;
      const br = {
        id: gcId('BRQ'),
        created_at: isoNow(),
        status: 'pending',
        mandate_request: input.mandate_request ?? null,
        payment_request: input.payment_request ?? null,
        links: input.links ?? {},
        metadata: input.metadata ?? {},
        ...input,
      };
      store.set(NS.billingRequests, br.id, br);
      return reply.code(201).send(wrapSingle('billing_requests', br));
    });

    server.get('/gocardless/billing_requests/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const br = store.get(NS.billingRequests, id);
      if (!br) return reply.code(404).send(notFound('Billing request', id));
      return reply.code(200).send(wrapSingle('billing_requests', br));
    });

    server.get('/gocardless/billing_requests', async (_req, reply) => {
      const brs = store.list(NS.billingRequests);
      return reply.code(200).send(wrapList('billing_requests', brs));
    });

    server.post('/gocardless/billing_requests/:id/actions/choose_currency', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.billingRequests, id);
      if (!existing) return reply.code(404).send(notFound('Billing request', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, currency: body.currency ?? 'GBP' };
      store.set(NS.billingRequests, id, updated);
      return reply.code(200).send(wrapSingle('billing_requests', updated));
    });

    server.post('/gocardless/billing_requests/:id/actions/confirm_payer_details', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.billingRequests, id);
      if (!existing) return reply.code(404).send(notFound('Billing request', id));
      const updated = { ...existing, status: 'ready_to_fulfil' };
      store.set(NS.billingRequests, id, updated);
      return reply.code(200).send(wrapSingle('billing_requests', updated));
    });

    server.post('/gocardless/billing_requests/:id/actions/select_institution', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.billingRequests, id);
      if (!existing) return reply.code(404).send(notFound('Billing request', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, institution: body.institution ?? null };
      store.set(NS.billingRequests, id, updated);
      return reply.code(200).send(wrapSingle('billing_requests', updated));
    });

    // ── Billing Request Flows ───────────────────────────────────────────

    server.post('/gocardless/billing_request_flows', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = (body.billing_request_flows ?? body) as Record<string, unknown>;
      const flow = {
        authorisation_url: `https://pay.gocardless.com/flow/${gcId('BRF')}`,
        auto_fulfil: input.auto_fulfil ?? false,
        created_at: isoNow(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        links: {
          billing_request: input.billing_request ?? (input.links as any)?.billing_request ?? null,
        },
        redirect_uri: input.redirect_uri ?? null,
        session_token: input.session_token ?? null,
      };
      return reply.code(201).send(wrapSingle('billing_request_flows', flow));
    });

    // ── Creditors ───────────────────────────────────────────────────────

    server.get('/gocardless/creditors', async (_req, reply) => {
      let creditors = store.list(NS.creditors);
      if (creditors.length === 0) {
        creditors = [{
          id: gcId('CR'),
          created_at: isoNow(),
          name: 'Test Creditor',
          country_code: 'GB',
          currency: 'GBP',
          verification_status: 'successful',
          scheme_identifiers: [{ scheme: 'bacs', name: 'Test Creditor' }],
        }];
      }
      return reply.code(200).send(wrapList('creditors', creditors));
    });

    server.get('/gocardless/creditors/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const creditor = store.get(NS.creditors, id);
      if (!creditor) return reply.code(404).send(notFound('Creditor', id));
      return reply.code(200).send(wrapSingle('creditors', creditor));
    });

    // ── Events ──────────────────────────────────────────────────────────

    server.get('/gocardless/events', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let events = store.list<Record<string, unknown>>(NS.events);
      if (query.resource_type) events = events.filter((e) => e.resource_type === query.resource_type);
      if (query.action) events = events.filter((e) => e.action === query.action);
      return reply.code(200).send(wrapList('events', events));
    });

    server.get('/gocardless/events/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const event = store.get(NS.events, id);
      if (!event) return reply.code(404).send(notFound('Event', id));
      return reply.code(200).send(wrapSingle('events', event));
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Customers
      { method: 'POST', path: '/gocardless/customers', description: 'Create customer' },
      { method: 'GET', path: '/gocardless/customers/:id', description: 'Get customer' },
      { method: 'GET', path: '/gocardless/customers', description: 'List customers' },
      { method: 'PUT', path: '/gocardless/customers/:id', description: 'Update customer' },

      // Customer Bank Accounts
      { method: 'POST', path: '/gocardless/customer_bank_accounts', description: 'Create bank account' },
      { method: 'GET', path: '/gocardless/customer_bank_accounts/:id', description: 'Get bank account' },
      { method: 'GET', path: '/gocardless/customer_bank_accounts', description: 'List bank accounts' },
      { method: 'POST', path: '/gocardless/customer_bank_accounts/:id/actions/disable', description: 'Disable bank account' },

      // Mandates
      { method: 'POST', path: '/gocardless/mandates', description: 'Create mandate' },
      { method: 'GET', path: '/gocardless/mandates/:id', description: 'Get mandate' },
      { method: 'GET', path: '/gocardless/mandates', description: 'List mandates' },
      { method: 'POST', path: '/gocardless/mandates/:id/actions/cancel', description: 'Cancel mandate' },
      { method: 'POST', path: '/gocardless/mandates/:id/actions/reinstate', description: 'Reinstate mandate' },

      // Payments
      { method: 'POST', path: '/gocardless/payments', description: 'Create payment' },
      { method: 'GET', path: '/gocardless/payments/:id', description: 'Get payment' },
      { method: 'GET', path: '/gocardless/payments', description: 'List payments' },
      { method: 'POST', path: '/gocardless/payments/:id/actions/cancel', description: 'Cancel payment' },
      { method: 'POST', path: '/gocardless/payments/:id/actions/retry', description: 'Retry payment' },

      // Subscriptions
      { method: 'POST', path: '/gocardless/subscriptions', description: 'Create subscription' },
      { method: 'GET', path: '/gocardless/subscriptions/:id', description: 'Get subscription' },
      { method: 'GET', path: '/gocardless/subscriptions', description: 'List subscriptions' },
      { method: 'POST', path: '/gocardless/subscriptions/:id/actions/cancel', description: 'Cancel subscription' },
      { method: 'POST', path: '/gocardless/subscriptions/:id/actions/pause', description: 'Pause subscription' },
      { method: 'POST', path: '/gocardless/subscriptions/:id/actions/resume', description: 'Resume subscription' },

      // Refunds
      { method: 'POST', path: '/gocardless/refunds', description: 'Create refund' },
      { method: 'GET', path: '/gocardless/refunds/:id', description: 'Get refund' },
      { method: 'GET', path: '/gocardless/refunds', description: 'List refunds' },

      // Payouts
      { method: 'GET', path: '/gocardless/payouts', description: 'List payouts' },
      { method: 'GET', path: '/gocardless/payouts/:id', description: 'Get payout' },

      // Payout Items
      { method: 'GET', path: '/gocardless/payout_items', description: 'List payout items' },

      // Instalment Schedules
      { method: 'POST', path: '/gocardless/instalment_schedules', description: 'Create instalment schedule' },
      { method: 'GET', path: '/gocardless/instalment_schedules/:id', description: 'Get instalment schedule' },
      { method: 'GET', path: '/gocardless/instalment_schedules', description: 'List instalment schedules' },
      { method: 'POST', path: '/gocardless/instalment_schedules/:id/actions/cancel', description: 'Cancel instalment schedule' },

      // Billing Requests
      { method: 'POST', path: '/gocardless/billing_requests', description: 'Create billing request' },
      { method: 'GET', path: '/gocardless/billing_requests/:id', description: 'Get billing request' },
      { method: 'GET', path: '/gocardless/billing_requests', description: 'List billing requests' },
      { method: 'POST', path: '/gocardless/billing_requests/:id/actions/choose_currency', description: 'Choose currency' },
      { method: 'POST', path: '/gocardless/billing_requests/:id/actions/confirm_payer_details', description: 'Confirm payer details' },
      { method: 'POST', path: '/gocardless/billing_requests/:id/actions/select_institution', description: 'Select institution' },

      // Billing Request Flows
      { method: 'POST', path: '/gocardless/billing_request_flows', description: 'Create billing request flow' },

      // Creditors
      { method: 'GET', path: '/gocardless/creditors', description: 'List creditors' },
      { method: 'GET', path: '/gocardless/creditors/:id', description: 'Get creditor' },

      // Events
      { method: 'GET', path: '/gocardless/events', description: 'List events' },
      { method: 'GET', path: '/gocardless/events/:id', description: 'Get event' },
    ];
  }

  // ── Cross-surface seeding ────────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    customers: NS.customers,
    customer_bank_accounts: NS.bankAccounts,
    mandates: NS.mandates,
    payments: NS.payments,
    subscriptions: NS.subscriptions,
    refunds: NS.refunds,
    payouts: NS.payouts,
    events: NS.events,
    creditors: NS.creditors,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const gcData = expanded.apiResponses?.gocardless;
      if (!gcData) continue;

      for (const [resourceType, responses] of Object.entries(gcData.responses)) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          if (!body.id) continue;

          const enriched = {
            created_at: body.created_at ?? isoNow(),
            ...body,
          };

          store.set(namespace, String(body.id), enriched);
        }
      }
    }
  }
}
