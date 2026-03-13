import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer } from '@mimicai/adapter-sdk';
import type { TestServer } from '@mimicai/adapter-sdk';
import { RecurlyAdapter } from '../recurly-adapter.js';

describe('RecurlyAdapter', () => {
  let ts: TestServer;
  const adapter = new RecurlyAdapter();

  beforeAll(async () => {
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── Metadata ────────────────────────────────────────────────────────────

  it('should have correct metadata', () => {
    expect(adapter.id).toBe('recurly');
    expect(adapter.basePath).toBe('/recurly');
    expect(adapter.name).toBe('Recurly API');
  });

  it('should return endpoint definitions', () => {
    const endpoints = adapter.getEndpoints();
    expect(endpoints.length).toBeGreaterThan(100);
    for (const ep of endpoints) {
      expect(ep.method).toBeDefined();
      expect(ep.path).toBeDefined();
    }
  });

  // ── Accounts CRUD ──────────────────────────────────────────────────────

  it('should create an account', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: '/recurly/accounts',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'acct-001', email: 'test@example.com', first_name: 'Test', last_name: 'User' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toMatch(/^acct_/);
    expect(body.email).toBe('test@example.com');
    expect(body.first_name).toBe('Test');
    expect(body.state).toBe('active');
  });

  it('should list accounts', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/recurly/accounts',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.object).toBe('list');
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('should retrieve an account', async () => {
    // Create first
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/recurly/accounts',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'acct-retrieve', email: 'retrieve@test.com' }),
    });
    const accountId = createRes.json().id;

    const res = await ts.server.inject({
      method: 'GET',
      url: `/recurly/accounts/${accountId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(accountId);
  });

  it('should update an account', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/recurly/accounts',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'acct-update' }),
    });
    const accountId = createRes.json().id;

    const res = await ts.server.inject({
      method: 'PUT',
      url: `/recurly/accounts/${accountId}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ company: 'Updated Corp' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().company).toBe('Updated Corp');
  });

  it('should return 404 for non-existent account', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/recurly/accounts/acct_nonexistent',
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.type).toBe('not_found');
  });

  // ── Account deactivate/reactivate ──────────────────────────────────────

  it('should deactivate an account', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/recurly/accounts',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'acct-deactivate' }),
    });
    const accountId = createRes.json().id;

    const res = await ts.server.inject({
      method: 'DELETE',
      url: `/recurly/accounts/${accountId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('closed');
  });

  it('should reactivate a closed account', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/recurly/accounts',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'acct-reactivate' }),
    });
    const accountId = createRes.json().id;

    // Deactivate
    await ts.server.inject({
      method: 'DELETE',
      url: `/recurly/accounts/${accountId}`,
    });

    // Reactivate
    const res = await ts.server.inject({
      method: 'PUT',
      url: `/recurly/accounts/${accountId}/reactivate`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('active');
  });

  // ── Plans CRUD ─────────────────────────────────────────────────────────

  it('should create a plan', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: '/recurly/plans',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'basic-monthly', name: 'Basic Monthly', interval_unit: 'months', interval_length: 1 }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toMatch(/^plan_/);
    expect(body.name).toBe('Basic Monthly');
  });

  it('should list plans', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/recurly/plans',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
  });

  // ── Subscriptions ─────────────────────────────────────────────────────

  it('should create a subscription', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: '/recurly/subscriptions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ plan_code: 'basic-monthly', currency: 'USD' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toMatch(/^sub_/);
    expect(body.state).toBe('active');
  });

  it('should list subscriptions', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/recurly/subscriptions',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
  });

  it('should cancel a subscription', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/recurly/subscriptions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ plan_code: 'cancel-test' }),
    });
    const subId = createRes.json().id;

    const res = await ts.server.inject({
      method: 'PUT',
      url: `/recurly/subscriptions/${subId}/cancel`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('canceled');
  });

  it('should reactivate a canceled subscription', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/recurly/subscriptions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ plan_code: 'reactivate-test' }),
    });
    const subId = createRes.json().id;

    // Cancel
    await ts.server.inject({
      method: 'PUT',
      url: `/recurly/subscriptions/${subId}/cancel`,
    });

    // Reactivate
    const res = await ts.server.inject({
      method: 'PUT',
      url: `/recurly/subscriptions/${subId}/reactivate`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('active');
  });

  it('should pause and resume a subscription', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/recurly/subscriptions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ plan_code: 'pause-test' }),
    });
    const subId = createRes.json().id;

    // Pause
    const pauseRes = await ts.server.inject({
      method: 'PUT',
      url: `/recurly/subscriptions/${subId}/pause`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ remaining_pause_cycles: 2 }),
    });
    expect(pauseRes.statusCode).toBe(200);
    expect(pauseRes.json().state).toBe('paused');

    // Resume
    const resumeRes = await ts.server.inject({
      method: 'PUT',
      url: `/recurly/subscriptions/${subId}/resume`,
    });
    expect(resumeRes.statusCode).toBe(200);
    expect(resumeRes.json().state).toBe('active');
  });

  it('should terminate a subscription', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/recurly/subscriptions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ plan_code: 'terminate-test' }),
    });
    const subId = createRes.json().id;

    const res = await ts.server.inject({
      method: 'DELETE',
      url: `/recurly/subscriptions/${subId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('expired');
  });

  // ── Invoices ──────────────────────────────────────────────────────────

  it('should list invoices', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/recurly/invoices',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().object).toBe('list');
  });

  it('should collect an invoice', async () => {
    // Create an invoice via the account sub-resource
    const acctRes = await ts.server.inject({
      method: 'POST',
      url: '/recurly/accounts',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'inv-test-acct' }),
    });
    const accountId = acctRes.json().id;

    const invRes = await ts.server.inject({
      method: 'POST',
      url: `/recurly/accounts/${accountId}/invoices`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ currency: 'USD' }),
    });
    expect(invRes.statusCode).toBe(200);
    const invoiceId = invRes.json().id;

    // Collect it
    const collectRes = await ts.server.inject({
      method: 'PUT',
      url: `/recurly/invoices/${invoiceId}/collect`,
    });
    expect(collectRes.statusCode).toBe(200);
    expect(collectRes.json().state).toBe('paid');
  });

  it('should void an invoice', async () => {
    const acctRes = await ts.server.inject({
      method: 'POST',
      url: '/recurly/accounts',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'void-inv-acct' }),
    });
    const accountId = acctRes.json().id;

    const invRes = await ts.server.inject({
      method: 'POST',
      url: `/recurly/accounts/${accountId}/invoices`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ currency: 'USD' }),
    });
    const invoiceId = invRes.json().id;

    const voidRes = await ts.server.inject({
      method: 'PUT',
      url: `/recurly/invoices/${invoiceId}/void`,
    });
    expect(voidRes.statusCode).toBe(200);
    expect(voidRes.json().state).toBe('voided');
  });

  // ── Coupons ───────────────────────────────────────────────────────────

  it('should create and list coupons', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/recurly/coupons',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'SUMMER20', name: 'Summer 20% Off', discount_type: 'percent', discount_percent: 20 }),
    });
    expect(createRes.statusCode).toBe(200);
    expect(createRes.json().id).toMatch(/^cpn_/);

    const listRes = await ts.server.inject({
      method: 'GET',
      url: '/recurly/coupons',
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.length).toBeGreaterThan(0);
  });

  // ── Items ─────────────────────────────────────────────────────────────

  it('should create and list items', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/recurly/items',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'widget-001', name: 'Widget' }),
    });
    expect(createRes.statusCode).toBe(200);
    expect(createRes.json().id).toMatch(/^item_/);

    const listRes = await ts.server.inject({
      method: 'GET',
      url: '/recurly/items',
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.length).toBeGreaterThan(0);
  });

  // ── Add-ons ───────────────────────────────────────────────────────────

  it('should list add-ons', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/recurly/add_ons',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().object).toBe('list');
  });

  // ── Transactions ──────────────────────────────────────────────────────

  it('should list transactions', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/recurly/transactions',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().object).toBe('list');
  });

  // ── Seeding ───────────────────────────────────────────────────────────

  it('should serve pre-seeded data', async () => {
    const seedData = new Map([['persona-1', {
      personaId: 'persona-1',
      blueprint: {} as any,
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
                body: { id: 'acct_seed1', object: 'account', email: 'seeded@test.com', state: 'active' },
                personaId: 'persona-1',
                stateKey: 'recurly_accounts',
              },
            ],
          },
        },
      },
      files: [],
      events: [],
      facts: [],
    }]]);

    const seededAdapter = new RecurlyAdapter();
    const seededTs = await buildTestServer(seededAdapter, seedData);
    const res = await seededTs.server.inject({ method: 'GET', url: '/recurly/accounts' });
    expect(res.json().data).toContainEqual(expect.objectContaining({ id: 'acct_seed1' }));
    await seededTs.close();
  });
});
