import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData } from '@mimicai/core';
import { MercadoPagoAdapter } from '../mercadopago-adapter.js';

describe('MercadoPagoAdapter', () => {
  let ts: TestServer;
  let adapter: MercadoPagoAdapter;

  beforeAll(async () => {
    adapter = new MercadoPagoAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ──────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('mercadopago');
      expect(adapter.name).toBe('Mercado Pago API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/mercadopago');
    });
  });

  // ── 2. Endpoints count ─────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return 30 endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(30);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. OAuth Token ─────────────────────────────────────────────────────

  describe('OAuth', () => {
    it('should return an access token', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mercadopago/oauth/token',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ grant_type: 'client_credentials', client_id: 'test', client_secret: 'test' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.expires_in).toBe(21600);
    });
  });

  // ── 4. Payments ──────────────────────────────────────────────────────────

  describe('Payments', () => {
    let paymentId: number;

    it('should create a payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mercadopago/v1/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          transaction_amount: 100.50,
          currency_id: 'BRL',
          payment_method_id: 'visa',
          description: 'Test payment',
          payer: { email: 'test@example.com' },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe('approved');
      expect(body.transaction_amount).toBe(100.50);
      expect(body.currency_id).toBe('BRL');
      expect(body.refunds).toEqual([]);
      paymentId = body.id;
    });

    it('should create an authorized payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mercadopago/v1/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          transaction_amount: 200,
          capture: false,
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.status).toBe('authorized');
      expect(body.captured).toBe(false);
    });

    it('should get a payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mercadopago/v1/payments/${paymentId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(paymentId);
    });

    it('should return 404 for unknown payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mercadopago/v1/payments/99999999',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('not_found');
    });

    it('should capture a payment', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/mercadopago/v1/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ transaction_amount: 50, capture: false }),
      });
      const id = createRes.json().id;

      const res = await ts.server.inject({
        method: 'PUT',
        url: `/mercadopago/v1/payments/${id}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ capture: true }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('approved');
      expect(res.json().captured).toBe(true);
    });

    it('should cancel a payment', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/mercadopago/v1/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ transaction_amount: 30, capture: false }),
      });
      const id = createRes.json().id;

      const res = await ts.server.inject({
        method: 'PUT',
        url: `/mercadopago/v1/payments/${id}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ status: 'cancelled' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('cancelled');
    });

    it('should search payments', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mercadopago/v1/payments/search?status=approved',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.paging).toBeDefined();
      expect(body.results).toBeInstanceOf(Array);
    });
  });

  // ── 5. Refunds ──────────────────────────────────────────────────────────

  describe('Refunds', () => {
    let paymentId: number;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mercadopago/v1/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ transaction_amount: 200, currency_id: 'BRL' }),
      });
      paymentId = res.json().id;
    });

    it('should create a partial refund', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/mercadopago/v1/payments/${paymentId}/refunds`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 50 }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.amount).toBe(50);
      expect(body.payment_id).toBe(paymentId);
      expect(body.status).toBe('approved');
    });

    it('should create a full refund', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/mercadopago/v1/payments/${paymentId}/refunds`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(201);

      // Verify payment is now refunded
      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/mercadopago/v1/payments/${paymentId}`,
      });
      expect(getRes.json().status).toBe('refunded');
    });

    it('should list refunds for a payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mercadopago/v1/payments/${paymentId}/refunds`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toBeInstanceOf(Array);
      expect(body.length).toBe(2);
    });

    it('should get a specific refund', async () => {
      const listRes = await ts.server.inject({
        method: 'GET',
        url: `/mercadopago/v1/payments/${paymentId}/refunds`,
      });
      const refundId = listRes.json()[0].id;

      const res = await ts.server.inject({
        method: 'GET',
        url: `/mercadopago/v1/payments/${paymentId}/refunds/${refundId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(refundId);
    });

    it('should return 404 for refund on unknown payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mercadopago/v1/payments/99999/refunds',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 6. Preferences ──────────────────────────────────────────────────────

  describe('Preferences', () => {
    let prefId: string;

    it('should create a preference', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mercadopago/checkout/preferences',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          items: [{ title: 'Test Item', unit_price: 100, quantity: 2 }],
          back_urls: { success: 'https://example.com/success', failure: 'https://example.com/failure', pending: 'https://example.com/pending' },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].title).toBe('Test Item');
      expect(body.init_point).toContain('mercadopago.com.br');
      expect(body.sandbox_init_point).toContain('sandbox');
      prefId = body.id;
    });

    it('should get a preference', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mercadopago/checkout/preferences/${prefId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(prefId);
    });

    it('should update a preference', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `/mercadopago/checkout/preferences/${prefId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ expires: true }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().expires).toBe(true);
    });

    it('should return 404 for unknown preference', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mercadopago/checkout/preferences/unknown-id',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 7. Customers ──────────────────────────────────────────────────────

  describe('Customers', () => {
    let customerId: string;

    it('should create a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mercadopago/v1/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          email: 'customer@example.com',
          first_name: 'John',
          last_name: 'Doe',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.email).toBe('customer@example.com');
      expect(body.first_name).toBe('John');
      customerId = body.id;
    });

    it('should get a customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mercadopago/v1/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(customerId);
    });

    it('should update a customer', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `/mercadopago/v1/customers/${customerId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ first_name: 'Jane' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().first_name).toBe('Jane');
    });

    it('should search customers', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mercadopago/v1/customers/search?email=customer@example.com',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeGreaterThanOrEqual(1);
    });

    it('should delete a customer', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/mercadopago/v1/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(customerId);

      // Verify deleted
      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/mercadopago/v1/customers/${customerId}`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('should return 404 for unknown customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mercadopago/v1/customers/99999',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 8. Cards ──────────────────────────────────────────────────────────

  describe('Cards', () => {
    let customerId: string;
    let cardId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mercadopago/v1/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'cardholder@example.com' }),
      });
      customerId = res.json().id;
    });

    it('should save a card', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/mercadopago/v1/customers/${customerId}/cards`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          payment_method_id: 'master',
          first_six_digits: '503175',
          last_four_digits: '0604',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.customer_id).toBe(customerId);
      expect(body.payment_method.id).toBe('master');
      cardId = body.id;
    });

    it('should list cards', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mercadopago/v1/customers/${customerId}/cards`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toBeInstanceOf(Array);
      expect(body.length).toBe(1);
    });

    it('should delete a card', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/mercadopago/v1/customers/${customerId}/cards/${cardId}`,
      });
      expect(res.statusCode).toBe(200);

      // Verify deleted
      const listRes = await ts.server.inject({
        method: 'GET',
        url: `/mercadopago/v1/customers/${customerId}/cards`,
      });
      expect(listRes.json()).toEqual([]);
    });

    it('should return 404 for cards of unknown customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mercadopago/v1/customers/99999/cards',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 9. Subscriptions ──────────────────────────────────────────────────

  describe('Subscriptions', () => {
    let subId: string;

    it('should create a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mercadopago/preapproval',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          reason: 'Monthly Premium',
          payer_email: 'sub@example.com',
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: 29.90,
            currency_id: 'BRL',
          },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe('authorized');
      expect(body.reason).toBe('Monthly Premium');
      expect(body.init_point).toContain('mercadopago.com.br');
      subId = body.id;
    });

    it('should get a subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mercadopago/preapproval/${subId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(subId);
    });

    it('should update a subscription', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `/mercadopago/preapproval/${subId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ status: 'paused' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('paused');
    });

    it('should search subscriptions', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mercadopago/preapproval/search',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toBeInstanceOf(Array);
      expect(body.paging).toBeDefined();
    });

    it('should return 404 for unknown subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mercadopago/preapproval/unknown-id',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 10. Plans ──────────────────────────────────────────────────────────

  describe('Plans', () => {
    let planId: string;

    it('should create a plan', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mercadopago/preapproval_plan',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          reason: 'Gold Plan',
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: 49.90,
            currency_id: 'BRL',
          },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe('active');
      expect(body.reason).toBe('Gold Plan');
      planId = body.id;
    });

    it('should get a plan', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mercadopago/preapproval_plan/${planId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(planId);
    });

    it('should update a plan', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `/mercadopago/preapproval_plan/${planId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ reason: 'Platinum Plan' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().reason).toBe('Platinum Plan');
    });

    it('should return 404 for unknown plan', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mercadopago/preapproval_plan/unknown-id',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 11. Merchant Orders ──────────────────────────────────────────────

  describe('Merchant Orders', () => {
    let orderId: number;

    it('should create a merchant order', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mercadopago/merchant_orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          external_reference: 'order-001',
          total_amount: 500,
          site_id: 'MLB',
          items: [{ title: 'Widget', quantity: 5, unit_price: 100 }],
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe('opened');
      expect(body.total_amount).toBe(500);
      expect(body.site_id).toBe('MLB');
      orderId = body.id;
    });

    it('should get a merchant order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mercadopago/merchant_orders/${orderId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(orderId);
    });

    it('should update a merchant order', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `/mercadopago/merchant_orders/${orderId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ status: 'closed' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('closed');
    });

    it('should return 404 for unknown merchant order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mercadopago/merchant_orders/99999',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 12. Payment Methods ──────────────────────────────────────────────

  describe('Payment Methods', () => {
    it('should list payment methods', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mercadopago/v1/payment_methods',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toBeInstanceOf(Array);
      expect(body.length).toBe(6);
      const ids = body.map((m: any) => m.id);
      expect(ids).toContain('visa');
      expect(ids).toContain('pix');
      expect(ids).toContain('bolbradesco');
    });
  });

  // ── 13. resolvePersona ─────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Bearer TEST- prefix', () => {
      const mockReq = {
        headers: { authorization: 'Bearer TEST-young-pro-abc123xyz' },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBe('young-pro');
    });

    it('should return null for non-matching token', () => {
      const mockReq = {
        headers: { authorization: 'Bearer some-random-token' },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });

    it('should return null for missing auth header', () => {
      const mockReq = { headers: {} } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 14. Cross-surface seeding ──────────────────────────────────────────

  describe('cross-surface seeding', () => {
    it('should seed payments from apiResponses', async () => {
      const seededAdapter = new MercadoPagoAdapter();
      const seedData = new Map<string, ExpandedData>([
        [
          'test-persona',
          {
            persona: 'test' as any,
            blueprint: {} as any,
            tables: {},
            facts: [],
            apiResponses: {
              mercadopago: {
                responses: {
                  payments: [
                    {
                      status: 200,
                      body: {
                        id: '12345678',
                        status: 'approved',
                        transaction_amount: 999.00,
                        currency_id: 'BRL',
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
        url: '/mercadopago/v1/payments/12345678',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe('12345678');
      expect(res.json().transaction_amount).toBe(999.00);

      await seededTs.close();
    });
  });
});
