import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { CheckoutComConfig } from './config.js';
import { ckoError } from './checkout-com-errors.js';
import { registerCheckoutComTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  payments: 'cko_payments',
  tokens: 'cko_tokens',
  instruments: 'cko_instruments',
  customers: 'cko_customers',
  disputes: 'cko_disputes',
  hosted: 'cko_hosted',
  paymentLinks: 'cko_payment_links',
  paymentSessions: 'cko_payment_sessions',
  sessions3ds: 'cko_sessions_3ds',
  transfers: 'cko_transfers',
  balances: 'cko_balances',
  workflows: 'cko_workflows',
  events: 'cko_events',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a Checkout.com-style prefixed ID */
function ckoId(prefix: string): string {
  return `${prefix}_${generateId('', 26)}`;
}

// ---------------------------------------------------------------------------
// Checkout.com Adapter
// ---------------------------------------------------------------------------

export class CheckoutComAdapter extends BaseApiMockAdapter<CheckoutComConfig> {
  readonly id = 'checkout';
  readonly name = 'Checkout.com API';
  readonly basePath = '/checkout';
  readonly versions = ['default'];

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerCheckoutComTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.replace('Bearer ', '').match(/^sk_(?:test_)?([a-z0-9-]+)/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // ── Seed from expanded apiResponses ──────────────────────────────────
    this.seedFromApiResponses(data, store);

    const p = this.basePath;

    // ══════════════════════════════════════════════════════════════════════
    //  PAYMENTS
    // ══════════════════════════════════════════════════════════════════════

    // ── Request Payment ──────────────────────────────────────────────────
    server.post(`${p}/payments`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, any>;

      // Sandbox testing via reference prefix
      const reference = (body.reference as string) || '';
      if (reference.startsWith('ERROR_')) {
        return reply.status(500).send(ckoError('processing_error', 'Internal server error'));
      }

      const paymentId = ckoId('pay');
      const actionId = ckoId('act');

      let approved = true;
      let status = body.capture === false ? 'Authorized' : 'Captured';
      let responseCode = '10000';
      let responseSummary = 'Approved';
      let flagged = false;

      if (reference.startsWith('DECLINE_')) {
        approved = false;
        status = 'Declined';
        responseCode = '20005';
        responseSummary = 'Do Not Honor';
      } else if (reference.startsWith('PENDING_')) {
        status = 'Pending';
      } else if (reference.startsWith('FLAG_')) {
        flagged = true;
      } else if (reference.startsWith('3DS_')) {
        status = 'Pending';
      }

      const payment: any = {
        id: paymentId,
        action_id: actionId,
        amount: body.amount,
        currency: body.currency || 'USD',
        approved,
        status,
        auth_code: String(Math.floor(100000 + Math.random() * 899999)),
        response_code: responseCode,
        response_summary: responseSummary,
        source: {
          type: body.source?.type || 'card',
          scheme: 'Visa',
          last4: '4242',
          fingerprint: generateId('', 26),
          bin: '424242',
          card_type: 'Credit',
          issuer_country: 'US',
        },
        customer: body.customer
          ? {
              id: body.customer.id || ckoId('cus'),
              email: body.customer.email,
            }
          : undefined,
        processing: {
          acquirer_transaction_id: generateId('', 10),
          retrieval_reference_number: generateId('', 12),
        },
        reference: body.reference,
        processing_channel_id: this.config?.processingChannelId || 'pc_mimic_test',
        _links: {
          self: { href: `https://api.sandbox.checkout.com/payments/${paymentId}` },
          actions: { href: `https://api.sandbox.checkout.com/payments/${paymentId}/actions` },
        },
        processed_on: new Date().toISOString(),
        requested_on: new Date().toISOString(),
      };

      if (flagged) {
        payment.flagged = true;
      }

      if (body.capture === false && approved) {
        payment._links.capture = { href: `https://api.sandbox.checkout.com/payments/${paymentId}/captures` };
        payment._links.void = { href: `https://api.sandbox.checkout.com/payments/${paymentId}/voids` };
      }

      store.set(NS.payments, paymentId, payment);
      return reply.status(201).send(payment);
    });

    // ── Get Payment ──────────────────────────────────────────────────────
    server.get(`${p}/payments/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const payment = store.get<any>(NS.payments, id);
      if (!payment) return reply.status(404).send(ckoError('payment_not_found', `Payment ${id} not found`));
      return reply.send(payment);
    });

    // ── Capture Payment ──────────────────────────────────────────────────
    server.post(`${p}/payments/:id/captures`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, any>;
      const payment = store.get<any>(NS.payments, id);
      if (!payment) return reply.status(404).send(ckoError('payment_not_found', `Payment ${id} not found`));
      if (payment.status !== 'Authorized') {
        return reply.status(422).send(ckoError('action_not_allowed', `Payment ${id} cannot be captured in state ${payment.status}`));
      }

      const actionId = ckoId('act');
      store.update(NS.payments, id, { status: 'Captured' });
      return reply.status(202).send({ action_id: actionId, reference: body.reference });
    });

    // ── Refund Payment ───────────────────────────────────────────────────
    server.post(`${p}/payments/:id/refunds`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, any>;
      const payment = store.get<any>(NS.payments, id);
      if (!payment) return reply.status(404).send(ckoError('payment_not_found', `Payment ${id} not found`));
      if (payment.status !== 'Captured') {
        return reply.status(422).send(ckoError('action_not_allowed', `Payment ${id} cannot be refunded in state ${payment.status}`));
      }

      const actionId = ckoId('act');
      store.update(NS.payments, id, { status: 'Refunded' });
      return reply.status(202).send({ action_id: actionId, reference: body.reference });
    });

    // ── Void Payment ─────────────────────────────────────────────────────
    server.post(`${p}/payments/:id/voids`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, any>;
      const payment = store.get<any>(NS.payments, id);
      if (!payment) return reply.status(404).send(ckoError('payment_not_found', `Payment ${id} not found`));
      if (payment.status !== 'Authorized') {
        return reply.status(422).send(ckoError('action_not_allowed', `Payment ${id} cannot be voided in state ${payment.status}`));
      }

      const actionId = ckoId('act');
      store.update(NS.payments, id, { status: 'Voided' });
      return reply.status(202).send({ action_id: actionId, reference: body.reference });
    });

    // ── Payment Actions (Audit Trail) ────────────────────────────────────
    server.get(`${p}/payments/:id/actions`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const payment = store.get<any>(NS.payments, id);
      if (!payment) return reply.status(404).send(ckoError('payment_not_found', `Payment ${id} not found`));
      return reply.send([
        {
          id: payment.action_id,
          type: payment.status === 'Captured' ? 'Capture' : 'Authorization',
          processed_on: payment.processed_on,
          amount: payment.amount,
          approved: payment.approved,
          response_code: payment.response_code,
          response_summary: payment.response_summary,
        },
      ]);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  TOKENS
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/tokens`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, any>;
      const token = {
        type: 'card',
        token: ckoId('tok'),
        expires_on: new Date(Date.now() + 900_000).toISOString(),
        scheme: 'Visa',
        last4: body.number?.slice(-4) || '4242',
        bin: body.number?.slice(0, 6) || '424242',
        card_type: 'Credit',
        issuer_country: 'US',
      };
      store.set(NS.tokens, token.token, token);
      return reply.status(201).send(token);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  INSTRUMENTS (Vaulted Payment Methods)
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/instruments`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, any>;
      const instrument = {
        id: ckoId('src'),
        type: body.type || 'card',
        scheme: 'Visa',
        last4: '4242',
        bin: '424242',
        expiry_month: body.expiry_month || 12,
        expiry_year: body.expiry_year || 2028,
        customer: body.customer,
        fingerprint: generateId('', 26),
      };
      store.set(NS.instruments, instrument.id, instrument);
      return reply.status(201).send(instrument);
    });

    server.get(`${p}/instruments/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const inst = store.get<any>(NS.instruments, id);
      if (!inst) return reply.status(404).send(ckoError('instrument_not_found', `Instrument ${id} not found`));
      return reply.send(inst);
    });

    server.patch(`${p}/instruments/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, any>;
      const inst = store.get<any>(NS.instruments, id);
      if (!inst) return reply.status(404).send(ckoError('instrument_not_found', `Instrument ${id} not found`));
      store.update(NS.instruments, id, body);
      return reply.send({ ...inst, ...body });
    });

    server.delete(`${p}/instruments/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const inst = store.get<any>(NS.instruments, id);
      if (!inst) return reply.status(404).send(ckoError('instrument_not_found', `Instrument ${id} not found`));
      store.delete(NS.instruments, id);
      return reply.status(204).send();
    });

    // ══════════════════════════════════════════════════════════════════════
    //  CUSTOMERS
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/customers`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, any>;
      const customer = {
        id: ckoId('cus'),
        email: body.email,
        name: body.name,
        phone: body.phone,
        metadata: body.metadata || {},
        instruments: [],
        default: body.default,
      };
      store.set(NS.customers, customer.id, customer);
      return reply.status(201).send(customer);
    });

    server.get(`${p}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = store.get<any>(NS.customers, id);
      if (!customer) return reply.status(404).send(ckoError('customer_not_found', `Customer ${id} not found`));
      return reply.send(customer);
    });

    server.patch(`${p}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, any>;
      const customer = store.get<any>(NS.customers, id);
      if (!customer) return reply.status(404).send(ckoError('customer_not_found', `Customer ${id} not found`));
      store.update(NS.customers, id, body);
      return reply.send({ ...customer, ...body });
    });

    server.delete(`${p}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = store.get<any>(NS.customers, id);
      if (!customer) return reply.status(404).send(ckoError('customer_not_found', `Customer ${id} not found`));
      store.delete(NS.customers, id);
      return reply.status(204).send();
    });

    // ══════════════════════════════════════════════════════════════════════
    //  DISPUTES
    // ══════════════════════════════════════════════════════════════════════

    server.get(`${p}/disputes`, async (req, reply) => {
      const disputes = store.list<any>(NS.disputes);
      return reply.send({
        limit: 50,
        skip: 0,
        total_count: disputes.length,
        data: disputes,
      });
    });

    server.get(`${p}/disputes/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const dispute = store.get<any>(NS.disputes, id);
      if (!dispute) return reply.status(404).send(ckoError('dispute_not_found', `Dispute ${id} not found`));
      return reply.send(dispute);
    });

    server.post(`${p}/disputes/:id/evidence`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const dispute = store.get<any>(NS.disputes, id);
      if (!dispute) return reply.status(404).send(ckoError('dispute_not_found', `Dispute ${id} not found`));
      store.update(NS.disputes, id, { status: 'evidence_under_review' });
      return reply.status(204).send();
    });

    server.post(`${p}/disputes/:id/accept`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const dispute = store.get<any>(NS.disputes, id);
      if (!dispute) return reply.status(404).send(ckoError('dispute_not_found', `Dispute ${id} not found`));
      store.update(NS.disputes, id, { status: 'accepted' });
      return reply.status(204).send();
    });

    // ══════════════════════════════════════════════════════════════════════
    //  HOSTED PAYMENTS
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/hosted-payments`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, any>;
      const hpId = ckoId('hpp');
      const hp = {
        id: hpId,
        reference: body.reference,
        amount: body.amount,
        currency: body.currency,
        _links: {
          self: { href: `https://api.sandbox.checkout.com/hosted-payments/${hpId}` },
          redirect: { href: `https://pay.sandbox.checkout.com/page/${hpId}` },
        },
      };
      store.set(NS.hosted, hpId, hp);
      return reply.status(201).send(hp);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PAYMENT LINKS
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/payment-links`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, any>;
      const plId = ckoId('pl');
      const pl = {
        id: plId,
        amount: body.amount,
        currency: body.currency || 'USD',
        reference: body.reference,
        description: body.description,
        expires_on: new Date(Date.now() + 86_400_000).toISOString(),
        _links: {
          self: { href: `https://api.sandbox.checkout.com/payment-links/${plId}` },
          redirect: { href: `https://pay.sandbox.checkout.com/link/${plId}` },
        },
      };
      store.set(NS.paymentLinks, plId, pl);
      return reply.status(201).send(pl);
    });

    server.get(`${p}/payment-links/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const pl = store.get<any>(NS.paymentLinks, id);
      if (!pl) return reply.status(404).send(ckoError('payment_link_not_found', `Payment link ${id} not found`));
      return reply.send(pl);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PAYMENT SESSIONS (Flow)
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/payment-sessions`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, any>;
      const psId = ckoId('ps');
      const ps = {
        id: psId,
        payment_session_token: generateId('', 40),
        amount: body.amount,
        currency: body.currency || 'USD',
        reference: body.reference,
        _links: {
          self: { href: `https://api.sandbox.checkout.com/payment-sessions/${psId}` },
        },
      };
      store.set(NS.paymentSessions, psId, ps);
      return reply.status(201).send(ps);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  SESSIONS (3DS)
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/sessions`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, any>;
      const sessionId = ckoId('sid');
      const session = {
        id: sessionId,
        session_secret: generateId('', 40),
        transaction_id: generateId('', 20),
        scheme: body.source?.scheme || 'Visa',
        amount: body.amount,
        currency: body.currency || 'USD',
        authentication_type: body.authentication_type || 'regular',
        authentication_category: body.authentication_category || 'payment',
        status: 'pending',
        next_actions: ['redirect_cardholder'],
        _links: {
          self: { href: `https://api.sandbox.checkout.com/sessions/${sessionId}` },
          redirect_url: { href: `https://3ds.sandbox.checkout.com/redirect/${sessionId}` },
        },
      };
      store.set(NS.sessions3ds, sessionId, session);
      return reply.status(201).send(session);
    });

    server.get(`${p}/sessions/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const session = store.get<any>(NS.sessions3ds, id);
      if (!session) return reply.status(404).send(ckoError('session_not_found', `Session ${id} not found`));
      return reply.send(session);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  FX RATES
    // ══════════════════════════════════════════════════════════════════════

    server.get(`${p}/forex/rates`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      const source = query.source || 'USD';
      const target = query.target || 'EUR';
      return reply.send({
        source,
        rates: [
          {
            exchange_rate: 0.92 + Math.random() * 0.02,
            currency_pair: `${source}/${target}`,
            target,
          },
        ],
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  TRANSFERS (Platforms)
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/transfers`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, any>;
      const transferId = ckoId('tra');
      const transfer = {
        id: transferId,
        status: 'pending',
        source: body.source,
        destination: body.destination,
        amount: body.amount,
        currency: body.currency || 'USD',
        reference: body.reference,
        transfer_type: body.transfer_type || 'commission',
        created_on: new Date().toISOString(),
      };
      store.set(NS.transfers, transferId, transfer);
      return reply.status(201).send(transfer);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  BALANCES
    // ══════════════════════════════════════════════════════════════════════

    server.get(`${p}/balances/:entityId`, async (req, reply) => {
      const { entityId } = req.params as { entityId: string };
      return reply.send({
        entity_id: entityId,
        balances: [
          {
            currency: 'USD',
            available: Math.floor(10000 + Math.random() * 90000),
            pending: Math.floor(1000 + Math.random() * 5000),
          },
          {
            currency: 'EUR',
            available: Math.floor(8000 + Math.random() * 40000),
            pending: Math.floor(500 + Math.random() * 2000),
          },
        ],
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  WORKFLOWS (Webhooks)
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/workflows`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, any>;
      const wfId = ckoId('wf');
      const workflow = {
        id: wfId,
        name: body.name || 'Default Workflow',
        active: true,
        conditions: body.conditions || [],
        actions: body.actions || [],
        _links: {
          self: { href: `https://api.sandbox.checkout.com/workflows/${wfId}` },
        },
      };
      store.set(NS.workflows, wfId, workflow);
      return reply.status(201).send(workflow);
    });

    server.get(`${p}/workflows`, async (req, reply) => {
      const workflows = store.list<any>(NS.workflows);
      return reply.send({ data: workflows });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  EVENTS
    // ══════════════════════════════════════════════════════════════════════

    server.get(`${p}/event-types`, async (_req, reply) => {
      return reply.send({
        items: [
          { event_type: 'payment_approved', description: 'Payment approved' },
          { event_type: 'payment_declined', description: 'Payment declined' },
          { event_type: 'payment_captured', description: 'Payment captured' },
          { event_type: 'payment_refunded', description: 'Payment refunded' },
          { event_type: 'payment_voided', description: 'Payment voided' },
          { event_type: 'dispute_received', description: 'Dispute received' },
          { event_type: 'dispute_resolved', description: 'Dispute resolved' },
        ],
      });
    });

    server.get(`${p}/events/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const event = store.get<any>(NS.events, id);
      if (!event) return reply.status(404).send(ckoError('event_not_found', `Event ${id} not found`));
      return reply.send(event);
    });
  }

  // ── Endpoint definitions ──────────────────────────────────────────────

  getEndpoints(): EndpointDefinition[] {
    const p = this.basePath;
    return [
      // Payments
      { method: 'POST', path: `${p}/payments`, description: 'Request payment' },
      { method: 'GET', path: `${p}/payments/:id`, description: 'Get payment details' },
      { method: 'POST', path: `${p}/payments/:id/captures`, description: 'Capture payment' },
      { method: 'POST', path: `${p}/payments/:id/refunds`, description: 'Refund payment' },
      { method: 'POST', path: `${p}/payments/:id/voids`, description: 'Void payment' },
      { method: 'GET', path: `${p}/payments/:id/actions`, description: 'Get payment actions' },
      // Tokens
      { method: 'POST', path: `${p}/tokens`, description: 'Tokenize card' },
      // Instruments
      { method: 'POST', path: `${p}/instruments`, description: 'Create instrument' },
      { method: 'GET', path: `${p}/instruments/:id`, description: 'Get instrument' },
      { method: 'PATCH', path: `${p}/instruments/:id`, description: 'Update instrument' },
      { method: 'DELETE', path: `${p}/instruments/:id`, description: 'Delete instrument' },
      // Customers
      { method: 'POST', path: `${p}/customers`, description: 'Create customer' },
      { method: 'GET', path: `${p}/customers/:id`, description: 'Get customer' },
      { method: 'PATCH', path: `${p}/customers/:id`, description: 'Update customer' },
      { method: 'DELETE', path: `${p}/customers/:id`, description: 'Delete customer' },
      // Disputes
      { method: 'GET', path: `${p}/disputes`, description: 'List disputes' },
      { method: 'GET', path: `${p}/disputes/:id`, description: 'Get dispute' },
      { method: 'POST', path: `${p}/disputes/:id/evidence`, description: 'Submit evidence' },
      { method: 'POST', path: `${p}/disputes/:id/accept`, description: 'Accept dispute' },
      // Hosted Payments
      { method: 'POST', path: `${p}/hosted-payments`, description: 'Create hosted payment page' },
      // Payment Links
      { method: 'POST', path: `${p}/payment-links`, description: 'Create payment link' },
      { method: 'GET', path: `${p}/payment-links/:id`, description: 'Get payment link' },
      // Payment Sessions
      { method: 'POST', path: `${p}/payment-sessions`, description: 'Create payment session' },
      // Sessions (3DS)
      { method: 'POST', path: `${p}/sessions`, description: 'Create 3DS session' },
      { method: 'GET', path: `${p}/sessions/:id`, description: 'Get 3DS session' },
      // FX Rates
      { method: 'GET', path: `${p}/forex/rates`, description: 'Get indicative FX rates' },
      // Transfers
      { method: 'POST', path: `${p}/transfers`, description: 'Transfer funds' },
      // Balances
      { method: 'GET', path: `${p}/balances/:entityId`, description: 'Get entity balance' },
      // Workflows
      { method: 'POST', path: `${p}/workflows`, description: 'Create workflow' },
      { method: 'GET', path: `${p}/workflows`, description: 'List workflows' },
      // Events
      { method: 'GET', path: `${p}/event-types`, description: 'List event types' },
      { method: 'GET', path: `${p}/events/:id`, description: 'Get event' },
    ];
  }

  // ── Cross-surface seeding ──────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    payments: NS.payments,
    tokens: NS.tokens,
    instruments: NS.instruments,
    customers: NS.customers,
    disputes: NS.disputes,
    hosted: NS.hosted,
    paymentLinks: NS.paymentLinks,
    workflows: NS.workflows,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const ckoData = expanded.apiResponses?.checkout;
      if (!ckoData) continue;

      for (const [resourceType, responses] of Object.entries(ckoData.responses)) {
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
