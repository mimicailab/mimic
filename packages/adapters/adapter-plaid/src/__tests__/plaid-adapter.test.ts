import { describe, it, expect, afterEach } from 'vitest';
import type { ExpandedData } from '@mimicailab/adapter-sdk';
import { buildTestServer, type TestServer } from '@mimicailab/adapter-sdk';
import { PlaidAdapter } from '../plaid-adapter.js';

function apiResponse(body: Record<string, unknown>) {
  return { statusCode: 200, headers: {}, body, personaId: 'test-user', stateKey: 'plaid' };
}

const seedData = new Map<string, ExpandedData>();
seedData.set('test-user', {
  personaId: 'test-user',
  blueprint: { persona: { name: 'Test User', location: 'Austin, TX' } } as any,
  tables: {},
  documents: {},
  apiResponses: {
    plaid: {
      adapterId: 'plaid',
      responses: {
        accounts: [
          apiResponse({ id: 1, institution: 'Chase', type: 'checking', balance: 5000 }),
          apiResponse({ id: 2, institution: 'Chase', type: 'savings', balance: 15000 }),
        ],
        transactions: [
          apiResponse({ id: 1, account_id: 1, amount: -42.50, date: '2025-01-15', merchant: 'Starbucks', category: 'Food and Drink', pending: false }),
          apiResponse({ id: 2, account_id: 1, amount: -120.00, date: '2025-01-20', merchant: 'Amazon', category: 'Shopping', pending: false }),
          apiResponse({ id: 3, account_id: 2, amount: 3000, date: '2025-02-01', merchant: 'Direct Deposit', category: 'Income', pending: false }),
        ],
      },
    },
  },
  files: [],
  events: [],
});

describe('PlaidAdapter', () => {
  let ts: TestServer | undefined;
  const adapter = new PlaidAdapter();

  afterEach(async () => {
    if (ts) await ts.close();
    ts = undefined;
  });

  async function setup() {
    await adapter.init({} as any, { config: {} as any, blueprints: new Map(), logger: console });
    ts = await buildTestServer(adapter, seedData);
    return ts;
  }

  // ── 1. Adapter metadata ───────────────────────────────────────────
  it('should have correct adapter metadata', () => {
    expect(adapter.id).toBe('plaid');
    expect(adapter.name).toBe('Plaid API');
    expect(adapter.type).toBe('api-mock');
    expect(adapter.basePath).toBe('/plaid');
    expect(adapter.versions).toEqual(['2020-09-14']);
  });

  // ── 2. Link token creation ────────────────────────────────────────
  it('should create a link token', async () => {
    const { server } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/plaid/link/token/create',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ client_id: 'test', secret: 'test' }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.link_token).toBeDefined();
    expect(body.link_token).toMatch(/^link-sandbox_/);
    expect(body.expiration).toBeDefined();
    expect(body.request_id).toBeDefined();
  });

  // ── 3. Token exchange ─────────────────────────────────────────────
  it('should exchange a public token for an access token', async () => {
    const { server } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/plaid/item/public_token/exchange',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ public_token: 'public-sandbox-test-user-abc123' }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toBeDefined();
    expect(body.access_token).toMatch(/^access-test-user-/);
    expect(body.item_id).toBeDefined();
    expect(body.request_id).toBeDefined();
  });

  // ── 4. Get accounts with valid access token ───────────────────────
  it('should get accounts with valid access token', async () => {
    const { server } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/plaid/accounts/get',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ access_token: 'access-test-user-tok_abc123' }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts[0]).toHaveProperty('account_id');
    expect(body.accounts[0]).toHaveProperty('balances');
    expect(body.accounts[0]).toHaveProperty('mask');
    expect(body.accounts[0]).toHaveProperty('name');
    expect(body.accounts[0]).toHaveProperty('subtype');
    expect(body.accounts[0]).toHaveProperty('type');
    expect(body.item).toBeDefined();
    expect(body.request_id).toBeDefined();
  });

  // ── 5. Get accounts with invalid token ────────────────────────────
  it('should return error for invalid access token', async () => {
    const { server } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/plaid/accounts/get',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ access_token: 'invalid-token' }),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error_code).toBe('INVALID_ACCESS_TOKEN');
    expect(body.error_type).toBe('INVALID_REQUEST');
  });

  // ── 6. Get transactions with date range ───────────────────────────
  it('should get transactions filtered by date range', async () => {
    const { server } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/plaid/transactions/get',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        access_token: 'access-test-user-tok_abc123',
        start_date: '2025-01-01',
        end_date: '2025-01-31',
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.transactions).toHaveLength(2);
    expect(body.total_transactions).toBe(2);
    expect(body.accounts).toBeDefined();
    expect(body.request_id).toBeDefined();
    expect(body.transactions[0]).toHaveProperty('transaction_id');
    expect(body.transactions[0]).toHaveProperty('amount');
    expect(body.transactions[0]).toHaveProperty('merchant_name');
  });

  // ── 7. Transactions sync returns all as added ─────────────────────
  it('should return all transactions as added via sync', async () => {
    const { server } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/plaid/transactions/sync',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ access_token: 'access-test-user-tok_abc123' }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toHaveLength(3);
    expect(body.modified).toEqual([]);
    expect(body.removed).toEqual([]);
    expect(body.next_cursor).toBeDefined();
    expect(body.has_more).toBe(false);
  });

  // ── 8. Auth returns routing numbers ───────────────────────────────
  it('should return accounts with routing numbers via auth', async () => {
    const { server } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/plaid/auth/get',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ access_token: 'access-test-user-tok_abc123' }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accounts).toHaveLength(2);
    expect(body.numbers).toBeDefined();
    expect(body.numbers.ach).toHaveLength(2);
    expect(body.numbers.ach[0]).toHaveProperty('routing');
    expect(body.numbers.ach[0]).toHaveProperty('wire_routing');
    expect(body.numbers.ach[0]).toHaveProperty('account_id');
  });

  // ── 9. Identity returns owner info ────────────────────────────────
  it('should return accounts with owner identity', async () => {
    const { server } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/plaid/identity/get',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ access_token: 'access-test-user-tok_abc123' }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts[0].owners).toBeDefined();
    expect(body.accounts[0].owners[0].names).toContain('Test User');
    expect(body.accounts[0].owners[0].emails).toHaveLength(1);
    expect(body.accounts[0].owners[0].phone_numbers).toHaveLength(1);
    expect(body.accounts[0].owners[0].addresses).toHaveLength(1);
    expect(body.accounts[0].owners[0].addresses[0].data.city).toBe('Austin');
    expect(body.accounts[0].owners[0].addresses[0].data.region).toBe('TX');
  });

  // ── 10. Balance returns real-time balances ────────────────────────
  it('should return real-time balances', async () => {
    const { server } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/plaid/accounts/balance/get',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ access_token: 'access-test-user-tok_abc123' }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts[0].balances).toBeDefined();
    expect(body.accounts[0].balances.available).toBe(5000);
    expect(body.accounts[1].balances.available).toBe(15000);
  });

  // ── 11. Investments returns empty holdings ────────────────────────
  it('should return empty investment holdings', async () => {
    const { server } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/plaid/investments/holdings/get',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ access_token: 'access-test-user-tok_abc123' }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.holdings).toEqual([]);
    expect(body.securities).toEqual([]);
    expect(body.accounts).toHaveLength(2);
  });

  // ── 12. Liabilities returns empty data ────────────────────────────
  it('should return empty liabilities', async () => {
    const { server } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/plaid/liabilities/get',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ access_token: 'access-test-user-tok_abc123' }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.liabilities).toBeDefined();
    expect(body.liabilities.credit).toEqual([]);
    expect(body.liabilities.mortgage).toEqual([]);
    expect(body.liabilities.student).toEqual([]);
    expect(body.accounts).toHaveLength(2);
  });

  // ── 13. PFCv2 confidence_level present ────────────────────────────
  it('should include confidence_level in PFCv2 transaction format', async () => {
    const { server } = await setup();
    const res = await server.inject({
      method: 'POST',
      url: '/plaid/transactions/get',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        access_token: 'access-test-user-tok_abc123',
        start_date: '2025-01-01',
        end_date: '2025-12-31',
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.transactions.length).toBeGreaterThan(0);

    for (const tx of body.transactions) {
      expect(tx.personal_finance_category).toBeDefined();
      expect(tx.personal_finance_category.confidence_level).toBeDefined();
      expect(['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW']).toContain(
        tx.personal_finance_category.confidence_level,
      );
    }
  });
});
