import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData } from '@mimicai/core';
import { DLocalAdapter } from '../dlocal-adapter.js';

/** Standard dLocal auth headers for test requests */
const DL_HEADERS = {
  'content-type': 'application/json',
  'x-login': 'dl_test_merchant',
  'x-trans-key': 'test_trans_key',
  'x-date': new Date().toISOString(),
  'x-version': '2.1',
  'authorization': 'V2-HMAC-SHA256, Signature: test_sig',
};

describe('DLocalAdapter', () => {
  let ts: TestServer;
  let adapter: DLocalAdapter;

  beforeAll(async () => {
    adapter = new DLocalAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ──────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('dlocal');
      expect(adapter.name).toBe('dLocal API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/dlocal');
    });

    it('should have version 2.1', () => {
      expect(adapter.versions).toEqual(['2.1']);
    });
  });

  // ── 2. Endpoints count ─────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return 13 endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(13);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Authentication ──────────────────────────────────────────────────

  describe('Authentication', () => {
    it('should reject requests without auth headers', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dlocal/payments-methods',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe(4000);
    });

    it('should reject requests with invalid authorization header', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dlocal/payments-methods',
        headers: {
          ...DL_HEADERS,
          authorization: 'Bearer invalid',
        },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── 4. Payments ────────────────────────────────────────────────────────

  describe('Payments', () => {
    let paymentId: string;

    it('should create a payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dlocal/payments',
        headers: DL_HEADERS,
        payload: JSON.stringify({
          amount: 100.00,
          currency: 'BRL',
          country: 'BR',
          payment_method_id: 'CARD',
          payer: { name: 'Test User', email: 'test@example.com', document: '12345678901' },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^D-\d-/);
      expect(body.status).toBe('PAID');
      expect(body.amount).toBe(100.00);
      expect(body.currency).toBe('BRL');
      expect(body.country).toBe('BR');
      paymentId = body.id;
    });

    it('should get a payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/dlocal/payments/${paymentId}`,
        headers: DL_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(paymentId);
    });

    it('should return 404 for unknown payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dlocal/payments/D-0-nonexistent',
        headers: DL_HEADERS,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe(4000);
    });

    it('should control payment status via description field', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dlocal/payments',
        headers: DL_HEADERS,
        payload: JSON.stringify({
          amount: 50.00,
          currency: 'USD',
          description: 'Test REJECT payment',
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('REJECTED');
    });

    it('should create an authorized payment and capture it', async () => {
      // Create authorized payment
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/dlocal/payments',
        headers: DL_HEADERS,
        payload: JSON.stringify({
          amount: 200.00,
          currency: 'USD',
          description: 'AUTHORIZE this payment',
        }),
      });
      expect(createRes.json().status).toBe('AUTHORIZED');
      const authPaymentId = createRes.json().id;

      // Capture it
      const captureRes = await ts.server.inject({
        method: 'POST',
        url: `/dlocal/payments/${authPaymentId}/capture`,
        headers: DL_HEADERS,
        payload: JSON.stringify({}),
      });
      expect(captureRes.statusCode).toBe(200);
      expect(captureRes.json().status).toBe('PAID');
    });

    it('should reject capture on non-authorized payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/dlocal/payments/${paymentId}/capture`,
        headers: DL_HEADERS,
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(5007);
    });

    it('should cancel a pending payment', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/dlocal/payments',
        headers: DL_HEADERS,
        payload: JSON.stringify({
          amount: 75.00,
          description: 'PENDING payment',
        }),
      });
      expect(createRes.json().status).toBe('PENDING');
      const pendingId = createRes.json().id;

      const cancelRes = await ts.server.inject({
        method: 'POST',
        url: `/dlocal/payments/${pendingId}/cancel`,
        headers: DL_HEADERS,
        payload: JSON.stringify({}),
      });
      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.json().status).toBe('CANCELLED');
    });

    it('should reject cancel on PAID payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/dlocal/payments/${paymentId}/cancel`,
        headers: DL_HEADERS,
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(5007);
    });
  });

  // ── 5. Secure Payments ─────────────────────────────────────────────────

  describe('Secure Payments', () => {
    it('should create a secure payment with card data', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dlocal/secure_payments',
        headers: DL_HEADERS,
        payload: JSON.stringify({
          amount: 150.00,
          currency: 'MXN',
          country: 'MX',
          card: {
            holder_name: 'Jane Doe',
            number: '4111111111111111',
            expiration_month: 6,
            expiration_year: 2028,
            cvv: '456',
          },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('PAID');
      expect(body.card).toBeDefined();
      expect(body.card.last4).toBe('1111');
      expect(body.card.holder_name).toBe('Jane Doe');
    });
  });

  // ── 6. Refunds ─────────────────────────────────────────────────────────

  describe('Refunds', () => {
    let paidPaymentId: string;
    let refundId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dlocal/payments',
        headers: DL_HEADERS,
        payload: JSON.stringify({ amount: 300.00, currency: 'USD' }),
      });
      paidPaymentId = res.json().id;
    });

    it('should create a refund', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dlocal/refunds',
        headers: DL_HEADERS,
        payload: JSON.stringify({
          payment_id: paidPaymentId,
          amount: 100.00,
          currency: 'USD',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^D-\d-/);
      expect(body.status).toBe('SUCCESS');
      expect(body.payment_id).toBe(paidPaymentId);
      expect(body.amount).toBe(100.00);
      refundId = body.id;
    });

    it('should get a refund', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/dlocal/refunds/${refundId}`,
        headers: DL_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(refundId);
    });

    it('should return 404 for unknown refund', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dlocal/refunds/D-0-nonexistent',
        headers: DL_HEADERS,
      });
      expect(res.statusCode).toBe(404);
    });

    it('should reject refund on non-PAID payment', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/dlocal/payments',
        headers: DL_HEADERS,
        payload: JSON.stringify({ amount: 50.00, description: 'PENDING test' }),
      });
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dlocal/refunds',
        headers: DL_HEADERS,
        payload: JSON.stringify({ payment_id: createRes.json().id }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(5007);
    });
  });

  // ── 7. Payouts ─────────────────────────────────────────────────────────

  describe('Payouts', () => {
    let payoutId: string;

    it('should create a payout', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dlocal/payouts',
        headers: DL_HEADERS,
        payload: JSON.stringify({
          amount: 500.00,
          currency: 'BRL',
          country: 'BR',
          beneficiary: { name: 'Maria Silva' },
          type: 'BANK_TRANSFER',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^D-\d-/);
      expect(body.status).toBe('PENDING');
      expect(body.amount).toBe(500.00);
      expect(body.currency).toBe('BRL');
      payoutId = body.id;
    });

    it('should get a payout', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/dlocal/payouts/${payoutId}`,
        headers: DL_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(payoutId);
    });

    it('should return 404 for unknown payout', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dlocal/payouts/D-0-nonexistent',
        headers: DL_HEADERS,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 8. Payment Methods ─────────────────────────────────────────────────

  describe('Payment Methods', () => {
    it('should list payment methods for Brazil', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dlocal/payments-methods?country=BR',
        headers: DL_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      const methods = res.json();
      expect(Array.isArray(methods)).toBe(true);
      expect(methods.length).toBe(3);
      const ids = methods.map((m: any) => m.id);
      expect(ids).toContain('CARD');
      expect(ids).toContain('PIX');
      expect(ids).toContain('BL');
    });

    it('should list payment methods for Mexico', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dlocal/payments-methods?country=MX',
        headers: DL_HEADERS,
      });
      const methods = res.json();
      expect(methods.length).toBe(3);
      const ids = methods.map((m: any) => m.id);
      expect(ids).toContain('SE');
      expect(ids).toContain('OX');
    });

    it('should list payment methods for India', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dlocal/payments-methods?country=IN',
        headers: DL_HEADERS,
      });
      const methods = res.json();
      expect(methods.length).toBe(4);
      const ids = methods.map((m: any) => m.id);
      expect(ids).toContain('UI');
    });

    it('should return default CARD for unknown country', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dlocal/payments-methods?country=XX',
        headers: DL_HEADERS,
      });
      const methods = res.json();
      expect(methods.length).toBe(1);
      expect(methods[0].id).toBe('CARD');
    });
  });

  // ── 9. Exchange Rates ──────────────────────────────────────────────────

  describe('Exchange Rates', () => {
    it('should return exchange rate for USD to BRL', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dlocal/exchange-rates?from=USD&to=BRL',
        headers: DL_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.from).toBe('USD');
      expect(body.to).toBe('BRL');
      expect(body.rate).toBe(5.05);
      expect(body.timestamp).toBeDefined();
    });

    it('should return 1.00 for unknown currency pair', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dlocal/exchange-rates?from=USD&to=XYZ',
        headers: DL_HEADERS,
      });
      expect(res.json().rate).toBe(1.00);
    });
  });

  // ── 10. Installment Plans ──────────────────────────────────────────────

  describe('Installment Plans', () => {
    it('should return installment plans', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dlocal/installments-plans?country=BR&bin=411111&amount=600&currency=BRL',
        headers: DL_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.country).toBe('BR');
      expect(body.amount).toBe(600);
      expect(body.currency).toBe('BRL');
      expect(body.installments.length).toBe(4);
      expect(body.installments[0].installments).toBe(1);
      expect(body.installments[1].installments).toBe(3);
      expect(body.installments[2].installments).toBe(6);
      expect(body.installments[3].installments).toBe(12);
    });
  });

  // ── 11. Chargebacks ───────────────────────────────────────────────────

  describe('Chargebacks', () => {
    it('should submit a chargeback dispute (auto-create)', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dlocal/chargebacks/dispute/CB-TEST-001',
        headers: DL_HEADERS,
        payload: JSON.stringify({ evidence_text: 'Product was delivered' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe('CB-TEST-001');
      expect(body.status).toBe('DISPUTE_IN_REVIEW');
    });

    it('should update an existing chargeback dispute', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dlocal/chargebacks/dispute/CB-TEST-001',
        headers: DL_HEADERS,
        payload: JSON.stringify({ evidence_text: 'Updated evidence' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('DISPUTE_IN_REVIEW');
    });
  });

  // ── 12. Persona resolution ────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from x-login header', () => {
      const mockReq = {
        headers: { 'x-login': 'dl_test-persona_abc123' },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBe('test-persona');
    });

    it('should return null for missing x-login', () => {
      const mockReq = { headers: {} } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });

    it('should return null for non-matching x-login', () => {
      const mockReq = {
        headers: { 'x-login': 'invalid_format' },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 13. Sandbox description-based outcomes ────────────────────────────

  describe('Sandbox outcomes', () => {
    const outcomes = [
      { desc: 'PENDING order', expected: 'PENDING' },
      { desc: 'Please CANCEL', expected: 'CANCELLED' },
      { desc: 'EXPIRE this', expected: 'EXPIRED' },
      { desc: 'AUTHORIZE only', expected: 'AUTHORIZED' },
      { desc: 'VERIFY card', expected: 'VERIFIED' },
    ];

    for (const { desc, expected } of outcomes) {
      it(`description "${desc}" should result in ${expected}`, async () => {
        const res = await ts.server.inject({
          method: 'POST',
          url: '/dlocal/payments',
          headers: DL_HEADERS,
          payload: JSON.stringify({ amount: 10.00, description: desc }),
        });
        expect(res.json().status).toBe(expected);
      });
    }
  });
});
