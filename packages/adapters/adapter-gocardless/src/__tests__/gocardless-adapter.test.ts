import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData, Blueprint } from '@mimicai/core';
import { GoCardlessAdapter } from '../gocardless-adapter.js';

describe('GoCardlessAdapter', () => {
  let ts: TestServer;
  let adapter: GoCardlessAdapter;

  beforeAll(async () => {
    adapter = new GoCardlessAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('gocardless');
      expect(adapter.name).toBe('GoCardless API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/gocardless');
    });
  });

  // ── 2. Endpoints count ────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return 45 endpoint definitions matching the spec', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(45);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Customer CRUD ──────────────────────────────────────────────────

  describe('Customers', () => {
    let customerId: string;

    it('should create a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/gocardless/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customers: { email: 'alice@example.com', given_name: 'Alice', family_name: 'Smith' } }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.customers.id).toMatch(/^CU/);
      expect(body.customers.email).toBe('alice@example.com');
      expect(body.customers.given_name).toBe('Alice');
      customerId = body.customers.id;
    });

    it('should get a customer by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/gocardless/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().customers.id).toBe(customerId);
    });

    it('should list customers', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/gocardless/customers',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.customers)).toBe(true);
      expect(body.customers.length).toBeGreaterThanOrEqual(1);
      expect(body.meta).toBeDefined();
      expect(body.meta.cursors).toBeDefined();
    });

    it('should update a customer', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `/gocardless/customers/${customerId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customers: { given_name: 'Alicia' } }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().customers.given_name).toBe('Alicia');
    });

    it('should return 404 for non-existent customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/gocardless/customers/CU000000000X',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('resource_not_found');
    });
  });

  // ── 4. Customer Bank Accounts ─────────────────────────────────────────

  describe('Customer Bank Accounts', () => {
    let bankAccountId: string;

    it('should create a bank account', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/gocardless/customer_bank_accounts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          customer_bank_accounts: {
            account_holder_name: 'Alice Smith',
            account_number: '55779911',
            branch_code: '200000',
            country_code: 'GB',
            customer: 'CU_test1',
          },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.customer_bank_accounts.id).toMatch(/^BA/);
      expect(body.customer_bank_accounts.account_holder_name).toBe('Alice Smith');
      expect(body.customer_bank_accounts.links.customer).toBe('CU_test1');
      bankAccountId = body.customer_bank_accounts.id;
    });

    it('should get a bank account by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/gocardless/customer_bank_accounts/${bankAccountId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().customer_bank_accounts.id).toBe(bankAccountId);
    });

    it('should list bank accounts', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/gocardless/customer_bank_accounts',
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().customer_bank_accounts)).toBe(true);
    });

    it('should disable a bank account', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/gocardless/customer_bank_accounts/${bankAccountId}/actions/disable`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().customer_bank_accounts.enabled).toBe(false);
    });
  });

  // ── 5. Mandates ───────────────────────────────────────────────────────

  describe('Mandates', () => {
    let mandateId: string;

    it('should create a mandate', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/gocardless/mandates',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          mandates: {
            scheme: 'bacs',
            links: { customer_bank_account: 'BA_test1' },
          },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.mandates.id).toMatch(/^MD/);
      expect(body.mandates.scheme).toBe('bacs');
      expect(body.mandates.status).toBe('pending_submission');
      mandateId = body.mandates.id;
    });

    it('should get a mandate by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/gocardless/mandates/${mandateId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().mandates.id).toBe(mandateId);
    });

    it('should list mandates', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/gocardless/mandates',
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().mandates)).toBe(true);
    });

    it('should cancel a mandate', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/gocardless/mandates/${mandateId}/actions/cancel`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().mandates.status).toBe('cancelled');
    });

    it('should reinstate a mandate', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/gocardless/mandates/${mandateId}/actions/reinstate`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().mandates.status).toBe('active');
    });
  });

  // ── 6. Payments ───────────────────────────────────────────────────────

  describe('Payments', () => {
    let paymentId: string;

    it('should create a payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/gocardless/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          payments: {
            amount: 5000,
            currency: 'GBP',
            links: { mandate: 'MD_test1' },
            description: 'Monthly invoice',
          },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.payments.id).toMatch(/^PM/);
      expect(body.payments.amount).toBe(5000);
      expect(body.payments.currency).toBe('GBP');
      expect(body.payments.status).toBe('pending_submission');
      paymentId = body.payments.id;
    });

    it('should get a payment by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/gocardless/payments/${paymentId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().payments.id).toBe(paymentId);
    });

    it('should list payments', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/gocardless/payments',
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().payments)).toBe(true);
    });

    it('should cancel a payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/gocardless/payments/${paymentId}/actions/cancel`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().payments.status).toBe('cancelled');
    });

    it('should retry a payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/gocardless/payments/${paymentId}/actions/retry`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().payments.status).toBe('pending_submission');
    });
  });

  // ── 7. Subscriptions ──────────────────────────────────────────────────

  describe('Subscriptions', () => {
    let subId: string;

    it('should create a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/gocardless/subscriptions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          subscriptions: {
            amount: 2500,
            currency: 'GBP',
            name: 'Pro Plan',
            interval_unit: 'monthly',
            links: { mandate: 'MD_test1' },
          },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.subscriptions.id).toMatch(/^SB/);
      expect(body.subscriptions.amount).toBe(2500);
      expect(body.subscriptions.status).toBe('active');
      subId = body.subscriptions.id;
    });

    it('should get a subscription by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/gocardless/subscriptions/${subId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscriptions.id).toBe(subId);
    });

    it('should list subscriptions', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/gocardless/subscriptions',
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().subscriptions)).toBe(true);
    });

    it('should pause a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/gocardless/subscriptions/${subId}/actions/pause`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscriptions.status).toBe('paused');
    });

    it('should resume a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/gocardless/subscriptions/${subId}/actions/resume`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscriptions.status).toBe('active');
    });

    it('should cancel a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/gocardless/subscriptions/${subId}/actions/cancel`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscriptions.status).toBe('cancelled');
    });
  });

  // ── 8. Refunds ────────────────────────────────────────────────────────

  describe('Refunds', () => {
    let refundId: string;

    it('should create a refund', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/gocardless/refunds',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          refunds: {
            amount: 1000,
            links: { payment: 'PM_test1' },
            reference: 'partial refund',
          },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.refunds.id).toMatch(/^RF/);
      expect(body.refunds.amount).toBe(1000);
      expect(body.refunds.links.payment).toBe('PM_test1');
      refundId = body.refunds.id;
    });

    it('should get a refund by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/gocardless/refunds/${refundId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().refunds.id).toBe(refundId);
    });

    it('should list refunds', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/gocardless/refunds',
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().refunds)).toBe(true);
    });
  });

  // ── 9. Payouts ────────────────────────────────────────────────────────

  describe('Payouts', () => {
    it('should list payouts (empty initially)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/gocardless/payouts',
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().payouts)).toBe(true);
    });

    it('should return 404 for non-existent payout', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/gocardless/payouts/PO000000000X',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 10. Instalment Schedules ──────────────────────────────────────────

  describe('Instalment Schedules', () => {
    let scheduleId: string;

    it('should create an instalment schedule', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/gocardless/instalment_schedules',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          instalment_schedules: {
            total_amount: 10000,
            currency: 'GBP',
            links: { mandate: 'MD_test1' },
          },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.instalment_schedules.id).toMatch(/^IS/);
      expect(body.instalment_schedules.status).toBe('pending');
      scheduleId = body.instalment_schedules.id;
    });

    it('should get an instalment schedule by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/gocardless/instalment_schedules/${scheduleId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().instalment_schedules.id).toBe(scheduleId);
    });

    it('should cancel an instalment schedule', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/gocardless/instalment_schedules/${scheduleId}/actions/cancel`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().instalment_schedules.status).toBe('cancelled');
    });
  });

  // ── 11. Billing Requests ──────────────────────────────────────────────

  describe('Billing Requests', () => {
    let brId: string;

    it('should create a billing request', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/gocardless/billing_requests',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          billing_requests: {
            mandate_request: { scheme: 'bacs' },
          },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.billing_requests.id).toMatch(/^BRQ/);
      expect(body.billing_requests.status).toBe('pending');
      brId = body.billing_requests.id;
    });

    it('should get a billing request by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/gocardless/billing_requests/${brId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().billing_requests.id).toBe(brId);
    });

    it('should confirm payer details', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/gocardless/billing_requests/${brId}/actions/confirm_payer_details`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().billing_requests.status).toBe('ready_to_fulfil');
    });
  });

  // ── 12. Billing Request Flows ─────────────────────────────────────────

  describe('Billing Request Flows', () => {
    it('should create a billing request flow', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/gocardless/billing_request_flows',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          billing_request_flows: {
            redirect_uri: 'https://example.com/callback',
            links: { billing_request: 'BRQ_test1' },
          },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.billing_request_flows.authorisation_url).toContain('pay.gocardless.com');
    });
  });

  // ── 13. Creditors ─────────────────────────────────────────────────────

  describe('Creditors', () => {
    it('should list creditors (auto-generates default)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/gocardless/creditors',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.creditors.length).toBeGreaterThanOrEqual(1);
      expect(body.creditors[0].name).toBe('Test Creditor');
    });
  });

  // ── 14. Events ────────────────────────────────────────────────────────

  describe('Events', () => {
    it('should list events (empty initially)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/gocardless/events',
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().events)).toBe(true);
    });
  });

  // ── 15. Error handling ────────────────────────────────────────────────

  describe('Error handling', () => {
    it('should return GoCardless error format for non-existent resource', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/gocardless/mandates/MD000000000X',
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(body.error.type).toBe('invalid_api_usage');
      expect(body.error.code).toBe('resource_not_found');
      expect(body.error.message).toContain('MD000000000X');
      expect(body.error.request_id).toBeDefined();
    });
  });

  // ── 16. resolvePersona ────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Bearer token', () => {
      const mockReq = {
        headers: { authorization: 'Bearer sandbox_young-professional_abc123xyz' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      const persona = adapter.resolvePersona(mockReq);
      expect(persona).toBe('young-professional');
    });

    it('should return null for missing auth header', () => {
      const mockReq = {
        headers: {},
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });

    it('should return null for non-matching token format', () => {
      const mockReq = {
        headers: { authorization: 'Bearer live_somekey' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 17. Cross-surface seeding from apiResponses ───────────────────────

  describe('Cross-surface seeding', () => {
    let seededTs: TestServer;

    beforeAll(async () => {
      const seededAdapter = new GoCardlessAdapter();
      const seedData = new Map<string, ExpandedData>([
        ['test-persona', {
          personaId: 'test-persona',
          blueprint: {} as Blueprint,
          tables: {},
          documents: {},
          apiResponses: {
            gocardless: {
              adapterId: 'gocardless',
              responses: {
                customers: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'CU000seeded1', given_name: 'Alice', family_name: 'Nguyen', email: 'alice@brightwave.io' },
                    personaId: 'test-persona',
                    stateKey: 'gc_customers',
                  },
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'CU000seeded2', given_name: 'Marcus', family_name: 'Bell', email: 'marcus@stackforge.dev' },
                    personaId: 'test-persona',
                    stateKey: 'gc_customers',
                  },
                ],
                mandates: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'MD000seeded1', scheme: 'bacs', status: 'active' },
                    personaId: 'test-persona',
                    stateKey: 'gc_mandates',
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

    it('should list pre-seeded customers', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: '/gocardless/customers' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.customers.length).toBe(2);
      expect(body.customers.some((c: Record<string, unknown>) => c.id === 'CU000seeded1')).toBe(true);
      expect(body.customers.some((c: Record<string, unknown>) => c.id === 'CU000seeded2')).toBe(true);
    });

    it('should retrieve a pre-seeded customer by ID', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: '/gocardless/customers/CU000seeded1' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.customers.id).toBe('CU000seeded1');
      expect(body.customers.given_name).toBe('Alice');
      expect(body.customers.email).toBe('alice@brightwave.io');
    });

    it('should list pre-seeded mandates', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: '/gocardless/mandates' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.mandates.length).toBe(1);
      expect(body.mandates[0].id).toBe('MD000seeded1');
      expect(body.mandates[0].scheme).toBe('bacs');
    });

    it('should allow creating new resources alongside pre-seeded ones', async () => {
      const createRes = await seededTs.server.inject({
        method: 'POST',
        url: '/gocardless/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customers: { email: 'new@example.com', given_name: 'New' } }),
      });
      expect(createRes.statusCode).toBe(201);

      const listRes = await seededTs.server.inject({ method: 'GET', url: '/gocardless/customers' });
      expect(listRes.json().customers.length).toBe(3);
    });
  });
});
