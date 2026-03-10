import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, DataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { KlarnaConfig } from './config.js';
import { klarnaError } from './klarna-errors.js';
import { generateUUID } from './helpers.js';
import { registerKlarnaTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  sessions: 'kl_sessions',
  auths: 'kl_auths',
  orders: 'kl_orders',
  captures: 'kl_captures',
  refunds: 'kl_refunds',
  checkoutOrders: 'kl_checkout_orders',
  customerTokens: 'kl_customer_tokens',
  hppSessions: 'kl_hpp_sessions',
  payouts: 'kl_payouts',
} as const;

// ---------------------------------------------------------------------------
// Klarna Adapter
// ---------------------------------------------------------------------------

export class KlarnaAdapter extends BaseApiMockAdapter<KlarnaConfig> {
  readonly id = 'klarna';
  readonly name = 'Klarna API';
  readonly basePath = '/klarna';
  readonly versions = [
    'payments/v1',
    'ordermanagement/v1',
    'checkout/v3',
    'customer-token/v1',
    'hpp/v1',
    'settlements/v1',
  ];
  readonly promptContext = {
    resources: ['sessions', 'orders', 'captures', 'refunds', 'customer_tokens'],
    amountFormat: 'integer minor units (e.g. 2999 = $29.99)',
    relationships: [
      'order → session',
      'capture → order',
      'refund → order',
      'customer_token → order',
    ],
    requiredFields: {
      sessions: ['session_id', 'status', 'purchase_country', 'purchase_currency', 'order_amount'],
      orders: ['order_id', 'status', 'purchase_country', 'purchase_currency', 'order_amount', 'created_at'],
      captures: ['capture_id', 'captured_amount', 'captured_at'],
      refunds: ['refund_id', 'refunded_amount'],
      customer_tokens: ['status', 'payment_method_type'],
    },
    notes: 'Buy-now-pay-later platform. Amounts in minor units. Timestamps ISO 8601. Order status: AUTHORIZED, PART_CAPTURED, CAPTURED, CANCELLED, EXPIRED. Requires order_lines with name, quantity, unit_price, total_amount per line.',
  };

  readonly dataSpec: DataSpec = {
    timestampFormat: 'iso8601',
    amountFields: ['order_amount', 'captured_amount', 'refunded_amount', 'unit_price', 'total_amount'],
    statusEnums: {
      orders: ['AUTHORIZED', 'PART_CAPTURED', 'CAPTURED', 'CANCELLED', 'EXPIRED'],
    },
    timestampFields: ['created_at', 'captured_at', 'expires_at'],
  };

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerKlarnaTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Basic ')) return null;
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
      const username = decoded.split(':')[0];
      const match = username.match(/^K_([a-z0-9-]+)_/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // ── Seed from expanded apiResponses ──────────────────────────────────
    this.seedFromApiResponses(data, store);

    // ══════════════════════════════════════════════════════════════════════
    //  KLARNA PAYMENTS (/payments/v1/)
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Payment Session ───────────────────────────────────────────
    server.post('/klarna/payments/v1/sessions', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sessionId = generateUUID();
      const session = {
        session_id: sessionId,
        client_token: `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64')}`,
        payment_method_categories: body.payment_method_categories || [
          { identifier: 'pay_later', name: 'Pay later', asset_urls: { descriptive: '', standard: '' } },
          { identifier: 'pay_over_time', name: 'Slice it', asset_urls: { descriptive: '', standard: '' } },
        ],
        purchase_country: body.purchase_country || 'US',
        purchase_currency: body.purchase_currency || 'USD',
        locale: body.locale || 'en-US',
        order_amount: body.order_amount || 0,
        order_tax_amount: body.order_tax_amount || 0,
        order_lines: body.order_lines || [],
        merchant_urls: body.merchant_urls || {},
        status: 'incomplete',
        acquiring_channel: body.acquiring_channel || 'ECOMMERCE',
        expires_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
      };
      store.set(NS.sessions, sessionId, session);
      return reply.status(200).send(session);
    });

    // ── Read Payment Session ─────────────────────────────────────────────
    server.get('/klarna/payments/v1/sessions/:session_id', async (req, reply) => {
      const { session_id } = req.params as { session_id: string };
      const session = store.get(NS.sessions, session_id);
      if (!session) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`Payment session ${session_id} not found`]));
      }
      return reply.send(session);
    });

    // ── Update Payment Session ───────────────────────────────────────────
    server.post('/klarna/payments/v1/sessions/:session_id', async (req, reply) => {
      const { session_id } = req.params as { session_id: string };
      const session = store.get(NS.sessions, session_id);
      if (!session) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`Payment session ${session_id} not found`]));
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      store.update(NS.sessions, session_id, { ...body, session_id });
      return reply.status(204).send();
    });

    // ── Create Order from Authorization ──────────────────────────────────
    server.post('/klarna/payments/v1/authorizations/:authorizationToken/order', async (req, reply) => {
      const { authorizationToken } = req.params as { authorizationToken: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const orderId = generateUUID();
      const orderAmount = (body.order_amount as number) || 0;
      const order = {
        order_id: orderId,
        status: 'AUTHORIZED',
        authorization_token: authorizationToken,
        fraud_status: 'ACCEPTED',
        purchase_country: body.purchase_country || 'US',
        purchase_currency: body.purchase_currency || 'USD',
        locale: body.locale || 'en-US',
        order_amount: orderAmount,
        order_tax_amount: body.order_tax_amount || 0,
        order_lines: body.order_lines || [],
        merchant_reference1: body.merchant_reference1 || '',
        merchant_reference2: body.merchant_reference2 || '',
        authorized_payment_method: {
          type: 'invoice',
          number_of_installments: 0,
          number_of_days: 30,
        },
        redirect_url: `https://payments.klarna.com/redirect/${orderId}`,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 28 * 86400_000).toISOString(),
        remaining_authorized_amount: orderAmount,
        captured_amount: 0,
        refunded_amount: 0,
        captures: [],
        refunds: [],
      };
      store.set(NS.orders, orderId, order);
      store.delete(NS.auths, authorizationToken);
      return reply.status(200).send(order);
    });

    // ── Cancel Authorization ─────────────────────────────────────────────
    server.delete('/klarna/payments/v1/authorizations/:authorizationToken', async (req, reply) => {
      const { authorizationToken } = req.params as { authorizationToken: string };
      store.delete(NS.auths, authorizationToken);
      return reply.status(204).send();
    });

    // ══════════════════════════════════════════════════════════════════════
    //  ORDER MANAGEMENT (/ordermanagement/v1/)
    // ══════════════════════════════════════════════════════════════════════

    // ── Get Order ────────────────────────────────────────────────────────
    server.get('/klarna/ordermanagement/v1/orders/:order_id', async (req, reply) => {
      const { order_id } = req.params as { order_id: string };
      const order = store.get(NS.orders, order_id);
      if (!order) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`Order ${order_id} not found`]));
      }
      return reply.send(order);
    });

    // ── Acknowledge Order ────────────────────────────────────────────────
    server.post('/klarna/ordermanagement/v1/orders/:order_id/acknowledge', async (req, reply) => {
      const { order_id } = req.params as { order_id: string };
      const order = store.get(NS.orders, order_id);
      if (!order) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`Order ${order_id} not found`]));
      }
      store.update(NS.orders, order_id, { acknowledged: true });
      return reply.status(204).send();
    });

    // ── Create Capture ───────────────────────────────────────────────────
    server.post('/klarna/ordermanagement/v1/orders/:order_id/captures', async (req, reply) => {
      const { order_id } = req.params as { order_id: string };
      const order = store.get<Record<string, unknown>>(NS.orders, order_id);
      if (!order) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`Order ${order_id} not found`]));
      }
      if (order.status === 'CANCELLED') {
        return reply.status(403).send(klarnaError('ORDER_CANCELLED', ['Order has been cancelled']));
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const capturedAmount = (body.captured_amount as number) || (order.remaining_authorized_amount as number);
      const captureId = generateUUID();
      const capture = {
        capture_id: captureId,
        klarna_reference: `K${generateId('', 16).toUpperCase()}`,
        captured_amount: capturedAmount,
        description: body.description || '',
        order_lines: body.order_lines || order.order_lines,
        shipping_info: body.shipping_info || [],
        captured_at: new Date().toISOString(),
        refunded_amount: 0,
      };

      const captures = [...((order.captures as unknown[]) || []), capture];
      const totalCaptured = ((order.captured_amount as number) || 0) + capturedAmount;
      const remaining = ((order.remaining_authorized_amount as number) || (order.order_amount as number)) - capturedAmount;
      const newStatus = remaining <= 0 ? 'CAPTURED' : 'PART_CAPTURED';

      store.set(NS.captures, captureId, capture);
      store.update(NS.orders, order_id, {
        status: newStatus,
        captures,
        captured_amount: totalCaptured,
        remaining_authorized_amount: remaining,
      });

      reply.header('Location', `/ordermanagement/v1/orders/${order_id}/captures/${captureId}`);
      reply.header('Capture-Id', captureId);
      return reply.status(201).send();
    });

    // ── Get Capture ──────────────────────────────────────────────────────
    server.get('/klarna/ordermanagement/v1/orders/:order_id/captures/:capture_id', async (req, reply) => {
      const { order_id, capture_id } = req.params as { order_id: string; capture_id: string };
      const order = store.get<Record<string, unknown>>(NS.orders, order_id);
      if (!order) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`Order ${order_id} not found`]));
      }
      const capture = ((order.captures as Record<string, unknown>[]) || []).find(
        (c) => c.capture_id === capture_id,
      );
      if (!capture) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`Capture ${capture_id} not found`]));
      }
      return reply.send(capture);
    });

    // ── Create Refund ────────────────────────────────────────────────────
    server.post('/klarna/ordermanagement/v1/orders/:order_id/refunds', async (req, reply) => {
      const { order_id } = req.params as { order_id: string };
      const order = store.get<Record<string, unknown>>(NS.orders, order_id);
      if (!order) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`Order ${order_id} not found`]));
      }
      if (((order.captured_amount as number) || 0) <= 0) {
        return reply.status(403).send(klarnaError('NOT_CAPTURED', ['Order has not been captured']));
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const refundedAmount = (body.refunded_amount as number) || (order.captured_amount as number);
      const refundId = generateUUID();
      const refund = {
        refund_id: refundId,
        refunded_amount: refundedAmount,
        description: body.description || '',
        order_lines: body.order_lines || [],
        refunded_at: new Date().toISOString(),
      };

      const refunds = [...((order.refunds as unknown[]) || []), refund];
      const totalRefunded = ((order.refunded_amount as number) || 0) + refundedAmount;

      store.set(NS.refunds, refundId, refund);
      store.update(NS.orders, order_id, {
        refunds,
        refunded_amount: totalRefunded,
      });

      reply.header('Location', `/ordermanagement/v1/orders/${order_id}/refunds/${refundId}`);
      reply.header('Refund-Id', refundId);
      return reply.status(201).send();
    });

    // ── Cancel Order ─────────────────────────────────────────────────────
    server.post('/klarna/ordermanagement/v1/orders/:order_id/cancel', async (req, reply) => {
      const { order_id } = req.params as { order_id: string };
      const order = store.get<Record<string, unknown>>(NS.orders, order_id);
      if (!order) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`Order ${order_id} not found`]));
      }
      if (((order.captured_amount as number) || 0) > 0) {
        return reply.status(403).send(klarnaError('ORDER_CAPTURED', ['Cannot cancel an order that has captures']));
      }
      store.update(NS.orders, order_id, { status: 'CANCELLED', remaining_authorized_amount: 0 });
      return reply.status(204).send();
    });

    // ── Release Remaining Authorization ──────────────────────────────────
    server.post('/klarna/ordermanagement/v1/orders/:order_id/release-remaining-authorization', async (req, reply) => {
      const { order_id } = req.params as { order_id: string };
      const order = store.get<Record<string, unknown>>(NS.orders, order_id);
      if (!order) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`Order ${order_id} not found`]));
      }
      const newStatus = ((order.captured_amount as number) || 0) > 0 ? 'CAPTURED' : 'CLOSED';
      store.update(NS.orders, order_id, { status: newStatus, remaining_authorized_amount: 0 });
      return reply.status(204).send();
    });

    // ── Extend Authorization Time ────────────────────────────────────────
    server.post('/klarna/ordermanagement/v1/orders/:order_id/extend-authorization-time', async (req, reply) => {
      const { order_id } = req.params as { order_id: string };
      const order = store.get<Record<string, unknown>>(NS.orders, order_id);
      if (!order) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`Order ${order_id} not found`]));
      }
      if (order.status !== 'AUTHORIZED' && order.status !== 'PART_CAPTURED') {
        return reply.status(403).send(klarnaError('NOT_ALLOWED', ['Order is not in an extendable state']));
      }
      store.update(NS.orders, order_id, {
        expires_at: new Date(Date.now() + 28 * 86400_000).toISOString(),
      });
      return reply.status(204).send();
    });

    // ══════════════════════════════════════════════════════════════════════
    //  CHECKOUT (/checkout/v3/)
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Checkout Order ────────────────────────────────────────────
    server.post('/klarna/checkout/v3/orders', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const orderId = generateUUID();
      const checkoutOrder = {
        order_id: orderId,
        status: 'checkout_incomplete',
        purchase_country: body.purchase_country || 'US',
        purchase_currency: body.purchase_currency || 'USD',
        locale: body.locale || 'en-US',
        order_amount: body.order_amount || 0,
        order_tax_amount: body.order_tax_amount || 0,
        order_lines: body.order_lines || [],
        merchant_urls: body.merchant_urls || {},
        merchant_reference1: body.merchant_reference1 || '',
        merchant_reference2: body.merchant_reference2 || '',
        html_snippet: `<div id="klarna-checkout-container"><script>/* Klarna Checkout Widget for ${orderId} */</script></div>`,
        started_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
        options: body.options || {},
        shipping_options: body.shipping_options || [],
      };
      store.set(NS.checkoutOrders, orderId, checkoutOrder);
      return reply.status(200).send(checkoutOrder);
    });

    // ── Read Checkout Order ──────────────────────────────────────────────
    server.get('/klarna/checkout/v3/orders/:order_id', async (req, reply) => {
      const { order_id } = req.params as { order_id: string };
      const checkoutOrder = store.get(NS.checkoutOrders, order_id);
      if (!checkoutOrder) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`Checkout order ${order_id} not found`]));
      }
      return reply.send(checkoutOrder);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  CUSTOMER TOKEN (/customer-token/v1/)
    // ══════════════════════════════════════════════════════════════════════

    // ── Get Customer Token ───────────────────────────────────────────────
    server.get('/klarna/customer-token/v1/tokens/:customerToken', async (req, reply) => {
      const { customerToken } = req.params as { customerToken: string };
      const token = store.get<Record<string, unknown>>(NS.customerTokens, customerToken);
      if (!token) {
        const generated = {
          token_id: customerToken,
          status: 'ACTIVE',
          payment_method_type: 'INVOICE',
          description: 'Pay later.',
          valid_payment_method: true,
        };
        store.set(NS.customerTokens, customerToken, generated);
        return reply.send(generated);
      }
      return reply.send(token);
    });

    // ── Create Order with Customer Token ─────────────────────────────────
    server.post('/klarna/customer-token/v1/tokens/:customerToken/order', async (req, reply) => {
      const { customerToken } = req.params as { customerToken: string };
      const token = store.get<Record<string, unknown>>(NS.customerTokens, customerToken);
      if (!token || token.status !== 'ACTIVE') {
        return reply.status(403).send(klarnaError('TOKEN_NOT_ACTIVE', ['Customer token is not active']));
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const orderId = generateUUID();
      const orderAmount = (body.order_amount as number) || 0;
      const order = {
        order_id: orderId,
        status: 'AUTHORIZED',
        fraud_status: 'ACCEPTED',
        purchase_country: body.purchase_country || 'US',
        purchase_currency: body.purchase_currency || 'USD',
        locale: body.locale || 'en-US',
        order_amount: orderAmount,
        order_tax_amount: body.order_tax_amount || 0,
        order_lines: body.order_lines || [],
        merchant_reference1: body.merchant_reference1 || '',
        redirect_url: `https://payments.klarna.com/redirect/${orderId}`,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 28 * 86400_000).toISOString(),
        remaining_authorized_amount: orderAmount,
        captured_amount: 0,
        refunded_amount: 0,
        captures: [],
        refunds: [],
      };
      store.set(NS.orders, orderId, order);
      return reply.status(200).send(order);
    });

    // ── Update Customer Token Status ─────────────────────────────────────
    server.patch('/klarna/customer-token/v1/tokens/:customerToken/status', async (req, reply) => {
      const { customerToken } = req.params as { customerToken: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const token = store.get(NS.customerTokens, customerToken);
      if (!token) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`Customer token ${customerToken} not found`]));
      }
      store.update(NS.customerTokens, customerToken, { status: body.status || 'CANCELLED' });
      return reply.status(202).send();
    });

    // ══════════════════════════════════════════════════════════════════════
    //  HOSTED PAYMENT PAGE (/hpp/v1/)
    // ══════════════════════════════════════════════════════════════════════

    // ── Create HPP Session ───────────────────────────────────────────────
    server.post('/klarna/hpp/v1/sessions', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sessionId = generateUUID();
      const hppSession = {
        session_id: sessionId,
        session_url: `https://buy.klarna.com/hpp/${sessionId}`,
        qr_code_url: `https://buy.klarna.com/hpp/${sessionId}/qr`,
        distribution_url: `https://buy.klarna.com/hpp/${sessionId}/link`,
        distribution_module: body.distribution_module || { type: 'redirect' },
        payment_session_url: body.payment_session_url || '',
        merchant_urls: body.merchant_urls || {},
        options: body.options || {},
        status: 'WAITING',
        expires_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.set(NS.hppSessions, sessionId, hppSession);
      return reply.status(201).send(hppSession);
    });

    // ── Get HPP Session ──────────────────────────────────────────────────
    server.get('/klarna/hpp/v1/sessions/:session_id', async (req, reply) => {
      const { session_id } = req.params as { session_id: string };
      const hppSession = store.get(NS.hppSessions, session_id);
      if (!hppSession) {
        return reply.status(404).send(klarnaError('NOT_FOUND', [`HPP session ${session_id} not found`]));
      }
      return reply.send(hppSession);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  SETTLEMENTS (/settlements/v1/)
    // ══════════════════════════════════════════════════════════════════════

    // ── List Payouts ─────────────────────────────────────────────────────
    server.get('/klarna/settlements/v1/payouts', async (req, reply) => {
      const query = req.query as Record<string, string>;
      const payouts = store.list<Record<string, unknown>>(NS.payouts);
      if (payouts.length > 0) {
        return reply.send({ payouts, pagination: { count: payouts.length, total: payouts.length } });
      }
      const samplePayouts = Array.from({ length: 3 }, (_, i) => ({
        payout_id: generateUUID(),
        payment_reference: `KL-${generateId('', 8).toUpperCase()}`,
        currency_code: query.currency_code || 'USD',
        total_amount: 10000 + i * 5000,
        total_commission: Math.round((10000 + i * 5000) * 0.029),
        total_tax: 0,
        total_fee_correction: 0,
        net_amount: 10000 + i * 5000 - Math.round((10000 + i * 5000) * 0.029),
        payout_date: new Date(Date.now() - i * 7 * 86400_000).toISOString().split('T')[0],
        transactions_count: 5 + i * 3,
        status: 'PAID',
      }));
      samplePayouts.forEach((p) => store.set(NS.payouts, p.payout_id, p));
      return reply.send({
        payouts: samplePayouts,
        pagination: { count: samplePayouts.length, total: samplePayouts.length },
      });
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Klarna Payments
      { method: 'POST', path: '/klarna/payments/v1/sessions', description: 'Create payment session' },
      { method: 'GET', path: '/klarna/payments/v1/sessions/:session_id', description: 'Read payment session' },
      { method: 'POST', path: '/klarna/payments/v1/sessions/:session_id', description: 'Update payment session' },
      { method: 'POST', path: '/klarna/payments/v1/authorizations/:authorizationToken/order', description: 'Create order from auth' },
      { method: 'DELETE', path: '/klarna/payments/v1/authorizations/:authorizationToken', description: 'Cancel authorization' },
      // Order Management
      { method: 'GET', path: '/klarna/ordermanagement/v1/orders/:order_id', description: 'Get order' },
      { method: 'POST', path: '/klarna/ordermanagement/v1/orders/:order_id/acknowledge', description: 'Acknowledge order' },
      { method: 'POST', path: '/klarna/ordermanagement/v1/orders/:order_id/captures', description: 'Create capture' },
      { method: 'GET', path: '/klarna/ordermanagement/v1/orders/:order_id/captures/:capture_id', description: 'Get capture' },
      { method: 'POST', path: '/klarna/ordermanagement/v1/orders/:order_id/refunds', description: 'Create refund' },
      { method: 'POST', path: '/klarna/ordermanagement/v1/orders/:order_id/cancel', description: 'Cancel order' },
      { method: 'POST', path: '/klarna/ordermanagement/v1/orders/:order_id/release-remaining-authorization', description: 'Release auth' },
      { method: 'POST', path: '/klarna/ordermanagement/v1/orders/:order_id/extend-authorization-time', description: 'Extend auth' },
      // Checkout
      { method: 'POST', path: '/klarna/checkout/v3/orders', description: 'Create checkout order' },
      { method: 'GET', path: '/klarna/checkout/v3/orders/:order_id', description: 'Read checkout order' },
      // Customer Token
      { method: 'GET', path: '/klarna/customer-token/v1/tokens/:customerToken', description: 'Get customer token' },
      { method: 'POST', path: '/klarna/customer-token/v1/tokens/:customerToken/order', description: 'Create order with token' },
      { method: 'PATCH', path: '/klarna/customer-token/v1/tokens/:customerToken/status', description: 'Update token status' },
      // HPP
      { method: 'POST', path: '/klarna/hpp/v1/sessions', description: 'Create HPP session' },
      { method: 'GET', path: '/klarna/hpp/v1/sessions/:session_id', description: 'Get HPP session' },
      // Settlements
      { method: 'GET', path: '/klarna/settlements/v1/payouts', description: 'List payouts' },
    ];
  }

  // ── Cross-surface seeding ──────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    sessions: NS.sessions,
    orders: NS.orders,
    captures: NS.captures,
    refunds: NS.refunds,
    checkout_orders: NS.checkoutOrders,
    customer_tokens: NS.customerTokens,
    hpp_sessions: NS.hppSessions,
    payouts: NS.payouts,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const klarnaData = expanded.apiResponses?.klarna;
      if (!klarnaData) continue;

      for (const [resourceType, responses] of Object.entries(
        klarnaData.responses,
      )) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          const key =
            (body.order_id as string) ??
            (body.session_id as string) ??
            (body.token_id as string) ??
            (body.id as string) ??
            (body.payout_id as string);
          if (!key) continue;

          store.set(namespace, String(key), body);
        }
      }
    }
  }
}
