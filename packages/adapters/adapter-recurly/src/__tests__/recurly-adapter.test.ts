import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData, Blueprint } from '@mimicai/core';
import { RecurlyAdapter } from '../recurly-adapter.js';

const BP = '/recurly/v2021-02-25';

describe('RecurlyAdapter', () => {
  let ts: TestServer;
  let adapter: RecurlyAdapter;

  beforeAll(async () => {
    adapter = new RecurlyAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ─────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('recurly');
      expect(adapter.name).toBe('Recurly API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/recurly/v2021-02-25');
    });
  });

  // ── 2. Endpoints count ─────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return the correct number of endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(47);
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
        payload: JSON.stringify({ first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.object).toBe('account');
      expect(body.first_name).toBe('Alice');
      expect(body.email).toBe('alice@example.com');
      expect(body.state).toBe('active');
      accountId = body.id;
    });

    it('should get an account by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/accounts/${accountId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(accountId);
    });

    it('should list accounts', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/accounts`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('list');
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update an account', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/accounts/${accountId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ first_name: 'Updated' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().first_name).toBe('Updated');
      expect(res.json().email).toBe('alice@example.com');
    });

    it('should deactivate an account', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/accounts/${accountId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe('closed');
    });
  });

  // ── 4. Subscription lifecycle ───────────────────────────────────────

  describe('Subscriptions', () => {
    let subId: string;

    it('should create a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ plan_code: 'pro', currency: 'USD', unit_amount: 29.99 }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.object).toBe('subscription');
      expect(body.state).toBe('active');
      expect(body.unit_amount).toBe(29.99);
      subId = body.id;
    });

    it('should get a subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/subscriptions/${subId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(subId);
    });

    it('should list subscriptions with has_more pagination', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/subscriptions`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('list');
      expect(body.has_more).toBeDefined();
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a subscription', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/subscriptions/${subId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ unit_amount: 49.99 }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().unit_amount).toBe(49.99);
    });

    it('should cancel a subscription (end of term)', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/subscriptions/${subId}/cancel`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe('canceled');
      expect(res.json().canceled_at).toBeDefined();
    });

    it('should reactivate a cancelled subscription', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/subscriptions/${subId}/reactivate`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe('active');
      expect(res.json().canceled_at).toBeNull();
    });

    it('should terminate a subscription immediately', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/subscriptions/${subId}/terminate`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe('expired');
      expect(res.json().expired_at).toBeDefined();
    });

    it('should pause and resume a subscription', async () => {
      // Create a new active sub for pause/resume
      const createRes = await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ plan_code: 'basic' }),
      });
      const newSubId = createRes.json().id;

      const pauseRes = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/subscriptions/${newSubId}/pause`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(pauseRes.statusCode).toBe(200);
      expect(pauseRes.json().state).toBe('paused');

      const resumeRes = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/subscriptions/${newSubId}/resume`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(resumeRes.statusCode).toBe(200);
      expect(resumeRes.json().state).toBe('active');
    });
  });

  // ── 5. Plans ────────────────────────────────────────────────────────

  describe('Plans', () => {
    let planId: string;

    it('should create a plan', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/plans`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ code: 'pro-monthly', name: 'Pro Monthly', interval_unit: 'months', interval_length: 1 }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().object).toBe('plan');
      expect(res.json().name).toBe('Pro Monthly');
      expect(res.json().code).toBe('pro-monthly');
      planId = res.json().id;
    });

    it('should get a plan by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/plans/${planId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(planId);
    });

    it('should list plans', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/plans`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a plan', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/plans/${planId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Pro Monthly v2' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Pro Monthly v2');
    });
  });

  // ── 6. Add-Ons ──────────────────────────────────────────────────────

  describe('Add-Ons', () => {
    let planId: string;
    let addOnId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/plans`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ code: 'addon-test-plan', name: 'Addon Test Plan' }),
      });
      planId = res.json().id;
    });

    it('should create an add-on', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/plans/${planId}/add_ons`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ code: 'extra-seats', name: 'Extra Seats', add_on_type: 'fixed' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().object).toBe('add_on');
      expect(res.json().plan_id).toBe(planId);
      expect(res.json().name).toBe('Extra Seats');
      addOnId = res.json().id;
    });

    it('should list add-ons for a plan', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/plans/${planId}/add_ons`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update an add-on', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/plans/${planId}/add_ons/${addOnId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Extra Seats v2' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Extra Seats v2');
    });

    it('should delete an add-on', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/plans/${planId}/add_ons/${addOnId}`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 7. Invoices ─────────────────────────────────────────────────────

  describe('Invoices', () => {
    let invoiceId: string;

    beforeAll(async () => {
      // Seed an invoice directly into the store
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/accounts`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ first_name: 'Invoice', last_name: 'Test' }),
      });
      // We need to seed an invoice — create via line items path isn't available,
      // so we'll use the collect endpoint to verify states
    });

    it('should list invoices (empty initially)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/invoices`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().object).toBe('list');
    });

    it('should return 404 for non-existent invoice', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/invoices/inv_doesnotexist`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 8. Line Items ──────────────────────────────────────────────────

  describe('Line Items', () => {
    let accountId: string;
    let lineItemId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/accounts`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ first_name: 'LineItem', last_name: 'Test' }),
      });
      accountId = res.json().id;
    });

    it('should create a line item', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/accounts/${accountId}/line_items`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ type: 'charge', unit_amount: 15.00, currency: 'USD', description: 'Setup fee' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().object).toBe('line_item');
      expect(res.json().type).toBe('charge');
      expect(res.json().unit_amount).toBe(15.00);
      lineItemId = res.json().id;
    });

    it('should list line items for an account', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/accounts/${accountId}/line_items`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should delete a line item', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/line_items/${lineItemId}`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 9. Billing Info ─────────────────────────────────────────────────

  describe('Billing Info', () => {
    let accountId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/accounts`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ first_name: 'Billing', last_name: 'Test' }),
      });
      accountId = res.json().id;
    });

    it('should update billing info', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/accounts/${accountId}/billing_info`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ token_id: 'tok_test123' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().object).toBe('billing_info');
      expect(res.json().account_id).toBe(accountId);
    });

    it('should get billing info', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/accounts/${accountId}/billing_info`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().account_id).toBe(accountId);
    });

    it('should remove billing info', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/accounts/${accountId}/billing_info`,
      });
      expect(res.statusCode).toBe(204);

      // Verify it's gone
      const getRes = await ts.server.inject({
        method: 'GET',
        url: `${BP}/accounts/${accountId}/billing_info`,
      });
      expect(getRes.statusCode).toBe(404);
    });
  });

  // ── 10. Coupons ─────────────────────────────────────────────────────

  describe('Coupons', () => {
    let couponId: string;

    it('should create a coupon', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/coupons`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          code: 'SAVE20',
          name: '20% Off',
          discount_type: 'percent',
          discount_percent: 20,
          duration: 'single_use',
        }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().object).toBe('coupon');
      expect(res.json().code).toBe('SAVE20');
      expect(res.json().state).toBe('redeemable');
      couponId = res.json().id;
    });

    it('should get a coupon by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/coupons/${couponId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(couponId);
    });

    it('should list coupons', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/coupons`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should redeem a coupon on an account', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/accounts/acct_test1/coupon_redemptions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ coupon_id: couponId, currency: 'USD' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().object).toBe('coupon_redemption');
      expect(res.json().account_id).toBe('acct_test1');
    });
  });

  // ── 11. Usage Records ───────────────────────────────────────────────

  describe('Usage Records', () => {
    it('should create a usage record', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions/sub_test1/add_ons/addon_test1/usage`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 150, merchant_tag: 'api-calls' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().object).toBe('usage');
      expect(res.json().amount).toBe(150);
      expect(res.json().subscription_id).toBe('sub_test1');
      expect(res.json().add_on_id).toBe('addon_test1');
    });

    it('should list usage records', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/subscriptions/sub_test1/add_ons/addon_test1/usage`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 12. Shipping Addresses ──────────────────────────────────────────

  describe('Shipping Addresses', () => {
    let accountId: string;
    let addressId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/accounts`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ first_name: 'Ship', last_name: 'Test' }),
      });
      accountId = res.json().id;
    });

    it('should create a shipping address', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/accounts/${accountId}/shipping_addresses`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          first_name: 'Alice',
          last_name: 'Smith',
          street1: '123 Main St',
          city: 'San Francisco',
          region: 'CA',
          postal_code: '94105',
          country: 'US',
        }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().object).toBe('shipping_address');
      expect(res.json().street1).toBe('123 Main St');
      addressId = res.json().id;
    });

    it('should list shipping addresses', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/accounts/${accountId}/shipping_addresses`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a shipping address', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/accounts/${accountId}/shipping_addresses/${addressId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ street1: '456 Oak Ave' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().street1).toBe('456 Oak Ave');
    });

    it('should delete a shipping address', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/accounts/${accountId}/shipping_addresses/${addressId}`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 13. Error handling ──────────────────────────────────────────────

  describe('Error handling', () => {
    it('should return Recurly error format for non-existent account', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/accounts/acct_doesnotexist`,
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error.type).toBe('not_found');
      expect(body.error.message).toContain('acct_doesnotexist');
    });

    it('should return 404 for non-existent subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/subscriptions/sub_doesnotexist`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.type).toBe('not_found');
    });
  });

  // ── 14. resolvePersona ──────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Basic auth', () => {
      const token = Buffer.from('test_young-professional_abc123:').toString('base64');
      const mockReq = {
        headers: { authorization: `Basic ${token}` },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBe('young-professional');
    });

    it('should return null for missing auth header', () => {
      const mockReq = {
        headers: {},
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });

    it('should return null for non-matching key format', () => {
      const token = Buffer.from('live_somekey:').toString('base64');
      const mockReq = {
        headers: { authorization: `Basic ${token}` },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 15. Cross-surface seeding ───────────────────────────────────────

  describe('Cross-surface seeding', () => {
    let seededTs: TestServer;

    beforeAll(async () => {
      const seededAdapter = new RecurlyAdapter();
      const seedData = new Map<string, ExpandedData>([
        ['test-persona', {
          personaId: 'test-persona',
          blueprint: {} as Blueprint,
          tables: {},
          documents: {},
          apiResponses: {
            recurly: {
              adapterId: 'recurly',
              responses: {
                accounts: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'acct_seeded1', first_name: 'Alice', email: 'alice@test.com', state: 'active' },
                    personaId: 'test-persona',
                    stateKey: 'recurly_accounts',
                  },
                ],
                subscriptions: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'sub_seeded1', plan_code: 'pro', state: 'active' },
                    personaId: 'test-persona',
                    stateKey: 'recurly_subscriptions',
                  },
                ],
              },
            },
          },
          files: [],
          events: [],
        }],
      ]);
      seededTs = await buildTestServer(seededAdapter, seedData);
    });

    afterAll(async () => {
      await seededTs.close();
    });

    it('should list pre-seeded accounts', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: `${BP}/accounts` });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBe(1);
      expect(res.json().data[0].id).toBe('acct_seeded1');
    });

    it('should retrieve a pre-seeded subscription', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: `${BP}/subscriptions/sub_seeded1` });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe('sub_seeded1');
      expect(res.json().state).toBe('active');
    });
  });
});
