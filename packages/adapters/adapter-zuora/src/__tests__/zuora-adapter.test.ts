import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData, Blueprint } from '@mimicai/core';
import { ZuoraAdapter } from '../zuora-adapter.js';

const BP = '/zuora/v1';

describe('ZuoraAdapter', () => {
  let ts: TestServer;
  let adapter: ZuoraAdapter;

  beforeAll(async () => {
    adapter = new ZuoraAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ─────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('zuora');
      expect(adapter.name).toBe('Zuora API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/zuora/v1');
    });
  });

  // ── 2. Endpoints count ─────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return the correct number of endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(413);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Account CRUD ─────────────────────────────────────────────────

  describe('Accounts', () => {
    let accountId: string;

    it('should create an account', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/accounts`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Acme Corp', currency: 'USD', billCycleDay: 15 }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.id).toBeDefined();
      expect(body.accountNumber).toBeDefined();
      accountId = body.id;
    });

    it('should get an account', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/accounts/${accountId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.basicInfo.name).toBe('Acme Corp');
    });

    it('should update an account', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/accounts/${accountId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Acme Inc' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('should get account summary', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/accounts/${accountId}/summary`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.basicInfo).toBeDefined();
      expect(body.subscriptions).toBeDefined();
      expect(body.invoices).toBeDefined();
    });
  });

  // ── 4. Subscription lifecycle ───────────────────────────────────────

  describe('Subscriptions', () => {
    let subId: string;
    let accountId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/accounts`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Sub Test Account' }),
      });
      accountId = res.json().id;
    });

    it('should create a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ accountId, termType: 'TERMED', currentTerm: 12 }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.subscriptionId).toBeDefined();
      expect(body.subscriptionNumber).toBeDefined();
      subId = body.subscriptionId;
    });

    it('should get a subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/subscriptions/${subId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.status).toBe('Active');
    });

    it('should list subscriptions by account', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/subscriptions/accounts/${accountId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a subscription', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/subscriptions/${subId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ autoRenew: false }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('should cancel a subscription', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/subscriptions/${subId}/cancel`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      // Verify status
      const get = await ts.server.inject({ method: 'GET', url: `${BP}/subscriptions/${subId}` });
      expect(get.json().status).toBe('Cancelled');
    });

    it('should renew a subscription', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/subscriptions/${subId}/renew`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);

      const get = await ts.server.inject({ method: 'GET', url: `${BP}/subscriptions/${subId}` });
      expect(get.json().status).toBe('Active');
    });

    it('should suspend and resume a subscription', async () => {
      const suspendRes = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/subscriptions/${subId}/suspend`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(suspendRes.statusCode).toBe(200);

      let get = await ts.server.inject({ method: 'GET', url: `${BP}/subscriptions/${subId}` });
      expect(get.json().status).toBe('Suspended');

      const resumeRes = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/subscriptions/${subId}/resume`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(resumeRes.statusCode).toBe(200);

      get = await ts.server.inject({ method: 'GET', url: `${BP}/subscriptions/${subId}` });
      expect(get.json().status).toBe('Active');
    });
  });

  // ── 5. Orders ───────────────────────────────────────────────────────

  describe('Orders', () => {
    let orderNumber: string;

    it('should create an order', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/orders`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ description: 'Test order', orderDate: '2025-01-01' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.orderNumber).toBeDefined();
      orderNumber = body.orderNumber;
    });

    it('should get an order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/orders/${orderNumber}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().order.description).toBe('Test order');
    });

    it('should list orders', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/orders`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should delete an order', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/orders/${orderNumber}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      // Verify deleted
      const get = await ts.server.inject({ method: 'GET', url: `${BP}/orders/${orderNumber}` });
      expect(get.statusCode).toBe(404);
    });
  });

  // ── 6. Products & Rate Plans ────────────────────────────────────────

  describe('Products & Rate Plans', () => {
    let productId: string;
    let ratePlanId: string;

    it('should create a product', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/object/product`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Enterprise Plan', sku: 'ENT-001' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
      productId = res.json().Id;
    });

    it('should get a product from catalog', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/catalog/products/${productId}`,
      });
      expect(res.statusCode).toBe(200);
    });

    it('should list catalog products', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/catalog/products`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a product', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/object/product/${productId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Enterprise Plan v2' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('should create a product rate plan', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/object/product-rate-plan`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ productId, name: 'Monthly' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
      ratePlanId = res.json().Id;
    });

    it('should list rate plans for a product', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/products/${productId}/product-rate-plans`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should get a rate plan', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/object/product-rate-plan/${ratePlanId}`,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── 7. Invoices ─────────────────────────────────────────────────────

  describe('Invoices', () => {
    let invoiceId: string;

    it('should create an invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/invoices`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ accountId: 'acct_test', amount: 100, currency: 'USD' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
      invoiceId = res.json().id;
    });

    it('should get an invoice', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/invoices/${invoiceId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().amount).toBe(100);
    });

    it('should list invoices', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/invoices`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update an invoice', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/invoices/${invoiceId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ status: 'Posted' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('should invoice and collect atomically', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/operations/invoice-collect`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ accountId: 'acct_test', invoiceAmount: 50 }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.invoiceId).toBeDefined();
      expect(body.paymentId).toBeDefined();
    });
  });

  // ── 8. Payments ─────────────────────────────────────────────────────

  describe('Payments', () => {
    let paymentId: string;

    it('should create a payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/payments`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ accountId: 'acct_test', amount: 100, currency: 'USD' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
      paymentId = res.json().id;
    });

    it('should get a payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/payments/${paymentId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().amount).toBe(100);
    });

    it('should list payments', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/payments`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 9. Payment Methods ──────────────────────────────────────────────

  describe('Payment Methods', () => {
    let pmId: string;

    it('should create a payment method', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/payment-methods`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ accountId: 'acct_test', type: 'CreditCard' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
      pmId = res.json().id;
    });

    it('should get a payment method', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/payment-methods/${pmId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().type).toBe('CreditCard');
    });

    it('should list payment methods', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/payment-methods`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should delete a payment method', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/payment-methods/${pmId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });

  // ── 10. Credit Memos ────────────────────────────────────────────────

  describe('Credit Memos', () => {
    let memoId: string;
    let invoiceId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/invoices`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ accountId: 'acct_cm', amount: 200 }),
      });
      invoiceId = res.json().id;
    });

    it('should create a credit memo', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/credit-memos`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ accountId: 'acct_cm', amount: 50, reasonCode: 'Write-off' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
      expect(res.json().memoNumber).toMatch(/^CM-/);
      memoId = res.json().id;
    });

    it('should get a credit memo', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/credit-memos/${memoId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().amount).toBe(50);
    });

    it('should list credit memos', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/credit-memos`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should apply a credit memo', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/credit-memos/${memoId}/apply`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);

      const get = await ts.server.inject({ method: 'GET', url: `${BP}/credit-memos/${memoId}` });
      expect(get.json().status).toBe('Posted');
    });

    it('should create a credit memo from invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/credit-memos/invoice/${invoiceId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ reasonCode: 'Correction' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
    });
  });

  // ── 11. Debit Memos ─────────────────────────────────────────────────

  describe('Debit Memos', () => {
    let memoId: string;

    it('should create a debit memo', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/debit-memos`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ accountId: 'acct_test', amount: 75, reasonCode: 'Late fee' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
      expect(res.json().memoNumber).toMatch(/^DM-/);
      memoId = res.json().id;
    });

    it('should get a debit memo', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/debit-memos/${memoId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().amount).toBe(75);
    });

    it('should list debit memos', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/debit-memos`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 12. Usage ───────────────────────────────────────────────────────

  describe('Usage', () => {
    it('should create a usage record', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/usage`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ accountId: 'acct_usage', quantity: 500, unitOfMeasure: 'API Calls' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
    });

    it('should list usage by account', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/usage/accounts/acct_usage`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
      expect(res.json().data[0].quantity).toBe(500);
    });
  });

  // ── 13. Contacts ────────────────────────────────────────────────────

  describe('Contacts', () => {
    let contactId: string;

    it('should create a contact', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/contacts`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ firstName: 'Alice', lastName: 'Smith', workEmail: 'alice@acme.com', country: 'US' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
      contactId = res.json().id;
    });

    it('should get a contact', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/contacts/${contactId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().firstName).toBe('Alice');
    });

    it('should update a contact', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/contacts/${contactId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ firstName: 'Alicia' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      const get = await ts.server.inject({ method: 'GET', url: `${BP}/contacts/${contactId}` });
      expect(get.json().firstName).toBe('Alicia');
    });
  });

  // ── 14. Error handling ──────────────────────────────────────────────

  describe('Error handling', () => {
    it('should return Zuora error format for non-existent account', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/accounts/doesnotexist`,
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.reasons[0].code).toBe('OBJECT_NOT_FOUND');
    });
  });

  // ── 15. resolvePersona ──────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Bearer token', () => {
      const mockReq = {
        headers: { authorization: 'Bearer test_young-professional_abc123' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBe('young-professional');
    });

    it('should return null for missing auth header', () => {
      const mockReq = {
        headers: {},
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });

    it('should return null for non-matching token format', () => {
      const mockReq = {
        headers: { authorization: 'Bearer prod_sometoken' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 16. Cross-surface seeding ───────────────────────────────────────

  describe('Cross-surface seeding', () => {
    let seededTs: TestServer;

    beforeAll(async () => {
      const seededAdapter = new ZuoraAdapter();
      const seedData = new Map<string, ExpandedData>([
        ['test-persona', {
          personaId: 'test-persona',
          blueprint: {} as Blueprint,
          tables: {},
          documents: {},
          apiResponses: {
            zuora: {
              adapterId: 'zuora',
              responses: {
                accounts: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'acct_seeded1', name: 'Seeded Corp', status: 'Active' },
                    personaId: 'test-persona',
                    stateKey: 'zuora:accounts',
                  },
                ],
                subscriptions: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'sub_seeded1', accountId: 'acct_seeded1', status: 'Active' },
                    personaId: 'test-persona',
                    stateKey: 'zuora:subscriptions',
                  },
                ],
              },
            },
          },
          files: [],
          events: [],
          facts: [],
        }],
      ]);
      seededTs = await buildTestServer(seededAdapter, seedData);
    });

    afterAll(async () => {
      await seededTs.close();
    });

    it('should retrieve a pre-seeded account', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: `${BP}/accounts/acct_seeded1` });
      expect(res.statusCode).toBe(200);
      expect(res.json().basicInfo.name).toBe('Seeded Corp');
    });

    it('should list pre-seeded subscriptions by account', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: `${BP}/subscriptions/accounts/acct_seeded1` });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBe(1);
      expect(res.json().data[0].status).toBe('Active');
    });
  });
});
