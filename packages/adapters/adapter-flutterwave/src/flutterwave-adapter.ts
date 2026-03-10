import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, DataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter } from '@mimicai/adapter-sdk';
import type { FlutterwaveConfig } from './config.js';
import { flwEnvelope } from './flutterwave-errors.js';
import { registerFlutterwaveTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  payments: 'flw_payments',
  transactions: 'flw_transactions',
  refunds: 'flw_refunds',
  transfers: 'flw_transfers',
  beneficiaries: 'flw_beneficiaries',
  subaccounts: 'flw_subaccounts',
  plans: 'flw_plans',
  subscriptions: 'flw_subscriptions',
  virtualAccounts: 'flw_virtual_accounts',
  bills: 'flw_bills',
  settlements: 'flw_settlements',
  chargebacks: 'flw_chargebacks',
} as const;

// ---------------------------------------------------------------------------
// Integer ID Generator
// ---------------------------------------------------------------------------

let flwIdCounter = 4475000;
function flwId(): number {
  return ++flwIdCounter;
}

// ---------------------------------------------------------------------------
// FLW Reference Generator
// ---------------------------------------------------------------------------

function flwRef(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'FLW-MOCK-';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Transaction Builder
// ---------------------------------------------------------------------------

function buildTransaction(body: any, chargeType: string): any {
  // Sandbox testing: control outcome via amount
  // Amounts ending in .01 = pending, .02 = failed
  let resolvedStatus = 'successful';
  if (body.amount) {
    const cents = Math.round((body.amount % 1) * 100);
    if (cents === 1) resolvedStatus = 'pending';
    else if (cents === 2) resolvedStatus = 'failed';
  }

  const id = flwId();
  const ref = flwRef();
  return {
    id,
    tx_ref: body.tx_ref || `FLW-TX-${Date.now()}`,
    flw_ref: ref,
    device_fingerprint: body.device_fingerprint || 'N/A',
    amount: body.amount || 0,
    currency: body.currency || 'NGN',
    charged_amount: body.amount || 0,
    app_fee: (body.amount || 0) * 0.014,
    merchant_fee: 0,
    processor_response: resolvedStatus === 'successful' ? 'Approved' : resolvedStatus === 'pending' ? 'Pending validation' : 'Declined',
    auth_model: chargeType === 'card' ? 'PIN' : 'REDIRECT',
    ip: '127.0.0.1',
    narration: body.narration || `CARD Transaction`,
    status: resolvedStatus,
    payment_type: chargeType,
    created_at: new Date().toISOString(),
    account_id: body.account_id || flwId(),
    customer: {
      id: flwId(),
      name: body.fullname || body.customer?.name || 'Test User',
      phone_number: body.phone_number || body.customer?.phone_number || null,
      email: body.email || body.customer?.email || 'test@example.com',
      created_at: new Date().toISOString(),
    },
    card: chargeType === 'card' ? {
      first_6digits: body.card_number ? body.card_number.slice(0, 6) : '411111',
      last_4digits: body.card_number ? body.card_number.slice(-4) : '1111',
      issuer: 'ACCESS BANK',
      country: 'NG',
      type: 'VISA',
      token: `flw-t1nf-${ref}`,
      expiry: body.expiry_month && body.expiry_year ? `${body.expiry_month}/${body.expiry_year}` : '12/27',
    } : undefined,
    wallet_id: null,
    meta: body.meta || {},
  };
}

// ---------------------------------------------------------------------------
// Banks by Country
// ---------------------------------------------------------------------------

function getBanksForCountry(country: string): any[] {
  const banksByCountry: Record<string, any[]> = {
    NG: [
      { id: 1, code: '044', name: 'Access Bank' },
      { id: 2, code: '023', name: 'Citibank Nigeria' },
      { id: 3, code: '063', name: 'Diamond Bank' },
      { id: 4, code: '050', name: 'Ecobank Nigeria' },
      { id: 5, code: '070', name: 'Fidelity Bank' },
      { id: 6, code: '011', name: 'First Bank of Nigeria' },
      { id: 7, code: '214', name: 'First City Monument Bank' },
      { id: 8, code: '058', name: 'Guaranty Trust Bank' },
      { id: 9, code: '030', name: 'Heritage Bank' },
      { id: 10, code: '301', name: 'Jaiz Bank' },
      { id: 11, code: '082', name: 'Keystone Bank' },
      { id: 12, code: '076', name: 'Polaris Bank' },
      { id: 13, code: '221', name: 'Stanbic IBTC Bank' },
      { id: 14, code: '068', name: 'Standard Chartered Bank' },
      { id: 15, code: '232', name: 'Sterling Bank' },
      { id: 16, code: '033', name: 'United Bank for Africa' },
      { id: 17, code: '032', name: 'Union Bank of Nigeria' },
      { id: 18, code: '035', name: 'Wema Bank' },
      { id: 19, code: '057', name: 'Zenith Bank' },
    ],
    GH: [
      { id: 20, code: 'GH010', name: 'Ecobank Ghana' },
      { id: 21, code: 'GH020', name: 'Fidelity Bank Ghana' },
      { id: 22, code: 'GH030', name: 'GCB Bank' },
      { id: 23, code: 'GH040', name: 'Stanbic Bank Ghana' },
      { id: 24, code: 'GH050', name: 'Standard Chartered Ghana' },
    ],
    KE: [
      { id: 25, code: 'KE010', name: 'Kenya Commercial Bank' },
      { id: 26, code: 'KE020', name: 'Equity Bank' },
      { id: 27, code: 'KE030', name: 'Co-operative Bank of Kenya' },
      { id: 28, code: 'KE040', name: 'Standard Chartered Kenya' },
      { id: 29, code: 'KE050', name: 'Barclays Bank of Kenya' },
    ],
    ZA: [
      { id: 30, code: 'ZA010', name: 'Standard Bank' },
      { id: 31, code: 'ZA020', name: 'First National Bank' },
      { id: 32, code: 'ZA030', name: 'ABSA Bank' },
      { id: 33, code: 'ZA040', name: 'Nedbank' },
      { id: 34, code: 'ZA050', name: 'Capitec Bank' },
    ],
    UG: [
      { id: 35, code: 'UG010', name: 'Stanbic Bank Uganda' },
      { id: 36, code: 'UG020', name: 'Standard Chartered Uganda' },
      { id: 37, code: 'UG030', name: 'Centenary Bank' },
    ],
    TZ: [
      { id: 38, code: 'TZ010', name: 'CRDB Bank' },
      { id: 39, code: 'TZ020', name: 'NMB Bank' },
      { id: 40, code: 'TZ030', name: 'Standard Chartered Tanzania' },
    ],
  };
  return banksByCountry[country] || [];
}

// ---------------------------------------------------------------------------
// Flutterwave Adapter
// ---------------------------------------------------------------------------

export class FlutterwaveAdapter extends BaseApiMockAdapter<FlutterwaveConfig> {
  readonly id = 'flutterwave';
  readonly name = 'Flutterwave API';
  readonly basePath = '/flutterwave/v3';
  readonly versions = ['v3'];

  readonly promptContext = {
    resources: ['customers', 'transactions', 'transfers', 'payment_plans', 'subaccounts', 'refunds', 'virtual_accounts'],
    amountFormat: 'decimal float (e.g. 2999.00)',
    relationships: [
      'transaction → customer',
      'transfer → subaccount',
      'refund → transaction',
      'payment_plan → transaction',
    ],
    requiredFields: {
      customers: ['id', 'email', 'full_name', 'phone_number', 'created_at'],
      transactions: ['id', 'tx_ref', 'amount', 'currency', 'status', 'payment_type', 'customer', 'created_at'],
      transfers: ['id', 'amount', 'currency', 'status', 'reference', 'narration', 'created_at'],
      refunds: ['id', 'amount_refunded', 'status', 'flw_ref', 'created_at'],
    },
    notes: 'African payment gateway. Amounts as decimal floats. Timestamps ISO 8601. Transaction status: successful, failed, pending. Supports NGN, GHS, KES, ZAR, USD currencies. tx_ref is merchant reference.',
  };

  readonly dataSpec: DataSpec = {
    timestampFormat: 'iso8601',
    amountFields: ['amount', 'amount_refunded', 'charged_amount', 'app_fee'],
    statusEnums: {
      transactions: ['successful', 'failed', 'pending'],
      transfers: ['NEW', 'PENDING', 'FAILED', 'SUCCESSFUL'],
    },
    timestampFields: ['created_at'],
  };

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerFlutterwaveTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.replace('Bearer ', '');
    // Keys look like FLWSECK_TEST-<persona>-<random> or FLWSECK-<persona>-<random>
    const match = token.match(/^FLWSECK(?:_TEST)?-([a-z0-9-]+)-/);
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
    //  PAYMENTS / CHARGES
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Payment (hosted checkout link) ────────────────────────────
    server.post('/flutterwave/v3/payments', async (req, reply) => {
      const body = req.body as any;
      const txRef = body.tx_ref || `FLW-TX-${Date.now()}`;
      const link = `https://checkout.flutterwave.com/v3/hosted/pay/${flwRef()}`;
      const payment = {
        tx_ref: txRef,
        link,
        amount: body.amount,
        currency: body.currency || 'NGN',
        customer: body.customer || {},
        customizations: body.customizations || {},
        payment_options: body.payment_options || 'card,banktransfer,ussd',
        redirect_url: body.redirect_url || null,
        meta: body.meta || {},
      };
      store.set(NS.payments, txRef, payment);
      return reply.status(200).send(flwEnvelope('success', 'Hosted Link', { link }));
    });

    // ── Direct Charge ────────────────────────────────────────────────────
    server.post('/flutterwave/v3/charges', async (req, reply) => {
      const body = req.body as any;
      const query = req.query as any;
      const chargeType = query.type || 'card';
      const txn = buildTransaction(body, chargeType);
      store.set(NS.transactions, String(txn.id), txn);
      if (chargeType === 'card' && txn.status === 'pending') {
        return reply.status(200).send(flwEnvelope('success', 'Charge initiated', {
          ...txn,
          meta: { authorization: { mode: 'pin', fields: ['pin'] } },
        }));
      }
      return reply.status(200).send(flwEnvelope('success', 'Charge initiated', txn));
    });

    // ── Validate Charge (submit OTP) ─────────────────────────────────────
    server.post('/flutterwave/v3/validate-charge', async (req, reply) => {
      const body = req.body as any;
      const flwRefVal = body.flw_ref;
      const otp = body.otp;
      if (!flwRefVal || !otp) {
        return reply.status(400).send(flwEnvelope('error', 'flw_ref and otp are required', null));
      }
      const txns = store.list<any>(NS.transactions);
      const txn = txns.find((t: any) => t.flw_ref === flwRefVal);
      if (!txn) {
        return reply.status(404).send(flwEnvelope('error', 'Transaction not found', null));
      }
      store.update(NS.transactions, String(txn.id), { status: 'successful' });
      return reply.status(200).send(flwEnvelope('success', 'Charge validated', store.get(NS.transactions, String(txn.id))));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  TRANSACTIONS
    // ══════════════════════════════════════════════════════════════════════

    // ── List Transactions ────────────────────────────────────────────────
    server.get('/flutterwave/v3/transactions', async (req, reply) => {
      const query = req.query as any;
      let items = store.list<any>(NS.transactions);

      if (query.status) items = items.filter((t: any) => t.status === query.status);
      if (query.tx_ref) items = items.filter((t: any) => t.tx_ref === query.tx_ref);
      if (query.customer_email) items = items.filter((t: any) => t.customer?.email === query.customer_email);

      const page = parseInt(query.page) || 1;
      const limit = 20;
      const total = items.length;
      const totalPages = Math.ceil(total / limit) || 1;
      items = items.slice((page - 1) * limit, page * limit);

      return reply.send({
        status: 'success',
        message: 'Transactions fetched',
        meta: { page_info: { total, current_page: page, total_pages: totalPages } },
        data: items,
      });
    });

    // ── Get Transaction ──────────────────────────────────────────────────
    server.get('/flutterwave/v3/transactions/:id', async (req, reply) => {
      const { id } = req.params as any;
      const txn = store.get<any>(NS.transactions, id);
      if (!txn) return reply.status(404).send(flwEnvelope('error', `Transaction ${id} not found`, null));
      return reply.send(flwEnvelope('success', 'Transaction fetched', txn));
    });

    // ── Verify Transaction ───────────────────────────────────────────────
    server.get('/flutterwave/v3/transactions/:id/verify', async (req, reply) => {
      const { id } = req.params as any;
      const txn = store.get<any>(NS.transactions, id);
      if (!txn) return reply.status(404).send(flwEnvelope('error', `Transaction ${id} not found`, null));
      return reply.send(flwEnvelope('success', 'Transaction fetched', txn));
    });

    // ── Verify Transaction by Reference ──────────────────────────────────
    server.get('/flutterwave/v3/transactions/verify_by_reference', async (req, reply) => {
      const query = req.query as any;
      const txRef = query.tx_ref;
      if (!txRef) return reply.status(400).send(flwEnvelope('error', 'tx_ref query parameter is required', null));
      const txns = store.list<any>(NS.transactions);
      const txn = txns.find((t: any) => t.tx_ref === txRef);
      if (!txn) return reply.status(404).send(flwEnvelope('error', `Transaction with tx_ref ${txRef} not found`, null));
      return reply.send(flwEnvelope('success', 'Transaction fetched', txn));
    });

    // ── Refund Transaction ───────────────────────────────────────────────
    server.post('/flutterwave/v3/transactions/:id/refund', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const txn = store.get<any>(NS.transactions, id);
      if (!txn) return reply.status(404).send(flwEnvelope('error', `Transaction ${id} not found`, null));
      if (txn.status !== 'successful') {
        return reply.status(400).send(flwEnvelope('error', 'Transaction is not in successful status', null));
      }
      const refund = {
        id: flwId(),
        tx_id: txn.id,
        flw_ref: txn.flw_ref,
        wallet_id: txn.wallet_id || null,
        amount_refunded: body.amount || txn.amount,
        status: 'completed',
        destination: body.destination || 'same_source',
        meta: { source: 'refund' },
        created_at: new Date().toISOString(),
      };
      store.set(NS.refunds, String(refund.id), refund);
      store.update(NS.transactions, id, { status: 'refunded' });
      return reply.status(200).send(flwEnvelope('success', 'Transaction refund initiated', refund));
    });

    // ── Calculate Transaction Fees ───────────────────────────────────────
    server.get('/flutterwave/v3/transactions/fee', async (req, reply) => {
      const query = req.query as any;
      const amount = parseFloat(query.amount) || 100;
      const currency = query.currency || 'NGN';
      let fee: number;
      if (currency === 'NGN') {
        fee = Math.min(Math.max(amount * 0.014, 100), 2000);
      } else {
        fee = amount * 0.038;
      }
      return reply.send(flwEnvelope('success', 'Charge fee', {
        charge_amount: amount + fee,
        fee,
        merchant_fee: fee,
        flutterwave_fee: fee,
        stamp_duty_charge: currency === 'NGN' && amount >= 10000 ? 50 : 0,
        currency,
      }));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  TRANSFERS (PAYOUTS)
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Transfer ──────────────────────────────────────────────────
    server.post('/flutterwave/v3/transfers', async (req, reply) => {
      const body = req.body as any;
      const transfer = {
        id: flwId(),
        account_number: body.account_number,
        bank_code: body.account_bank,
        full_name: body.beneficiary_name || 'Test Beneficiary',
        date_created: new Date().toISOString(),
        currency: body.currency || 'NGN',
        debit_currency: body.debit_currency || body.currency || 'NGN',
        amount: body.amount,
        fee: body.amount * 0.005 || 0,
        status: 'NEW',
        reference: body.reference || `FLW-TRF-${Date.now()}`,
        narration: body.narration || null,
        complete_message: 'Transfer queued successfully',
        meta: body.meta || null,
        requires_approval: 0,
        is_approved: 1,
        bank_name: body.bank_name || 'Mock Bank',
      };
      store.set(NS.transfers, String(transfer.id), transfer);
      return reply.status(200).send(flwEnvelope('success', 'Transfer Queued Successfully', transfer));
    });

    // ── List Transfers ───────────────────────────────────────────────────
    server.get('/flutterwave/v3/transfers', async (req, reply) => {
      const query = req.query as any;
      let items = store.list<any>(NS.transfers);

      if (query.status) items = items.filter((t: any) => t.status === query.status);
      if (query.reference) items = items.filter((t: any) => t.reference === query.reference);

      const page = parseInt(query.page) || 1;
      const limit = 20;
      const total = items.length;
      const totalPages = Math.ceil(total / limit) || 1;
      items = items.slice((page - 1) * limit, page * limit);

      return reply.send({
        status: 'success',
        message: 'Transfers fetched',
        meta: { page_info: { total, current_page: page, total_pages: totalPages } },
        data: items,
      });
    });

    // ── Get Transfer ─────────────────────────────────────────────────────
    server.get('/flutterwave/v3/transfers/:id', async (req, reply) => {
      const { id } = req.params as any;
      const transfer = store.get<any>(NS.transfers, id);
      if (!transfer) return reply.status(404).send(flwEnvelope('error', `Transfer ${id} not found`, null));
      return reply.send(flwEnvelope('success', 'Transfer fetched', transfer));
    });

    // ── Create Bulk Transfer ─────────────────────────────────────────────
    server.post('/flutterwave/v3/bulk-transfers', async (req, reply) => {
      const body = req.body as any;
      const bulkData = (body.bulk_data || []).map((item: any) => {
        const transfer = {
          id: flwId(),
          account_number: item.account_number,
          bank_code: item.account_bank,
          full_name: item.beneficiary_name || 'Test Beneficiary',
          date_created: new Date().toISOString(),
          currency: item.currency || body.currency || 'NGN',
          amount: item.amount,
          status: 'NEW',
          reference: item.reference || `FLW-TRF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          narration: item.narration || null,
          meta: item.meta || null,
        };
        store.set(NS.transfers, String(transfer.id), transfer);
        return transfer;
      });
      return reply.status(200).send(flwEnvelope('success', 'Bulk transfer created', {
        id: flwId(),
        date_created: new Date().toISOString(),
        approver: 'N/A',
      }));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  BENEFICIARIES
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Beneficiary ───────────────────────────────────────────────
    server.post('/flutterwave/v3/beneficiaries', async (req, reply) => {
      const body = req.body as any;
      const beneficiary = {
        id: flwId(),
        account_number: body.account_number,
        account_bank: body.account_bank,
        full_name: body.beneficiary_name || 'Test Beneficiary',
        bank_name: body.bank_name || 'Mock Bank',
        currency: body.currency || 'NGN',
        created_at: new Date().toISOString(),
      };
      store.set(NS.beneficiaries, String(beneficiary.id), beneficiary);
      return reply.status(200).send(flwEnvelope('success', 'Beneficiary created', beneficiary));
    });

    // ── List Beneficiaries ───────────────────────────────────────────────
    server.get('/flutterwave/v3/beneficiaries', async (req, reply) => {
      const query = req.query as any;
      let items = store.list<any>(NS.beneficiaries);

      const page = parseInt(query.page) || 1;
      const limit = 20;
      const total = items.length;
      const totalPages = Math.ceil(total / limit) || 1;
      items = items.slice((page - 1) * limit, page * limit);

      return reply.send({
        status: 'success',
        message: 'Beneficiaries fetched',
        meta: { page_info: { total, current_page: page, total_pages: totalPages } },
        data: items,
      });
    });

    // ── Get Beneficiary ──────────────────────────────────────────────────
    server.get('/flutterwave/v3/beneficiaries/:id', async (req, reply) => {
      const { id } = req.params as any;
      const b = store.get<any>(NS.beneficiaries, id);
      if (!b) return reply.status(404).send(flwEnvelope('error', `Beneficiary ${id} not found`, null));
      return reply.send(flwEnvelope('success', 'Beneficiary fetched', b));
    });

    // ── Delete Beneficiary ───────────────────────────────────────────────
    server.delete('/flutterwave/v3/beneficiaries/:id', async (req, reply) => {
      const { id } = req.params as any;
      const b = store.get<any>(NS.beneficiaries, id);
      if (!b) return reply.status(404).send(flwEnvelope('error', `Beneficiary ${id} not found`, null));
      store.delete(NS.beneficiaries, id);
      return reply.send(flwEnvelope('success', 'Beneficiary deleted', null));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  SUBACCOUNTS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Subaccount ────────────────────────────────────────────────
    server.post('/flutterwave/v3/subaccounts', async (req, reply) => {
      const body = req.body as any;
      const subaccount = {
        id: flwId(),
        subaccount_id: `RS_${flwRef()}`,
        account_number: body.account_number,
        account_bank: body.account_bank,
        business_name: body.business_name || 'Test Business',
        full_name: body.full_name || 'Test User',
        split_type: body.split_type || 'percentage',
        split_value: body.split_value || 0.1,
        country: body.country || 'NG',
        created_at: new Date().toISOString(),
      };
      store.set(NS.subaccounts, String(subaccount.id), subaccount);
      return reply.status(200).send(flwEnvelope('success', 'Subaccount created', subaccount));
    });

    // ── List Subaccounts ─────────────────────────────────────────────────
    server.get('/flutterwave/v3/subaccounts', async (_req, reply) => {
      const items = store.list<any>(NS.subaccounts);
      return reply.send(flwEnvelope('success', 'Subaccounts fetched', items));
    });

    // ── Get Subaccount ───────────────────────────────────────────────────
    server.get('/flutterwave/v3/subaccounts/:id', async (req, reply) => {
      const { id } = req.params as any;
      const sub = store.get<any>(NS.subaccounts, id);
      if (!sub) return reply.status(404).send(flwEnvelope('error', `Subaccount ${id} not found`, null));
      return reply.send(flwEnvelope('success', 'Subaccount fetched', sub));
    });

    // ── Update Subaccount ────────────────────────────────────────────────
    server.put('/flutterwave/v3/subaccounts/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const sub = store.get<any>(NS.subaccounts, id);
      if (!sub) return reply.status(404).send(flwEnvelope('error', `Subaccount ${id} not found`, null));

      const updates: any = {};
      if (body.business_name) updates.business_name = body.business_name;
      if (body.split_type) updates.split_type = body.split_type;
      if (body.split_value !== undefined) updates.split_value = body.split_value;
      if (body.account_number) updates.account_number = body.account_number;
      if (body.account_bank) updates.account_bank = body.account_bank;

      store.update(NS.subaccounts, id, updates);
      return reply.send(flwEnvelope('success', 'Subaccount updated', store.get(NS.subaccounts, id)));
    });

    // ── Delete Subaccount ────────────────────────────────────────────────
    server.delete('/flutterwave/v3/subaccounts/:id', async (req, reply) => {
      const { id } = req.params as any;
      const sub = store.get<any>(NS.subaccounts, id);
      if (!sub) return reply.status(404).send(flwEnvelope('error', `Subaccount ${id} not found`, null));
      store.delete(NS.subaccounts, id);
      return reply.send(flwEnvelope('success', 'Subaccount deleted', null));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PAYMENT PLANS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Payment Plan ──────────────────────────────────────────────
    server.post('/flutterwave/v3/payment-plans', async (req, reply) => {
      const body = req.body as any;
      const plan = {
        id: flwId(),
        name: body.name || 'Test Plan',
        amount: body.amount,
        interval: body.interval || 'monthly',
        duration: body.duration || 0,
        currency: body.currency || 'NGN',
        plan_token: `FLW-PLN-${flwRef()}`,
        status: 'active',
        created_at: new Date().toISOString(),
      };
      store.set(NS.plans, String(plan.id), plan);
      return reply.status(200).send(flwEnvelope('success', 'Payment plan created', plan));
    });

    // ── List Payment Plans ───────────────────────────────────────────────
    server.get('/flutterwave/v3/payment-plans', async (req, reply) => {
      const query = req.query as any;
      let items = store.list<any>(NS.plans);

      if (query.status) items = items.filter((p: any) => p.status === query.status);

      const page = parseInt(query.page) || 1;
      const limit = 20;
      const total = items.length;
      const totalPages = Math.ceil(total / limit) || 1;
      items = items.slice((page - 1) * limit, page * limit);

      return reply.send({
        status: 'success',
        message: 'Payment plans fetched',
        meta: { page_info: { total, current_page: page, total_pages: totalPages } },
        data: items,
      });
    });

    // ── Get Payment Plan ─────────────────────────────────────────────────
    server.get('/flutterwave/v3/payment-plans/:id', async (req, reply) => {
      const { id } = req.params as any;
      const plan = store.get<any>(NS.plans, id);
      if (!plan) return reply.status(404).send(flwEnvelope('error', `Payment plan ${id} not found`, null));
      return reply.send(flwEnvelope('success', 'Payment plan fetched', plan));
    });

    // ── Cancel Payment Plan ──────────────────────────────────────────────
    server.put('/flutterwave/v3/payment-plans/:id/cancel', async (req, reply) => {
      const { id } = req.params as any;
      const plan = store.get<any>(NS.plans, id);
      if (!plan) return reply.status(404).send(flwEnvelope('error', `Payment plan ${id} not found`, null));
      if (plan.status !== 'active') {
        return reply.status(400).send(flwEnvelope('error', 'Payment plan is not active', null));
      }
      store.update(NS.plans, id, { status: 'cancelled' });
      return reply.send(flwEnvelope('success', 'Payment plan cancelled', store.get(NS.plans, id)));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  SUBSCRIPTIONS
    // ══════════════════════════════════════════════════════════════════════

    // ── List Subscriptions ───────────────────────────────────────────────
    server.get('/flutterwave/v3/subscriptions', async (_req, reply) => {
      const items = store.list<any>(NS.subscriptions);
      return reply.send(flwEnvelope('success', 'Subscriptions fetched', items));
    });

    // ── Activate Subscription ────────────────────────────────────────────
    server.put('/flutterwave/v3/subscriptions/:id/activate', async (req, reply) => {
      const { id } = req.params as any;
      const sub = store.get<any>(NS.subscriptions, id);
      if (!sub) return reply.status(404).send(flwEnvelope('error', `Subscription ${id} not found`, null));
      if (sub.status !== 'cancelled') {
        return reply.status(400).send(flwEnvelope('error', 'Subscription is not in cancelled status', null));
      }
      store.update(NS.subscriptions, id, { status: 'active' });
      return reply.send(flwEnvelope('success', 'Subscription activated', store.get(NS.subscriptions, id)));
    });

    // ── Cancel Subscription ──────────────────────────────────────────────
    server.put('/flutterwave/v3/subscriptions/:id/cancel', async (req, reply) => {
      const { id } = req.params as any;
      const sub = store.get<any>(NS.subscriptions, id);
      if (!sub) return reply.status(404).send(flwEnvelope('error', `Subscription ${id} not found`, null));
      if (sub.status !== 'active') {
        return reply.status(400).send(flwEnvelope('error', 'Subscription is not active', null));
      }
      store.update(NS.subscriptions, id, { status: 'cancelled' });
      return reply.send(flwEnvelope('success', 'Subscription cancelled', store.get(NS.subscriptions, id)));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  VIRTUAL ACCOUNT NUMBERS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Virtual Account ───────────────────────────────────────────
    server.post('/flutterwave/v3/virtual-account-numbers', async (req, reply) => {
      const body = req.body as any;
      const orderRef = body.tx_ref || `FLW-VA-${Date.now()}`;
      const va = {
        response_code: '02',
        response_message: 'Transaction initiated successfully',
        flw_ref: flwRef(),
        order_ref: orderRef,
        account_number: `99${Math.floor(1000000000 + Math.random() * 9000000000)}`.slice(0, 10),
        bank_name: body.bank_slug === 'wema-bank' ? 'Wema Bank' : 'Flutterwave',
        frequency: body.frequency || 1,
        amount: body.amount || 0,
        currency: body.currency || 'NGN',
        created_at: new Date().toISOString(),
        expiry_date: body.expiry_date || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        note: body.narration || null,
      };
      store.set(NS.virtualAccounts, orderRef, va);
      return reply.status(200).send(flwEnvelope('success', 'Virtual account created', va));
    });

    // ── Get Virtual Account ──────────────────────────────────────────────
    server.get('/flutterwave/v3/virtual-account-numbers/:order_ref', async (req, reply) => {
      const { order_ref } = req.params as any;
      const va = store.get<any>(NS.virtualAccounts, order_ref);
      if (!va) return reply.status(404).send(flwEnvelope('error', `Virtual account ${order_ref} not found`, null));
      return reply.send(flwEnvelope('success', 'Virtual account fetched', va));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  BILL PAYMENTS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Bill Payment ──────────────────────────────────────────────
    server.post('/flutterwave/v3/bills', async (req, reply) => {
      const body = req.body as any;
      const bill = {
        phone_number: body.customer || body.phone_number || '+2348000000000',
        amount: body.amount,
        network: body.network || null,
        flw_ref: flwRef(),
        tx_ref: body.reference || `FLW-BILL-${Date.now()}`,
        reference: body.reference || null,
        type: body.type || 'AIRTIME',
        country: body.country || 'NG',
        currency: body.currency || 'NGN',
        status: 'successful',
        created_at: new Date().toISOString(),
      };
      store.set(NS.bills, bill.flw_ref, bill);
      return reply.status(200).send(flwEnvelope('success', 'Bill payment created', bill));
    });

    // ── List Bills ───────────────────────────────────────────────────────
    server.get('/flutterwave/v3/bills', async (_req, reply) => {
      const items = store.list<any>(NS.bills);
      return reply.send(flwEnvelope('success', 'Bills fetched', items));
    });

    // ── Get Bill Categories ──────────────────────────────────────────────
    server.get('/flutterwave/v3/bill-categories', async (_req, reply) => {
      return reply.send(flwEnvelope('success', 'Bill categories fetched', [
        { id: 1, biller_code: 'BIL099', name: 'MTN NIgeria', country: 'NG', is_airtime: true, biller_name: 'AIRTIME', item_code: 'AT099', label_name: 'Mobile Number', amount: 0 },
        { id: 2, biller_code: 'BIL110', name: 'DSTV', country: 'NG', is_airtime: false, biller_name: 'DSTV', item_code: 'CB140', label_name: 'SmartCard Number', amount: 0 },
        { id: 3, biller_code: 'BIL112', name: 'PHCN Electricity', country: 'NG', is_airtime: false, biller_name: 'EKO DISCO', item_code: 'UB157', label_name: 'Meter Number', amount: 0 },
        { id: 4, biller_code: 'BIL119', name: 'Safaricom', country: 'KE', is_airtime: true, biller_name: 'AIRTIME', item_code: 'AT120', label_name: 'Mobile Number', amount: 0 },
        { id: 5, biller_code: 'BIL121', name: 'MTN Ghana', country: 'GH', is_airtime: true, biller_name: 'AIRTIME', item_code: 'AT130', label_name: 'Mobile Number', amount: 0 },
      ]));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  SETTLEMENTS
    // ══════════════════════════════════════════════════════════════════════

    // ── List Settlements ─────────────────────────────────────────────────
    server.get('/flutterwave/v3/settlements', async (req, reply) => {
      const query = req.query as any;
      let items = store.list<any>(NS.settlements);

      if (query.status) items = items.filter((s: any) => s.status === query.status);

      const page = parseInt(query.page) || 1;
      const limit = 20;
      const total = items.length;
      const totalPages = Math.ceil(total / limit) || 1;
      items = items.slice((page - 1) * limit, page * limit);

      return reply.send({
        status: 'success',
        message: 'Settlements fetched',
        meta: { page_info: { total, current_page: page, total_pages: totalPages } },
        data: items,
      });
    });

    // ── Get Settlement ───────────────────────────────────────────────────
    server.get('/flutterwave/v3/settlements/:id', async (req, reply) => {
      const { id } = req.params as any;
      const settlement = store.get<any>(NS.settlements, id);
      if (!settlement) return reply.status(404).send(flwEnvelope('error', `Settlement ${id} not found`, null));
      return reply.send(flwEnvelope('success', 'Settlement fetched', settlement));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  CHARGEBACKS
    // ══════════════════════════════════════════════════════════════════════

    // ── List Chargebacks ─────────────────────────────────────────────────
    server.get('/flutterwave/v3/chargebacks', async (req, reply) => {
      const query = req.query as any;
      let items = store.list<any>(NS.chargebacks);

      if (query.status) items = items.filter((c: any) => c.status === query.status);

      const page = parseInt(query.page) || 1;
      const limit = 20;
      const total = items.length;
      const totalPages = Math.ceil(total / limit) || 1;
      items = items.slice((page - 1) * limit, page * limit);

      return reply.send({
        status: 'success',
        message: 'Chargebacks fetched',
        meta: { page_info: { total, current_page: page, total_pages: totalPages } },
        data: items,
      });
    });

    // ── Accept/Decline Chargeback ────────────────────────────────────────
    server.post('/flutterwave/v3/chargebacks/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const chargeback = store.get<any>(NS.chargebacks, id);

      if (!chargeback) {
        // Auto-create chargeback for testing convenience
        const newCb = {
          id: parseInt(id) || flwId(),
          amount: body.amount || 1000,
          flw_ref: flwRef(),
          status: body.action === 'accept' ? 'accepted' : 'declined',
          stage: 'pre-arbitration',
          comment: body.comment || null,
          meta: body.meta || {},
          due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        };
        store.set(NS.chargebacks, String(newCb.id), newCb);
        return reply.status(200).send(flwEnvelope('success', `Chargeback ${body.action || 'accept'}ed`, newCb));
      }

      const action = body.action || 'accept';
      store.update(NS.chargebacks, id, {
        status: action === 'accept' ? 'accepted' : 'declined',
        comment: body.comment || chargeback.comment,
      });
      return reply.send(flwEnvelope('success', `Chargeback ${action}ed`, store.get(NS.chargebacks, id)));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  BALANCES
    // ══════════════════════════════════════════════════════════════════════

    // ── Get All Balances ─────────────────────────────────────────────────
    server.get('/flutterwave/v3/balances', async (_req, reply) => {
      return reply.send(flwEnvelope('success', 'Wallet balances fetched', [
        { currency: 'NGN', available_balance: 5000000, ledger_balance: 5250000 },
        { currency: 'USD', available_balance: 12500, ledger_balance: 13000 },
        { currency: 'KES', available_balance: 250000, ledger_balance: 260000 },
        { currency: 'GHS', available_balance: 85000, ledger_balance: 87000 },
      ]));
    });

    // ── Get Balance by Currency ──────────────────────────────────────────
    server.get('/flutterwave/v3/balances/:currency', async (req, reply) => {
      const { currency } = req.params as any;
      const balances: Record<string, any> = {
        NGN: { currency: 'NGN', available_balance: 5000000, ledger_balance: 5250000 },
        USD: { currency: 'USD', available_balance: 12500, ledger_balance: 13000 },
        KES: { currency: 'KES', available_balance: 250000, ledger_balance: 260000 },
        GHS: { currency: 'GHS', available_balance: 85000, ledger_balance: 87000 },
        ZAR: { currency: 'ZAR', available_balance: 150000, ledger_balance: 155000 },
        GBP: { currency: 'GBP', available_balance: 8500, ledger_balance: 9000 },
        UGX: { currency: 'UGX', available_balance: 12000000, ledger_balance: 12500000 },
        TZS: { currency: 'TZS', available_balance: 8500000, ledger_balance: 8800000 },
        RWF: { currency: 'RWF', available_balance: 3500000, ledger_balance: 3600000 },
        EGP: { currency: 'EGP', available_balance: 180000, ledger_balance: 185000 },
      };
      const bal = balances[currency.toUpperCase()];
      if (!bal) return reply.status(404).send(flwEnvelope('error', `No wallet found for currency ${currency}`, null));
      return reply.send(flwEnvelope('success', 'Wallet balance fetched', bal));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  BANKS
    // ══════════════════════════════════════════════════════════════════════

    // ── List Banks by Country ────────────────────────────────────────────
    server.get('/flutterwave/v3/banks/:country_code', async (req, reply) => {
      const { country_code } = req.params as any;
      const banks = getBanksForCountry(country_code.toUpperCase());
      return reply.send(flwEnvelope('success', 'Banks fetched', banks));
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Payments / Charges
      { method: 'POST', path: '/flutterwave/v3/payments', description: 'Create payment (hosted link)' },
      { method: 'POST', path: '/flutterwave/v3/charges', description: 'Direct charge (card, bank_transfer, mpesa, mobilemoney)' },
      { method: 'POST', path: '/flutterwave/v3/validate-charge', description: 'Validate charge (OTP)' },
      // Transactions
      { method: 'GET', path: '/flutterwave/v3/transactions', description: 'List transactions' },
      { method: 'GET', path: '/flutterwave/v3/transactions/:id', description: 'Get transaction' },
      { method: 'GET', path: '/flutterwave/v3/transactions/:id/verify', description: 'Verify transaction' },
      { method: 'GET', path: '/flutterwave/v3/transactions/verify_by_reference', description: 'Verify by tx_ref' },
      { method: 'POST', path: '/flutterwave/v3/transactions/:id/refund', description: 'Refund transaction' },
      { method: 'GET', path: '/flutterwave/v3/transactions/fee', description: 'Calculate fees' },
      // Transfers
      { method: 'POST', path: '/flutterwave/v3/transfers', description: 'Create transfer' },
      { method: 'GET', path: '/flutterwave/v3/transfers', description: 'List transfers' },
      { method: 'GET', path: '/flutterwave/v3/transfers/:id', description: 'Get transfer' },
      { method: 'POST', path: '/flutterwave/v3/bulk-transfers', description: 'Create bulk transfer' },
      // Beneficiaries
      { method: 'POST', path: '/flutterwave/v3/beneficiaries', description: 'Create beneficiary' },
      { method: 'GET', path: '/flutterwave/v3/beneficiaries', description: 'List beneficiaries' },
      { method: 'GET', path: '/flutterwave/v3/beneficiaries/:id', description: 'Get beneficiary' },
      { method: 'DELETE', path: '/flutterwave/v3/beneficiaries/:id', description: 'Delete beneficiary' },
      // Subaccounts
      { method: 'POST', path: '/flutterwave/v3/subaccounts', description: 'Create subaccount' },
      { method: 'GET', path: '/flutterwave/v3/subaccounts', description: 'List subaccounts' },
      { method: 'GET', path: '/flutterwave/v3/subaccounts/:id', description: 'Get subaccount' },
      { method: 'PUT', path: '/flutterwave/v3/subaccounts/:id', description: 'Update subaccount' },
      { method: 'DELETE', path: '/flutterwave/v3/subaccounts/:id', description: 'Delete subaccount' },
      // Payment Plans
      { method: 'POST', path: '/flutterwave/v3/payment-plans', description: 'Create payment plan' },
      { method: 'GET', path: '/flutterwave/v3/payment-plans', description: 'List payment plans' },
      { method: 'GET', path: '/flutterwave/v3/payment-plans/:id', description: 'Get payment plan' },
      { method: 'PUT', path: '/flutterwave/v3/payment-plans/:id/cancel', description: 'Cancel payment plan' },
      // Subscriptions
      { method: 'GET', path: '/flutterwave/v3/subscriptions', description: 'List subscriptions' },
      { method: 'PUT', path: '/flutterwave/v3/subscriptions/:id/activate', description: 'Activate subscription' },
      { method: 'PUT', path: '/flutterwave/v3/subscriptions/:id/cancel', description: 'Cancel subscription' },
      // Virtual Account Numbers
      { method: 'POST', path: '/flutterwave/v3/virtual-account-numbers', description: 'Create virtual account' },
      { method: 'GET', path: '/flutterwave/v3/virtual-account-numbers/:order_ref', description: 'Get virtual account' },
      // Bill Payments
      { method: 'POST', path: '/flutterwave/v3/bills', description: 'Create bill payment' },
      { method: 'GET', path: '/flutterwave/v3/bills', description: 'List bills' },
      { method: 'GET', path: '/flutterwave/v3/bill-categories', description: 'Get bill categories' },
      // Settlements
      { method: 'GET', path: '/flutterwave/v3/settlements', description: 'List settlements' },
      { method: 'GET', path: '/flutterwave/v3/settlements/:id', description: 'Get settlement' },
      // Chargebacks
      { method: 'GET', path: '/flutterwave/v3/chargebacks', description: 'List chargebacks' },
      { method: 'POST', path: '/flutterwave/v3/chargebacks/:id', description: 'Accept/decline chargeback' },
      // Balances
      { method: 'GET', path: '/flutterwave/v3/balances', description: 'Get all balances' },
      { method: 'GET', path: '/flutterwave/v3/balances/:currency', description: 'Get balance by currency' },
      // Banks
      { method: 'GET', path: '/flutterwave/v3/banks/:country_code', description: 'List banks by country' },
    ];
  }

  // ── Cross-surface seeding ──────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    transactions: NS.transactions,
    refunds: NS.refunds,
    transfers: NS.transfers,
    beneficiaries: NS.beneficiaries,
    subaccounts: NS.subaccounts,
    plans: NS.plans,
    subscriptions: NS.subscriptions,
    settlements: NS.settlements,
    chargebacks: NS.chargebacks,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const flwData = expanded.apiResponses?.flutterwave;
      if (!flwData) continue;

      for (const [resourceType, responses] of Object.entries(flwData.responses)) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          const key = (body.id as string | number) ?? (body.flw_ref as string);
          if (!key) continue;

          store.set(namespace, String(key), body);
        }
      }
    }
  }
}
