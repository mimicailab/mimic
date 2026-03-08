import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import { XenditAdapter } from '../xendit-adapter.js';

/** Helper: Base64-encode an API key for Basic auth */
function basicAuth(key: string = 'xnd_development_testpersona_abc123'): string {
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

describe('XenditAdapter', () => {
  let ts: TestServer;
  let adapter: XenditAdapter;

  beforeAll(async () => {
    adapter = new XenditAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ──────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('xendit');
      expect(adapter.name).toBe('Xendit API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/xendit');
    });

    it('should expose versions', () => {
      expect(adapter.versions).toEqual(['v3', 'v2']);
    });
  });

  // ── 2. Endpoints count ─────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return 22 endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(22);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Auth ─────────────────────────────────────────────────────────────

  describe('Auth', () => {
    it('should reject requests without auth', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/balance',
      });
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error_code).toBe('UNAUTHORIZED');
    });

    it('should reject invalid API keys', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/balance',
        headers: { authorization: basicAuth('invalid_key_123') },
      });
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error_code).toBe('INVALID_API_KEY');
    });

    it('should accept valid development API keys', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/balance',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
    });

    it('should accept valid production API keys', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/balance',
        headers: { authorization: basicAuth('xnd_production_mypersona_xyz789') },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── 4. resolvePersona ──────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from development key', () => {
      const req = { headers: { authorization: basicAuth('xnd_development_johndoe_abc123') } } as any;
      expect(adapter.resolvePersona(req)).toBe('johndoe');
    });

    it('should extract persona from production key', () => {
      const req = { headers: { authorization: basicAuth('xnd_production_janedoe_xyz789') } } as any;
      expect(adapter.resolvePersona(req)).toBe('janedoe');
    });

    it('should return null for missing auth', () => {
      const req = { headers: {} } as any;
      expect(adapter.resolvePersona(req)).toBeNull();
    });
  });

  // ── 5. Payment Requests ────────────────────────────────────────────────

  describe('Payment Requests', () => {
    let paymentRequestId: string;

    it('should create a payment request', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/xendit/v3/payment_requests',
        headers: { 'content-type': 'application/json', authorization: basicAuth() },
        payload: JSON.stringify({
          amount: 150000,
          currency: 'IDR',
          country: 'ID',
          payment_method: { type: 'EWALLET', reusability: 'ONE_TIME_USE' },
          description: 'Test payment',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^pr-/);
      expect(body.amount).toBe(150000);
      expect(body.currency).toBe('IDR');
      expect(body.status).toBe('REQUIRES_ACTION');
      expect(body.actions).toHaveLength(1);
      paymentRequestId = body.id;
    });

    it('should get a payment request', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/xendit/v3/payment_requests/${paymentRequestId}`,
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(paymentRequestId);
    });

    it('should list payment requests', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/v3/payment_requests',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should return 404 for unknown payment request', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/v3/payment_requests/pr-nonexistent',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error_code).toBe('DATA_NOT_FOUND');
    });

    it('should support idempotency', async () => {
      const idempotencyKey = 'idem-pr-' + Date.now();
      const payload = JSON.stringify({
        amount: 200000,
        currency: 'IDR',
        payment_method: { type: 'EWALLET' },
      });

      const res1 = await ts.server.inject({
        method: 'POST',
        url: '/xendit/v3/payment_requests',
        headers: { 'content-type': 'application/json', authorization: basicAuth(), 'idempotency-key': idempotencyKey },
        payload,
      });
      const res2 = await ts.server.inject({
        method: 'POST',
        url: '/xendit/v3/payment_requests',
        headers: { 'content-type': 'application/json', authorization: basicAuth(), 'idempotency-key': idempotencyKey },
        payload,
      });

      expect(res1.json().id).toBe(res2.json().id);
    });
  });

  // ── 6. Payment Methods ─────────────────────────────────────────────────

  describe('Payment Methods', () => {
    let paymentMethodId: string;

    it('should create a payment method', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/xendit/v3/payment_methods',
        headers: { 'content-type': 'application/json', authorization: basicAuth() },
        payload: JSON.stringify({
          type: 'EWALLET',
          reusability: 'MULTIPLE_USE',
          country: 'ID',
          ewallet: { channel_code: 'OVO' },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^pm-/);
      expect(body.type).toBe('EWALLET');
      expect(body.status).toBe('ACTIVE');
      expect(body.reusability).toBe('MULTIPLE_USE');
      paymentMethodId = body.id;
    });

    it('should get a payment method', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/xendit/v3/payment_methods/${paymentMethodId}`,
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(paymentMethodId);
    });

    it('should list payment methods', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/v3/payment_methods',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a payment method', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/xendit/v3/payment_methods/${paymentMethodId}`,
        headers: { 'content-type': 'application/json', authorization: basicAuth() },
        payload: JSON.stringify({ description: 'Updated payment method' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().description).toBe('Updated payment method');
    });

    it('should return 404 for unknown payment method', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/v3/payment_methods/pm-nonexistent',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 7. Invoices ────────────────────────────────────────────────────────

  describe('Invoices', () => {
    let invoiceId: string;

    it('should create an invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/xendit/v2/invoices/',
        headers: { 'content-type': 'application/json', authorization: basicAuth() },
        payload: JSON.stringify({
          external_id: 'inv-test-001',
          amount: 500000,
          currency: 'IDR',
          payer_email: 'test@example.com',
          description: 'Test invoice',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.external_id).toBe('inv-test-001');
      expect(body.amount).toBe(500000);
      expect(body.status).toBe('PENDING');
      expect(body.invoice_url).toContain('checkout.xendit.co');
      expect(body.available_banks).toHaveLength(4);
      expect(body.available_ewallets).toHaveLength(4);
      invoiceId = body.id;
    });

    it('should get an invoice', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/xendit/v2/invoices/${invoiceId}`,
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(invoiceId);
    });

    it('should list invoices', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/v2/invoices',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toBeInstanceOf(Array);
      expect(body.length).toBeGreaterThanOrEqual(1);
    });

    it('should reject invoice creation without required fields', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/xendit/v2/invoices/',
        headers: { 'content-type': 'application/json', authorization: basicAuth() },
        payload: JSON.stringify({ description: 'Missing fields' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error_code).toBe('API_VALIDATION_ERROR');
    });

    it('should expire an invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/xendit/invoices/${invoiceId}/expire`,
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('EXPIRED');
    });

    it('should reject expiring a non-PENDING invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/xendit/invoices/${invoiceId}/expire`,
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error_code).toBe('INVALID_INVOICE_STATUS');
    });

    it('should return 404 for unknown invoice', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/v2/invoices/nonexistent',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error_code).toBe('INVOICE_NOT_FOUND_ERROR');
    });
  });

  // ── 8. Payouts ─────────────────────────────────────────────────────────

  describe('Payouts', () => {
    let payoutId: string;

    it('should create a payout', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/xendit/v2/payouts',
        headers: { 'content-type': 'application/json', authorization: basicAuth() },
        payload: JSON.stringify({
          reference_id: 'payout-test-001',
          channel_code: 'ID_BCA',
          amount: 100000,
          currency: 'IDR',
          channel_properties: { account_number: '1234567890', account_holder_name: 'Test User' },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^disb-/);
      expect(body.amount).toBe(100000);
      expect(body.status).toBe('ACCEPTED');
      expect(body.channel_code).toBe('ID_BCA');
      payoutId = body.id;
    });

    it('should get a payout', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/xendit/v2/payouts/${payoutId}`,
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(payoutId);
    });

    it('should list payouts', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/v2/payouts',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should reject payout creation without required fields', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/xendit/v2/payouts',
        headers: { 'content-type': 'application/json', authorization: basicAuth() },
        payload: JSON.stringify({ description: 'Missing fields' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error_code).toBe('API_VALIDATION_ERROR');
    });

    it('should cancel a payout', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/xendit/v2/payouts/${payoutId}/cancel`,
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('CANCELLED');
    });

    it('should reject cancelling a non-ACCEPTED payout', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/xendit/v2/payouts/${payoutId}/cancel`,
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error_code).toBe('PAYOUT_CANCELLATION_ERROR');
    });

    it('should return 404 for unknown payout', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/v2/payouts/disb-nonexistent',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 9. Refunds ─────────────────────────────────────────────────────────

  describe('Refunds', () => {
    let refundId: string;

    it('should create a refund', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/xendit/refunds',
        headers: { 'content-type': 'application/json', authorization: basicAuth() },
        payload: JSON.stringify({
          payment_request_id: 'pr-some-id',
          amount: 50000,
          currency: 'IDR',
          reason: 'REQUESTED_BY_CUSTOMER',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^rfd-/);
      expect(body.amount).toBe(50000);
      expect(body.status).toBe('SUCCEEDED');
      refundId = body.id;
    });

    it('should get a refund', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/xendit/refunds/${refundId}`,
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(refundId);
    });

    it('should list refunds', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/refunds',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should reject refund without required identifiers', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/xendit/refunds',
        headers: { 'content-type': 'application/json', authorization: basicAuth() },
        payload: JSON.stringify({ amount: 10000 }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error_code).toBe('API_VALIDATION_ERROR');
    });

    it('should return 404 for unknown refund', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/refunds/rfd-nonexistent',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 10. Customers ──────────────────────────────────────────────────────

  describe('Customers', () => {
    let customerId: string;

    it('should create a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/xendit/customers',
        headers: { 'content-type': 'application/json', authorization: basicAuth() },
        payload: JSON.stringify({
          reference_id: 'cust-ref-001',
          type: 'INDIVIDUAL',
          individual_detail: { given_names: 'John', surname: 'Doe' },
          email: 'john@example.com',
          mobile_number: '+6281234567890',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^cust-/);
      expect(body.reference_id).toBe('cust-ref-001');
      expect(body.type).toBe('INDIVIDUAL');
      expect(body.email).toBe('john@example.com');
      customerId = body.id;
    });

    it('should get a customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/xendit/customers/${customerId}`,
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(customerId);
    });

    it('should update a customer', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/xendit/customers/${customerId}`,
        headers: { 'content-type': 'application/json', authorization: basicAuth() },
        payload: JSON.stringify({
          email: 'john.updated@example.com',
          description: 'Updated customer',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.email).toBe('john.updated@example.com');
      expect(body.description).toBe('Updated customer');
    });

    it('should reject customer creation without reference_id', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/xendit/customers',
        headers: { 'content-type': 'application/json', authorization: basicAuth() },
        payload: JSON.stringify({ email: 'test@example.com' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error_code).toBe('API_VALIDATION_ERROR');
    });

    it('should return 404 for unknown customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/customers/cust-nonexistent',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 11. Balance ────────────────────────────────────────────────────────

  describe('Balance', () => {
    it('should get balance with default CASH type', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/balance',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.balance).toBe(1500000);
      expect(body.currency).toBe('IDR');
      expect(body.account_type).toBe('CASH');
    });

    it('should get balance with specific account type', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/balance?account_type=HOLDING',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().account_type).toBe('HOLDING');
    });

    it('should reject invalid account type', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/balance?account_type=INVALID',
        headers: { authorization: basicAuth() },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error_code).toBe('API_VALIDATION_ERROR');
    });

    it('should include for_user_id when header is present', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/xendit/balance',
        headers: { authorization: basicAuth(), 'for-user-id': 'sub-account-123' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().for_user_id).toBe('sub-account-123');
    });
  });
});
