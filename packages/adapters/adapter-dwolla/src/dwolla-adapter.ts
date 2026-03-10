import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, DataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { DwollaConfig } from './config.js';
import { dwError, dwValidationError } from './dwolla-errors.js';
import { registerDwollaTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  tokens: 'dw_tokens',
  customers: 'dw_customers',
  fundingSources: 'dw_funding_sources',
  transfers: 'dw_transfers',
  massPayments: 'dw_mass_payments',
  massPaymentItems: 'dw_mass_payment_items',
  events: 'dw_events',
  webhookSubs: 'dw_webhook_subs',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a Dwolla-style UUID */
function dwUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Generate an ACH trace ID */
function dwAchId(): string {
  return Array.from({ length: 15 }, () => Math.floor(Math.random() * 10)).join('');
}

const BASE = 'https://api-sandbox.dwolla.com';

/** Emit an event to state */
function emitEvent(state: StateStore, topic: string, resourceUrl: string): void {
  const id = dwUuid();
  const event = {
    id,
    topic,
    resourceId: resourceUrl,
    created: new Date().toISOString(),
    _links: {
      self: { href: `${BASE}/events/${id}` },
      resource: { href: resourceUrl },
    },
  };
  state.set(NS.events, id, event);
}

// ---------------------------------------------------------------------------
// Dwolla Adapter
// ---------------------------------------------------------------------------

export class DwollaAdapter extends BaseApiMockAdapter<DwollaConfig> {
  readonly id = 'dwolla';
  readonly name = 'Dwolla API';
  readonly basePath = '/dwolla';
  readonly versions = ['v2'];

  readonly promptContext = {
    resources: ['customers', 'funding_sources', 'transfers', 'mass_payments', 'webhooks', 'events'],
    amountFormat: 'decimal string with currency (e.g. { value: "29.99", currency: "USD" })',
    relationships: [
      'transfer → source_funding_source, destination_funding_source',
      'funding_source → customer',
      'mass_payment → customer, items',
    ],
    requiredFields: {
      customers: ['id', 'firstName', 'lastName', 'email', 'type', 'status', 'created'],
      funding_sources: ['id', 'status', 'type', 'bankAccountType', 'name', 'created'],
      transfers: ['id', 'status', 'amount', 'created'],
    },
    notes: 'ACH payment platform. Amounts as decimal string in {value, currency} objects. Timestamps ISO 8601. Customer type: personal, business, receive-only. Transfer status: pending, processed, cancelled, failed. Uses camelCase field names.',
  };

  readonly dataSpec: DataSpec = {
    timestampFormat: 'iso8601',
    amountFields: ['amount'],
    statusEnums: {
      customers: ['unverified', 'retry', 'document', 'verified', 'suspended', 'deactivated'],
      transfers: ['pending', 'processed', 'cancelled', 'failed'],
      funding_sources: ['unverified', 'verified', 'removed'],
    },
    timestampFields: ['created'],
  };

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerDwollaTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.slice(7);
    const match = token.match(/^dwl_([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // ── Seed from expanded apiResponses ──────────────────────────────────
    this.seedFromApiResponses(data, store);

    // ══════════════════════════════════════════════════════════════════════
    //  AUTH VALIDATION HOOK
    // ══════════════════════════════════════════════════════════════════════

    server.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/dwolla')) return;
      if (req.url === '/dwolla/token' && req.method === 'POST') return;
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) {
        return reply.status(401).send(dwError('InvalidAccessToken', 'Access token is invalid.'));
      }
      const token = auth.slice(7);
      const session = store.get<any>(NS.tokens, token);
      if (!session) {
        return reply.status(401).send(dwError('InvalidAccessToken', 'Access token is invalid.'));
      }
    });

    // ══════════════════════════════════════════════════════════════════════
    //  AUTHENTICATION
    // ══════════════════════════════════════════════════════════════════════

    server.post('/dwolla/token', async (req, reply) => {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Basic ')) {
        return reply.status(401).send(dwError('InvalidCredentials', 'Missing Basic auth credentials.'));
      }
      const token = dwUuid();
      const session = {
        access_token: token,
        token_type: 'bearer',
        expires_in: 3600,
        created_at: new Date().toISOString(),
      };
      store.set(NS.tokens, token, session);
      return reply.status(200).send({
        access_token: token,
        token_type: 'bearer',
        expires_in: 3600,
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  CUSTOMERS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Customer ─────────────────────────────────────────────────
    server.post('/dwolla/customers', async (req, reply) => {
      const body = req.body as any;
      if (!body.firstName || !body.lastName || !body.email) {
        return reply.status(400).send(dwValidationError([
          ...(!body.firstName ? [{ code: 'Required', message: 'FirstName required.', path: '/firstName' }] : []),
          ...(!body.lastName ? [{ code: 'Required', message: 'LastName required.', path: '/lastName' }] : []),
          ...(!body.email ? [{ code: 'Required', message: 'Email required.', path: '/email' }] : []),
        ]));
      }
      const id = dwUuid();
      const customer = {
        id,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        type: body.type || 'personal',
        status: body.ssn || body.dateOfBirth ? 'verified' : 'unverified',
        businessName: body.businessName || null,
        address1: body.address1 || null,
        address2: body.address2 || null,
        city: body.city || null,
        state: body.state || null,
        postalCode: body.postalCode || null,
        phone: body.phone || null,
        created: new Date().toISOString(),
        _links: {
          self: { href: `${BASE}/customers/${id}` },
          'funding-sources': { href: `${BASE}/customers/${id}/funding-sources` },
          transfers: { href: `${BASE}/customers/${id}/transfers` },
        },
      };
      store.set(NS.customers, id, customer);
      emitEvent(store, 'customer_created', `${BASE}/customers/${id}`);
      return reply.status(201).header('Location', `${BASE}/customers/${id}`).send(customer);
    });

    // ── List Customers ──────────────────────────────────────────────────
    server.get('/dwolla/customers', async (req, reply) => {
      const query = req.query as any;
      const all = store.list<any>(NS.customers);
      let filtered = all;
      if (query.search) {
        const s = query.search.toLowerCase();
        filtered = all.filter((c: any) =>
          c.firstName.toLowerCase().includes(s) ||
          c.lastName.toLowerCase().includes(s) ||
          c.email.toLowerCase().includes(s),
        );
      }
      if (query.status) {
        filtered = filtered.filter((c: any) => c.status === query.status);
      }
      const limit = parseInt(query.limit) || 25;
      const offset = parseInt(query.offset) || 0;
      const page = filtered.slice(offset, offset + limit);
      return reply.send({
        _links: { self: { href: `${BASE}/customers` } },
        _embedded: { customers: page },
        total: filtered.length,
      });
    });

    // ── Get Customer ────────────────────────────────────────────────────
    server.get('/dwolla/customers/:id', async (req, reply) => {
      const { id } = req.params as any;
      const customer = store.get<any>(NS.customers, id);
      if (!customer) return reply.status(404).send(dwError('NotFound', `Customer ${id} not found.`));
      return reply.send(customer);
    });

    // ── Update Customer ─────────────────────────────────────────────────
    server.post('/dwolla/customers/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const customer = store.get<any>(NS.customers, id);
      if (!customer) return reply.status(404).send(dwError('NotFound', `Customer ${id} not found.`));
      const updatable = ['firstName', 'lastName', 'email', 'businessName', 'address1', 'address2', 'city', 'state', 'postalCode', 'phone', 'status'];
      const updates: Record<string, any> = {};
      for (const key of updatable) {
        if (body[key] !== undefined) updates[key] = body[key];
      }
      store.update(NS.customers, id, updates);
      const updated = store.get<any>(NS.customers, id);
      emitEvent(store, 'customer_updated', `${BASE}/customers/${id}`);
      return reply.send(updated);
    });

    // ── List Customer Funding Sources ───────────────────────────────────
    server.get('/dwolla/customers/:id/funding-sources', async (req, reply) => {
      const { id } = req.params as any;
      const customer = store.get<any>(NS.customers, id);
      if (!customer) return reply.status(404).send(dwError('NotFound', `Customer ${id} not found.`));
      const all = store.list<any>(NS.fundingSources);
      const sources = all.filter((fs: any) => fs.customerId === id && !fs.removed);
      return reply.send({
        _links: { self: { href: `${BASE}/customers/${id}/funding-sources` } },
        _embedded: { 'funding-sources': sources },
      });
    });

    // ── Create Funding Source for Customer ──────────────────────────────
    server.post('/dwolla/customers/:id/funding-sources', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const customer = store.get<any>(NS.customers, id);
      if (!customer) return reply.status(404).send(dwError('NotFound', `Customer ${id} not found.`));
      if (!body.routingNumber || !body.accountNumber || !body.bankAccountType || !body.name) {
        return reply.status(400).send(dwValidationError([
          { code: 'Required', message: 'Routing number, account number, bank account type, and name are required.', path: '/' },
        ]));
      }
      const fsId = dwUuid();
      const fundingSource = {
        id: fsId,
        customerId: id,
        status: 'unverified',
        type: 'bank',
        bankAccountType: body.bankAccountType,
        name: body.name,
        bankName: body.bankName || 'Mock Bank',
        fingerprint: dwUuid().replace(/-/g, ''),
        created: new Date().toISOString(),
        removed: false,
        channels: ['ach'],
        _links: {
          self: { href: `${BASE}/funding-sources/${fsId}` },
          customer: { href: `${BASE}/customers/${id}` },
          'initiate-micro-deposits': { href: `${BASE}/funding-sources/${fsId}/micro-deposits` },
        },
      };
      store.set(NS.fundingSources, fsId, fundingSource);
      emitEvent(store, 'customer_funding_source_added', `${BASE}/funding-sources/${fsId}`);
      return reply.status(201).header('Location', `${BASE}/funding-sources/${fsId}`).send(fundingSource);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  FUNDING SOURCES
    // ══════════════════════════════════════════════════════════════════════

    // ── Get Funding Source ──────────────────────────────────────────────
    server.get('/dwolla/funding-sources/:id', async (req, reply) => {
      const { id } = req.params as any;
      const fs = store.get<any>(NS.fundingSources, id);
      if (!fs || fs.removed) return reply.status(404).send(dwError('NotFound', `Funding source ${id} not found.`));
      return reply.send(fs);
    });

    // ── Update Funding Source ───────────────────────────────────────────
    server.post('/dwolla/funding-sources/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const fs = store.get<any>(NS.fundingSources, id);
      if (!fs || fs.removed) return reply.status(404).send(dwError('NotFound', `Funding source ${id} not found.`));
      const updates: Record<string, any> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.bankAccountType !== undefined) updates.bankAccountType = body.bankAccountType;
      store.update(NS.fundingSources, id, updates);
      return reply.send(store.get(NS.fundingSources, id));
    });

    // ── Remove Funding Source ───────────────────────────────────────────
    server.delete('/dwolla/funding-sources/:id', async (req, reply) => {
      const { id } = req.params as any;
      const fs = store.get<any>(NS.fundingSources, id);
      if (!fs || fs.removed) return reply.status(404).send(dwError('NotFound', `Funding source ${id} not found.`));
      store.update(NS.fundingSources, id, { removed: true });
      emitEvent(store, 'customer_funding_source_removed', `${BASE}/funding-sources/${id}`);
      return reply.status(200).send({ ...fs, removed: true });
    });

    // ── Get Funding Source Balance ──────────────────────────────────────
    server.get('/dwolla/funding-sources/:id/balance', async (req, reply) => {
      const { id } = req.params as any;
      const fs = store.get<any>(NS.fundingSources, id);
      if (!fs || fs.removed) return reply.status(404).send(dwError('NotFound', `Funding source ${id} not found.`));
      return reply.send({
        _links: { self: { href: `${BASE}/funding-sources/${id}/balance` } },
        balance: { value: '5000.00', currency: 'USD' },
        total: { value: '5000.00', currency: 'USD' },
        lastUpdated: new Date().toISOString(),
      });
    });

    // ── Initiate / Verify Micro-Deposits ────────────────────────────────
    server.post('/dwolla/funding-sources/:id/micro-deposits', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const fs = store.get<any>(NS.fundingSources, id);
      if (!fs || fs.removed) return reply.status(404).send(dwError('NotFound', `Funding source ${id} not found.`));

      // If amounts are provided, this is a verification request
      if (body.amount1 && body.amount2) {
        if (body.amount1.value === '0.03' && body.amount2.value === '0.09') {
          store.update(NS.fundingSources, id, {
            status: 'verified',
            _links: {
              ...fs._links,
              'verify-micro-deposits': undefined,
            },
          });
          emitEvent(store, 'customer_funding_source_verified', `${BASE}/funding-sources/${id}`);
          return reply.status(200).send(store.get(NS.fundingSources, id));
        }
        return reply.status(400).send(dwError('InvalidAmount', 'Micro-deposit amounts do not match.'));
      }

      // Otherwise initiate micro-deposits
      store.update(NS.fundingSources, id, { status: 'unverified' });
      emitEvent(store, 'customer_micro_deposits_added', `${BASE}/funding-sources/${id}`);
      return reply.status(201).send({ _links: { self: { href: `${BASE}/funding-sources/${id}/micro-deposits` } } });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  TRANSFERS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Transfer ─────────────────────────────────────────────────
    server.post('/dwolla/transfers', async (req, reply) => {
      const body = req.body as any;
      if (!body._links?.source?.href || !body._links?.destination?.href || !body.amount) {
        return reply.status(400).send(dwValidationError([
          { code: 'Required', message: 'Source, destination, and amount are required.', path: '/_links' },
        ]));
      }
      const id = dwUuid();
      const transfer = {
        id,
        status: 'pending',
        _links: {
          self: { href: `${BASE}/transfers/${id}` },
          source: body._links.source,
          destination: body._links.destination,
          'source-funding-source': body._links.source,
          'destination-funding-source': body._links.destination,
          cancel: { href: `${BASE}/transfers/${id}`, type: 'application/vnd.dwolla.v1.hal+json', 'resource-type': 'transfer' },
        },
        amount: {
          value: body.amount.value,
          currency: body.amount.currency || 'USD',
        },
        metadata: body.metadata || {},
        fees: body.fees || [],
        correlationId: body.correlationId || null,
        individualAchId: dwAchId(),
        clearing: body.clearing || { source: 'standard', destination: 'standard' },
        achDetails: body.achDetails || null,
        created: new Date().toISOString(),
      };
      store.set(NS.transfers, id, transfer);
      emitEvent(store, 'customer_transfer_created', `${BASE}/transfers/${id}`);
      return reply.status(201).header('Location', `${BASE}/transfers/${id}`).send(transfer);
    });

    // ── Get Transfer ────────────────────────────────────────────────────
    server.get('/dwolla/transfers/:id', async (req, reply) => {
      const { id } = req.params as any;
      const transfer = store.get<any>(NS.transfers, id);
      if (!transfer) return reply.status(404).send(dwError('NotFound', `Transfer ${id} not found.`));
      return reply.send(transfer);
    });

    // ── Cancel Transfer ─────────────────────────────────────────────────
    server.post('/dwolla/transfers/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const transfer = store.get<any>(NS.transfers, id);
      if (!transfer) return reply.status(404).send(dwError('NotFound', `Transfer ${id} not found.`));
      if (body.status !== 'cancelled') {
        return reply.status(400).send(dwError('InvalidStatus', 'Only cancellation is supported.'));
      }
      if (transfer.status !== 'pending') {
        return reply.status(400).send(dwError('InvalidResourceState', 'Transfer can only be cancelled when pending.'));
      }
      store.update(NS.transfers, id, { status: 'cancelled' });
      const updated = store.get<any>(NS.transfers, id);
      delete updated._links.cancel;
      store.set(NS.transfers, id, updated);
      emitEvent(store, 'customer_transfer_cancelled', `${BASE}/transfers/${id}`);
      return reply.send(updated);
    });

    // ── List Transfer Fees ──────────────────────────────────────────────
    server.get('/dwolla/transfers/:id/fees', async (req, reply) => {
      const { id } = req.params as any;
      const transfer = store.get<any>(NS.transfers, id);
      if (!transfer) return reply.status(404).send(dwError('NotFound', `Transfer ${id} not found.`));
      return reply.send({
        _links: { self: { href: `${BASE}/transfers/${id}/fees` } },
        _embedded: { fees: transfer.fees || [] },
        total: (transfer.fees || []).length,
      });
    });

    // ── Get Transfer Failure Reason ─────────────────────────────────────
    server.get('/dwolla/transfers/:id/failure', async (req, reply) => {
      const { id } = req.params as any;
      const transfer = store.get<any>(NS.transfers, id);
      if (!transfer) return reply.status(404).send(dwError('NotFound', `Transfer ${id} not found.`));
      if (transfer.status !== 'failed') {
        return reply.status(404).send(dwError('NotFound', 'No failure reason for non-failed transfer.'));
      }
      return reply.send({
        _links: { self: { href: `${BASE}/transfers/${id}/failure` } },
        code: 'R01',
        description: 'Insufficient Funds',
        explanation: 'Available balance is not sufficient to cover the dollar value of the debit entry.',
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  MASS PAYMENTS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Mass Payment ─────────────────────────────────────────────
    server.post('/dwolla/mass-payments', async (req, reply) => {
      const body = req.body as any;
      if (!body._links?.source?.href || !body.items || !Array.isArray(body.items)) {
        return reply.status(400).send(dwValidationError([
          { code: 'Required', message: 'Source and items are required.', path: '/' },
        ]));
      }
      if (body.items.length > 5000) {
        return reply.status(400).send(dwError('TooManyItems', 'Mass payment cannot exceed 5000 items.'));
      }
      const id = dwUuid();
      const items = body.items.map((item: any) => {
        const itemId = dwUuid();
        return {
          id: itemId,
          status: 'pending',
          amount: item.amount,
          _links: {
            self: { href: `${BASE}/mass-payment-items/${itemId}` },
            destination: item._links?.destination,
          },
          metadata: item.metadata || {},
        };
      });
      const massPayment = {
        id,
        status: body.status === 'deferred' ? 'deferred' : 'pending',
        _links: {
          self: { href: `${BASE}/mass-payments/${id}` },
          source: body._links.source,
          items: { href: `${BASE}/mass-payments/${id}/items` },
        },
        total: { value: items.reduce((sum: number, i: any) => sum + parseFloat(i.amount.value), 0).toFixed(2), currency: 'USD' },
        totalFees: { value: '0.00', currency: 'USD' },
        metadata: body.metadata || {},
        correlationId: body.correlationId || null,
        created: new Date().toISOString(),
      };
      store.set(NS.massPayments, id, massPayment);
      store.set(NS.massPaymentItems, id, items);
      emitEvent(store, 'mass_payment_created', `${BASE}/mass-payments/${id}`);
      return reply.status(201).header('Location', `${BASE}/mass-payments/${id}`).send(massPayment);
    });

    // ── Get Mass Payment ────────────────────────────────────────────────
    server.get('/dwolla/mass-payments/:id', async (req, reply) => {
      const { id } = req.params as any;
      const mp = store.get<any>(NS.massPayments, id);
      if (!mp) return reply.status(404).send(dwError('NotFound', `Mass payment ${id} not found.`));
      return reply.send(mp);
    });

    // ── Update Mass Payment ─────────────────────────────────────────────
    server.post('/dwolla/mass-payments/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const mp = store.get<any>(NS.massPayments, id);
      if (!mp) return reply.status(404).send(dwError('NotFound', `Mass payment ${id} not found.`));
      if (body.status === 'pending' && mp.status === 'deferred') {
        store.update(NS.massPayments, id, { status: 'pending' });
        emitEvent(store, 'mass_payment_processing', `${BASE}/mass-payments/${id}`);
      } else if (body.status) {
        return reply.status(400).send(dwError('InvalidResourceState', `Cannot transition from ${mp.status} to ${body.status}.`));
      }
      return reply.send(store.get(NS.massPayments, id));
    });

    // ── List Mass Payment Items ─────────────────────────────────────────
    server.get('/dwolla/mass-payments/:id/items', async (req, reply) => {
      const { id } = req.params as any;
      const mp = store.get<any>(NS.massPayments, id);
      if (!mp) return reply.status(404).send(dwError('NotFound', `Mass payment ${id} not found.`));
      const items = store.get<any[]>(NS.massPaymentItems, id) || [];
      const query = req.query as any;
      const limit = parseInt(query.limit) || 25;
      const offset = parseInt(query.offset) || 0;
      const page = items.slice(offset, offset + limit);
      return reply.send({
        _links: { self: { href: `${BASE}/mass-payments/${id}/items` } },
        _embedded: { items: page },
        total: items.length,
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  EVENTS
    // ══════════════════════════════════════════════════════════════════════

    // ── List Events ─────────────────────────────────────────────────────
    server.get('/dwolla/events', async (req, reply) => {
      const query = req.query as any;
      const all = store.list<any>(NS.events);
      const limit = parseInt(query.limit) || 25;
      const offset = parseInt(query.offset) || 0;
      const page = all.slice(offset, offset + limit);
      return reply.send({
        _links: { self: { href: `${BASE}/events` } },
        _embedded: { events: page },
        total: all.length,
      });
    });

    // ── Get Event ───────────────────────────────────────────────────────
    server.get('/dwolla/events/:id', async (req, reply) => {
      const { id } = req.params as any;
      const event = store.get<any>(NS.events, id);
      if (!event) return reply.status(404).send(dwError('NotFound', `Event ${id} not found.`));
      return reply.send(event);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  WEBHOOK SUBSCRIPTIONS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Webhook Subscription ─────────────────────────────────────
    server.post('/dwolla/webhook-subscriptions', async (req, reply) => {
      const body = req.body as any;
      if (!body.url || !body.secret) {
        return reply.status(400).send(dwValidationError([
          { code: 'Required', message: 'URL and secret are required.', path: '/' },
        ]));
      }
      const id = dwUuid();
      const sub = {
        id,
        url: body.url,
        paused: false,
        created: new Date().toISOString(),
        _links: {
          self: { href: `${BASE}/webhook-subscriptions/${id}` },
          webhooks: { href: `${BASE}/webhook-subscriptions/${id}/webhooks` },
        },
      };
      store.set(NS.webhookSubs, id, sub);
      return reply.status(201).header('Location', `${BASE}/webhook-subscriptions/${id}`).send(sub);
    });

    // ── List Webhook Subscriptions ──────────────────────────────────────
    server.get('/dwolla/webhook-subscriptions', async (_req, reply) => {
      const all = store.list<any>(NS.webhookSubs);
      return reply.send({
        _links: { self: { href: `${BASE}/webhook-subscriptions` } },
        _embedded: { 'webhook-subscriptions': all },
        total: all.length,
      });
    });

    // ── Get Webhook Subscription ────────────────────────────────────────
    server.get('/dwolla/webhook-subscriptions/:id', async (req, reply) => {
      const { id } = req.params as any;
      const sub = store.get<any>(NS.webhookSubs, id);
      if (!sub) return reply.status(404).send(dwError('NotFound', `Webhook subscription ${id} not found.`));
      return reply.send(sub);
    });

    // ── Delete Webhook Subscription ─────────────────────────────────────
    server.delete('/dwolla/webhook-subscriptions/:id', async (req, reply) => {
      const { id } = req.params as any;
      const sub = store.get<any>(NS.webhookSubs, id);
      if (!sub) return reply.status(404).send(dwError('NotFound', `Webhook subscription ${id} not found.`));
      store.delete(NS.webhookSubs, id);
      return reply.status(200).send(sub);
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      { method: 'POST', path: '/dwolla/token', description: 'Generate OAuth2 access token' },
      { method: 'POST', path: '/dwolla/customers', description: 'Create customer' },
      { method: 'GET', path: '/dwolla/customers', description: 'List customers' },
      { method: 'GET', path: '/dwolla/customers/:id', description: 'Get customer' },
      { method: 'POST', path: '/dwolla/customers/:id', description: 'Update customer' },
      { method: 'GET', path: '/dwolla/customers/:id/funding-sources', description: 'List customer funding sources' },
      { method: 'POST', path: '/dwolla/customers/:id/funding-sources', description: 'Create funding source' },
      { method: 'GET', path: '/dwolla/funding-sources/:id', description: 'Get funding source' },
      { method: 'POST', path: '/dwolla/funding-sources/:id', description: 'Update funding source' },
      { method: 'DELETE', path: '/dwolla/funding-sources/:id', description: 'Remove funding source' },
      { method: 'GET', path: '/dwolla/funding-sources/:id/balance', description: 'Get funding source balance' },
      { method: 'POST', path: '/dwolla/funding-sources/:id/micro-deposits', description: 'Initiate/verify micro-deposits' },
      { method: 'POST', path: '/dwolla/transfers', description: 'Create transfer' },
      { method: 'GET', path: '/dwolla/transfers/:id', description: 'Get transfer' },
      { method: 'POST', path: '/dwolla/transfers/:id', description: 'Cancel transfer' },
      { method: 'GET', path: '/dwolla/transfers/:id/fees', description: 'List transfer fees' },
      { method: 'GET', path: '/dwolla/transfers/:id/failure', description: 'Get transfer failure reason' },
      { method: 'POST', path: '/dwolla/mass-payments', description: 'Create mass payment' },
      { method: 'GET', path: '/dwolla/mass-payments/:id', description: 'Get mass payment' },
      { method: 'POST', path: '/dwolla/mass-payments/:id', description: 'Update mass payment' },
      { method: 'GET', path: '/dwolla/mass-payments/:id/items', description: 'List mass payment items' },
      { method: 'GET', path: '/dwolla/events', description: 'List events' },
      { method: 'GET', path: '/dwolla/events/:id', description: 'Get event' },
      { method: 'POST', path: '/dwolla/webhook-subscriptions', description: 'Create webhook subscription' },
      { method: 'GET', path: '/dwolla/webhook-subscriptions', description: 'List webhook subscriptions' },
      { method: 'GET', path: '/dwolla/webhook-subscriptions/:id', description: 'Get webhook subscription' },
      { method: 'DELETE', path: '/dwolla/webhook-subscriptions/:id', description: 'Delete webhook subscription' },
    ];
  }

  // ── Cross-surface seeding ──────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    customers: NS.customers,
    funding_sources: NS.fundingSources,
    transfers: NS.transfers,
    mass_payments: NS.massPayments,
    events: NS.events,
    webhook_subscriptions: NS.webhookSubs,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const dwData = expanded.apiResponses?.dwolla;
      if (!dwData) continue;

      for (const [resourceType, responses] of Object.entries(dwData.responses)) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          const key = body.id as string;
          if (!key) continue;

          store.set(namespace, String(key), body);
        }
      }
    }
  }
}
