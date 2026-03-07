import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData, Blueprint } from '@mimicai/core';
import { ChargebeeAdapter } from '../chargebee-adapter.js';

const BP = '/chargebee/api/v2';

describe('ChargebeeAdapter', () => {
  let ts: TestServer;
  let adapter: ChargebeeAdapter;

  beforeAll(async () => {
    adapter = new ChargebeeAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('chargebee');
      expect(adapter.name).toBe('Chargebee API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/chargebee/api/v2');
    });
  });

  // ── 2. Endpoints count ────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return the correct number of endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(55);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Customer CRUD ───────────────────────────────────────────────────

  describe('Customers', () => {
    let customerId: string;

    it('should create a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/customers`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.customer).toBeDefined();
      expect(body.customer.id).toMatch(/^cust_/);
      expect(body.customer.first_name).toBe('Alice');
      expect(body.customer.email).toBe('alice@example.com');
      customerId = body.customer.id;
    });

    it('should get a customer by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().customer.id).toBe(customerId);
    });

    it('should list customers', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/customers`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.list).toBeDefined();
      expect(body.list.length).toBeGreaterThanOrEqual(1);
      expect(body.list[0].customer).toBeDefined();
    });

    it('should update a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/customers/${customerId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ first_name: 'Updated' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().customer.first_name).toBe('Updated');
      expect(res.json().customer.email).toBe('alice@example.com');
    });
  });

  // ── 4. Subscription lifecycle ──────────────────────────────────────────

  describe('Subscriptions', () => {
    let subId: string;

    it('should create a subscription and auto-generate invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customer_id: 'cust_test1' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.subscription).toBeDefined();
      expect(body.subscription.id).toMatch(/^sub_/);
      expect(body.subscription.status).toBe('active');
      expect(body.invoice).toBeDefined();
      expect(body.invoice.id).toMatch(/^inv_/);
      subId = body.subscription.id;
    });

    it('should get a subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/subscriptions/${subId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscription.id).toBe(subId);
    });

    it('should list subscriptions with Chargebee list format', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/subscriptions`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.list).toBeDefined();
      expect(body.list.length).toBeGreaterThanOrEqual(1);
      expect(body.list[0].subscription).toBeDefined();
    });

    it('should cancel a subscription immediately', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions/${subId}/cancel`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscription.status).toBe('cancelled');
    });

    it('should reactivate a cancelled subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions/${subId}/reactivate`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscription.status).toBe('active');
    });

    it('should cancel end-of-term (non_renewing)', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions/${subId}/cancel`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ end_of_term: true }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscription.status).toBe('non_renewing');
    });

    it('should pause a subscription', async () => {
      // Reactivate first
      await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions/${subId}/reactivate`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });

      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions/${subId}/pause`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscription.status).toBe('paused');
    });

    it('should resume a paused subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions/${subId}/resume`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscription.status).toBe('active');
    });

    it('should update a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions/${subId}/update`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ auto_collection: 'off' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscription.auto_collection).toBe('off');
    });
  });

  // ── 5. Items & Item Prices ─────────────────────────────────────────────

  describe('Items & Item Prices', () => {
    let itemId: string;
    let itemPriceId: string;

    it('should create an item', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/items`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Pro Plan', type: 'plan' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().item.name).toBe('Pro Plan');
      itemId = res.json().item.id;
    });

    it('should list items', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/items`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().list.length).toBeGreaterThanOrEqual(1);
    });

    it('should create an item price', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/item_prices`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          name: 'Pro Monthly',
          item_id: itemId,
          price: 2999,
          period: 1,
          period_unit: 'month',
          currency_code: 'USD',
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().item_price.item_id).toBe(itemId);
      expect(res.json().item_price.price).toBe(2999);
      itemPriceId = res.json().item_price.id;
    });

    it('should list item prices filtered by item', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/item_prices?item_id[is]=${itemId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().list.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 6. Item Families ───────────────────────────────────────────────────

  describe('Item Families', () => {
    it('should create an item family', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/item_families`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'SaaS Products' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().item_family.name).toBe('SaaS Products');
    });
  });

  // ── 7. Invoice lifecycle ───────────────────────────────────────────────

  describe('Invoices', () => {
    let invoiceId: string;

    beforeAll(async () => {
      // Create a subscription to auto-generate an invoice
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customer_id: 'cust_inv_test' }),
      });
      invoiceId = res.json().invoice.id;
    });

    it('should get an invoice', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/invoices/${invoiceId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().invoice.id).toBe(invoiceId);
    });

    it('should list invoices', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/invoices`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().list.length).toBeGreaterThanOrEqual(1);
    });

    it('should void an invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/invoices/${invoiceId}/void`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().invoice.status).toBe('voided');
    });

    it('should get invoice PDF', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/invoices/${invoiceId}/pdf`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().download.download_url).toContain('.pdf');
    });
  });

  // ── 8. Credit Notes ────────────────────────────────────────────────────

  describe('Credit Notes', () => {
    it('should create a credit note', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/credit_notes`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          reference_invoice_id: 'inv_test1',
          total: 500,
          reason_code: 'product_unsatisfactory',
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().credit_note.id).toMatch(/^cn_/);
      expect(res.json().credit_note.total).toBe(500);
    });

    it('should list credit notes', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/credit_notes`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().list.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 9. Coupons ─────────────────────────────────────────────────────────

  describe('Coupons', () => {
    let couponId: string;

    it('should create a coupon', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/coupons`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          name: '20% Off',
          discount_type: 'percentage',
          discount_percentage: 20,
          duration_type: 'one_time',
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().coupon.discount_type).toBe('percentage');
      expect(res.json().coupon.discount_percentage).toBe(20);
      couponId = res.json().coupon.id;
    });

    it('should list coupons', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/coupons`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().list.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a coupon', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/coupons/${couponId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: '25% Off' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().coupon.name).toBe('25% Off');
    });

    it('should delete a coupon', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/coupons/${couponId}/delete`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().coupon.status).toBe('archived');
    });
  });

  // ── 10. Usage ──────────────────────────────────────────────────────────

  describe('Usage', () => {
    let usageId: string;

    it('should create a usage record', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/subscriptions/sub_test1/usages`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ item_price_id: 'iprice_test', quantity: '150' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().usage.id).toMatch(/^usage_/);
      expect(res.json().usage.quantity).toBe('150');
      usageId = res.json().usage.id;
    });

    it('should list usage records', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/subscriptions/sub_test1/usages`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().list.length).toBeGreaterThanOrEqual(1);
    });

    it('should delete a usage record', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/usages/${usageId}`,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── 11. Hosted Pages ───────────────────────────────────────────────────

  describe('Hosted Pages', () => {
    it('should create a checkout hosted page', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/hosted_pages/checkout_new`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().hosted_page.type).toBe('checkout_new');
      expect(res.json().hosted_page.url).toContain('chargebee.com');
    });
  });

  // ── 12. Portal Sessions ────────────────────────────────────────────────

  describe('Portal Sessions', () => {
    it('should create a portal session', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/portal_sessions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customer_id: 'cust_test1' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.portal_session.id).toMatch(/^ps_/);
      expect(body.portal_session.access_url).toContain('chargebeeportal.com');
    });
  });

  // ── 13. Quotes ─────────────────────────────────────────────────────────

  describe('Quotes', () => {
    let quoteId: string;

    it('should create a quote', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/quotes`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customer_id: 'cust_test1', name: 'Enterprise Quote' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().quote.id).toMatch(/^qt_/);
      expect(res.json().quote.status).toBe('open');
      quoteId = res.json().quote.id;
    });

    it('should convert a quote to subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/quotes/${quoteId}/convert`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().quote.status).toBe('accepted');
      expect(res.json().subscription).toBeDefined();
      expect(res.json().subscription.status).toBe('active');
    });
  });

  // ── 14. Error handling ─────────────────────────────────────────────────

  describe('Error handling', () => {
    it('should return Chargebee error format for non-existent customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/customers/cust_doesnotexist`,
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.api_error_code).toBe('resource_not_found');
      expect(body.http_status_code).toBe(404);
      expect(body.message).toContain('cust_doesnotexist');
    });
  });

  // ── 15. resolvePersona ─────────────────────────────────────────────────

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

  // ── 16. Cross-surface seeding ──────────────────────────────────────────

  describe('Cross-surface seeding', () => {
    let seededTs: TestServer;

    beforeAll(async () => {
      const seededAdapter = new ChargebeeAdapter();
      const seedData = new Map<string, ExpandedData>([
        ['test-persona', {
          personaId: 'test-persona',
          blueprint: {} as Blueprint,
          tables: {},
          documents: {},
          apiResponses: {
            chargebee: {
              adapterId: 'chargebee',
              responses: {
                customers: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'cust_seeded1', first_name: 'Alice', email: 'alice@test.com' },
                    personaId: 'test-persona',
                    stateKey: 'cb_customers',
                  },
                ],
                subscriptions: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'sub_seeded1', customer_id: 'cust_seeded1', status: 'active' },
                    personaId: 'test-persona',
                    stateKey: 'cb_subscriptions',
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

    it('should list pre-seeded customers', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: `${BP}/customers` });
      expect(res.statusCode).toBe(200);
      expect(res.json().list.length).toBe(1);
      expect(res.json().list[0].customer.id).toBe('cust_seeded1');
    });

    it('should retrieve a pre-seeded subscription', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: `${BP}/subscriptions/sub_seeded1` });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscription.id).toBe('sub_seeded1');
      expect(res.json().subscription.status).toBe('active');
    });
  });
});
