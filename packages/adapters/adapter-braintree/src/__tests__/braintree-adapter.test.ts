import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData } from '@mimicai/core';
import { BraintreeAdapter } from '../braintree-adapter.js';

describe('BraintreeAdapter', () => {
  let ts: TestServer;
  let adapter: BraintreeAdapter;
  const mp = '/braintree/merchants/test_merchant';

  beforeAll(async () => {
    adapter = new BraintreeAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ──────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('braintree');
      expect(adapter.name).toBe('Braintree API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/braintree');
    });
  });

  // ── 2. Endpoints count ─────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return 25 endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(25);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Client Token ─────────────────────────────────────────────────────

  describe('Client Token', () => {
    it('should generate a client token', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/client_token`,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.clientToken).toBeDefined();
      // Should be base64-encoded JSON
      const decoded = JSON.parse(Buffer.from(body.clientToken, 'base64').toString());
      expect(decoded.authorizationFingerprint).toBeDefined();
    });
  });

  // ── 4. Transactions ─────────────────────────────────────────────────────

  describe('Transactions', () => {
    let txnId: string;

    it('should create a transaction (authorized)', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: '100.00',
          type: 'sale',
          orderId: 'order-123',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.transaction.id).toBeDefined();
      expect(body.transaction.status).toBe('authorized');
      expect(body.transaction.amount).toBe('100.00');
      expect(body.transaction.processorResponseCode).toBe('1000');
      expect(body.transaction.processorResponseText).toBe('Approved');
      expect(body.transaction.creditCard.last4).toBe('1111');
      txnId = body.transaction.id;
    });

    it('should create a transaction with submitForSettlement', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: '50.00',
          options: { submitForSettlement: true },
        }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().transaction.status).toBe('submitted_for_settlement');
    });

    it('should return 422 when amount is missing', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ type: 'sale' }),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().errors.code).toBe('81502');
    });

    it('should decline transaction with amount 2000.00', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: '2000.00' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().transaction.status).toBe('processor_declined');
      expect(res.json().transaction.processorResponseCode).toBe('2000');
    });

    it('should gateway reject transaction with amount 3000.00', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: '3000.00' }),
      });
      expect(res.statusCode).toBe(201);
      const txn = res.json().transaction;
      expect(txn.status).toBe('gateway_rejected');
      expect(txn.gatewayRejectionReason).toBe('fraud');
    });

    it('should get a transaction', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${mp}/transactions/${txnId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().transaction.id).toBe(txnId);
    });

    it('should return 404 for unknown transaction', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${mp}/transactions/UNKNOWN`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().errors.message).toBe('Transaction not found');
    });

    it('should search transactions', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions/search`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().transactions).toBeInstanceOf(Array);
      expect(res.json().transactions.length).toBeGreaterThanOrEqual(1);
    });

    it('should submit for settlement', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${mp}/transactions/${txnId}/submit_for_settlement`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().transaction.status).toBe('submitted_for_settlement');
    });

    it('should reject submitting already-settled transaction', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${mp}/transactions/${txnId}/submit_for_settlement`,
      });
      expect(res.statusCode).toBe(422);
    });

    it('should void a transaction', async () => {
      // Create fresh authorized txn
      const createRes = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: '25.00' }),
      });
      const voidTxnId = createRes.json().transaction.id;

      const res = await ts.server.inject({
        method: 'PUT',
        url: `${mp}/transactions/${voidTxnId}/void`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().transaction.status).toBe('voided');
    });

    it('should reject voiding a voided transaction', async () => {
      // Create and void
      const createRes = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: '10.00' }),
      });
      const id = createRes.json().transaction.id;
      await ts.server.inject({
        method: 'PUT',
        url: `${mp}/transactions/${id}/void`,
      });

      const res = await ts.server.inject({
        method: 'PUT',
        url: `${mp}/transactions/${id}/void`,
      });
      expect(res.statusCode).toBe(422);
    });

    it('should refund a submitted transaction', async () => {
      // txnId is now submitted_for_settlement
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions/${txnId}/refund`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(201);
      const refund = res.json().transaction;
      expect(refund.type).toBe('credit');
      expect(refund.refundedTransactionId).toBe(txnId);
      expect(refund.amount).toBe('100.00');
    });

    it('should partial refund a transaction', async () => {
      // Create and submit for settlement
      const createRes = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: '200.00',
          options: { submitForSettlement: true },
        }),
      });
      const partialId = createRes.json().transaction.id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions/${partialId}/refund`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: '50.00' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().transaction.amount).toBe('50.00');

      // Check original is partially_refunded
      const getRes = await ts.server.inject({
        method: 'GET',
        url: `${mp}/transactions/${partialId}`,
      });
      expect(getRes.json().transaction.status).toBe('partially_refunded');
    });

    it('should reject refunding an authorized transaction', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: '30.00' }),
      });
      const authId = createRes.json().transaction.id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions/${authId}/refund`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(422);
    });

    it('should partial settle a transaction', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: '150.00' }),
      });
      const parentId = createRes.json().transaction.id;

      const res = await ts.server.inject({
        method: 'PUT',
        url: `${mp}/transactions/${parentId}/partial_settlement`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: '75.00' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().transaction.amount).toBe('75.00');
      expect(res.json().transaction.parentTransactionId).toBe(parentId);
    });
  });

  // ── 5. Customers ────────────────────────────────────────────────────────

  describe('Customers', () => {
    let custId: string;

    it('should create a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/customers`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '555-1234',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.customer.id).toBeDefined();
      expect(body.customer.firstName).toBe('John');
      expect(body.customer.lastName).toBe('Doe');
      expect(body.customer.email).toBe('john@example.com');
      custId = body.customer.id;
    });

    it('should create a customer with a custom ID', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/customers`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ id: 'custom-id-123', firstName: 'Jane' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().customer.id).toBe('custom-id-123');
    });

    it('should get a customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${mp}/customers/${custId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().customer.id).toBe(custId);
    });

    it('should update a customer', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${mp}/customers/${custId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ firstName: 'Jonathan' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().customer.firstName).toBe('Jonathan');
    });

    it('should return 404 for unknown customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${mp}/customers/UNKNOWN`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().errors.message).toBe('Customer not found');
    });

    it('should delete a customer', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${mp}/customers/${custId}`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('should return 404 when getting deleted customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${mp}/customers/${custId}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('should search customers', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/customers/search`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().customers).toBeInstanceOf(Array);
    });
  });

  // ── 6. Payment Methods ──────────────────────────────────────────────────

  describe('Payment Methods', () => {
    let pmToken: string;

    it('should create a payment method', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/payment_methods`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          customerId: 'cust-001',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.paymentMethod.token).toBeDefined();
      expect(body.paymentMethod.cardType).toBe('Visa');
      expect(body.paymentMethod.last4).toBe('1111');
      pmToken = body.paymentMethod.token;
    });

    it('should create a payment method with custom token', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/payment_methods`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ token: 'my-custom-token', customerId: 'cust-002' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().paymentMethod.token).toBe('my-custom-token');
    });

    it('should get a payment method', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${mp}/payment_methods/${pmToken}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().paymentMethod.token).toBe(pmToken);
    });

    it('should update a payment method', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${mp}/payment_methods/${pmToken}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ default: true }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().paymentMethod.default).toBe(true);
    });

    it('should return 404 for unknown payment method', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${mp}/payment_methods/UNKNOWN`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('should delete a payment method', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `${mp}/payment_methods/${pmToken}`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('should return 404 for deleted payment method', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${mp}/payment_methods/${pmToken}`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 7. Subscriptions ────────────────────────────────────────────────────

  describe('Subscriptions', () => {
    let subId: string;

    it('should create a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/subscriptions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          planId: 'premium-monthly',
          paymentMethodToken: 'pm-token-001',
          price: '19.99',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.subscription.id).toBeDefined();
      expect(body.subscription.status).toBe('Active');
      expect(body.subscription.planId).toBe('premium-monthly');
      expect(body.subscription.price).toBe('19.99');
      expect(body.subscription.currentBillingCycle).toBe(1);
      subId = body.subscription.id;
    });

    it('should get a subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${mp}/subscriptions/${subId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscription.id).toBe(subId);
    });

    it('should cancel a subscription', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${mp}/subscriptions/${subId}/cancel`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscription.status).toBe('Canceled');
    });

    it('should return 404 for unknown subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${mp}/subscriptions/UNKNOWN`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 8. Plans ────────────────────────────────────────────────────────────

  describe('Plans', () => {
    it('should list plans (initially empty)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${mp}/plans`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().plans).toBeInstanceOf(Array);
    });
  });

  // ── 9. Disputes ─────────────────────────────────────────────────────────

  describe('Disputes', () => {
    let disputeId: string;

    it('should search disputes (generates samples)', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/disputes/search`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.disputes).toBeInstanceOf(Array);
      expect(body.disputes.length).toBeGreaterThanOrEqual(2);
      disputeId = body.disputes[0].id;
    });

    it('should get a dispute', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${mp}/disputes/${disputeId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().dispute.id).toBe(disputeId);
    });

    it('should accept a dispute', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `${mp}/disputes/${disputeId}/accept`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().dispute.status).toBe('accepted');
    });

    it('should add dispute evidence', async () => {
      // Use second dispute
      const searchRes = await ts.server.inject({
        method: 'POST',
        url: `${mp}/disputes/search`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      const id2 = searchRes.json().disputes[1].id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `${mp}/disputes/${id2}/evidence`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ comment: 'Shipment tracking info' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().evidence.disputeId).toBe(id2);
      expect(res.json().evidence.comment).toBe('Shipment tracking info');
    });

    it('should return 404 for unknown dispute', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `${mp}/disputes/UNKNOWN`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 10. Transaction lifecycle: authorize -> settle -> refund ──────────

  describe('Transaction lifecycle', () => {
    it('should follow authorized -> submitted_for_settlement -> refunded', async () => {
      // Step 1: Create authorized
      const createRes = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: '500.00' }),
      });
      const id = createRes.json().transaction.id;
      expect(createRes.json().transaction.status).toBe('authorized');

      // Step 2: Submit for settlement
      const settleRes = await ts.server.inject({
        method: 'PUT',
        url: `${mp}/transactions/${id}/submit_for_settlement`,
      });
      expect(settleRes.json().transaction.status).toBe('submitted_for_settlement');

      // Step 3: Refund
      const refundRes = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions/${id}/refund`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(refundRes.statusCode).toBe(201);
      expect(refundRes.json().transaction.type).toBe('credit');

      // Step 4: Check original is refunded
      const getRes = await ts.server.inject({
        method: 'GET',
        url: `${mp}/transactions/${id}`,
      });
      expect(getRes.json().transaction.status).toBe('refunded');
    });

    it('should follow authorized -> voided', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: `${mp}/transactions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: '75.00' }),
      });
      const id = createRes.json().transaction.id;

      const voidRes = await ts.server.inject({
        method: 'PUT',
        url: `${mp}/transactions/${id}/void`,
      });
      expect(voidRes.json().transaction.status).toBe('voided');

      // Cannot void again
      const voidAgain = await ts.server.inject({
        method: 'PUT',
        url: `${mp}/transactions/${id}/void`,
      });
      expect(voidAgain.statusCode).toBe(422);

      // Cannot settle voided
      const settleVoided = await ts.server.inject({
        method: 'PUT',
        url: `${mp}/transactions/${id}/submit_for_settlement`,
      });
      expect(settleVoided.statusCode).toBe(422);
    });
  });

  // ── 11. resolvePersona ─────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Basic auth public key', () => {
      const encoded = Buffer.from('young-pro:private_key_here').toString('base64');
      const mockReq = {
        headers: { authorization: `Basic ${encoded}` },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBe('young-pro');
    });

    it('should return null for non-matching auth', () => {
      const mockReq = {
        headers: { authorization: 'Bearer some-token' },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });

    it('should return null for missing auth header', () => {
      const mockReq = { headers: {} } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 12. Cross-surface seeding ──────────────────────────────────────────

  describe('cross-surface seeding', () => {
    it('should seed transactions from apiResponses', async () => {
      const seededAdapter = new BraintreeAdapter();
      const seedData = new Map<string, ExpandedData>([
        [
          'test-persona',
          {
            persona: 'test' as any,
            blueprint: {} as any,
            tables: {},
            facts: [],
            apiResponses: {
              braintree: {
                responses: {
                  transactions: [
                    {
                      status: 200,
                      body: {
                        id: 'SEEDED-TXN-001',
                        type: 'sale',
                        amount: '999.00',
                        status: 'settled',
                        processorResponseCode: '1000',
                      },
                    },
                  ],
                  customers: [
                    {
                      status: 200,
                      body: {
                        id: 'SEEDED-CUST-001',
                        firstName: 'Seeded',
                        lastName: 'Customer',
                        email: 'seeded@example.com',
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

      // Verify seeded transaction
      const txnRes = await seededTs.server.inject({
        method: 'GET',
        url: `${mp}/transactions/SEEDED-TXN-001`,
      });
      expect(txnRes.statusCode).toBe(200);
      expect(txnRes.json().transaction.id).toBe('SEEDED-TXN-001');
      expect(txnRes.json().transaction.amount).toBe('999.00');

      // Verify seeded customer
      const custRes = await seededTs.server.inject({
        method: 'GET',
        url: `${mp}/customers/SEEDED-CUST-001`,
      });
      expect(custRes.statusCode).toBe(200);
      expect(custRes.json().customer.id).toBe('SEEDED-CUST-001');
      expect(custRes.json().customer.firstName).toBe('Seeded');

      await seededTs.close();
    });
  });
});
