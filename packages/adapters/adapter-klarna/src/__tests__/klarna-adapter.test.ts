import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData } from '@mimicai/core';
import { KlarnaAdapter } from '../klarna-adapter.js';

describe('KlarnaAdapter', () => {
  let ts: TestServer;
  let adapter: KlarnaAdapter;

  beforeAll(async () => {
    adapter = new KlarnaAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // helper – Basic Auth header
  const authHeader = 'Basic ' + Buffer.from('K_persona1_key:secret').toString('base64');

  // ── 1. Adapter metadata ──────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('klarna');
      expect(adapter.name).toBe('Klarna API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/klarna');
    });
  });

  // ── 2. Endpoints count ─────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return 21 endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(21);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Klarna Payments ─────────────────────────────────────────────────

  describe('Klarna Payments', () => {
    let sessionId: string;

    it('should create a payment session', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/klarna/payments/v1/sessions',
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({
          purchase_country: 'SE',
          purchase_currency: 'SEK',
          order_amount: 50000,
          order_tax_amount: 10000,
          order_lines: [
            { name: 'Widget', quantity: 1, unit_price: 50000, total_amount: 50000 },
          ],
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.session_id).toBeDefined();
      expect(body.client_token).toBeDefined();
      expect(body.status).toBe('incomplete');
      expect(body.purchase_country).toBe('SE');
      expect(body.order_amount).toBe(50000);
      sessionId = body.session_id;
    });

    it('should read a payment session', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/klarna/payments/v1/sessions/${sessionId}`,
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.session_id).toBe(sessionId);
      expect(body.order_amount).toBe(50000);
    });

    it('should return 404 for unknown session', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/klarna/payments/v1/sessions/nonexistent',
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error_code).toBe('NOT_FOUND');
    });

    it('should update a payment session (204)', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/payments/v1/sessions/${sessionId}`,
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({ order_amount: 60000 }),
      });
      expect(res.statusCode).toBe(204);
    });

    it('should cancel an authorization (204)', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: '/klarna/payments/v1/authorizations/some-auth-token',
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 4. Order from Authorization ────────────────────────────────────────

  describe('Create order from authorization', () => {
    let orderId: string;

    it('should create an order from authorization token', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/klarna/payments/v1/authorizations/auth-token-123/order',
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({
          purchase_country: 'SE',
          purchase_currency: 'SEK',
          order_amount: 25000,
          order_lines: [
            { name: 'Gadget', quantity: 1, unit_price: 25000, total_amount: 25000 },
          ],
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.order_id).toBeDefined();
      expect(body.status).toBe('AUTHORIZED');
      expect(body.fraud_status).toBe('ACCEPTED');
      expect(body.order_amount).toBe(25000);
      expect(body.remaining_authorized_amount).toBe(25000);
      expect(body.captured_amount).toBe(0);
      orderId = body.order_id;
    });

    it('should retrieve the order via order management', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/klarna/ordermanagement/v1/orders/${orderId}`,
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().order_id).toBe(orderId);
    });
  });

  // ── 5. Order Management lifecycle ──────────────────────────────────────

  describe('Order Management', () => {
    let orderId: string;
    let captureId: string;

    // Create a fresh order for lifecycle tests
    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/klarna/payments/v1/authorizations/lifecycle-auth/order',
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({
          purchase_country: 'US',
          purchase_currency: 'USD',
          order_amount: 10000,
          order_lines: [
            { name: 'Item', quantity: 2, unit_price: 5000, total_amount: 10000 },
          ],
        }),
      });
      orderId = res.json().order_id;
    });

    it('should acknowledge an order', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/acknowledge`,
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(204);
    });

    it('should extend authorization time', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/extend-authorization-time`,
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(204);
    });

    it('should capture the order', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/captures`,
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({ captured_amount: 6000, description: 'Partial capture' }),
      });
      expect(res.statusCode).toBe(201);
      captureId = res.headers['capture-id'] as string;
      expect(captureId).toBeDefined();
    });

    it('should retrieve the capture', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/captures/${captureId}`,
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.capture_id).toBe(captureId);
      expect(body.captured_amount).toBe(6000);
    });

    it('should show PART_CAPTURED status after partial capture', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/klarna/ordermanagement/v1/orders/${orderId}`,
        headers: { authorization: authHeader },
      });
      const body = res.json();
      expect(body.status).toBe('PART_CAPTURED');
      expect(body.captured_amount).toBe(6000);
      expect(body.remaining_authorized_amount).toBe(4000);
    });

    it('should capture the remaining amount', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/captures`,
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(201);
    });

    it('should show CAPTURED status after full capture', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/klarna/ordermanagement/v1/orders/${orderId}`,
        headers: { authorization: authHeader },
      });
      const body = res.json();
      expect(body.status).toBe('CAPTURED');
      expect(body.captured_amount).toBe(10000);
    });

    it('should refund the order', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/refunds`,
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({ refunded_amount: 3000, description: 'Partial refund' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.headers['refund-id']).toBeDefined();
    });

    it('should reflect refunded amount on order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/klarna/ordermanagement/v1/orders/${orderId}`,
        headers: { authorization: authHeader },
      });
      expect(res.json().refunded_amount).toBe(3000);
    });

    it('should return 404 for unknown order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/klarna/ordermanagement/v1/orders/nonexistent',
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(404);
    });

    it('should return 404 for unknown capture', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/captures/nonexistent`,
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 6. Cancel Order ────────────────────────────────────────────────────

  describe('Cancel Order', () => {
    let orderId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/klarna/payments/v1/authorizations/cancel-auth/order',
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({ order_amount: 5000 }),
      });
      orderId = res.json().order_id;
    });

    it('should cancel an authorized order', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/cancel`,
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(204);
    });

    it('should show CANCELLED status', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/klarna/ordermanagement/v1/orders/${orderId}`,
        headers: { authorization: authHeader },
      });
      expect(res.json().status).toBe('CANCELLED');
    });

    it('should refuse capture on cancelled order', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/captures`,
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error_code).toBe('ORDER_CANCELLED');
    });
  });

  // ── 7. Release Remaining Authorization ─────────────────────────────────

  describe('Release Remaining Authorization', () => {
    it('should release remaining auth and set status CLOSED', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/klarna/payments/v1/authorizations/release-auth/order',
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({ order_amount: 8000 }),
      });
      const orderId = createRes.json().order_id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/release-remaining-authorization`,
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(204);

      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/klarna/ordermanagement/v1/orders/${orderId}`,
        headers: { authorization: authHeader },
      });
      expect(getRes.json().status).toBe('CLOSED');
    });
  });

  // ── 8. Refund errors ───────────────────────────────────────────────────

  describe('Refund errors', () => {
    it('should refuse refund on uncaptured order', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/klarna/payments/v1/authorizations/refund-err-auth/order',
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({ order_amount: 5000 }),
      });
      const orderId = createRes.json().order_id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/refunds`,
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({ refunded_amount: 1000 }),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error_code).toBe('NOT_CAPTURED');
    });
  });

  // ── 9. Extend Auth errors ──────────────────────────────────────────────

  describe('Extend Authorization errors', () => {
    it('should refuse extend on cancelled order', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/klarna/payments/v1/authorizations/extend-err-auth/order',
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({ order_amount: 5000 }),
      });
      const orderId = createRes.json().order_id;

      // Cancel it first
      await ts.server.inject({
        method: 'POST',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/cancel`,
        headers: { authorization: authHeader },
      });

      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/extend-authorization-time`,
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error_code).toBe('NOT_ALLOWED');
    });
  });

  // ── 10. Checkout ───────────────────────────────────────────────────────

  describe('Checkout', () => {
    let checkoutOrderId: string;

    it('should create a checkout order', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/klarna/checkout/v3/orders',
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({
          purchase_country: 'SE',
          purchase_currency: 'SEK',
          order_amount: 30000,
          order_lines: [
            { name: 'Shirt', quantity: 3, unit_price: 10000, total_amount: 30000 },
          ],
          merchant_urls: { terms: 'https://example.com/terms' },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.order_id).toBeDefined();
      expect(body.status).toBe('checkout_incomplete');
      expect(body.html_snippet).toContain('klarna-checkout-container');
      checkoutOrderId = body.order_id;
    });

    it('should read a checkout order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/klarna/checkout/v3/orders/${checkoutOrderId}`,
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().order_id).toBe(checkoutOrderId);
    });

    it('should return 404 for unknown checkout order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/klarna/checkout/v3/orders/nonexistent',
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 11. Customer Token ─────────────────────────────────────────────────

  describe('Customer Token', () => {
    const tokenId = 'ct-test-token-001';

    it('should auto-generate a customer token on GET', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/klarna/customer-token/v1/tokens/${tokenId}`,
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.token_id).toBe(tokenId);
      expect(body.status).toBe('ACTIVE');
      expect(body.payment_method_type).toBe('INVOICE');
    });

    it('should create an order using a customer token', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/customer-token/v1/tokens/${tokenId}/order`,
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({
          purchase_country: 'SE',
          purchase_currency: 'SEK',
          order_amount: 15000,
          order_lines: [
            { name: 'Subscription', quantity: 1, unit_price: 15000, total_amount: 15000 },
          ],
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.order_id).toBeDefined();
      expect(body.status).toBe('AUTHORIZED');
    });

    it('should cancel a customer token', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/klarna/customer-token/v1/tokens/${tokenId}/status`,
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({ status: 'CANCELLED' }),
      });
      expect(res.statusCode).toBe(202);
    });

    it('should refuse order creation on cancelled token', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/customer-token/v1/tokens/${tokenId}/order`,
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({ order_amount: 5000 }),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error_code).toBe('TOKEN_NOT_ACTIVE');
    });

    it('should return 404 when cancelling unknown token', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: '/klarna/customer-token/v1/tokens/unknown-token/status',
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({ status: 'CANCELLED' }),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 12. HPP Sessions ──────────────────────────────────────────────────

  describe('HPP Sessions', () => {
    let hppSessionId: string;

    it('should create an HPP session', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/klarna/hpp/v1/sessions',
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({
          payment_session_url: 'https://example.com/session',
          merchant_urls: { success: 'https://example.com/success' },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.session_id).toBeDefined();
      expect(body.session_url).toContain('buy.klarna.com/hpp/');
      expect(body.qr_code_url).toBeDefined();
      expect(body.status).toBe('WAITING');
      hppSessionId = body.session_id;
    });

    it('should read an HPP session', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/klarna/hpp/v1/sessions/${hppSessionId}`,
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().session_id).toBe(hppSessionId);
    });

    it('should return 404 for unknown HPP session', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/klarna/hpp/v1/sessions/unknown',
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 13. Settlements / Payouts ──────────────────────────────────────────

  describe('Settlements', () => {
    it('should list payouts (generates samples if empty)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/klarna/settlements/v1/payouts',
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.payouts).toBeInstanceOf(Array);
      expect(body.payouts.length).toBeGreaterThanOrEqual(3);
      const payout = body.payouts[0];
      expect(payout.payout_id).toBeDefined();
      expect(payout.currency_code).toBeDefined();
      expect(payout.status).toBe('PAID');
    });
  });

  // ── 14. resolvePersona ─────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Basic Auth K_ prefix', () => {
      const mockReq = {
        headers: {
          authorization: 'Basic ' + Buffer.from('K_young-pro_key123:secret').toString('base64'),
        },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBe('young-pro');
    });

    it('should return null for non-Basic auth', () => {
      const mockReq = { headers: { authorization: 'Bearer token123' } } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });

    it('should return null when no K_ prefix', () => {
      const mockReq = {
        headers: {
          authorization: 'Basic ' + Buffer.from('user:pass').toString('base64'),
        },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });

    it('should return null for missing auth header', () => {
      const mockReq = { headers: {} } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 15. Cross-surface seeding ──────────────────────────────────────────

  describe('cross-surface seeding', () => {
    it('should seed orders from apiResponses', async () => {
      const seededAdapter = new KlarnaAdapter();
      const seedData = new Map<string, ExpandedData>([
        [
          'test-persona',
          {
            persona: 'test' as any,
            blueprint: {} as any,
            tables: {},
            facts: [],
            apiResponses: {
              klarna: {
                responses: {
                  orders: [
                    {
                      status: 200,
                      body: {
                        order_id: 'seeded-order-001',
                        status: 'AUTHORIZED',
                        order_amount: 99900,
                        purchase_currency: 'USD',
                        captured_amount: 0,
                        refunded_amount: 0,
                        remaining_authorized_amount: 99900,
                        captures: [],
                        refunds: [],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      ]);

      const seededTs = await buildTestServer(seededAdapter, seedData);

      const res = await seededTs.server.inject({
        method: 'GET',
        url: '/klarna/ordermanagement/v1/orders/seeded-order-001',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().order_id).toBe('seeded-order-001');
      expect(res.json().order_amount).toBe(99900);

      await seededTs.close();
    });
  });

  // ── 16. Cancel captured order error ────────────────────────────────────

  describe('Cancel captured order', () => {
    it('should refuse to cancel an order with captures', async () => {
      // Create order
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/klarna/payments/v1/authorizations/cancel-captured-auth/order',
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({ order_amount: 5000 }),
      });
      const orderId = createRes.json().order_id;

      // Capture it
      await ts.server.inject({
        method: 'POST',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/captures`,
        headers: { 'content-type': 'application/json', authorization: authHeader },
        payload: JSON.stringify({}),
      });

      // Try to cancel
      const res = await ts.server.inject({
        method: 'POST',
        url: `/klarna/ordermanagement/v1/orders/${orderId}/cancel`,
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error_code).toBe('ORDER_CAPTURED');
    });
  });
});
