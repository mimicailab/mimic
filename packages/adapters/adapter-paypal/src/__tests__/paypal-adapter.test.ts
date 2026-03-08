import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData } from '@mimicai/core';
import { PayPalAdapter } from '../paypal-adapter.js';

describe('PayPalAdapter', () => {
  let ts: TestServer;
  let adapter: PayPalAdapter;

  beforeAll(async () => {
    adapter = new PayPalAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ──────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('paypal');
      expect(adapter.name).toBe('PayPal API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/paypal');
    });
  });

  // ── 2. Endpoints count ─────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return 40 endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(40);
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
        url: '/paypal/v1/oauth2/token',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'grant_type=client_credentials',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.expires_in).toBe(32400);
    });
  });

  // ── 4. Orders ──────────────────────────────────────────────────────────

  describe('Orders', () => {
    let orderId: string;

    it('should create an order', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v2/checkout/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            amount: { currency_code: 'USD', value: '100.00' },
            description: 'Test order',
          }],
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe('CREATED');
      expect(body.intent).toBe('CAPTURE');
      expect(body.purchase_units[0].amount.value).toBe('100.00');
      expect(body.links.length).toBeGreaterThan(0);
      orderId = body.id;
    });

    it('should get an order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v2/checkout/orders/${orderId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(orderId);
    });

    it('should update an order', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/paypal/v2/checkout/orders/${orderId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify([{
          op: 'replace',
          path: '/intent',
          value: 'AUTHORIZE',
        }]),
      });
      expect(res.statusCode).toBe(204);
    });

    it('should return 404 for unknown order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v2/checkout/orders/UNKNOWN',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().name).toBe('RESOURCE_NOT_FOUND');
    });

    it('should capture an order', async () => {
      // Create a fresh order for capture
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v2/checkout/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: '50.00' } }],
        }),
      });
      const id = createRes.json().id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/checkout/orders/${id}/capture`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('COMPLETED');
      expect(body.purchase_units[0].payments.captures).toHaveLength(1);
      expect(body.purchase_units[0].payments.captures[0].status).toBe('COMPLETED');
    });

    it('should authorize an order', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v2/checkout/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          intent: 'AUTHORIZE',
          purchase_units: [{ amount: { currency_code: 'EUR', value: '75.00' } }],
        }),
      });
      const id = createRes.json().id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/checkout/orders/${id}/authorize`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('APPROVED');
      expect(body.purchase_units[0].payments.authorizations).toHaveLength(1);
    });

    it('should add tracking info', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v2/checkout/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: '30.00' } }],
        }),
      });
      const id = createRes.json().id;

      // Capture first
      await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/checkout/orders/${id}/capture`,
      });

      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/checkout/orders/${id}/track`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          carrier: 'FEDEX',
          tracking_number: '123456789',
          status: 'SHIPPED',
        }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().carrier).toBe('FEDEX');
    });
  });

  // ── 5. Payments – Authorizations ───────────────────────────────────────

  describe('Payments - Authorizations', () => {
    let authId: string;

    beforeAll(async () => {
      // Create and authorize an order
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v2/checkout/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          intent: 'AUTHORIZE',
          purchase_units: [{ amount: { currency_code: 'USD', value: '200.00' } }],
        }),
      });
      const orderId = createRes.json().id;
      const authRes = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/checkout/orders/${orderId}/authorize`,
      });
      authId = authRes.json().purchase_units[0].payments.authorizations[0].id;
    });

    it('should get an authorization', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v2/payments/authorizations/${authId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(authId);
      expect(res.json().status).toBe('CREATED');
    });

    it('should capture an authorization', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/payments/authorizations/${authId}/capture`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().status).toBe('COMPLETED');
    });

    it('should return 422 when voiding a captured auth', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/payments/authorizations/${authId}/void`,
      });
      // authId was already captured above
      expect(res.statusCode).toBe(422);
    });

    it('should void an authorization', async () => {
      // Create a fresh auth
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v2/checkout/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          intent: 'AUTHORIZE',
          purchase_units: [{ amount: { currency_code: 'USD', value: '50.00' } }],
        }),
      });
      const authRes = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/checkout/orders/${createRes.json().id}/authorize`,
      });
      const newAuthId = authRes.json().purchase_units[0].payments.authorizations[0].id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/payments/authorizations/${newAuthId}/void`,
      });
      expect(res.statusCode).toBe(204);

      // Verify status
      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v2/payments/authorizations/${newAuthId}`,
      });
      expect(getRes.json().status).toBe('VOIDED');
    });

    it('should return 422 when capturing a voided auth', async () => {
      // Create and void
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v2/checkout/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          intent: 'AUTHORIZE',
          purchase_units: [{ amount: { currency_code: 'USD', value: '25.00' } }],
        }),
      });
      const authRes = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/checkout/orders/${createRes.json().id}/authorize`,
      });
      const voidAuthId = authRes.json().purchase_units[0].payments.authorizations[0].id;
      await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/payments/authorizations/${voidAuthId}/void`,
      });

      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/payments/authorizations/${voidAuthId}/capture`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(422);
    });
  });

  // ── 6. Payments – Captures & Refunds ───────────────────────────────────

  describe('Payments - Captures & Refunds', () => {
    let captureId: string;

    beforeAll(async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v2/checkout/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: '80.00' } }],
        }),
      });
      const captureRes = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/checkout/orders/${createRes.json().id}/capture`,
      });
      captureId = captureRes.json().purchase_units[0].payments.captures[0].id;
    });

    it('should get a capture', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v2/payments/captures/${captureId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(captureId);
      expect(res.json().status).toBe('COMPLETED');
    });

    it('should refund a capture', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/payments/captures/${captureId}/refund`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { currency_code: 'USD', value: '20.00' },
          note_to_payer: 'Partial refund',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.status).toBe('COMPLETED');
      expect(body.amount.value).toBe('20.00');
    });

    it('should get a refund', async () => {
      // First refund, then get
      const refundRes = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/payments/captures/${captureId}/refund`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      const refundId = refundRes.json().id;

      const res = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v2/payments/refunds/${refundId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(refundId);
    });

    it('should return 404 for unknown capture', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v2/payments/captures/UNKNOWN',
      });
      expect(res.statusCode).toBe(404);
    });

    it('should return 404 for unknown refund', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v2/payments/refunds/UNKNOWN',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 7. Payouts ─────────────────────────────────────────────────────────

  describe('Payouts', () => {
    let batchId: string;
    let itemId: string;

    it('should create a batch payout', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v1/payments/payouts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          sender_batch_header: {
            sender_batch_id: 'batch-test-001',
            email_subject: 'You have a payout!',
          },
          items: [
            { recipient_type: 'EMAIL', amount: { value: '25.00', currency: 'USD' }, receiver: 'user@example.com' },
            { recipient_type: 'EMAIL', amount: { value: '50.00', currency: 'USD' }, receiver: 'user2@example.com' },
          ],
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.batch_header.payout_batch_id).toBeDefined();
      expect(body.batch_header.batch_status).toBe('PENDING');
      expect(body.items).toHaveLength(2);
      expect(body.items[0].transaction_status).toBe('SUCCESS');
      batchId = body.batch_header.payout_batch_id;
      itemId = body.items[0].payout_item_id;
    });

    it('should get a payout batch', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v1/payments/payouts/${batchId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().batch_header.payout_batch_id).toBe(batchId);
    });

    it('should get a payout item', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v1/payments/payouts-item/${itemId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().payout_item_id).toBe(itemId);
    });

    it('should return 404 for unknown batch', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v1/payments/payouts/UNKNOWN',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 8. Disputes ────────────────────────────────────────────────────────

  describe('Disputes', () => {
    it('should list disputes (generates samples)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v1/customer/disputes',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBeGreaterThanOrEqual(2);
    });

    it('should get a dispute', async () => {
      const listRes = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v1/customer/disputes',
      });
      const disputeId = listRes.json().items[0].dispute_id;

      const res = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v1/customer/disputes/${disputeId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().dispute_id).toBe(disputeId);
    });

    it('should accept a claim', async () => {
      const listRes = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v1/customer/disputes',
      });
      const disputeId = listRes.json().items[0].dispute_id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v1/customer/disputes/${disputeId}/accept-claim`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ note: 'Accept the claim' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('RESOLVED');
    });

    it('should provide evidence', async () => {
      const listRes = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v1/customer/disputes',
      });
      const disputeId = listRes.json().items[1].dispute_id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v1/customer/disputes/${disputeId}/provide-evidence`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('UNDER_REVIEW');
    });
  });

  // ── 9. Billing Plans & Subscriptions ───────────────────────────────────

  describe('Billing Plans & Subscriptions', () => {
    let planId: string;
    let subId: string;

    it('should create a billing plan', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v1/billing/plans',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          name: 'Premium Monthly',
          description: 'Monthly premium plan',
          billing_cycles: [{
            frequency: { interval_unit: 'MONTH', interval_count: 1 },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 12,
            pricing_scheme: { fixed_price: { currency_code: 'USD', value: '9.99' } },
          }],
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^P-/);
      expect(body.status).toBe('ACTIVE');
      planId = body.id;
    });

    it('should list plans', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v1/billing/plans',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().plans.length).toBeGreaterThanOrEqual(1);
    });

    it('should create a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v1/billing/subscriptions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          plan_id: planId,
          subscriber: { email_address: 'sub@example.com' },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^I-/);
      expect(body.status).toBe('ACTIVE');
      expect(body.plan_id).toBe(planId);
      subId = body.id;
    });

    it('should get a subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v1/billing/subscriptions/${subId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(subId);
    });

    it('should suspend a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v1/billing/subscriptions/${subId}/suspend`,
      });
      expect(res.statusCode).toBe(204);

      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v1/billing/subscriptions/${subId}`,
      });
      expect(getRes.json().status).toBe('SUSPENDED');
    });

    it('should reactivate a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v1/billing/subscriptions/${subId}/activate`,
      });
      expect(res.statusCode).toBe(204);

      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v1/billing/subscriptions/${subId}`,
      });
      expect(getRes.json().status).toBe('ACTIVE');
    });

    it('should cancel a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v1/billing/subscriptions/${subId}/cancel`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ reason: 'No longer needed' }),
      });
      expect(res.statusCode).toBe(204);

      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v1/billing/subscriptions/${subId}`,
      });
      expect(getRes.json().status).toBe('CANCELLED');
    });

    it('should return 404 for unknown subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v1/billing/subscriptions/I-UNKNOWN',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 10. Invoicing ──────────────────────────────────────────────────────

  describe('Invoicing', () => {
    let invoiceId: string;

    it('should create an invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v2/invoicing/invoices',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          detail: { currency_code: 'USD' },
          primary_recipients: [{ billing_info: { email_address: 'buyer@example.com' } }],
          items: [{ name: 'Consulting', quantity: '5', unit_amount: { currency_code: 'USD', value: '100.00' } }],
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^INV2-/);
      expect(body.status).toBe('DRAFT');
      invoiceId = body.id;
    });

    it('should list invoices', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v2/invoicing/invoices',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBeGreaterThanOrEqual(1);
    });

    it('should get an invoice', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v2/invoicing/invoices/${invoiceId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(invoiceId);
    });

    it('should send an invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/paypal/v2/invoicing/invoices/${invoiceId}/send`,
      });
      expect(res.statusCode).toBe(202);

      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/paypal/v2/invoicing/invoices/${invoiceId}`,
      });
      expect(getRes.json().status).toBe('SENT');
    });

    it('should return 404 for unknown invoice', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v2/invoicing/invoices/INV2-UNKNOWN',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 11. Transaction Search ─────────────────────────────────────────────

  describe('Transaction Search', () => {
    it('should list transactions', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v1/reporting/transactions',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.transaction_details).toBeInstanceOf(Array);
    });
  });

  // ── 12. Vault ──────────────────────────────────────────────────────────

  describe('Vault', () => {
    let paymentTokenId: string;

    it('should create a setup token', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v3/vault/setup-tokens',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          payment_source: { card: { number: '4111111111111111', expiry: '2028-12' } },
        }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().status).toBe('APPROVED');
    });

    it('should create a payment token', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v3/vault/payment-tokens',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          payment_source: { token: { id: 'setup-token-123', type: 'SETUP_TOKEN' } },
        }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().status).toBe('ACTIVE');
      paymentTokenId = res.json().id;
    });

    it('should list payment tokens', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v3/vault/payment-tokens',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().payment_tokens.length).toBeGreaterThanOrEqual(1);
    });

    it('should delete a payment token', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/paypal/v3/vault/payment-tokens/${paymentTokenId}`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('should return 404 for deleted token', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/paypal/v3/vault/payment-tokens/${paymentTokenId}`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 13. Webhooks ───────────────────────────────────────────────────────

  describe('Webhooks', () => {
    let webhookId: string;

    it('should create a webhook', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paypal/v1/notifications/webhooks',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          url: 'https://example.com/webhooks',
          event_types: [{ name: 'PAYMENT.CAPTURE.COMPLETED' }],
        }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().url).toBe('https://example.com/webhooks');
      webhookId = res.json().id;
    });

    it('should list webhooks', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v1/notifications/webhooks',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().webhooks.length).toBeGreaterThanOrEqual(1);
    });

    it('should delete a webhook', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/paypal/v1/notifications/webhooks/${webhookId}`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('should return 404 for deleted webhook', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/paypal/v1/notifications/webhooks/${webhookId}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('should list webhook events', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paypal/v1/notifications/webhooks-events',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().events).toBeInstanceOf(Array);
    });
  });

  // ── 14. resolvePersona ─────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Bearer A21AAK_ prefix', () => {
      const mockReq = {
        headers: { authorization: 'Bearer A21AAK_young-pro_abc123xyz' },
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

  // ── 15. Cross-surface seeding ──────────────────────────────────────────

  describe('cross-surface seeding', () => {
    it('should seed orders from apiResponses', async () => {
      const seededAdapter = new PayPalAdapter();
      const seedData = new Map<string, ExpandedData>([
        [
          'test-persona',
          {
            persona: 'test' as any,
            blueprint: {} as any,
            tables: {},
            facts: [],
            apiResponses: {
              paypal: {
                responses: {
                  orders: [
                    {
                      status: 200,
                      body: {
                        id: 'SEEDED-ORDER-001',
                        status: 'COMPLETED',
                        intent: 'CAPTURE',
                        purchase_units: [{
                          amount: { currency_code: 'USD', value: '999.00' },
                        }],
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
        url: '/paypal/v2/checkout/orders/SEEDED-ORDER-001',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe('SEEDED-ORDER-001');
      expect(res.json().purchase_units[0].amount.value).toBe('999.00');

      await seededTs.close();
    });
  });
});
