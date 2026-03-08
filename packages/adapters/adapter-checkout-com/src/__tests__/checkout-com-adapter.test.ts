import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData } from '@mimicai/core';
import { CheckoutComAdapter } from '../checkout-com-adapter.js';

describe('CheckoutComAdapter', () => {
  let ts: TestServer;
  let adapter: CheckoutComAdapter;

  beforeAll(async () => {
    adapter = new CheckoutComAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ──────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('checkout');
      expect(adapter.name).toBe('Checkout.com API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/checkout');
    });
  });

  // ── 2. Endpoints count ─────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return 32 endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(32);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Payments ─────────────────────────────────────────────────────────

  describe('Payments', () => {
    let paymentId: string;

    it('should create a payment (auto-capture)', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 5000,
          currency: 'USD',
          source: { type: 'card' },
          reference: 'order-123',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^pay_/);
      expect(body.status).toBe('Captured');
      expect(body.approved).toBe(true);
      expect(body.amount).toBe(5000);
      expect(body.currency).toBe('USD');
      expect(body.response_code).toBe('10000');
      expect(body.source.scheme).toBe('Visa');
      expect(body._links.self).toBeDefined();
      paymentId = body.id;
    });

    it('should create an authorized payment (capture=false)', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 3000,
          currency: 'EUR',
          capture: false,
          source: { type: 'card' },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.status).toBe('Authorized');
      expect(body._links.capture).toBeDefined();
      expect(body._links.void).toBeDefined();
    });

    it('should get a payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/checkout/payments/${paymentId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(paymentId);
    });

    it('should return 404 for unknown payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/checkout/payments/pay_unknown',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error_type).toBe('payment_not_found');
    });

    it('should get payment actions', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/checkout/payments/${paymentId}/actions`,
      });
      expect(res.statusCode).toBe(200);
      const actions = res.json();
      expect(Array.isArray(actions)).toBe(true);
      expect(actions.length).toBe(1);
      expect(actions[0].approved).toBe(true);
      expect(actions[0].response_code).toBe('10000');
    });
  });

  // ── 4. Payment lifecycle: Authorize -> Capture ──────────────────────────

  describe('Payment lifecycle: Authorize -> Capture', () => {
    let authPaymentId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 7500,
          currency: 'GBP',
          capture: false,
          source: { type: 'card' },
          reference: 'auth-test',
        }),
      });
      authPaymentId = res.json().id;
    });

    it('should capture an authorized payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/checkout/payments/${authPaymentId}/captures`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ reference: 'capture-ref' }),
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().action_id).toMatch(/^act_/);

      // Verify status changed
      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/checkout/payments/${authPaymentId}`,
      });
      expect(getRes.json().status).toBe('Captured');
    });

    it('should refund a captured payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/checkout/payments/${authPaymentId}/refunds`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ reference: 'refund-ref' }),
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().action_id).toMatch(/^act_/);

      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/checkout/payments/${authPaymentId}`,
      });
      expect(getRes.json().status).toBe('Refunded');
    });
  });

  // ── 5. Payment lifecycle: Authorize -> Void ─────────────────────────────

  describe('Payment lifecycle: Authorize -> Void', () => {
    let voidPaymentId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 2500,
          currency: 'USD',
          capture: false,
          source: { type: 'card' },
        }),
      });
      voidPaymentId = res.json().id;
    });

    it('should void an authorized payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/checkout/payments/${voidPaymentId}/voids`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ reference: 'void-ref' }),
      });
      expect(res.statusCode).toBe(202);

      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/checkout/payments/${voidPaymentId}`,
      });
      expect(getRes.json().status).toBe('Voided');
    });

    it('should reject capture on voided payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/checkout/payments/${voidPaymentId}/captures`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error_type).toBe('action_not_allowed');
    });
  });

  // ── 6. Sandbox testing via reference prefix ─────────────────────────────

  describe('Sandbox reference prefixes', () => {
    it('should decline payment with DECLINE_ prefix', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 1000,
          currency: 'USD',
          source: { type: 'card' },
          reference: 'DECLINE_test',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.approved).toBe(false);
      expect(body.status).toBe('Declined');
      expect(body.response_code).toBe('20005');
    });

    it('should return pending with PENDING_ prefix', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 1000,
          currency: 'USD',
          source: { type: 'card' },
          reference: 'PENDING_test',
        }),
      });
      expect(res.json().status).toBe('Pending');
    });

    it('should flag payment with FLAG_ prefix', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 1000,
          currency: 'USD',
          source: { type: 'card' },
          reference: 'FLAG_test',
        }),
      });
      expect(res.json().flagged).toBe(true);
    });

    it('should return 500 with ERROR_ prefix', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 1000,
          currency: 'USD',
          source: { type: 'card' },
          reference: 'ERROR_test',
        }),
      });
      expect(res.statusCode).toBe(500);
      expect(res.json().error_type).toBe('processing_error');
    });
  });

  // ── 7. Tokens ──────────────────────────────────────────────────────────

  describe('Tokens', () => {
    it('should tokenize a card', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/tokens',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          type: 'card',
          number: '4242424242424242',
          expiry_month: 12,
          expiry_year: 2028,
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.token).toMatch(/^tok_/);
      expect(body.last4).toBe('4242');
      expect(body.bin).toBe('424242');
      expect(body.scheme).toBe('Visa');
      expect(body.expires_on).toBeDefined();
    });
  });

  // ── 8. Instruments ─────────────────────────────────────────────────────

  describe('Instruments', () => {
    let instrumentId: string;

    it('should create an instrument', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/instruments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          type: 'card',
          token: 'tok_test123',
          expiry_month: 6,
          expiry_year: 2029,
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^src_/);
      expect(body.type).toBe('card');
      instrumentId = body.id;
    });

    it('should get an instrument', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/checkout/instruments/${instrumentId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(instrumentId);
    });

    it('should update an instrument', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/checkout/instruments/${instrumentId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ expiry_year: 2030 }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().expiry_year).toBe(2030);
    });

    it('should delete an instrument', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/checkout/instruments/${instrumentId}`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('should return 404 for deleted instrument', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/checkout/instruments/${instrumentId}`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 9. Customers ───────────────────────────────────────────────────────

  describe('Customers', () => {
    let customerId: string;

    it('should create a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          email: 'test@example.com',
          name: 'Test User',
          phone: { country_code: '+1', number: '5551234567' },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^cus_/);
      expect(body.email).toBe('test@example.com');
      expect(body.name).toBe('Test User');
      customerId = body.id;
    });

    it('should get a customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/checkout/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(customerId);
    });

    it('should update a customer', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/checkout/customers/${customerId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Updated Name' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Updated Name');
    });

    it('should delete a customer', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/checkout/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('should return 404 for deleted customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/checkout/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 10. Disputes ───────────────────────────────────────────────────────

  describe('Disputes', () => {
    it('should list disputes (empty initially)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/checkout/disputes',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.total_count).toBeDefined();
    });

    it('should return 404 for unknown dispute', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/checkout/disputes/dsp_unknown',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 11. Hosted Payments ────────────────────────────────────────────────

  describe('Hosted Payments', () => {
    it('should create a hosted payment page', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/hosted-payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 10000,
          currency: 'USD',
          reference: 'hp-ref-001',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^hpp_/);
      expect(body._links.redirect.href).toContain('pay.sandbox.checkout.com');
    });
  });

  // ── 12. Payment Links ─────────────────────────────────────────────────

  describe('Payment Links', () => {
    let linkId: string;

    it('should create a payment link', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/payment-links',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 2500,
          currency: 'EUR',
          reference: 'pl-ref-001',
          description: 'Test payment link',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^pl_/);
      expect(body.expires_on).toBeDefined();
      linkId = body.id;
    });

    it('should get a payment link', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/checkout/payment-links/${linkId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(linkId);
    });

    it('should return 404 for unknown payment link', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/checkout/payment-links/pl_unknown',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 13. Payment Sessions ──────────────────────────────────────────────

  describe('Payment Sessions', () => {
    it('should create a payment session', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/payment-sessions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 5000,
          currency: 'USD',
          reference: 'ps-ref-001',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^ps_/);
      expect(body.payment_session_token).toBeDefined();
    });
  });

  // ── 14. 3DS Sessions ──────────────────────────────────────────────────

  describe('3DS Sessions', () => {
    let sessionId: string;

    it('should create a 3DS session', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/sessions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 4000,
          currency: 'GBP',
          source: { type: 'card', scheme: 'Visa' },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^sid_/);
      expect(body.status).toBe('pending');
      expect(body.session_secret).toBeDefined();
      sessionId = body.id;
    });

    it('should get a 3DS session', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/checkout/sessions/${sessionId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(sessionId);
    });

    it('should return 404 for unknown session', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/checkout/sessions/sid_unknown',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 15. FX Rates ──────────────────────────────────────────────────────

  describe('FX Rates', () => {
    it('should get FX rates', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/checkout/forex/rates?source=USD&target=EUR',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.source).toBe('USD');
      expect(body.rates).toHaveLength(1);
      expect(body.rates[0].target).toBe('EUR');
      expect(typeof body.rates[0].exchange_rate).toBe('number');
    });
  });

  // ── 16. Transfers ─────────────────────────────────────────────────────

  describe('Transfers', () => {
    it('should create a transfer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/transfers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          source: { entity_id: 'ent_source_001' },
          destination: { entity_id: 'ent_dest_001' },
          amount: 50000,
          currency: 'USD',
          reference: 'transfer-001',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^tra_/);
      expect(body.status).toBe('pending');
      expect(body.amount).toBe(50000);
    });
  });

  // ── 17. Balances ──────────────────────────────────────────────────────

  describe('Balances', () => {
    it('should get entity balance', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/checkout/balances/ent_test_001',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entity_id).toBe('ent_test_001');
      expect(body.balances).toHaveLength(2);
      expect(body.balances[0].currency).toBe('USD');
      expect(typeof body.balances[0].available).toBe('number');
    });
  });

  // ── 18. Workflows ─────────────────────────────────────────────────────

  describe('Workflows', () => {
    let workflowId: string;

    it('should create a workflow', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/checkout/workflows',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          name: 'Payment Events',
          actions: [{ type: 'webhook', url: 'https://example.com/hook' }],
          conditions: [],
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^wf_/);
      expect(body.name).toBe('Payment Events');
      expect(body.active).toBe(true);
      workflowId = body.id;
    });

    it('should list workflows', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/checkout/workflows',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 19. Events ────────────────────────────────────────────────────────

  describe('Events', () => {
    it('should list event types', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/checkout/event-types',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items[0].event_type).toBeDefined();
    });

    it('should return 404 for unknown event', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/checkout/events/evt_unknown',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 20. resolvePersona ────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Bearer sk_xxx token', () => {
      const mockReq = {
        headers: { authorization: 'Bearer sk_test_young-pro_abc123xyz' },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBe('young-pro');
    });

    it('should extract persona from sk_ without test_ prefix', () => {
      const mockReq = {
        headers: { authorization: 'Bearer sk_freelancer_abc123xyz' },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBe('freelancer');
    });

    it('should return null for pk_ token (public key)', () => {
      const mockReq = {
        headers: { authorization: 'Bearer pk_test_some-key' },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
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

  // ── 21. Cross-surface seeding ─────────────────────────────────────────

  describe('cross-surface seeding', () => {
    it('should seed payments from apiResponses', async () => {
      const seededAdapter = new CheckoutComAdapter();
      const seedData = new Map<string, ExpandedData>([
        [
          'test-persona',
          {
            persona: 'test' as any,
            blueprint: {} as any,
            tables: {},
            facts: [],
            apiResponses: {
              checkout: {
                responses: {
                  payments: [
                    {
                      status: 200,
                      body: {
                        id: 'pay_seeded_001',
                        status: 'Captured',
                        approved: true,
                        amount: 99900,
                        currency: 'USD',
                      },
                    },
                  ],
                  customers: [
                    {
                      status: 200,
                      body: {
                        id: 'cus_seeded_001',
                        email: 'seeded@example.com',
                        name: 'Seeded User',
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

      // Verify seeded payment
      const payRes = await seededTs.server.inject({
        method: 'GET',
        url: '/checkout/payments/pay_seeded_001',
      });
      expect(payRes.statusCode).toBe(200);
      expect(payRes.json().id).toBe('pay_seeded_001');
      expect(payRes.json().amount).toBe(99900);

      // Verify seeded customer
      const cusRes = await seededTs.server.inject({
        method: 'GET',
        url: '/checkout/customers/cus_seeded_001',
      });
      expect(cusRes.statusCode).toBe(200);
      expect(cusRes.json().id).toBe('cus_seeded_001');
      expect(cusRes.json().email).toBe('seeded@example.com');

      await seededTs.close();
    });
  });

  // ── 22. Error format ──────────────────────────────────────────────────

  describe('Error format', () => {
    it('should return Checkout.com error structure', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/checkout/payments/pay_nonexistent',
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.request_id).toBeDefined();
      expect(body.error_type).toBe('payment_not_found');
      expect(body.error_codes).toBeInstanceOf(Array);
      expect(body.error_codes).toContain('payment_not_found');
      expect(body.message).toBeDefined();
    });

    it('should reject refund on non-captured payment', async () => {
      // Create authorized payment
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/checkout/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 1500,
          currency: 'USD',
          capture: false,
          source: { type: 'card' },
        }),
      });
      const payId = createRes.json().id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/checkout/payments/${payId}/refunds`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error_type).toBe('action_not_allowed');
    });

    it('should reject void on captured payment', async () => {
      // Create auto-captured payment
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/checkout/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 1500,
          currency: 'USD',
          source: { type: 'card' },
        }),
      });
      const payId = createRes.json().id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/checkout/payments/${payId}/voids`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error_type).toBe('action_not_allowed');
    });
  });
});
