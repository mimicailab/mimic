import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer } from '@mimicai/adapter-sdk';
import type { TestServer } from '@mimicai/adapter-sdk';
import { ChargebeeAdapter } from '../chargebee-adapter.js';

describe('ChargebeeAdapter', () => {
  let ts: TestServer;
  const adapter = new ChargebeeAdapter();

  beforeAll(async () => {
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  it('should have correct metadata', () => {
    expect(adapter.id).toBe('chargebee');
    expect(adapter.basePath).toBe('');
    expect(adapter.name).toBe('Chargebee');
  });

  it('should return endpoint definitions', () => {
    const endpoints = adapter.getEndpoints();
    expect(endpoints.length).toBeGreaterThan(0);
    for (const ep of endpoints) {
      expect(ep.method).toBeDefined();
      expect(ep.path).toBeDefined();
    }
  });

  // ── Customer CRUD ─────────────────────────────────────────────────────────

  let customerId: string;

  it('should create a customer', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: '/customers',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=test@example.com&first_name=Test&last_name=User',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.customer).toBeDefined();
    expect(body.customer.email).toBe('test@example.com');
    expect(body.customer.first_name).toBe('Test');
    expect(body.customer.id).toBeDefined();
    customerId = body.customer.id;
  });

  it('should list customers', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/customers',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.list).toBeDefined();
    expect(body.list.length).toBeGreaterThan(0);
    expect(body.list[0].customer).toBeDefined();
  });

  it('should retrieve a customer', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: `/customers/${customerId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.customer).toBeDefined();
    expect(body.customer.id).toBe(customerId);
    expect(body.customer.email).toBe('test@example.com');
  });

  it('should update a customer', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: `/customers/${customerId}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'first_name=Updated&company=Acme',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.customer).toBeDefined();
    expect(body.customer.first_name).toBe('Updated');
    expect(body.customer.company).toBe('Acme');
    expect(body.customer.email).toBe('test@example.com');
  });

  it('should delete a customer', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: `/customers/${customerId}/delete`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.customer).toBeDefined();
    expect(body.customer.deleted).toBe(true);
  });

  it('should return 404 for non-existent customer', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/customers/nonexistent_id',
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('resource_not_found');
  });

  // ── Item CRUD ─────────────────────────────────────────────────────────────

  let itemId: string;

  it('should create an item', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: '/items',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'id=silver-plan&name=Silver+Plan&type=plan',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.item).toBeDefined();
    expect(body.item.name).toBe('Silver Plan');
    itemId = body.item.id;
  });

  it('should list items', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/items',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.list).toBeDefined();
    expect(body.list.length).toBeGreaterThan(0);
  });

  // ── Subscription lifecycle ─────────────────────────────────────────────────
  // Chargebee creates subscriptions via POST /customers/{id}/subscription_for_items

  let subId: string;

  it('should create a subscription via /customers/:id/subscription_for_items', async () => {
    // First create a customer
    const cusRes = await ts.server.inject({
      method: 'POST',
      url: '/customers',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=subscriber@example.com',
    });
    const cusId = cusRes.json().customer.id;

    const res = await ts.server.inject({
      method: 'POST',
      url: `/customers/${cusId}/subscription_for_items`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.subscription).toBeDefined();
    expect(body.subscription.status).toBe('active');
    expect(body.subscription.customer_id).toBe(cusId);
    subId = body.subscription.id;
  });

  it('should cancel a subscription', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: `/subscriptions/${subId}/cancel_for_items`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.subscription.status).toBe('cancelled');
  });

  it('should reactivate a cancelled subscription', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: `/subscriptions/${subId}/reactivate`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.subscription.status).toBe('active');
  });

  it('should pause a subscription', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: `/subscriptions/${subId}/pause`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.subscription.status).toBe('paused');
  });

  it('should resume a paused subscription', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: `/subscriptions/${subId}/resume`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.subscription.status).toBe('active');
  });

  it('should cancel at end of term', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: `/subscriptions/${subId}/cancel_for_items`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'end_of_term=true',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.subscription.status).toBe('non_renewing');
  });

  // ── Invoice lifecycle ─────────────────────────────────────────────────────
  // Chargebee creates invoices via POST /invoices/create_for_charge_items_and_charges

  let invoiceId: string;

  it('should create an invoice via /invoices/create_for_charge_items_and_charges', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: '/invoices/create_for_charge_items_and_charges',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'customer_id=cus_test&total=5000&amount_due=5000',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.invoice).toBeDefined();
    expect(body.invoice.status).toBe('payment_due');
    invoiceId = body.invoice.id;
  });

  it('should record payment on an invoice', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: `/invoices/${invoiceId}/record_payment`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'amount=5000',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.invoice.status).toBe('paid');
  });

  it('should void an unpaid invoice', async () => {
    // Create a new invoice first
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/invoices/create_for_charge_items_and_charges',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'customer_id=cus_test&total=3000&amount_due=3000',
    });
    const newInvId = createRes.json().invoice.id;

    const res = await ts.server.inject({
      method: 'POST',
      url: `/invoices/${newInvId}/void`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.invoice.status).toBe('voided');
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  it('should paginate list results', async () => {
    // Create multiple customers
    for (let i = 0; i < 3; i++) {
      await ts.server.inject({
        method: 'POST',
        url: '/customers',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `email=page${i}@test.com`,
      });
    }

    const res = await ts.server.inject({
      method: 'GET',
      url: '/customers?limit=2',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.list.length).toBe(2);
    expect(body.next_offset).toBeDefined();

    // Fetch next page
    const res2 = await ts.server.inject({
      method: 'GET',
      url: `/customers?limit=2&offset=${body.next_offset}`,
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.list.length).toBeGreaterThan(0);
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('should reject cancel on already cancelled subscription', async () => {
    // Create a customer and subscription
    const cusRes = await ts.server.inject({
      method: 'POST',
      url: '/customers',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=cancel-test@example.com',
    });
    const cusId = cusRes.json().customer.id;

    const createRes = await ts.server.inject({
      method: 'POST',
      url: `/customers/${cusId}/subscription_for_items`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const sid = createRes.json().subscription.id;

    await ts.server.inject({
      method: 'POST',
      url: `/subscriptions/${sid}/cancel_for_items`,
    });

    // Try to cancel again
    const res = await ts.server.inject({
      method: 'POST',
      url: `/subscriptions/${sid}/cancel_for_items`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('should reject void on paid invoice', async () => {
    // invoiceId was already paid in earlier test
    const res = await ts.server.inject({
      method: 'POST',
      url: `/invoices/${invoiceId}/void`,
    });
    expect(res.statusCode).toBe(400);
  });

  // ── resolvePersona ────────────────────────────────────────────────────────

  it('should resolve persona from basic auth', () => {
    const apiKey = Buffer.from('test_mysite_abcdef123:').toString('base64');
    const persona = adapter.resolvePersona({
      headers: { authorization: `Basic ${apiKey}` },
    } as any);
    expect(persona).toBe('mysite');
  });

  it('should return null for missing auth', () => {
    const persona = adapter.resolvePersona({
      headers: {},
    } as any);
    expect(persona).toBeNull();
  });

  // ── Coupon CRUD ───────────────────────────────────────────────────────────
  // Chargebee creates coupons via POST /coupons/create_for_items

  it('should create and list coupons', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/coupons/create_for_items',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'id=SUMMER20&name=Summer+Discount&discount_type=percentage&discount_percentage=20',
    });
    expect(createRes.statusCode).toBe(200);
    expect(createRes.json().coupon).toBeDefined();
    expect(createRes.json().coupon.status).toBe('active');

    const listRes = await ts.server.inject({
      method: 'GET',
      url: '/coupons',
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().list.length).toBeGreaterThan(0);
  });
});
