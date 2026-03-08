import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData } from '@mimicai/core';
import { DwollaAdapter } from '../dwolla-adapter.js';

describe('DwollaAdapter', () => {
  let ts: TestServer;
  let adapter: DwollaAdapter;
  let authToken: string;

  beforeAll(async () => {
    adapter = new DwollaAdapter();
    ts = await buildTestServer(adapter);

    // Get an auth token for subsequent requests
    const tokenRes = await ts.server.inject({
      method: 'POST',
      url: '/dwolla/token',
      headers: { authorization: 'Basic dGVzdDp0ZXN0' },
    });
    authToken = tokenRes.json().access_token;
  });

  afterAll(async () => {
    await ts.close();
  });

  function authHeaders(extra?: Record<string, string>) {
    return { authorization: `Bearer ${authToken}`, 'content-type': 'application/json', ...extra };
  }

  // ── 1. Adapter metadata ────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('dwolla');
      expect(adapter.name).toBe('Dwolla API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/dwolla');
    });
  });

  // ── 2. Endpoints count ───────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return 27 endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(27);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. OAuth Token ───────────────────────────────────────────────────

  describe('OAuth', () => {
    it('should return an access token with Basic auth', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/token',
        headers: { authorization: 'Basic dGVzdDp0ZXN0' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe('bearer');
      expect(body.expires_in).toBe(3600);
    });

    it('should reject token request without Basic auth', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/token',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('InvalidCredentials');
    });

    it('should reject requests without Bearer token', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dwolla/customers',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('InvalidAccessToken');
    });

    it('should reject requests with invalid Bearer token', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dwolla/customers',
        headers: { authorization: 'Bearer invalid-token' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── 4. Customers ─────────────────────────────────────────────────────

  describe('Customers', () => {
    let customerId: string;

    it('should create a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/customers',
        headers: authHeaders(),
        payload: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.firstName).toBe('Jane');
      expect(body.lastName).toBe('Doe');
      expect(body.status).toBe('unverified');
      expect(body._links.self).toBeDefined();
      customerId = body.id;
    });

    it('should create a verified customer with SSN', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/customers',
        headers: authHeaders(),
        payload: JSON.stringify({
          firstName: 'John',
          lastName: 'Smith',
          email: 'john@example.com',
          ssn: '1234',
          dateOfBirth: '1990-01-01',
        }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().status).toBe('verified');
    });

    it('should reject customer creation without required fields', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/customers',
        headers: authHeaders(),
        payload: JSON.stringify({ firstName: 'Only' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('ValidationError');
    });

    it('should list customers', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dwolla/customers',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body._embedded.customers).toBeInstanceOf(Array);
      expect(body._embedded.customers.length).toBeGreaterThanOrEqual(1);
    });

    it('should search customers', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dwolla/customers?search=jane',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()._embedded.customers.length).toBeGreaterThanOrEqual(1);
    });

    it('should get a customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/dwolla/customers/${customerId}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(customerId);
    });

    it('should update a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/dwolla/customers/${customerId}`,
        headers: authHeaders(),
        payload: JSON.stringify({ firstName: 'Janet' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().firstName).toBe('Janet');
    });

    it('should return 404 for unknown customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dwolla/customers/nonexistent-id',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NotFound');
    });
  });

  // ── 5. Funding Sources ───────────────────────────────────────────────

  describe('Funding Sources', () => {
    let customerId: string;
    let fsId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/customers',
        headers: authHeaders(),
        payload: JSON.stringify({
          firstName: 'Fund',
          lastName: 'Test',
          email: 'fund@example.com',
        }),
      });
      customerId = res.json().id;
    });

    it('should create a funding source', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/dwolla/customers/${customerId}/funding-sources`,
        headers: authHeaders(),
        payload: JSON.stringify({
          routingNumber: '222222226',
          accountNumber: '123456789',
          bankAccountType: 'checking',
          name: 'My Checking',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe('unverified');
      expect(body.name).toBe('My Checking');
      expect(body.bankAccountType).toBe('checking');
      fsId = body.id;
    });

    it('should reject funding source without required fields', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/dwolla/customers/${customerId}/funding-sources`,
        headers: authHeaders(),
        payload: JSON.stringify({ name: 'Incomplete' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('should list customer funding sources', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/dwolla/customers/${customerId}/funding-sources`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()._embedded['funding-sources'].length).toBeGreaterThanOrEqual(1);
    });

    it('should get a funding source', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/dwolla/funding-sources/${fsId}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(fsId);
    });

    it('should update a funding source', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/dwolla/funding-sources/${fsId}`,
        headers: authHeaders(),
        payload: JSON.stringify({ name: 'Renamed Checking' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Renamed Checking');
    });

    it('should get funding source balance', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/dwolla/funding-sources/${fsId}/balance`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().balance.value).toBe('5000.00');
    });

    it('should initiate micro-deposits', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/dwolla/funding-sources/${fsId}/micro-deposits`,
        headers: authHeaders(),
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(201);
    });

    it('should verify micro-deposits with correct amounts', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/dwolla/funding-sources/${fsId}/micro-deposits`,
        headers: authHeaders(),
        payload: JSON.stringify({
          amount1: { value: '0.03', currency: 'USD' },
          amount2: { value: '0.09', currency: 'USD' },
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('verified');
    });

    it('should reject incorrect micro-deposit amounts', async () => {
      // Create a new funding source for this test
      const createRes = await ts.server.inject({
        method: 'POST',
        url: `/dwolla/customers/${customerId}/funding-sources`,
        headers: authHeaders(),
        payload: JSON.stringify({
          routingNumber: '222222226',
          accountNumber: '987654321',
          bankAccountType: 'savings',
          name: 'My Savings',
        }),
      });
      const newFsId = createRes.json().id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/dwolla/funding-sources/${newFsId}/micro-deposits`,
        headers: authHeaders(),
        payload: JSON.stringify({
          amount1: { value: '0.01', currency: 'USD' },
          amount2: { value: '0.02', currency: 'USD' },
        }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('InvalidAmount');
    });

    it('should remove a funding source', async () => {
      // Create one to remove
      const createRes = await ts.server.inject({
        method: 'POST',
        url: `/dwolla/customers/${customerId}/funding-sources`,
        headers: authHeaders(),
        payload: JSON.stringify({
          routingNumber: '222222226',
          accountNumber: '111222333',
          bankAccountType: 'checking',
          name: 'To Remove',
        }),
      });
      const removeId = createRes.json().id;

      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/dwolla/funding-sources/${removeId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().removed).toBe(true);

      // Verify it's gone
      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/dwolla/funding-sources/${removeId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });
      expect(getRes.statusCode).toBe(404);
    });
  });

  // ── 6. Transfers ─────────────────────────────────────────────────────

  describe('Transfers', () => {
    let transferId: string;

    it('should create a transfer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/transfers',
        headers: authHeaders(),
        payload: JSON.stringify({
          _links: {
            source: { href: 'https://api-sandbox.dwolla.com/funding-sources/src-id' },
            destination: { href: 'https://api-sandbox.dwolla.com/funding-sources/dst-id' },
          },
          amount: { value: '50.00', currency: 'USD' },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe('pending');
      expect(body.amount.value).toBe('50.00');
      transferId = body.id;
    });

    it('should reject transfer without required fields', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/transfers',
        headers: authHeaders(),
        payload: JSON.stringify({ amount: { value: '10.00' } }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('should get a transfer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/dwolla/transfers/${transferId}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(transferId);
    });

    it('should cancel a pending transfer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/dwolla/transfers/${transferId}`,
        headers: authHeaders(),
        payload: JSON.stringify({ status: 'cancelled' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('cancelled');
    });

    it('should not cancel an already cancelled transfer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/dwolla/transfers/${transferId}`,
        headers: authHeaders(),
        payload: JSON.stringify({ status: 'cancelled' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('InvalidResourceState');
    });

    it('should list transfer fees', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/dwolla/transfers/${transferId}/fees`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()._embedded.fees).toBeInstanceOf(Array);
    });

    it('should return 404 for failure of non-failed transfer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/dwolla/transfers/${transferId}/failure`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    });

    it('should return 404 for unknown transfer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dwolla/transfers/nonexistent-id',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 7. Mass Payments ─────────────────────────────────────────────────

  describe('Mass Payments', () => {
    let mpId: string;

    it('should create a mass payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/mass-payments',
        headers: authHeaders(),
        payload: JSON.stringify({
          _links: { source: { href: 'https://api-sandbox.dwolla.com/funding-sources/src-id' } },
          items: [
            { _links: { destination: { href: 'https://api-sandbox.dwolla.com/funding-sources/dst1' } }, amount: { value: '25.00', currency: 'USD' } },
            { _links: { destination: { href: 'https://api-sandbox.dwolla.com/funding-sources/dst2' } }, amount: { value: '50.00', currency: 'USD' } },
          ],
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe('pending');
      expect(body.total.value).toBe('75.00');
      mpId = body.id;
    });

    it('should create a deferred mass payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/mass-payments',
        headers: authHeaders(),
        payload: JSON.stringify({
          _links: { source: { href: 'https://api-sandbox.dwolla.com/funding-sources/src-id' } },
          items: [
            { _links: { destination: { href: 'https://api-sandbox.dwolla.com/funding-sources/dst1' } }, amount: { value: '10.00', currency: 'USD' } },
          ],
          status: 'deferred',
        }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().status).toBe('deferred');
    });

    it('should reject mass payment without required fields', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/mass-payments',
        headers: authHeaders(),
        payload: JSON.stringify({ items: 'not-array' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('should get a mass payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/dwolla/mass-payments/${mpId}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(mpId);
    });

    it('should list mass payment items', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/dwolla/mass-payments/${mpId}/items`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()._embedded.items.length).toBe(2);
      expect(res.json().total).toBe(2);
    });

    it('should update deferred mass payment to pending', async () => {
      // Create deferred
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/mass-payments',
        headers: authHeaders(),
        payload: JSON.stringify({
          _links: { source: { href: 'https://api-sandbox.dwolla.com/funding-sources/src-id' } },
          items: [{ _links: { destination: { href: 'https://api-sandbox.dwolla.com/funding-sources/dst1' } }, amount: { value: '5.00', currency: 'USD' } }],
          status: 'deferred',
        }),
      });
      const deferredId = createRes.json().id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/dwolla/mass-payments/${deferredId}`,
        headers: authHeaders(),
        payload: JSON.stringify({ status: 'pending' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('pending');
    });

    it('should reject invalid mass payment state transition', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/dwolla/mass-payments/${mpId}`,
        headers: authHeaders(),
        payload: JSON.stringify({ status: 'complete' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('InvalidResourceState');
    });

    it('should return 404 for unknown mass payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dwolla/mass-payments/nonexistent-id',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 8. Events ────────────────────────────────────────────────────────

  describe('Events', () => {
    it('should list events', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dwolla/events',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body._embedded.events).toBeInstanceOf(Array);
      // There should be events from previous operations
      expect(body._embedded.events.length).toBeGreaterThan(0);
    });

    it('should return 404 for unknown event', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dwolla/events/nonexistent-id',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 9. Webhook Subscriptions ─────────────────────────────────────────

  describe('Webhook Subscriptions', () => {
    let subId: string;

    it('should create a webhook subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/webhook-subscriptions',
        headers: authHeaders(),
        payload: JSON.stringify({
          url: 'https://example.com/webhooks',
          secret: 'my-webhook-secret',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.url).toBe('https://example.com/webhooks');
      expect(body.paused).toBe(false);
      subId = body.id;
    });

    it('should reject webhook without url and secret', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/dwolla/webhook-subscriptions',
        headers: authHeaders(),
        payload: JSON.stringify({ url: 'https://example.com' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('should list webhook subscriptions', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/dwolla/webhook-subscriptions',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()._embedded['webhook-subscriptions'].length).toBeGreaterThanOrEqual(1);
    });

    it('should get a webhook subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/dwolla/webhook-subscriptions/${subId}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(subId);
    });

    it('should delete a webhook subscription', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/dwolla/webhook-subscriptions/${subId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });
      expect(res.statusCode).toBe(200);

      // Verify it's gone
      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/dwolla/webhook-subscriptions/${subId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('should return 404 for deleted webhook subscription', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/dwolla/webhook-subscriptions/${subId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 10. resolvePersona ───────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Bearer dwl_ prefix', () => {
      const mockReq = {
        headers: { authorization: 'Bearer dwl_young-pro_abc123xyz' },
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

  // ── 11. Cross-surface seeding ────────────────────────────────────────

  describe('cross-surface seeding', () => {
    it('should seed customers from apiResponses', async () => {
      const seededAdapter = new DwollaAdapter();
      const seedData = new Map<string, ExpandedData>([
        [
          'test-persona',
          {
            persona: 'test' as any,
            blueprint: {} as any,
            tables: {},
            facts: [],
            apiResponses: {
              dwolla: {
                responses: {
                  customers: [
                    {
                      status: 200,
                      body: {
                        id: 'SEEDED-CUSTOMER-001',
                        firstName: 'Seeded',
                        lastName: 'Customer',
                        email: 'seeded@example.com',
                        status: 'verified',
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

      // Get a token first
      const tokenRes = await seededTs.server.inject({
        method: 'POST',
        url: '/dwolla/token',
        headers: { authorization: 'Basic dGVzdDp0ZXN0' },
      });
      const seededToken = tokenRes.json().access_token;

      const res = await seededTs.server.inject({
        method: 'GET',
        url: '/dwolla/customers/SEEDED-CUSTOMER-001',
        headers: { authorization: `Bearer ${seededToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe('SEEDED-CUSTOMER-001');
      expect(res.json().firstName).toBe('Seeded');

      await seededTs.close();
    });
  });
});
