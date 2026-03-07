import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData, Blueprint } from '@mimicai/core';
import { RevenueCatAdapter } from '../revenuecat-adapter.js';

const BP = '/revenuecat/v2';
const PROJECT = 'proj_test';

describe('RevenueCatAdapter', () => {
  let ts: TestServer;
  let adapter: RevenueCatAdapter;

  beforeAll(async () => {
    adapter = new RevenueCatAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ─────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('revenuecat');
      expect(adapter.name).toBe('RevenueCat API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/revenuecat/v2');
    });
  });

  // ── 2. Endpoints count ─────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return the correct number of endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      // Count them from the actual implementation
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
      expect(endpoints.length).toBe(42);
    });
  });

  // ── 3. Projects ─────────────────────────────────────────────────────

  describe('Projects', () => {
    it('should list projects (auto-creates default)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toBeDefined();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should get a project (auto-creates on access)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects/${PROJECT}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(PROJECT);
    });
  });

  // ── 4. Offerings CRUD ──────────────────────────────────────────────

  describe('Offerings', () => {
    let offeringId: string;

    it('should create an offering', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/projects/${PROJECT}/offerings`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ display_name: 'Default Offering', is_current: true }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toMatch(/^ofr_/);
      expect(res.json().display_name).toBe('Default Offering');
      expect(res.json().is_current).toBe(true);
      offeringId = res.json().id;
    });

    it('should list offerings', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects/${PROJECT}/offerings`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBeGreaterThanOrEqual(1);
    });

    it('should get an offering', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects/${PROJECT}/offerings/${offeringId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(offeringId);
    });

    it('should update an offering', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `${BP}/projects/${PROJECT}/offerings/${offeringId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ display_name: 'Premium Offering' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().display_name).toBe('Premium Offering');
    });

    it('should delete an offering', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/projects/${PROJECT}/offerings/${offeringId}`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 5. Products CRUD ───────────────────────────────────────────────

  describe('Products', () => {
    let productId: string;

    it('should create a product', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/projects/${PROJECT}/products`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ display_name: 'Pro Monthly', type: 'subscription', store_identifier: 'com.app.pro_monthly' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toMatch(/^prod_/);
      expect(res.json().type).toBe('subscription');
      productId = res.json().id;
    });

    it('should list products', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects/${PROJECT}/products`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a product', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `${BP}/projects/${PROJECT}/products/${productId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ display_name: 'Pro Monthly v2' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().display_name).toBe('Pro Monthly v2');
    });

    it('should delete a product', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/projects/${PROJECT}/products/${productId}`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 6. Entitlements CRUD ────────────────────────────────────────────

  describe('Entitlements', () => {
    let entitlementId: string;

    it('should create an entitlement', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/entitlements`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ display_name: 'Premium Access', lookup_key: 'premium' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toMatch(/^entl_/);
      expect(res.json().display_name).toBe('Premium Access');
      entitlementId = res.json().id;
    });

    it('should list entitlements', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/entitlements`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBeGreaterThanOrEqual(1);
    });

    it('should get an entitlement', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/entitlements/${entitlementId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().lookup_key).toBe('premium');
    });

    it('should update an entitlement', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `${BP}/entitlements/${entitlementId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ display_name: 'Premium+ Access' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().display_name).toBe('Premium+ Access');
    });

    it('should delete an entitlement', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/entitlements/${entitlementId}`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 7. Packages CRUD ───────────────────────────────────────────────

  describe('Packages', () => {
    let packageId: string;

    it('should create a package', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/packages`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ display_name: 'Monthly', lookup_key: '$rc_monthly', position: 1 }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toMatch(/^pkg_/);
      packageId = res.json().id;
    });

    it('should list packages', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/packages`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a package', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/packages/${packageId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ display_name: 'Monthly v2' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().display_name).toBe('Monthly v2');
    });

    it('should delete a package', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/packages/${packageId}`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 8. Price Experiments CRUD ───────────────────────────────────────

  describe('Price Experiments', () => {
    let experimentId: string;

    it('should create a price experiment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/price-experiments`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ display_name: 'Price Test A', treatment_percentage: 50 }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toMatch(/^exp_/);
      expect(res.json().status).toBe('draft');
      experimentId = res.json().id;
    });

    it('should list price experiments', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/price-experiments`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a price experiment', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${BP}/price-experiments/${experimentId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ display_name: 'Price Test B', treatment_percentage: 30 }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().display_name).toBe('Price Test B');
    });

    it('should delete a price experiment', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/price-experiments/${experimentId}`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 9. Customers ────────────────────────────────────────────────────

  describe('Customers', () => {
    const customerId = 'user_alice_123';

    it('should get a customer (auto-creates)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects/${PROJECT}/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(customerId);
      expect(res.json().project_id).toBe(PROJECT);
    });

    it('should get active entitlements', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects/${PROJECT}/customers/${customerId}/active_entitlements`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });

    it('should list customer aliases', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects/${PROJECT}/customers/${customerId}/aliases`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });

    it('should set customer attributes', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/projects/${PROJECT}/customers/${customerId}/attributes`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ attributes: { $displayName: 'Alice', tier: 'gold' } }),
      });
      expect(res.statusCode).toBe(200);

      // Verify attributes persisted
      const get = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects/${PROJECT}/customers/${customerId}`,
      });
      expect(get.json().subscriber_attributes.$displayName).toBe('Alice');
      expect(get.json().subscriber_attributes.tier).toBe('gold');
    });

    it('should delete a customer', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${BP}/projects/${PROJECT}/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 10. Purchases ──────────────────────────────────────────────────

  describe('Purchases', () => {
    let purchaseId: string;

    it('should grant a Google purchase', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/projects/${PROJECT}/customers/user_bob/purchases/google`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ product_id: 'com.app.pro', purchase_token: 'tok_google123' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toMatch(/^purch_/);
      expect(res.json().store).toBe('play_store');
      purchaseId = res.json().id;
    });

    it('should grant a Stripe purchase', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${BP}/projects/${PROJECT}/customers/user_bob/purchases/stripe`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ stripe_checkout_session_id: 'cs_test_abc' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().store).toBe('stripe');
    });

    it('should list purchases', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects/${PROJECT}/purchases`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBeGreaterThanOrEqual(2);
    });

    it('should get a purchase', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects/${PROJECT}/purchases/${purchaseId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(purchaseId);
    });
  });

  // ── 11. Subscriptions ──────────────────────────────────────────────

  describe('Subscriptions', () => {
    it('should list subscriptions (empty)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects/${PROJECT}/subscriptions`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toBeDefined();
    });

    it('should return 404 for non-existent subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects/${PROJECT}/subscriptions/sub_doesnotexist`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 12. Error handling ──────────────────────────────────────────────

  describe('Error handling', () => {
    it('should return RevenueCat error format for non-existent offering', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${BP}/projects/${PROJECT}/offerings/ofr_doesnotexist`,
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.type).toBe('resource_not_found');
      expect(body.message).toContain('ofr_doesnotexist');
    });
  });

  // ── 13. resolvePersona ──────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Bearer token', () => {
      const mockReq = {
        headers: { authorization: 'Bearer sk_test_young-professional_abc123' },
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
      const mockReq = {
        headers: { authorization: 'Bearer sk_live_somekey' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 14. Cross-surface seeding ───────────────────────────────────────

  describe('Cross-surface seeding', () => {
    let seededTs: TestServer;

    beforeAll(async () => {
      const seededAdapter = new RevenueCatAdapter();
      const seedData = new Map<string, ExpandedData>([
        ['test-persona', {
          personaId: 'test-persona',
          blueprint: {} as Blueprint,
          tables: {},
          documents: {},
          apiResponses: {
            revenuecat: {
              adapterId: 'revenuecat',
              responses: {
                offerings: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'ofr_seeded1', project_id: 'proj_test', display_name: 'Seeded Offering', is_current: true },
                    personaId: 'test-persona',
                    stateKey: 'rc_offerings',
                  },
                ],
                products: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'prod_seeded1', project_id: 'proj_test', display_name: 'Seeded Product', type: 'subscription' },
                    personaId: 'test-persona',
                    stateKey: 'rc_products',
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

    it('should list pre-seeded offerings', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: `${BP}/projects/proj_test/offerings` });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBe(1);
      expect(res.json().items[0].id).toBe('ofr_seeded1');
    });

    it('should retrieve a pre-seeded product', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: `${BP}/projects/proj_test/products/prod_seeded1` });
      expect(res.statusCode).toBe(200);
      expect(res.json().display_name).toBe('Seeded Product');
      expect(res.json().type).toBe('subscription');
    });
  });

  describe('Generated RevenueCat response seeding', () => {
    let generatedTs: TestServer;

    beforeAll(async () => {
      const generatedAdapter = new RevenueCatAdapter();
      const generatedData = new Map<string, ExpandedData>([
        ['growth-saas', {
          personaId: 'growth-saas',
          blueprint: {} as Blueprint,
          tables: {},
          documents: {},
          apiResponses: {
            revenuecat: {
              adapterId: 'revenuecat',
              responses: {
                offerings: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: {
                      id: 'rc_offering_default',
                      identifier: 'default',
                      description: 'Default mobile offering',
                      packages: [
                        {
                          identifier: '$rc_monthly_pro',
                          platform_product_identifier: 'verida_pro_monthly',
                        },
                      ],
                      created: 1757156062,
                    },
                    personaId: 'growth-saas',
                    stateKey: 'rc_offerings',
                  },
                ],
                subscribers: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: {
                      original_app_user_id: 'rc_user_123',
                      entitlements: {
                        pro: {
                          product_identifier: 'verida_pro_monthly',
                          store: 'play_store',
                        },
                      },
                      subscriber_attributes: {
                        '$appsflyerId': { value: 'af-123' },
                      },
                      created: 1757156062,
                    },
                    personaId: 'growth-saas',
                    stateKey: 'rc_subscribers',
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
      generatedTs = await buildTestServer(generatedAdapter, generatedData);
    });

    afterAll(async () => {
      await generatedTs.close();
    });

    it('should expose a seeded project instead of falling back to proj_default', async () => {
      const res = await generatedTs.server.inject({ method: 'GET', url: `${BP}/projects` });
      expect(res.statusCode).toBe(200);
      expect(res.json().items[0].id).toBe('proj_growth_saas');
      expect(res.json().items[0].id).not.toBe('proj_default');
    });

    it('should list offerings under the generated project', async () => {
      const res = await generatedTs.server.inject({
        method: 'GET',
        url: `${BP}/projects/proj_growth_saas/offerings`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBe(1);
      expect(res.json().items[0].id).toBe('rc_offering_default');
    });

    it('should expose subscribers as customers keyed by original_app_user_id', async () => {
      const res = await generatedTs.server.inject({
        method: 'GET',
        url: `${BP}/projects/proj_growth_saas/customers/rc_user_123`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe('rc_user_123');
      expect(res.json().entitlements.pro.product_identifier).toBe('verida_pro_monthly');
    });

    it('should derive subscriptions from subscriber entitlements', async () => {
      const res = await generatedTs.server.inject({
        method: 'GET',
        url: `${BP}/projects/proj_growth_saas/subscriptions`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBe(1);
      expect(res.json().items[0].customer_id).toBe('rc_user_123');
      expect(res.json().items[0].product_id).toBe('verida_pro_monthly');
    });
  });
});
