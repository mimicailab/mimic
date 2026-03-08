import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData, Blueprint } from '@mimicai/core';
import { AdyenAdapter } from '../adyen-adapter.js';

describe('AdyenAdapter', () => {
  let ts: TestServer;
  let adapter: AdyenAdapter;

  beforeAll(async () => {
    adapter = new AdyenAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('adyen');
      expect(adapter.name).toBe('Adyen API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/adyen/v71');
    });
  });

  // ── 2. Endpoints count ────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return the correct number of endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      // 4 checkout + 5 modifications + 3 tokenization + 1 payouts
      // + 3 payment links + 2 orders + 3 additional = 21
      expect(endpoints.length).toBe(21);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Payment creation ───────────────────────────────────────────────

  describe('Payments', () => {
    let pspRef: string;

    it('should create a payment (Authorised)', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 5000, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
          reference: 'order-001',
          paymentMethod: { type: 'scheme' },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.resultCode).toBe('Authorised');
      expect(body.pspReference).toMatch(/^\d{16}$/);
      expect(body.amount.value).toBe(5000);
      expect(body.paymentMethod.type).toBe('scheme');
      pspRef = body.pspReference;
    });

    it('should return Refused for DECLINE_ reference prefix', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 1000, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
          reference: 'DECLINE_test',
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().resultCode).toBe('Refused');
    });

    it('should return RedirectShopper with action for REDIRECT_ prefix', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 2000, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
          reference: 'REDIRECT_3ds',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.resultCode).toBe('RedirectShopper');
      expect(body.action).toBeDefined();
      expect(body.action.type).toBe('redirect');
    });

    it('should return ChallengeShopper for CHALLENGE_ prefix', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 3000, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
          reference: 'CHALLENGE_test',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.resultCode).toBe('ChallengeShopper');
      expect(body.action.type).toBe('threeDS2');
    });

    it('should reject payment without amount', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ merchantAccount: 'Test' }),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().errorCode).toBe('14_012');
    });

    it('should reject payment without merchantAccount', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: { value: 100, currency: 'EUR' } }),
      });
      expect(res.statusCode).toBe(422);
    });

    // ── Capture ──────────────────────────────────────────────────────────

    it('should capture a payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/adyen/v71/payments/${pspRef}/captures`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 5000, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.paymentPspReference).toBe(pspRef);
      expect(body.status).toBe('received');
      expect(body.pspReference).toMatch(/^\d{16}$/);
    });

    // ── Refund ───────────────────────────────────────────────────────────

    it('should refund a payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/adyen/v71/payments/${pspRef}/refunds`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 2500, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.paymentPspReference).toBe(pspRef);
      expect(body.status).toBe('received');
    });

    // ── Cancel ───────────────────────────────────────────────────────────

    it('should cancel a payment', async () => {
      // Create a fresh payment to cancel
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 1000, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
          reference: 'cancel-me',
        }),
      });
      const cancelPsp = createRes.json().pspReference;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/adyen/v71/payments/${cancelPsp}/cancels`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ merchantAccount: 'TestMerchant' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().paymentPspReference).toBe(cancelPsp);
      expect(res.json().status).toBe('received');
    });

    // ── Reversal ─────────────────────────────────────────────────────────

    it('should reverse a payment', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 500, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
          reference: 'reverse-me',
        }),
      });
      const revPsp = createRes.json().pspReference;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/adyen/v71/payments/${revPsp}/reversals`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ merchantAccount: 'TestMerchant' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('received');
    });

    // ── Amount Update ────────────────────────────────────────────────────

    it('should update a payment amount', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 7000, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
          reference: 'update-amt',
        }),
      });
      const updPsp = createRes.json().pspReference;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/adyen/v71/payments/${updPsp}/amountUpdates`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 8000, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('received');
      expect(body.amount.value).toBe(8000);
    });

    // ── Modification error for unknown PSP ───────────────────────────────

    it('should return error for capture on unknown PSP', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/payments/0000000000000000/captures',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: { value: 100, currency: 'EUR' } }),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().errorCode).toBe('14_012');
    });
  });

  // ── 4. Payment Details (3DS) ──────────────────────────────────────────

  describe('Payment Details', () => {
    it('should submit 3DS details and get Authorised', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/payments/details',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          details: { MD: 'test', PaRes: 'test' },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.resultCode).toBe('Authorised');
      expect(body.pspReference).toMatch(/^\d{16}$/);
    });
  });

  // ── 5. Sessions ───────────────────────────────────────────────────────

  describe('Sessions', () => {
    it('should create a Drop-in session', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/sessions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 10000, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
          returnUrl: 'https://example.com/return',
          reference: 'session-001',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^CS/);
      expect(body.sessionData).toBeDefined();
      expect(body.expiresAt).toBeDefined();
      expect(body.amount.value).toBe(10000);
    });

    it('should reject session without required fields', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/sessions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ reference: 'bad' }),
      });
      expect(res.statusCode).toBe(422);
    });
  });

  // ── 6. Payment Methods ────────────────────────────────────────────────

  describe('Payment Methods', () => {
    it('should return available payment methods', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/paymentMethods',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ merchantAccount: 'TestMerchant' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.paymentMethods.length).toBe(8);
      expect(body.paymentMethods.some((m: any) => m.type === 'scheme')).toBe(true);
      expect(body.paymentMethods.some((m: any) => m.type === 'paypal')).toBe(true);
      expect(body.paymentMethods.some((m: any) => m.type === 'ideal')).toBe(true);
    });
  });

  // ── 7. Stored Payment Methods (Tokenization) ─────────────────────────

  describe('Stored Payment Methods', () => {
    let tokenId: string;

    it('should create a stored payment method', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/storedPaymentMethods',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          shopperReference: 'shopper-001',
          merchantAccount: 'TestMerchant',
          paymentMethod: { brand: 'visa' },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.brand).toBe('visa');
      expect(body.lastFour).toBe('1234');
      expect(body.shopperReference).toBe('shopper-001');
      tokenId = body.id;
    });

    it('should list stored payment methods', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/adyen/v71/storedPaymentMethods?shopperReference=shopper-001',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.storedPaymentMethods.length).toBe(1);
      expect(body.storedPaymentMethods[0].id).toBe(tokenId);
    });

    it('should delete a stored payment method', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/adyen/v71/storedPaymentMethods/${tokenId}`,
      });
      expect(res.statusCode).toBe(204);

      // Verify deleted
      const listRes = await ts.server.inject({
        method: 'GET',
        url: '/adyen/v71/storedPaymentMethods?shopperReference=shopper-001',
      });
      expect(listRes.json().storedPaymentMethods.length).toBe(0);
    });

    it('should return error for deleting non-existent token', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: '/adyen/v71/storedPaymentMethods/nonexistent',
      });
      expect(res.statusCode).toBe(422);
    });
  });

  // ── 8. Payouts ────────────────────────────────────────────────────────

  describe('Payouts', () => {
    it('should create a payout', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/payouts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 25000, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pspReference).toMatch(/^\d{16}$/);
      expect(body.resultCode).toBe('[payout-submit-received]');
    });
  });

  // ── 9. Payment Links ──────────────────────────────────────────────────

  describe('Payment Links', () => {
    let linkId: string;

    it('should create a payment link', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/paymentLinks',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 5000, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
          reference: 'link-001',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^PL/);
      expect(body.url).toContain('test.adyen.link');
      expect(body.status).toBe('active');
      linkId = body.id;
    });

    it('should get a payment link', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/adyen/v71/paymentLinks/${linkId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(linkId);
    });

    it('should update/expire a payment link', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/adyen/v71/paymentLinks/${linkId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ status: 'expired' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('expired');
    });

    it('should return error for non-existent payment link', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/adyen/v71/paymentLinks/PLnonexistent',
      });
      expect(res.statusCode).toBe(422);
    });
  });

  // ── 10. Orders ────────────────────────────────────────────────────────

  describe('Orders', () => {
    let orderPsp: string;

    it('should create an order', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 15000, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
          reference: 'order-001',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.pspReference).toMatch(/^\d{16}$/);
      expect(body.resultCode).toBe('Success');
      expect(body.orderData).toBeDefined();
      expect(body.remainingAmount.value).toBe(15000);
      orderPsp = body.pspReference;
    });

    it('should cancel an order', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/orders/cancel',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          order: { pspReference: orderPsp, orderData: 'test' },
          merchantAccount: 'TestMerchant',
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().resultCode).toBe('Cancelled');
    });

    it('should reject order without amount', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ merchantAccount: 'Test' }),
      });
      expect(res.statusCode).toBe(422);
    });
  });

  // ── 11. Donations ─────────────────────────────────────────────────────

  describe('Donations', () => {
    it('should make a donation', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/donations',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 500, currency: 'EUR' },
          donationAccount: 'CHARITY_ACC',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pspReference).toMatch(/^\d{16}$/);
      expect(body.status).toBe('completed');
      expect(body.donationAccount).toBe('CHARITY_ACC');
    });
  });

  // ── 12. Card Details ──────────────────────────────────────────────────

  describe('Card Details', () => {
    it('should detect Visa card', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/cardDetails',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ cardNumber: '4111111111111111' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.brands[0].type).toBe('visa');
      expect(body.brands[0].supported).toBe(true);
    });

    it('should detect Mastercard', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/cardDetails',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ cardNumber: '5500000000000004' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().brands[0].type).toBe('mc');
    });

    it('should detect Amex', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/cardDetails',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ cardNumber: '3700000000000002' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().brands[0].type).toBe('amex');
    });
  });

  // ── 13. Apple Pay Sessions ────────────────────────────────────────────

  describe('Apple Pay Sessions', () => {
    it('should create an Apple Pay session', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/applePay/sessions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          merchantIdentifier: 'merchant.com.test',
          domainName: 'shop.example.com',
          displayName: 'My Shop',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.merchantSessionIdentifier).toMatch(/^SSH/);
      expect(body.domainName).toBe('shop.example.com');
      expect(body.displayName).toBe('My Shop');
    });
  });

  // ── 14. Error handling ────────────────────────────────────────────────

  describe('Error handling', () => {
    it('should return Adyen error format', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/adyen/v71/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.status).toBe(422);
      expect(body.errorCode).toBe('14_012');
      expect(body.errorType).toBe('validation');
      expect(body.message).toBeDefined();
    });
  });

  // ── 15. resolvePersona ────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from AQE prefix API key', () => {
      const mockReq = {
        headers: { 'x-api-key': 'AQEyoungprofessional_abc123' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBe('youngprofessional');
    });

    it('should return null for missing API key', () => {
      const mockReq = {
        headers: {},
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });

    it('should return null for non-matching API key', () => {
      const mockReq = {
        headers: { 'x-api-key': 'some_random_key' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 16. Cross-surface seeding ─────────────────────────────────────────

  describe('Cross-surface seeding', () => {
    let seededTs: TestServer;

    beforeAll(async () => {
      const seededAdapter = new AdyenAdapter();
      const seedData = new Map<string, ExpandedData>([
        [
          'test-persona',
          {
            personaId: 'test-persona',
            blueprint: {} as Blueprint,
            tables: {},
            documents: {},
            apiResponses: {
              adyen: {
                adapterId: 'adyen',
                responses: {
                  payments: [
                    {
                      statusCode: 200,
                      headers: {},
                      body: {
                        pspReference: '1234567890123456',
                        resultCode: 'Authorised',
                        status: 'authorised',
                        amount: { value: 9900, currency: 'EUR' },
                      },
                      personaId: 'test-persona',
                      stateKey: 'adyen_payments',
                    },
                  ],
                },
              },
            },
            files: [],
            events: [],
            facts: [],
          },
        ],
      ]);
      seededTs = await buildTestServer(seededAdapter, seedData);
    });

    afterAll(async () => {
      await seededTs.close();
    });

    it('should allow capturing a pre-seeded payment', async () => {
      const res = await seededTs.server.inject({
        method: 'POST',
        url: '/adyen/v71/payments/1234567890123456/captures',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: 9900, currency: 'EUR' },
          merchantAccount: 'TestMerchant',
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().paymentPspReference).toBe('1234567890123456');
      expect(res.json().status).toBe('received');
    });
  });
});
