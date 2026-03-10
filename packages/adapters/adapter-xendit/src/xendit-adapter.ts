import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, DataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { XenditConfig } from './config.js';
import { xndError } from './xendit-errors.js';
import { registerXenditTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  paymentRequests: 'xnd_payment_requests',
  paymentMethods: 'xnd_payment_methods',
  invoices: 'xnd_invoices',
  payouts: 'xnd_payouts',
  refunds: 'xnd_refunds',
  customers: 'xnd_customers',
} as const;

// ---------------------------------------------------------------------------
// Xendit Adapter
// ---------------------------------------------------------------------------

export class XenditAdapter extends BaseApiMockAdapter<XenditConfig> {
  readonly id = 'xendit';
  readonly name = 'Xendit API';
  readonly basePath = '/xendit';
  readonly versions = ['v3', 'v2'];

  readonly promptContext = {
    resources: ['customers', 'invoices', 'payment_requests', 'payouts', 'balance', 'refunds'],
    amountFormat: 'integer (e.g. 29900 for IDR, follows currency minor units)',
    relationships: [
      'invoice → customer',
      'payment_request → customer',
      'payout → customer',
      'refund → payment_request',
    ],
    requiredFields: {
      customers: ['id', 'reference_id', 'email', 'type', 'created'],
      invoices: ['id', 'external_id', 'amount', 'status', 'currency', 'created'],
      payment_requests: ['id', 'reference_id', 'amount', 'currency', 'status', 'payment_method', 'created'],
      payouts: ['id', 'reference_id', 'amount', 'currency', 'status', 'channel_code', 'created'],
    },
    notes: 'Southeast Asian payment gateway. Amounts as integers in currency minor units. Timestamps ISO 8601. Invoice status: PENDING, PAID, EXPIRED. Payment request status: REQUIRES_ACTION, PENDING, SUCCEEDED, FAILED. Primarily used in Indonesia, Philippines, Vietnam.',
  };

  readonly dataSpec: DataSpec = {
    timestampFormat: 'iso8601',
    amountFields: ['amount'],
    statusEnums: {
      invoices: ['PENDING', 'PAID', 'EXPIRED'],
      payment_requests: ['REQUIRES_ACTION', 'PENDING', 'SUCCEEDED', 'FAILED'],
      payouts: ['ACCEPTED', 'QUEUED', 'SENDING', 'COMPLETED', 'FAILED'],
    },
    timestampFields: ['created', 'updated', 'expiry_date'],
  };

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerXenditTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    // Basic auth: base64(api_key:) -- key as username, empty password
    const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
    const key = decoded.replace(/:$/, '');
    // Keys look like xnd_development_<persona>_<random> or xnd_production_<persona>_<random>
    const match = key.match(/^xnd_(?:development|production)_([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    _data: Map<string, ExpandedData>,
    state: StateStore,
  ): Promise<void> {
    // ── Auth Middleware (validate Basic auth) ─────────────
    server.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/xendit')) return;
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Basic ')) {
        return reply.status(401).send(xndError(401, 'UNAUTHORIZED', 'You have not been authenticated.'));
      }
      const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
      const key = decoded.replace(/:$/, '');
      if (!key.startsWith('xnd_development_') && !key.startsWith('xnd_production_')) {
        return reply.status(401).send(xndError(401, 'INVALID_API_KEY', 'API key is not valid.'));
      }
    });

    // ══════════════════════════════════════════════════════
    //  PAYMENT REQUESTS (v3)
    // ══════════════════════════════════════════════════════

    // ── Create Payment Request ────────────────────────────
    server.post('/xendit/v3/payment_requests', async (req, reply) => {
      const body = req.body as any;
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      // Idempotency check
      if (idempotencyKey) {
        const existing = state.list<any>(NS.paymentRequests).find(
          (pr: any) => pr._idempotency_key === idempotencyKey,
        );
        if (existing) return reply.send(existing);
      }

      const id = `pr-${generateId('', 36)}`;
      const now = new Date().toISOString();
      const paymentRequest = {
        id,
        reference_id: body.reference_id || id,
        business_id: `biz-${generateId('', 36)}`,
        currency: body.currency || 'IDR',
        amount: body.amount || 0,
        country: body.country || 'ID',
        payment_method: body.payment_method || {},
        description: body.description || null,
        metadata: body.metadata || {},
        status: 'REQUIRES_ACTION',
        actions: [
          {
            action: 'AUTH',
            url: `https://checkout.xendit.co/web/${id}`,
            url_type: 'WEB',
          },
        ],
        created: now,
        updated: now,
        _idempotency_key: idempotencyKey || null,
      };
      state.set(NS.paymentRequests, id, paymentRequest);
      return reply.status(201).send(paymentRequest);
    });

    // ── Get Payment Request ───────────────────────────────
    server.get('/xendit/v3/payment_requests/:id', async (req, reply) => {
      const { id } = req.params as any;
      const pr = state.get<any>(NS.paymentRequests, id);
      if (!pr) return reply.status(404).send(xndError(404, 'DATA_NOT_FOUND', `Payment request ${id} not found`));
      return reply.send(pr);
    });

    // ── List Payment Requests ─────────────────────────────
    server.get('/xendit/v3/payment_requests', async (req, reply) => {
      const query = req.query as any;
      let items = state.list<any>(NS.paymentRequests);

      if (query.reference_id) {
        items = items.filter((pr: any) => pr.reference_id === query.reference_id);
      }
      if (query.status) {
        items = items.filter((pr: any) => pr.status === query.status);
      }

      const limit = parseInt(query.limit) || 10;
      const afterId = query.after_id;
      if (afterId) {
        const idx = items.findIndex((pr: any) => pr.id === afterId);
        if (idx >= 0) items = items.slice(idx + 1);
      }
      items = items.slice(0, limit);

      return reply.send({
        data: items,
        has_more: items.length === limit,
      });
    });

    // ══════════════════════════════════════════════════════
    //  PAYMENT METHODS (v3)
    // ══════════════════════════════════════════════════════

    // ── Create Payment Method ─────────────────────────────
    server.post('/xendit/v3/payment_methods', async (req, reply) => {
      const body = req.body as any;
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      if (idempotencyKey) {
        const existing = state.list<any>(NS.paymentMethods).find(
          (pm: any) => pm._idempotency_key === idempotencyKey,
        );
        if (existing) return reply.send(existing);
      }

      const id = `pm-${generateId('', 36)}`;
      const now = new Date().toISOString();
      const paymentMethod = {
        id,
        business_id: `biz-${generateId('', 36)}`,
        type: body.type || 'EWALLET',
        country: body.country || 'ID',
        customer_id: body.customer_id || null,
        reference_id: body.reference_id || id,
        reusability: body.reusability || 'ONE_TIME_USE',
        status: 'ACTIVE',
        actions: [],
        metadata: body.metadata || {},
        description: body.description || null,
        created: now,
        updated: now,
        ewallet: body.type === 'EWALLET' ? (body.ewallet || {}) : undefined,
        card: body.type === 'CARDS' ? (body.card || {}) : undefined,
        direct_debit: body.type === 'DIRECT_DEBIT' ? (body.direct_debit || {}) : undefined,
        over_the_counter: body.type === 'RETAIL_OUTLET' ? (body.over_the_counter || {}) : undefined,
        virtual_account: body.type === 'VIRTUAL_ACCOUNT' ? (body.virtual_account || {}) : undefined,
        qr_code: body.type === 'QR_CODE' ? (body.qr_code || {}) : undefined,
        _idempotency_key: idempotencyKey || null,
      };
      state.set(NS.paymentMethods, id, paymentMethod);
      return reply.status(201).send(paymentMethod);
    });

    // ── Get Payment Method ────────────────────────────────
    server.get('/xendit/v3/payment_methods/:id', async (req, reply) => {
      const { id } = req.params as any;
      const pm = state.get<any>(NS.paymentMethods, id);
      if (!pm) return reply.status(404).send(xndError(404, 'DATA_NOT_FOUND', `Payment method ${id} not found`));
      return reply.send(pm);
    });

    // ── List Payment Methods ──────────────────────────────
    server.get('/xendit/v3/payment_methods', async (req, reply) => {
      const query = req.query as any;
      let items = state.list<any>(NS.paymentMethods);

      if (query.type) {
        items = items.filter((pm: any) => pm.type === query.type);
      }
      if (query.customer_id) {
        items = items.filter((pm: any) => pm.customer_id === query.customer_id);
      }
      if (query.status) {
        items = items.filter((pm: any) => pm.status === query.status);
      }

      const limit = parseInt(query.limit) || 10;
      const afterId = query.after_id;
      if (afterId) {
        const idx = items.findIndex((pm: any) => pm.id === afterId);
        if (idx >= 0) items = items.slice(idx + 1);
      }
      items = items.slice(0, limit);

      return reply.send({
        data: items,
        has_more: items.length === limit,
      });
    });

    // ── Update Payment Method ─────────────────────────────
    server.patch('/xendit/v3/payment_methods/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const pm = state.get<any>(NS.paymentMethods, id);
      if (!pm) return reply.status(404).send(xndError(404, 'DATA_NOT_FOUND', `Payment method ${id} not found`));

      const updates: any = { updated: new Date().toISOString() };
      if (body.status) updates.status = body.status;
      if (body.reference_id) updates.reference_id = body.reference_id;
      if (body.description) updates.description = body.description;
      if (body.metadata) updates.metadata = { ...pm.metadata, ...body.metadata };

      state.update(NS.paymentMethods, id, updates);
      return reply.send(state.get(NS.paymentMethods, id));
    });

    // ══════════════════════════════════════════════════════
    //  INVOICES (v2)
    // ══════════════════════════════════════════════════════

    // ── Create Invoice ────────────────────────────────────
    server.post('/xendit/v2/invoices/', async (req, reply) => {
      const body = req.body as any;

      if (!body.external_id || !body.amount) {
        return reply.status(400).send(xndError(400, 'API_VALIDATION_ERROR', 'external_id and amount are required'));
      }

      const id = generateId('', 24);
      const now = new Date().toISOString();
      const expiryDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const invoice = {
        id,
        external_id: body.external_id,
        user_id: `biz-${generateId('', 36)}`,
        status: 'PENDING',
        merchant_name: body.merchant_name || 'Test Merchant',
        merchant_profile_picture_url: null,
        amount: body.amount,
        payer_email: body.payer_email || null,
        description: body.description || null,
        customer: body.customer || null,
        customer_notification_preference: body.customer_notification_preference || null,
        invoice_url: `https://checkout.xendit.co/web/${id}`,
        expiry_date: body.expiry_date || expiryDate,
        available_banks: [
          { bank_code: 'BCA', collection_type: 'POOL', bank_branch: 'Virtual Account', account_holder_name: 'XENDIT' },
          { bank_code: 'BNI', collection_type: 'POOL', bank_branch: 'Virtual Account', account_holder_name: 'XENDIT' },
          { bank_code: 'BRI', collection_type: 'POOL', bank_branch: 'Virtual Account', account_holder_name: 'XENDIT' },
          { bank_code: 'MANDIRI', collection_type: 'POOL', bank_branch: 'Virtual Account', account_holder_name: 'XENDIT' },
        ],
        available_retail_outlets: [
          { retail_outlet_name: 'ALFAMART' },
          { retail_outlet_name: 'INDOMARET' },
        ],
        available_ewallets: [
          { ewallet_type: 'OVO' },
          { ewallet_type: 'DANA' },
          { ewallet_type: 'LINKAJA' },
          { ewallet_type: 'SHOPEEPAY' },
        ],
        should_exclude_credit_card: body.should_exclude_credit_card || false,
        should_send_email: body.should_send_email || false,
        currency: body.currency || 'IDR',
        items: body.items || [],
        fees: body.fees || [],
        success_redirect_url: body.success_redirect_url || null,
        failure_redirect_url: body.failure_redirect_url || null,
        created: now,
        updated: now,
      };
      state.set(NS.invoices, id, invoice);
      return reply.status(201).send(invoice);
    });

    // ── Get Invoice ───────────────────────────────────────
    server.get('/xendit/v2/invoices/:id', async (req, reply) => {
      const { id } = req.params as any;
      const invoice = state.get<any>(NS.invoices, id);
      if (!invoice) return reply.status(404).send(xndError(404, 'INVOICE_NOT_FOUND_ERROR', `Invoice ${id} not found`));
      return reply.send(invoice);
    });

    // ── List Invoices ─────────────────────────────────────
    server.get('/xendit/v2/invoices', async (req, reply) => {
      const query = req.query as any;
      let items = state.list<any>(NS.invoices);

      if (query.external_id) {
        items = items.filter((inv: any) => inv.external_id === query.external_id);
      }
      if (query.statuses) {
        const statuses = Array.isArray(query.statuses) ? query.statuses : [query.statuses];
        items = items.filter((inv: any) => statuses.includes(inv.status));
      }

      const limit = parseInt(query.limit) || 10;
      const lastId = query.last_invoice_id;
      if (lastId) {
        const idx = items.findIndex((inv: any) => inv.id === lastId);
        if (idx >= 0) items = items.slice(idx + 1);
      }
      items = items.slice(0, limit);

      return reply.send(items);
    });

    // ── Expire Invoice (unversioned) ──────────────────────
    server.post('/xendit/invoices/:id/expire', async (req, reply) => {
      const { id } = req.params as any;
      const invoice = state.get<any>(NS.invoices, id);
      if (!invoice) return reply.status(404).send(xndError(404, 'INVOICE_NOT_FOUND_ERROR', `Invoice ${id} not found`));

      if (invoice.status !== 'PENDING') {
        return reply.status(400).send(xndError(400, 'INVALID_INVOICE_STATUS', `Invoice ${id} is not in PENDING status`));
      }

      state.update(NS.invoices, id, { status: 'EXPIRED', updated: new Date().toISOString() });
      return reply.send(state.get(NS.invoices, id));
    });

    // ══════════════════════════════════════════════════════
    //  PAYOUTS (v2)
    // ══════════════════════════════════════════════════════

    // ── Create Payout ─────────────────────────────────────
    server.post('/xendit/v2/payouts', async (req, reply) => {
      const body = req.body as any;
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      if (idempotencyKey) {
        const existing = state.list<any>(NS.payouts).find(
          (p: any) => p._idempotency_key === idempotencyKey,
        );
        if (existing) return reply.send(existing);
      }

      if (!body.reference_id || !body.channel_code || !body.amount) {
        return reply.status(400).send(xndError(400, 'API_VALIDATION_ERROR', 'reference_id, channel_code, and amount are required'));
      }

      const id = `disb-${generateId('', 36)}`;
      const now = new Date().toISOString();
      const payout = {
        id,
        business_id: `biz-${generateId('', 36)}`,
        reference_id: body.reference_id,
        channel_code: body.channel_code,
        channel_properties: body.channel_properties || {},
        amount: body.amount,
        currency: body.currency || 'IDR',
        description: body.description || null,
        receipt_notification: body.receipt_notification || null,
        metadata: body.metadata || {},
        status: 'ACCEPTED',
        estimated_arrival_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        created: now,
        updated: now,
        _idempotency_key: idempotencyKey || null,
      };
      state.set(NS.payouts, id, payout);
      return reply.status(200).send(payout);
    });

    // ── Get Payout ────────────────────────────────────────
    server.get('/xendit/v2/payouts/:id', async (req, reply) => {
      const { id } = req.params as any;
      const payout = state.get<any>(NS.payouts, id);
      if (!payout) return reply.status(404).send(xndError(404, 'DATA_NOT_FOUND', `Payout ${id} not found`));
      return reply.send(payout);
    });

    // ── List Payouts ──────────────────────────────────────
    server.get('/xendit/v2/payouts', async (req, reply) => {
      const query = req.query as any;
      let items = state.list<any>(NS.payouts);

      if (query.reference_id) {
        items = items.filter((p: any) => p.reference_id === query.reference_id);
      }
      if (query.status) {
        items = items.filter((p: any) => p.status === query.status);
      }

      const limit = parseInt(query.limit) || 10;
      const afterId = query.after_id;
      if (afterId) {
        const idx = items.findIndex((p: any) => p.id === afterId);
        if (idx >= 0) items = items.slice(idx + 1);
      }
      items = items.slice(0, limit);

      return reply.send({
        data: items,
        has_more: items.length === limit,
      });
    });

    // ── Cancel Payout ─────────────────────────────────────
    server.post('/xendit/v2/payouts/:id/cancel', async (req, reply) => {
      const { id } = req.params as any;
      const payout = state.get<any>(NS.payouts, id);
      if (!payout) return reply.status(404).send(xndError(404, 'DATA_NOT_FOUND', `Payout ${id} not found`));

      if (payout.status !== 'ACCEPTED') {
        return reply.status(400).send(xndError(400, 'PAYOUT_CANCELLATION_ERROR', `Payout ${id} cannot be cancelled in ${payout.status} status`));
      }

      state.update(NS.payouts, id, { status: 'CANCELLED', updated: new Date().toISOString() });
      return reply.send(state.get(NS.payouts, id));
    });

    // ══════════════════════════════════════════════════════
    //  REFUNDS (unversioned)
    // ══════════════════════════════════════════════════════

    // ── Create Refund ─────────────────────────────────────
    server.post('/xendit/refunds', async (req, reply) => {
      const body = req.body as any;
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      if (idempotencyKey) {
        const existing = state.list<any>(NS.refunds).find(
          (r: any) => r._idempotency_key === idempotencyKey,
        );
        if (existing) return reply.send(existing);
      }

      if (!body.payment_request_id && !body.invoice_id && !body.reference_id) {
        return reply.status(400).send(xndError(400, 'API_VALIDATION_ERROR', 'payment_request_id, invoice_id, or reference_id is required'));
      }

      const id = `rfd-${generateId('', 36)}`;
      const now = new Date().toISOString();
      const refund = {
        id,
        payment_id: body.payment_request_id || body.invoice_id || null,
        invoice_id: body.invoice_id || null,
        payment_method_type: body.payment_method_type || null,
        amount: body.amount || 0,
        channel_code: body.channel_code || null,
        country: body.country || 'ID',
        currency: body.currency || 'IDR',
        reason: body.reason || 'REQUESTED_BY_CUSTOMER',
        reference_id: body.reference_id || id,
        metadata: body.metadata || {},
        status: 'SUCCEEDED',
        created: now,
        updated: now,
        _idempotency_key: idempotencyKey || null,
      };
      state.set(NS.refunds, id, refund);
      return reply.status(201).send(refund);
    });

    // ── Get Refund ────────────────────────────────────────
    server.get('/xendit/refunds/:id', async (req, reply) => {
      const { id } = req.params as any;
      const refund = state.get<any>(NS.refunds, id);
      if (!refund) return reply.status(404).send(xndError(404, 'DATA_NOT_FOUND', `Refund ${id} not found`));
      return reply.send(refund);
    });

    // ── List Refunds ──────────────────────────────────────
    server.get('/xendit/refunds', async (req, reply) => {
      const query = req.query as any;
      let items = state.list<any>(NS.refunds);

      if (query.payment_request_id) {
        items = items.filter((r: any) => r.payment_id === query.payment_request_id);
      }
      if (query.invoice_id) {
        items = items.filter((r: any) => r.invoice_id === query.invoice_id);
      }
      if (query.status) {
        items = items.filter((r: any) => r.status === query.status);
      }

      const limit = parseInt(query.limit) || 10;
      const afterId = query.after_id;
      if (afterId) {
        const idx = items.findIndex((r: any) => r.id === afterId);
        if (idx >= 0) items = items.slice(idx + 1);
      }
      items = items.slice(0, limit);

      return reply.send({
        data: items,
        has_more: items.length === limit,
      });
    });

    // ══════════════════════════════════════════════════════
    //  CUSTOMERS (unversioned)
    // ══════════════════════════════════════════════════════

    // ── Create Customer ───────────────────────────────────
    server.post('/xendit/customers', async (req, reply) => {
      const body = req.body as any;
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      if (idempotencyKey) {
        const existing = state.list<any>(NS.customers).find(
          (c: any) => c._idempotency_key === idempotencyKey,
        );
        if (existing) return reply.send(existing);
      }

      if (!body.reference_id) {
        return reply.status(400).send(xndError(400, 'API_VALIDATION_ERROR', 'reference_id is required'));
      }

      const id = `cust-${generateId('', 36)}`;
      const now = new Date().toISOString();
      const customer = {
        id,
        reference_id: body.reference_id,
        type: body.type || 'INDIVIDUAL',
        individual_detail: body.individual_detail || null,
        business_detail: body.business_detail || null,
        mobile_number: body.mobile_number || null,
        phone_number: body.phone_number || null,
        email: body.email || null,
        hashed_phone_number: body.hashed_phone_number || null,
        description: body.description || null,
        addresses: body.addresses || [],
        identity_accounts: body.identity_accounts || [],
        kyc_documents: body.kyc_documents || [],
        metadata: body.metadata || {},
        created: now,
        updated: now,
        _idempotency_key: idempotencyKey || null,
      };
      state.set(NS.customers, id, customer);
      return reply.status(200).send(customer);
    });

    // ── Get Customer ──────────────────────────────────────
    server.get('/xendit/customers/:id', async (req, reply) => {
      const { id } = req.params as any;
      const customer = state.get<any>(NS.customers, id);
      if (!customer) return reply.status(404).send(xndError(404, 'DATA_NOT_FOUND', `Customer ${id} not found`));
      return reply.send(customer);
    });

    // ── Update Customer ───────────────────────────────────
    server.patch('/xendit/customers/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const customer = state.get<any>(NS.customers, id);
      if (!customer) return reply.status(404).send(xndError(404, 'DATA_NOT_FOUND', `Customer ${id} not found`));

      const updates: any = { updated: new Date().toISOString() };
      if (body.individual_detail) updates.individual_detail = { ...customer.individual_detail, ...body.individual_detail };
      if (body.business_detail) updates.business_detail = { ...customer.business_detail, ...body.business_detail };
      if (body.email) updates.email = body.email;
      if (body.mobile_number) updates.mobile_number = body.mobile_number;
      if (body.phone_number) updates.phone_number = body.phone_number;
      if (body.description) updates.description = body.description;
      if (body.addresses) updates.addresses = body.addresses;
      if (body.identity_accounts) updates.identity_accounts = body.identity_accounts;
      if (body.kyc_documents) updates.kyc_documents = body.kyc_documents;
      if (body.metadata) updates.metadata = { ...customer.metadata, ...body.metadata };

      state.update(NS.customers, id, updates);
      return reply.send(state.get(NS.customers, id));
    });

    // ══════════════════════════════════════════════════════
    //  BALANCE (unversioned)
    // ══════════════════════════════════════════════════════

    // ── Get Balance ───────────────────────────────────────
    server.get('/xendit/balance', async (req, reply) => {
      const query = req.query as any;
      const accountType = query.account_type || 'CASH';
      const forUserId = req.headers['for-user-id'] as string | undefined;

      const validTypes = ['CASH', 'HOLDING', 'TAX'];
      if (!validTypes.includes(accountType)) {
        return reply.status(400).send(xndError(400, 'API_VALIDATION_ERROR', `account_type must be one of: ${validTypes.join(', ')}`));
      }

      return reply.send({
        balance: 1500000,
        currency: 'IDR',
        account_type: accountType,
        ...(forUserId ? { for_user_id: forUserId } : {}),
      });
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Payment Requests (v3)
      { method: 'POST', path: '/xendit/v3/payment_requests', description: 'Create payment request' },
      { method: 'GET', path: '/xendit/v3/payment_requests/:id', description: 'Get payment request' },
      { method: 'GET', path: '/xendit/v3/payment_requests', description: 'List payment requests' },
      // Payment Methods (v3)
      { method: 'POST', path: '/xendit/v3/payment_methods', description: 'Create payment method' },
      { method: 'GET', path: '/xendit/v3/payment_methods/:id', description: 'Get payment method' },
      { method: 'GET', path: '/xendit/v3/payment_methods', description: 'List payment methods' },
      { method: 'PATCH', path: '/xendit/v3/payment_methods/:id', description: 'Update payment method' },
      // Invoices (v2)
      { method: 'POST', path: '/xendit/v2/invoices/', description: 'Create invoice' },
      { method: 'GET', path: '/xendit/v2/invoices/:id', description: 'Get invoice' },
      { method: 'GET', path: '/xendit/v2/invoices', description: 'List invoices' },
      { method: 'POST', path: '/xendit/invoices/:id/expire', description: 'Expire invoice' },
      // Payouts (v2)
      { method: 'POST', path: '/xendit/v2/payouts', description: 'Create payout' },
      { method: 'GET', path: '/xendit/v2/payouts/:id', description: 'Get payout' },
      { method: 'GET', path: '/xendit/v2/payouts', description: 'List payouts' },
      { method: 'POST', path: '/xendit/v2/payouts/:id/cancel', description: 'Cancel payout' },
      // Refunds
      { method: 'POST', path: '/xendit/refunds', description: 'Create refund' },
      { method: 'GET', path: '/xendit/refunds/:id', description: 'Get refund' },
      { method: 'GET', path: '/xendit/refunds', description: 'List refunds' },
      // Customers
      { method: 'POST', path: '/xendit/customers', description: 'Create customer' },
      { method: 'GET', path: '/xendit/customers/:id', description: 'Get customer' },
      { method: 'PATCH', path: '/xendit/customers/:id', description: 'Update customer' },
      // Balance
      { method: 'GET', path: '/xendit/balance', description: 'Get balance' },
    ];
  }
}
