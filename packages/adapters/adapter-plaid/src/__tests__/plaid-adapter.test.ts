import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer } from '@mimicai/adapter-sdk';
import type { TestServer } from '@mimicai/adapter-sdk';
import { PlaidAdapter } from '../plaid-adapter.js';

describe('PlaidAdapter', () => {
  let ts: TestServer;
  let adapter: PlaidAdapter;

  beforeAll(async () => {
    adapter = new PlaidAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('plaid');
      expect(adapter.name).toBe('Plaid API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/plaid');
    });

    it('should have versions', () => {
      expect(adapter.versions).toContain('2020-09-14');
    });
  });

  // ── Endpoints ─────────────────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBeGreaterThan(100);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
      }
    });
  });

  // ── Full Lifecycle ────────────────────────────────────────────────────────

  describe('sandbox → item → accounts → transactions flow', () => {
    let publicToken: string;
    let accessToken: string;
    let itemId: string;

    it('should create a sandbox public token', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/sandbox/public_token/create',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          institution_id: 'ins_109508',
          initial_products: ['transactions', 'auth'],
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.public_token).toMatch(/^public-sandbox-/);
      expect(body.request_id).toBeDefined();
      publicToken = body.public_token;
    });

    it('should exchange public token for access token', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/item/public_token/exchange',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ public_token: publicToken }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.access_token).toMatch(/^access-sandbox-/);
      expect(body.item_id).toBeDefined();
      expect(body.request_id).toBeDefined();
      accessToken = body.access_token;
      itemId = body.item_id;
    });

    it('should get item details', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/item/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ access_token: accessToken }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.item.item_id).toBe(itemId);
      expect(body.item.institution_id).toBe('ins_109508');
      expect(body.item.error).toBeNull();
      expect(body.request_id).toBeDefined();
    });

    it('should get accounts', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/accounts/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ access_token: accessToken }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accounts.length).toBe(3); // checking, savings, credit
      expect(body.item.item_id).toBe(itemId);

      // Verify account types
      const types = body.accounts.map((a: Record<string, unknown>) => a.type).sort();
      expect(types).toEqual(['credit', 'depository', 'depository']);

      // Verify balances
      const checking = body.accounts.find((a: Record<string, unknown>) => a.subtype === 'checking');
      expect(checking).toBeDefined();
      expect(checking.balances.available).toBe(100);
      expect(checking.balances.current).toBe(110);
    });

    it('should get account balances', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/accounts/balance/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ access_token: accessToken }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accounts.length).toBe(3);
    });

    it('should filter accounts by account_ids', async () => {
      // First get all accounts to get an ID
      const allRes = await ts.server.inject({
        method: 'POST',
        url: '/plaid/accounts/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ access_token: accessToken }),
      });
      const firstAccountId = allRes.json().accounts[0].account_id;

      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/accounts/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          access_token: accessToken,
          options: { account_ids: [firstAccountId] },
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().accounts.length).toBe(1);
      expect(res.json().accounts[0].account_id).toBe(firstAccountId);
    });

    it('should get auth data with routing numbers', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/auth/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ access_token: accessToken }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accounts.length).toBe(3);
      expect(body.numbers.ach.length).toBe(2); // 2 depository accounts
      expect(body.numbers.ach[0].routing).toBeDefined();
      expect(body.numbers.ach[0].account).toBeDefined();
    });

    it('should get transactions', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/transactions/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          access_token: accessToken,
          start_date: '2020-01-01',
          end_date: '2099-12-31',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.transactions.length).toBeGreaterThan(0);
      expect(body.total_transactions).toBeGreaterThan(0);
      expect(body.item.item_id).toBe(itemId);

      // Verify transaction shape
      const txn = body.transactions[0];
      expect(txn.transaction_id).toBeDefined();
      expect(txn.account_id).toBeDefined();
      expect(txn.amount).toBeDefined();
      expect(txn.date).toBeDefined();
      expect(txn.name).toBeDefined();
    });

    it('should paginate transactions', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/transactions/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          access_token: accessToken,
          start_date: '2020-01-01',
          end_date: '2099-12-31',
          options: { count: 3, offset: 0 },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.transactions.length).toBe(3);
      expect(body.total_transactions).toBeGreaterThan(3);
    });

    it('should sync transactions', async () => {
      // Initial sync (no cursor) — returns all transactions
      const res1 = await ts.server.inject({
        method: 'POST',
        url: '/plaid/transactions/sync',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ access_token: accessToken }),
      });
      expect(res1.statusCode).toBe(200);
      const body1 = res1.json();
      expect(body1.added.length).toBeGreaterThan(0);
      expect(body1.next_cursor).toBeDefined();
      expect(body1.has_more).toBe(false);

      // Subsequent sync (with cursor) — returns empty (caught up)
      const res2 = await ts.server.inject({
        method: 'POST',
        url: '/plaid/transactions/sync',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          access_token: accessToken,
          cursor: body1.next_cursor,
        }),
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().added.length).toBe(0);
    });

    it('should refresh transactions', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/transactions/refresh',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ access_token: accessToken }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().request_id).toBeDefined();
    });

    it('should get identity data', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/identity/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ access_token: accessToken }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accounts.length).toBe(3);
      expect(body.accounts[0].owners).toBeDefined();
      expect(body.accounts[0].owners[0].names.length).toBeGreaterThan(0);
      expect(body.accounts[0].owners[0].emails.length).toBeGreaterThan(0);
    });

    it('should remove an item', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/item/remove',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ access_token: accessToken }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().removed).toBe(true);

      // Subsequent calls should fail
      const res2 = await ts.server.inject({
        method: 'POST',
        url: '/plaid/item/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ access_token: accessToken }),
      });
      expect(res2.statusCode).toBe(400);
      expect(res2.json().error_code).toBe('INVALID_ACCESS_TOKEN');
    });
  });

  // ── Institutions ──────────────────────────────────────────────────────────

  describe('institutions', () => {
    it('should list institutions', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/institutions/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ count: 10, offset: 0, country_codes: ['US'] }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.institutions.length).toBeGreaterThan(0);
      expect(body.total).toBeGreaterThan(0);
    });

    it('should get institution by ID', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/institutions/get_by_id',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ institution_id: 'ins_109508', country_codes: ['US'] }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.institution.institution_id).toBe('ins_109508');
      expect(body.institution.name).toBe('First Platypus Bank');
    });

    it('should search institutions', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/institutions/search',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ query: 'platypus', products: ['transactions'], country_codes: ['US'] }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.institutions.length).toBe(1);
      expect(body.institutions[0].name).toContain('Platypus');
    });
  });

  // ── Categories ────────────────────────────────────────────────────────────

  describe('categories', () => {
    it('should get categories', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/categories/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.categories.length).toBeGreaterThan(0);
      expect(body.categories[0].category_id).toBeDefined();
      expect(body.categories[0].hierarchy).toBeDefined();
    });
  });

  // ── Error Handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should return error for missing access_token', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/accounts/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error_type).toBe('INVALID_REQUEST');
      expect(body.error_code).toBe('MISSING_FIELDS');
    });

    it('should return error for invalid access_token', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/accounts/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ access_token: 'invalid-token-12345' }),
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error_type).toBe('ITEM_ERROR');
      expect(body.error_code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('should return error for missing public_token on exchange', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/item/public_token/exchange',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error_code).toBe('MISSING_FIELDS');
    });

    it('should return error for invalid institution_id', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/institutions/get_by_id',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ institution_id: 'ins_nonexistent' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error_type).toBe('INVALID_REQUEST');
    });
  });

  // ── Sandbox Helpers ───────────────────────────────────────────────────────

  describe('sandbox', () => {
    it('should reset item login', async () => {
      // Create a new item first
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/plaid/sandbox/public_token/create',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ institution_id: 'ins_109509', initial_products: ['transactions'] }),
      });
      const pt = createRes.json().public_token;

      const exchangeRes = await ts.server.inject({
        method: 'POST',
        url: '/plaid/item/public_token/exchange',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ public_token: pt }),
      });
      const at = exchangeRes.json().access_token;

      // Reset login
      const resetRes = await ts.server.inject({
        method: 'POST',
        url: '/plaid/sandbox/item/reset_login',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ access_token: at }),
      });
      expect(resetRes.statusCode).toBe(200);
      expect(resetRes.json().reset_login).toBe(true);

      // Verify item now has error
      const itemRes = await ts.server.inject({
        method: 'POST',
        url: '/plaid/item/get',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ access_token: at }),
      });
      expect(itemRes.json().item.error).toBeDefined();
      expect(itemRes.json().item.error.error_code).toBe('ITEM_LOGIN_REQUIRED');
    });
  });

  // ── Link Token ────────────────────────────────────────────────────────────

  describe('link token', () => {
    it('should create a link token', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/plaid/link/token/create',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          user: { client_user_id: 'user-123' },
          client_name: 'Test App',
          products: ['transactions'],
          country_codes: ['US'],
          language: 'en',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.link_token).toMatch(/^link-sandbox-/);
      expect(body.expiration).toBeDefined();
      expect(body.request_id).toBeDefined();
    });
  });
});
