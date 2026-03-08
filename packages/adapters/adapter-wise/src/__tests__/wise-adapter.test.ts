import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData } from '@mimicai/core';
import { WiseAdapter } from '../wise-adapter.js';

describe('WiseAdapter', () => {
  let ts: TestServer;
  let adapter: WiseAdapter;

  beforeAll(async () => {
    adapter = new WiseAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ──────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('wise');
      expect(adapter.name).toBe('Wise API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/wise');
    });
  });

  // ── 2. Endpoints count ─────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return 16 endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(16);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Profiles ──────────────────────────────────────────────────────────

  describe('Profiles', () => {
    it('should list profiles (auto-creates default)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/wise/v2/profiles',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toBeInstanceOf(Array);
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0].type).toBe('personal');
      expect(body[0].fullName).toBe('Test User');
    });

    it('should get a profile by ID', async () => {
      const listRes = await ts.server.inject({
        method: 'GET',
        url: '/wise/v2/profiles',
      });
      const profileId = listRes.json()[0].id;

      const res = await ts.server.inject({
        method: 'GET',
        url: `/wise/v2/profiles/${profileId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(profileId);
    });

    it('should return 404 for unknown profile', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/wise/v2/profiles/999999999',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().errors[0].code).toBe('PROFILE_NOT_FOUND');
    });
  });

  // ── 4. Quotes ────────────────────────────────────────────────────────────

  describe('Quotes', () => {
    let profileId: number;
    let quoteId: string;

    beforeAll(async () => {
      const listRes = await ts.server.inject({
        method: 'GET',
        url: '/wise/v2/profiles',
      });
      profileId = listRes.json()[0].id;
    });

    it('should create a quote with source amount', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/wise/v3/profiles/${profileId}/quotes`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          sourceCurrency: 'GBP',
          targetCurrency: 'EUR',
          sourceAmount: 500,
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.sourceCurrency).toBe('GBP');
      expect(body.targetCurrency).toBe('EUR');
      expect(body.sourceAmount).toBe(500);
      expect(body.type).toBe('FIXED_SOURCE');
      expect(body.status).toBe('PENDING');
      expect(body.rate).toBeGreaterThan(0);
      expect(body.fee).toBeGreaterThan(0);
      expect(body.paymentOptions).toHaveLength(2);
      quoteId = body.id;
    });

    it('should create a quote with target amount', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/wise/v3/profiles/${profileId}/quotes`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          sourceCurrency: 'USD',
          targetCurrency: 'GBP',
          targetAmount: 200,
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.type).toBe('FIXED_TARGET');
      expect(body.targetAmount).toBe(200);
    });

    it('should get a quote', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/wise/v3/profiles/${profileId}/quotes/${quoteId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(quoteId);
    });

    it('should return 404 for unknown quote', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/wise/v3/profiles/${profileId}/quotes/unknown-uuid`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().errors[0].code).toBe('QUOTE_NOT_FOUND');
    });

    it('should return 404 when creating quote for unknown profile', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/wise/v3/profiles/999999999/quotes',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          sourceCurrency: 'GBP',
          targetCurrency: 'EUR',
          sourceAmount: 100,
        }),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().errors[0].code).toBe('PROFILE_NOT_FOUND');
    });
  });

  // ── 5. Recipients ────────────────────────────────────────────────────────

  describe('Recipients', () => {
    let profileId: number;
    let recipientId: number;

    beforeAll(async () => {
      const listRes = await ts.server.inject({
        method: 'GET',
        url: '/wise/v2/profiles',
      });
      profileId = listRes.json()[0].id;
    });

    it('should create a recipient', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/wise/v1/accounts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          profile: profileId,
          accountHolderName: 'Jane Doe',
          type: 'iban',
          currency: 'EUR',
          country: 'DE',
          details: { IBAN: 'DE89370400440532013000' },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.accountHolderName).toBe('Jane Doe');
      expect(body.currency).toBe('EUR');
      expect(body.isActive).toBe(true);
      recipientId = body.id;
    });

    it('should get a recipient', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/wise/v1/accounts/${recipientId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(recipientId);
    });

    it('should list recipients', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/wise/v1/accounts?profile=${profileId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toBeInstanceOf(Array);
      expect(body.length).toBeGreaterThanOrEqual(1);
    });

    it('should list recipients filtered by currency', async () => {
      // Create a GBP recipient first
      await ts.server.inject({
        method: 'POST',
        url: '/wise/v1/accounts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          profile: profileId,
          accountHolderName: 'John Smith',
          currency: 'GBP',
          country: 'GB',
        }),
      });

      const res = await ts.server.inject({
        method: 'GET',
        url: `/wise/v1/accounts?currency=GBP`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.every((r: any) => r.currency === 'GBP')).toBe(true);
    });

    it('should delete (deactivate) a recipient', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/wise/v1/accounts/${recipientId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().isActive).toBe(false);
    });

    it('should not list deactivated recipients', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/wise/v1/accounts?profile=${profileId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const deactivated = body.find((r: any) => r.id === recipientId);
      expect(deactivated).toBeUndefined();
    });

    it('should return 404 for unknown recipient', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/wise/v1/accounts/999999999',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().errors[0].code).toBe('RECIPIENT_NOT_FOUND');
    });

    it('should return 404 when deleting unknown recipient', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: '/wise/v1/accounts/999999999',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 6. Transfers ─────────────────────────────────────────────────────────

  describe('Transfers', () => {
    let profileId: number;
    let quoteId: string;
    let recipientId: number;
    let transferId: number;

    beforeAll(async () => {
      // Get profile
      const listRes = await ts.server.inject({
        method: 'GET',
        url: '/wise/v2/profiles',
      });
      profileId = listRes.json()[0].id;

      // Create a quote
      const quoteRes = await ts.server.inject({
        method: 'POST',
        url: `/wise/v3/profiles/${profileId}/quotes`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          sourceCurrency: 'GBP',
          targetCurrency: 'EUR',
          sourceAmount: 200,
        }),
      });
      quoteId = quoteRes.json().id;

      // Create a recipient
      const recipientRes = await ts.server.inject({
        method: 'POST',
        url: '/wise/v1/accounts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          profile: profileId,
          accountHolderName: 'Transfer Test Recipient',
          currency: 'EUR',
          country: 'DE',
        }),
      });
      recipientId = recipientRes.json().id;
    });

    it('should create a transfer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/wise/v1/transfers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          targetAccount: recipientId,
          quoteUuid: quoteId,
          details: { reference: 'Test transfer' },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe('incoming_payment_waiting');
      expect(body.quoteUuid).toBe(quoteId);
      expect(body.targetAccount).toBe(recipientId);
      expect(body.sourceCurrency).toBe('GBP');
      expect(body.targetCurrency).toBe('EUR');
      transferId = body.id;
    });

    it('should get a transfer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/wise/v1/transfers/${transferId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(transferId);
    });

    it('should list transfers', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/wise/v1/transfers',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toBeInstanceOf(Array);
      expect(body.length).toBeGreaterThanOrEqual(1);
    });

    it('should list transfers filtered by profile', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/wise/v1/transfers?profile=${profileId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.every((t: any) => String(t.user) === String(profileId))).toBe(true);
    });

    it('should list transfers filtered by status', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/wise/v1/transfers?status=incoming_payment_waiting',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.every((t: any) => t.status === 'incoming_payment_waiting')).toBe(true);
    });

    it('should cancel a transfer', async () => {
      // Create a fresh transfer for cancellation
      const quoteRes = await ts.server.inject({
        method: 'POST',
        url: `/wise/v3/profiles/${profileId}/quotes`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          sourceCurrency: 'GBP',
          targetCurrency: 'USD',
          sourceAmount: 50,
        }),
      });
      const cancelQuoteId = quoteRes.json().id;

      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/wise/v1/transfers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          targetAccount: recipientId,
          quoteUuid: cancelQuoteId,
        }),
      });
      const cancelTransferId = createRes.json().id;

      const res = await ts.server.inject({
        method: 'PUT',
        url: `/wise/v1/transfers/${cancelTransferId}/cancel`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('cancelled');
    });

    it('should return 422 when cancelling a non-cancellable transfer', async () => {
      // Create and cancel a transfer, then try to cancel again
      const quoteRes = await ts.server.inject({
        method: 'POST',
        url: `/wise/v3/profiles/${profileId}/quotes`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          sourceCurrency: 'GBP',
          targetCurrency: 'EUR',
          sourceAmount: 30,
        }),
      });

      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/wise/v1/transfers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          targetAccount: recipientId,
          quoteUuid: quoteRes.json().id,
        }),
      });
      const tid = createRes.json().id;

      // Cancel first time
      await ts.server.inject({
        method: 'PUT',
        url: `/wise/v1/transfers/${tid}/cancel`,
      });

      // Try to cancel again
      const res = await ts.server.inject({
        method: 'PUT',
        url: `/wise/v1/transfers/${tid}/cancel`,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().errors[0].code).toBe('TRANSFER_NOT_CANCELLABLE');
    });

    it('should return 404 for unknown transfer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/wise/v1/transfers/999999999',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().errors[0].code).toBe('TRANSFER_NOT_FOUND');
    });

    it('should return 404 when cancelling unknown transfer', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: '/wise/v1/transfers/999999999/cancel',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 7. Fund Transfer ─────────────────────────────────────────────────────

  describe('Fund Transfer', () => {
    let profileId: number;
    let transferId: number;

    beforeAll(async () => {
      const listRes = await ts.server.inject({
        method: 'GET',
        url: '/wise/v2/profiles',
      });
      profileId = listRes.json()[0].id;

      // Create quote
      const quoteRes = await ts.server.inject({
        method: 'POST',
        url: `/wise/v3/profiles/${profileId}/quotes`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          sourceCurrency: 'GBP',
          targetCurrency: 'EUR',
          sourceAmount: 100,
        }),
      });

      // Create recipient
      const recipientRes = await ts.server.inject({
        method: 'POST',
        url: '/wise/v1/accounts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          profile: profileId,
          accountHolderName: 'Fund Test Recipient',
          currency: 'EUR',
        }),
      });

      // Create transfer
      const transferRes = await ts.server.inject({
        method: 'POST',
        url: '/wise/v1/transfers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          targetAccount: recipientRes.json().id,
          quoteUuid: quoteRes.json().id,
        }),
      });
      transferId = transferRes.json().id;
    });

    it('should fund a transfer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/wise/v3/profiles/${profileId}/transfers/${transferId}/payments`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ type: 'BALANCE' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.type).toBe('BALANCE');
      expect(body.status).toBe('COMPLETED');
      expect(body.errorCode).toBeNull();
    });

    it('should return 422 when funding an already-funded transfer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/wise/v3/profiles/${profileId}/transfers/${transferId}/payments`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ type: 'BALANCE' }),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().errors[0].code).toBe('TRANSFER_NOT_FUNDABLE');
    });

    it('should return 404 when funding unknown transfer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/wise/v3/profiles/${profileId}/transfers/999999999/payments`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ type: 'BALANCE' }),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 8. Balances ──────────────────────────────────────────────────────────

  describe('Balances', () => {
    let profileId: number;

    beforeAll(async () => {
      const listRes = await ts.server.inject({
        method: 'GET',
        url: '/wise/v2/profiles',
      });
      profileId = listRes.json()[0].id;
    });

    it('should list balances (auto-creates defaults)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/wise/v4/profiles/${profileId}/balances`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toBeInstanceOf(Array);
      expect(body.length).toBe(3);
      expect(body[0].amount).toBeDefined();
      expect(body[0].type).toBe('STANDARD');
    });

    it('should filter balances by type', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/wise/v4/profiles/${profileId}/balances?types=STANDARD`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.every((b: any) => b.type === 'STANDARD')).toBe(true);
    });

    it('should return 404 for unknown profile', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/wise/v4/profiles/999999999/balances',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().errors[0].code).toBe('PROFILE_NOT_FOUND');
    });
  });

  // ── 9. Exchange Rates ────────────────────────────────────────────────────

  describe('Exchange Rates', () => {
    it('should get exchange rates', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/wise/v1/rates?source=GBP&target=EUR',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toBeInstanceOf(Array);
      expect(body).toHaveLength(1);
      expect(body[0].source).toBe('GBP');
      expect(body[0].target).toBe('EUR');
      expect(body[0].rate).toBeGreaterThan(0);
      expect(body[0].time).toBeDefined();
    });

    it('should return default rates without query params', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/wise/v1/rates',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body[0].source).toBe('GBP');
      expect(body[0].target).toBe('EUR');
    });
  });

  // ── 10. Currencies ──────────────────────────────────────────────────────

  describe('Currencies', () => {
    it('should list currencies', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/wise/v1/currencies',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toBeInstanceOf(Array);
      expect(body.length).toBe(20);
      expect(body[0].code).toBeDefined();
      expect(body[0].name).toBeDefined();
      expect(body[0].symbol).toBeDefined();
    });
  });

  // ── 11. Full Transfer Lifecycle ──────────────────────────────────────────

  describe('Full Transfer Lifecycle', () => {
    it('should complete profile -> quote -> recipient -> transfer -> fund flow', async () => {
      // 1. List profiles
      const profilesRes = await ts.server.inject({
        method: 'GET',
        url: '/wise/v2/profiles',
      });
      expect(profilesRes.statusCode).toBe(200);
      const profileId = profilesRes.json()[0].id;

      // 2. Create quote
      const quoteRes = await ts.server.inject({
        method: 'POST',
        url: `/wise/v3/profiles/${profileId}/quotes`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          sourceCurrency: 'GBP',
          targetCurrency: 'USD',
          sourceAmount: 1000,
        }),
      });
      expect(quoteRes.statusCode).toBe(200);
      const quoteId = quoteRes.json().id;

      // 3. Create recipient
      const recipientRes = await ts.server.inject({
        method: 'POST',
        url: '/wise/v1/accounts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          profile: profileId,
          accountHolderName: 'Lifecycle Test Recipient',
          currency: 'USD',
          country: 'US',
        }),
      });
      expect(recipientRes.statusCode).toBe(200);
      const recipientId = recipientRes.json().id;

      // 4. Create transfer
      const transferRes = await ts.server.inject({
        method: 'POST',
        url: '/wise/v1/transfers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          targetAccount: recipientId,
          quoteUuid: quoteId,
          details: { reference: 'Lifecycle test' },
        }),
      });
      expect(transferRes.statusCode).toBe(200);
      expect(transferRes.json().status).toBe('incoming_payment_waiting');
      const transferId = transferRes.json().id;

      // 5. Fund transfer
      const fundRes = await ts.server.inject({
        method: 'POST',
        url: `/wise/v3/profiles/${profileId}/transfers/${transferId}/payments`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ type: 'BALANCE' }),
      });
      expect(fundRes.statusCode).toBe(201);
      expect(fundRes.json().status).toBe('COMPLETED');

      // 6. Verify transfer status moved to processing
      const verifyRes = await ts.server.inject({
        method: 'GET',
        url: `/wise/v1/transfers/${transferId}`,
      });
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.json().status).toBe('processing');
    });
  });

  // ── 12. resolvePersona ─────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from wise_ prefix token', () => {
      const mockReq = {
        headers: { authorization: 'Bearer wise_young-pro_abc123xyz' },
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

  // ── 13. Cross-surface seeding ──────────────────────────────────────────

  describe('cross-surface seeding', () => {
    it('should seed transfers from apiResponses', async () => {
      const seededAdapter = new WiseAdapter();
      const seedData = new Map<string, ExpandedData>([
        [
          'test-persona',
          {
            persona: 'test' as any,
            blueprint: {} as any,
            tables: {},
            facts: [],
            apiResponses: {
              wise: {
                responses: {
                  transfers: [
                    {
                      status: 200,
                      body: {
                        id: 123456789,
                        status: 'outgoing_payment_sent',
                        sourceCurrency: 'GBP',
                        sourceValue: 500,
                        targetCurrency: 'EUR',
                        targetValue: 580,
                        user: 100000000,
                      },
                    },
                  ],
                  profiles: [
                    {
                      status: 200,
                      body: {
                        id: 100000000,
                        type: 'personal',
                        fullName: 'Seeded User',
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

      // Verify seeded transfer
      const transferRes = await seededTs.server.inject({
        method: 'GET',
        url: '/wise/v1/transfers/123456789',
      });
      expect(transferRes.statusCode).toBe(200);
      expect(transferRes.json().id).toBe(123456789);
      expect(transferRes.json().status).toBe('outgoing_payment_sent');

      // Verify seeded profile
      const profileRes = await seededTs.server.inject({
        method: 'GET',
        url: '/wise/v2/profiles/100000000',
      });
      expect(profileRes.statusCode).toBe(200);
      expect(profileRes.json().fullName).toBe('Seeded User');

      await seededTs.close();
    });
  });

  // ── 14. Pagination ──────────────────────────────────────────────────────

  describe('Transfers Pagination', () => {
    it('should respect offset and limit params', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/wise/v1/transfers?offset=0&limit=2',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBeLessThanOrEqual(2);
    });
  });
});
