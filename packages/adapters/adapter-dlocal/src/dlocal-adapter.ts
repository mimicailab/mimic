import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { DLocalConfig } from './config.js';
import { dlError } from './dlocal-errors.js';
import { registerDlocalTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  payments: 'dl_payments',
  refunds: 'dl_refunds',
  payouts: 'dl_payouts',
  chargebacks: 'dl_chargebacks',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a dLocal-style ID: D-{digit}-{uuid} */
function dlId(): string {
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  const digit = Math.floor(Math.random() * 10);
  return `D-${digit}-${uuid}`;
}

/** Build a payment object from request body */
function buildPayment(body: any, status: string): any {
  // Sandbox testing: control outcome via description field
  let resolvedStatus = status;
  if (body.description) {
    const desc = body.description.toUpperCase();
    if (desc.includes('REJECT')) resolvedStatus = 'REJECTED';
    else if (desc.includes('PENDING')) resolvedStatus = 'PENDING';
    else if (desc.includes('CANCEL')) resolvedStatus = 'CANCELLED';
    else if (desc.includes('EXPIRE')) resolvedStatus = 'EXPIRED';
    else if (desc.includes('AUTHORIZE')) resolvedStatus = 'AUTHORIZED';
    else if (desc.includes('VERIFY')) resolvedStatus = 'VERIFIED';
  }

  return {
    id: dlId(),
    amount: body.amount,
    currency: body.currency || 'USD',
    country: body.country || 'BR',
    payment_method_id: body.payment_method_id || 'CARD',
    payment_method_type: body.payment_method_type || 'CARD',
    payment_method_flow: body.payment_method_flow || 'DIRECT',
    payer: body.payer || {
      name: 'Test User',
      email: 'test@example.com',
      document: '12345678901',
    },
    order_id: body.order_id || `ORD-${Date.now()}`,
    notification_url: body.notification_url || null,
    description: body.description || null,
    status: resolvedStatus,
    status_detail:
      resolvedStatus === 'PAID'
        ? 'The payment was paid.'
        : `The payment is ${resolvedStatus.toLowerCase()}.`,
    created_date: new Date().toISOString(),
    approved_date: resolvedStatus === 'PAID' ? new Date().toISOString() : null,
    redirect_url:
      body.payment_method_flow === 'REDIRECT'
        ? `https://sandbox.dlocal.com/collect/${dlId()}`
        : null,
  };
}

/** Payment methods by country */
function getPaymentMethodsForCountry(country: string): any[] {
  const methodsByCountry: Record<string, any[]> = {
    BR: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'PIX', type: 'BANK_TRANSFER', name: 'PIX', flow: 'REDIRECT' },
      { id: 'BL', type: 'TICKET', name: 'Boleto Bancario', flow: 'REDIRECT' },
    ],
    MX: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'SE', type: 'BANK_TRANSFER', name: 'SPEI', flow: 'REDIRECT' },
      { id: 'OX', type: 'TICKET', name: 'OXXO', flow: 'REDIRECT' },
    ],
    AR: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'RP', type: 'TICKET', name: 'Rapipago', flow: 'REDIRECT' },
      { id: 'PF', type: 'TICKET', name: 'Pago Facil', flow: 'REDIRECT' },
    ],
    CL: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'WP', type: 'BANK_TRANSFER', name: 'WebPay', flow: 'REDIRECT' },
      { id: 'SP', type: 'BANK_TRANSFER', name: 'ServiPag', flow: 'REDIRECT' },
    ],
    CO: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'EF', type: 'TICKET', name: 'Efecty', flow: 'REDIRECT' },
      { id: 'PSE', type: 'BANK_TRANSFER', name: 'PSE', flow: 'REDIRECT' },
    ],
    PE: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'PE', type: 'TICKET', name: 'PagoEfectivo', flow: 'REDIRECT' },
    ],
    IN: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'UI', type: 'BANK_TRANSFER', name: 'UPI', flow: 'REDIRECT' },
      { id: 'NB', type: 'BANK_TRANSFER', name: 'NetBanking', flow: 'REDIRECT' },
      { id: 'WA', type: 'WALLET', name: 'Wallet', flow: 'REDIRECT' },
    ],
    NG: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'BT', type: 'BANK_TRANSFER', name: 'Bank Transfer', flow: 'REDIRECT' },
    ],
    KE: [
      { id: 'MP', type: 'WALLET', name: 'M-Pesa', flow: 'REDIRECT' },
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
    ],
    ZA: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'EF', type: 'BANK_TRANSFER', name: 'EFT', flow: 'REDIRECT' },
    ],
    GH: [
      { id: 'MM', type: 'WALLET', name: 'MTN Mobile Money', flow: 'REDIRECT' },
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
    ],
    EG: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'FW', type: 'WALLET', name: 'Fawry', flow: 'REDIRECT' },
    ],
    ID: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'OV', type: 'WALLET', name: 'OVO', flow: 'REDIRECT' },
      { id: 'DA', type: 'WALLET', name: 'DANA', flow: 'REDIRECT' },
    ],
    PH: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'GC', type: 'WALLET', name: 'GCash', flow: 'REDIRECT' },
    ],
    TH: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'PP', type: 'WALLET', name: 'PromptPay', flow: 'REDIRECT' },
    ],
    VN: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'MO', type: 'WALLET', name: 'MoMo', flow: 'REDIRECT' },
    ],
    JP: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'KN', type: 'TICKET', name: 'Konbini', flow: 'REDIRECT' },
    ],
    MY: [
      { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
      { id: 'FP', type: 'BANK_TRANSFER', name: 'FPX', flow: 'REDIRECT' },
    ],
  };
  return methodsByCountry[country] || [
    { id: 'CARD', type: 'CARD', name: 'Credit/Debit Card', flow: 'DIRECT' },
  ];
}

/** Exchange rate helper */
function getExchangeRate(from?: string, to?: string): number {
  const rates: Record<string, number> = {
    'USD_BRL': 5.05, 'USD_MXN': 17.15, 'USD_ARS': 870.50,
    'USD_CLP': 935.20, 'USD_COP': 3950.00, 'USD_PEN': 3.72,
    'USD_INR': 83.25, 'USD_IDR': 15650.00, 'USD_PHP': 56.10,
    'USD_THB': 35.50, 'USD_VND': 24500.00, 'USD_JPY': 149.80,
    'USD_MYR': 4.72, 'USD_NGN': 1550.00, 'USD_KES': 153.50,
    'USD_ZAR': 18.75, 'USD_GHS': 14.80, 'USD_EGP': 30.90,
  };
  const key = `${from || 'USD'}_${to || 'BRL'}`;
  return rates[key] || 1.00;
}

// ---------------------------------------------------------------------------
// dLocal Adapter
// ---------------------------------------------------------------------------

export class DLocalAdapter extends BaseApiMockAdapter<DLocalConfig> {
  readonly id = 'dlocal';
  readonly name = 'dLocal API';
  readonly basePath = '/dlocal';
  readonly versions = ['2.1'];

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerDlocalTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const login = req.headers['x-login'];
    if (!login || typeof login !== 'string') return null;
    const match = login.match(/^dl_([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    _data: Map<string, ExpandedData>,
    state: StateStore,
  ): Promise<void> {

    // ── Auth Validation Hook ──────────────────────────────
    server.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/dlocal')) return;
      const xLogin = req.headers['x-login'];
      const xTransKey = req.headers['x-trans-key'];
      const xDate = req.headers['x-date'];
      const xVersion = req.headers['x-version'];
      const auth = req.headers.authorization;

      if (!xLogin || !xTransKey || !xDate || !xVersion) {
        return reply.status(401).send(dlError(4000, 'Missing authentication headers'));
      }
      if (!auth || !auth.startsWith('V2-HMAC-SHA256')) {
        return reply.status(401).send(dlError(4000, 'Invalid authorization header'));
      }
    });

    // ── Create Payment ────────────────────────────────────
    server.post('/dlocal/payments', async (req, reply) => {
      const body = req.body as any;
      const payment = buildPayment(body, 'PAID');
      state.set(NS.payments, payment.id, payment);
      return reply.status(200).send(payment);
    });

    // ── Create Secure Payment (raw card data) ─────────────
    server.post('/dlocal/secure_payments', async (req, reply) => {
      const body = req.body as any;
      const payment = buildPayment(body, 'PAID');
      payment.card = {
        holder_name: body.card?.holder_name || 'John Doe',
        expiration_month: body.card?.expiration_month || 12,
        expiration_year: body.card?.expiration_year || 2027,
        last4: body.card?.number ? body.card.number.slice(-4) : '4242',
        brand: body.card?.brand || 'VI',
      };
      state.set(NS.payments, payment.id, payment);
      return reply.status(200).send(payment);
    });

    // ── Get Payment ───────────────────────────────────────
    server.get('/dlocal/payments/:payment_id', async (req, reply) => {
      const { payment_id } = req.params as any;
      const payment = state.get<any>(NS.payments, payment_id);
      if (!payment) return reply.status(404).send(dlError(4000, `Payment ${payment_id} not found`));
      return reply.send(payment);
    });

    // ── Cancel Payment ────────────────────────────────────
    server.post('/dlocal/payments/:payment_id/cancel', async (req, reply) => {
      const { payment_id } = req.params as any;
      const payment = state.get<any>(NS.payments, payment_id);
      if (!payment) return reply.status(404).send(dlError(4000, `Payment ${payment_id} not found`));
      if (payment.status !== 'PENDING' && payment.status !== 'AUTHORIZED') {
        return reply.status(400).send(dlError(5007, 'Payment cannot be cancelled in current status'));
      }
      state.update(NS.payments, payment_id, { status: 'CANCELLED' });
      return reply.send(state.get(NS.payments, payment_id));
    });

    // ── Capture Authorized Payment ────────────────────────
    server.post('/dlocal/payments/:payment_id/capture', async (req, reply) => {
      const { payment_id } = req.params as any;
      const body = req.body as any;
      const payment = state.get<any>(NS.payments, payment_id);
      if (!payment) return reply.status(404).send(dlError(4000, `Payment ${payment_id} not found`));
      if (payment.status !== 'AUTHORIZED') {
        return reply.status(400).send(dlError(5007, 'Payment is not in AUTHORIZED status'));
      }
      state.update(NS.payments, payment_id, {
        status: 'PAID',
        amount: body.amount || payment.amount,
        approved_date: new Date().toISOString(),
      });
      return reply.send(state.get(NS.payments, payment_id));
    });

    // ── Create Refund ─────────────────────────────────────
    server.post('/dlocal/refunds', async (req, reply) => {
      const body = req.body as any;
      const payment = state.get<any>(NS.payments, body.payment_id);
      if (!payment) return reply.status(404).send(dlError(4000, `Payment ${body.payment_id} not found`));
      if (payment.status !== 'PAID') {
        return reply.status(400).send(dlError(5007, 'Payment is not in PAID status'));
      }
      const refund = {
        id: dlId(),
        payment_id: body.payment_id,
        status: 'SUCCESS',
        amount: body.amount || payment.amount,
        currency: body.currency || payment.currency,
        notification_url: body.notification_url || null,
        description: body.description || null,
        created_date: new Date().toISOString(),
      };
      state.set(NS.refunds, refund.id, refund);
      return reply.status(200).send(refund);
    });

    // ── Get Refund ────────────────────────────────────────
    server.get('/dlocal/refunds/:refund_id', async (req, reply) => {
      const { refund_id } = req.params as any;
      const refund = state.get<any>(NS.refunds, refund_id);
      if (!refund) return reply.status(404).send(dlError(4000, `Refund ${refund_id} not found`));
      return reply.send(refund);
    });

    // ── Create Payout ─────────────────────────────────────
    server.post('/dlocal/payouts', async (req, reply) => {
      const body = req.body as any;
      const payout = {
        id: dlId(),
        status: 'PENDING',
        amount: body.amount,
        currency: body.currency || 'USD',
        country: body.country || 'BR',
        beneficiary: body.beneficiary || {},
        notification_url: body.notification_url || null,
        type: body.type || 'BANK_TRANSFER',
        created_date: new Date().toISOString(),
      };
      state.set(NS.payouts, payout.id, payout);
      return reply.status(200).send(payout);
    });

    // ── Get Payout ────────────────────────────────────────
    server.get('/dlocal/payouts/:payout_id', async (req, reply) => {
      const { payout_id } = req.params as any;
      const payout = state.get<any>(NS.payouts, payout_id);
      if (!payout) return reply.status(404).send(dlError(4000, `Payout ${payout_id} not found`));
      return reply.send(payout);
    });

    // ── List Payment Methods ──────────────────────────────
    server.get('/dlocal/payments-methods', async (req, reply) => {
      const { country } = req.query as any;
      const methods = getPaymentMethodsForCountry(country || 'BR');
      return reply.send(methods);
    });

    // ── Exchange Rates ────────────────────────────────────
    server.get('/dlocal/exchange-rates', async (req, reply) => {
      const { from, to } = req.query as any;
      return reply.send({
        from: from || 'USD',
        to: to || 'BRL',
        rate: getExchangeRate(from, to),
        timestamp: new Date().toISOString(),
      });
    });

    // ── Installment Plans ─────────────────────────────────
    server.get('/dlocal/installments-plans', async (req, reply) => {
      const { country, bin, amount, currency } = req.query as any;
      const parsedAmount = parseFloat(amount) || 100.00;
      return reply.send({
        id: dlId(),
        country: country || 'BR',
        bin: bin || '411111',
        amount: parsedAmount,
        currency: currency || 'BRL',
        installments: [
          { id: '1', installment_amount: parsedAmount, total_amount: parsedAmount, installments: 1 },
          { id: '2', installment_amount: parseFloat((parsedAmount * 1.05 / 3).toFixed(2)), total_amount: parseFloat((parsedAmount * 1.05).toFixed(2)), installments: 3 },
          { id: '3', installment_amount: parseFloat((parsedAmount * 1.10 / 6).toFixed(2)), total_amount: parseFloat((parsedAmount * 1.10).toFixed(2)), installments: 6 },
          { id: '4', installment_amount: parseFloat((parsedAmount * 1.18 / 12).toFixed(2)), total_amount: parseFloat((parsedAmount * 1.18).toFixed(2)), installments: 12 },
        ],
      });
    });

    // ── Submit Chargeback Dispute ──────────────────────────
    server.post('/dlocal/chargebacks/dispute/:chargeback_id', async (req, reply) => {
      const { chargeback_id } = req.params as any;
      const body = req.body as any;
      const chargeback = state.get<any>(NS.chargebacks, chargeback_id);
      if (!chargeback) {
        // Auto-create a chargeback record if not found (for testing convenience)
        const newChargeback = {
          id: chargeback_id,
          status: 'DISPUTE_IN_REVIEW',
          dispute_evidence: body,
          created_date: new Date().toISOString(),
          updated_date: new Date().toISOString(),
        };
        state.set(NS.chargebacks, chargeback_id, newChargeback);
        return reply.status(200).send(newChargeback);
      }
      state.update(NS.chargebacks, chargeback_id, {
        status: 'DISPUTE_IN_REVIEW',
        dispute_evidence: body,
        updated_date: new Date().toISOString(),
      });
      return reply.send(state.get(NS.chargebacks, chargeback_id));
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      { method: 'POST', path: '/dlocal/payments', description: 'Create payment' },
      { method: 'POST', path: '/dlocal/secure_payments', description: 'Create payment (raw card)' },
      { method: 'GET', path: '/dlocal/payments/:payment_id', description: 'Get payment' },
      { method: 'POST', path: '/dlocal/payments/:payment_id/cancel', description: 'Cancel payment' },
      { method: 'POST', path: '/dlocal/payments/:payment_id/capture', description: 'Capture payment' },
      { method: 'POST', path: '/dlocal/refunds', description: 'Create refund' },
      { method: 'GET', path: '/dlocal/refunds/:refund_id', description: 'Get refund' },
      { method: 'POST', path: '/dlocal/payouts', description: 'Create payout' },
      { method: 'GET', path: '/dlocal/payouts/:payout_id', description: 'Get payout' },
      { method: 'GET', path: '/dlocal/payments-methods', description: 'List payment methods' },
      { method: 'GET', path: '/dlocal/exchange-rates', description: 'Get exchange rate' },
      { method: 'GET', path: '/dlocal/installments-plans', description: 'Get installment plans' },
      { method: 'POST', path: '/dlocal/chargebacks/dispute/:chargeback_id', description: 'Submit dispute' },
    ];
  }
}
