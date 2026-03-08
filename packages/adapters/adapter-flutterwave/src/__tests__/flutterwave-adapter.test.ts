import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData } from '@mimicai/core';
import { FlutterwaveAdapter } from '../flutterwave-adapter.js';

describe('FlutterwaveAdapter', () => {
  let ts: TestServer;
  let adapter: FlutterwaveAdapter;

  beforeAll(async () => {
    adapter = new FlutterwaveAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ──────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('flutterwave');
      expect(adapter.name).toBe('Flutterwave API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/flutterwave/v3');
    });
  });

  // ── 2. Endpoints count ─────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return 41 endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(41);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Payments ─────────────────────────────────────────────────────────

  describe('Payments', () => {
    it('should create a payment (hosted link)', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          tx_ref: 'FLW-TEST-001',
          amount: 5000,
          currency: 'NGN',
          customer: { email: 'test@example.com' },
          redirect_url: 'https://example.com/callback',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('success');
      expect(body.data.link).toContain('checkout.flutterwave.com');
    });

    it('should create a card charge', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/charges?type=card',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          tx_ref: 'FLW-CARD-001',
          amount: 3000,
          currency: 'NGN',
          email: 'test@example.com',
          card_number: '4111111111111111',
          cvv: '123',
          expiry_month: '12',
          expiry_year: '27',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('success');
      expect(body.data.id).toBeDefined();
      expect(body.data.payment_type).toBe('card');
      expect(body.data.status).toBe('successful');
    });

    it('should create a bank_transfer charge', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/charges?type=bank_transfer',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          tx_ref: 'FLW-BT-001',
          amount: 10000,
          currency: 'NGN',
          email: 'test@example.com',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.payment_type).toBe('bank_transfer');
    });

    it('should create a pending charge with amount ending in .01', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/charges?type=card',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          tx_ref: 'FLW-PENDING-001',
          amount: 5000.01,
          currency: 'NGN',
          email: 'test@example.com',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.status).toBe('pending');
      expect(body.data.meta.authorization.mode).toBe('pin');
    });
  });

  // ── 4. Validate Charge ──────────────────────────────────────────────────

  describe('Validate Charge', () => {
    it('should validate a charge with OTP', async () => {
      // Create a pending charge first
      const chargeRes = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/charges?type=card',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          tx_ref: 'FLW-VAL-001',
          amount: 2000.01,
          currency: 'NGN',
          email: 'test@example.com',
        }),
      });
      const flwRef = chargeRes.json().data.flw_ref;

      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/validate-charge',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ flw_ref: flwRef, otp: '123456' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('successful');
    });

    it('should return 400 when missing flw_ref or otp', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/validate-charge',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 404 for unknown flw_ref', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/validate-charge',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ flw_ref: 'UNKNOWN-REF', otp: '123456' }),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 5. Transactions ─────────────────────────────────────────────────────

  describe('Transactions', () => {
    let txnId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/charges?type=card',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          tx_ref: 'FLW-TXN-TEST',
          amount: 1500,
          currency: 'NGN',
          email: 'test@example.com',
        }),
      });
      txnId = String(res.json().data.id);
    });

    it('should list transactions', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/transactions',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('success');
      expect(body.data).toBeInstanceOf(Array);
      expect(body.meta.page_info).toBeDefined();
    });

    it('should get a transaction', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/flutterwave/v3/transactions/${txnId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(parseInt(txnId));
    });

    it('should verify a transaction', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/flutterwave/v3/transactions/${txnId}/verify`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(parseInt(txnId));
    });

    it('should verify by tx_ref', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/transactions/verify_by_reference?tx_ref=FLW-TXN-TEST',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.tx_ref).toBe('FLW-TXN-TEST');
    });

    it('should return 400 when verify_by_reference missing tx_ref', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/transactions/verify_by_reference',
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 404 for unknown transaction', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/transactions/99999999',
      });
      expect(res.statusCode).toBe(404);
    });

    it('should refund a successful transaction', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/flutterwave/v3/transactions/${txnId}/refund`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 500 }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.status).toBe('completed');
      expect(body.data.amount_refunded).toBe(500);
    });

    it('should return 400 when refunding non-successful transaction', async () => {
      // txnId was already refunded (status = 'refunded')
      const res = await ts.server.inject({
        method: 'POST',
        url: `/flutterwave/v3/transactions/${txnId}/refund`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(400);
    });

    it('should calculate transaction fees', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/transactions/fee?amount=10000&currency=NGN',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.fee).toBeDefined();
      expect(body.data.charge_amount).toBeDefined();
      expect(body.data.stamp_duty_charge).toBe(50); // >= 10000 NGN
    });

    it('should calculate international fees', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/transactions/fee?amount=100&currency=USD',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.fee).toBeCloseTo(3.8); // 3.8% of 100
    });
  });

  // ── 6. Transfers ────────────────────────────────────────────────────────

  describe('Transfers', () => {
    let transferId: string;

    it('should create a transfer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/transfers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          account_bank: '044',
          account_number: '0690000040',
          amount: 50000,
          currency: 'NGN',
          narration: 'Test transfer',
          beneficiary_name: 'John Doe',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('success');
      expect(body.data.status).toBe('NEW');
      expect(body.data.amount).toBe(50000);
      transferId = String(body.data.id);
    });

    it('should list transfers', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/transfers',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeInstanceOf(Array);
    });

    it('should get a transfer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/flutterwave/v3/transfers/${transferId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(parseInt(transferId));
    });

    it('should return 404 for unknown transfer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/transfers/99999999',
      });
      expect(res.statusCode).toBe(404);
    });

    it('should create a bulk transfer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/bulk-transfers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          title: 'Bulk test',
          bulk_data: [
            { account_bank: '044', account_number: '0690000040', amount: 1000, currency: 'NGN' },
            { account_bank: '058', account_number: '0690000041', amount: 2000, currency: 'NGN' },
          ],
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBeDefined();
    });
  });

  // ── 7. Beneficiaries ────────────────────────────────────────────────────

  describe('Beneficiaries', () => {
    let beneficiaryId: string;

    it('should create a beneficiary', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/beneficiaries',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          account_number: '0690000040',
          account_bank: '044',
          beneficiary_name: 'Jane Doe',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.full_name).toBe('Jane Doe');
      beneficiaryId = String(body.data.id);
    });

    it('should list beneficiaries', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/beneficiaries',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeInstanceOf(Array);
    });

    it('should get a beneficiary', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/flutterwave/v3/beneficiaries/${beneficiaryId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(parseInt(beneficiaryId));
    });

    it('should delete a beneficiary', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/flutterwave/v3/beneficiaries/${beneficiaryId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('success');
    });

    it('should return 404 for deleted beneficiary', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/flutterwave/v3/beneficiaries/${beneficiaryId}`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 8. Subaccounts ──────────────────────────────────────────────────────

  describe('Subaccounts', () => {
    let subaccountId: string;

    it('should create a subaccount', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/subaccounts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          account_bank: '044',
          account_number: '0690000040',
          business_name: 'Test Vendor',
          split_type: 'percentage',
          split_value: 0.2,
          country: 'NG',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.business_name).toBe('Test Vendor');
      expect(body.data.subaccount_id).toMatch(/^RS_/);
      subaccountId = String(body.data.id);
    });

    it('should list subaccounts', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/subaccounts',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeInstanceOf(Array);
    });

    it('should get a subaccount', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/flutterwave/v3/subaccounts/${subaccountId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(parseInt(subaccountId));
    });

    it('should update a subaccount', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `/flutterwave/v3/subaccounts/${subaccountId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ business_name: 'Updated Vendor', split_value: 0.3 }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.business_name).toBe('Updated Vendor');
      expect(res.json().data.split_value).toBe(0.3);
    });

    it('should delete a subaccount', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/flutterwave/v3/subaccounts/${subaccountId}`,
      });
      expect(res.statusCode).toBe(200);
    });

    it('should return 404 for deleted subaccount', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/flutterwave/v3/subaccounts/${subaccountId}`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 9. Payment Plans ────────────────────────────────────────────────────

  describe('Payment Plans', () => {
    let planId: string;

    it('should create a payment plan', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/payment-plans',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          name: 'Monthly Premium',
          amount: 5000,
          interval: 'monthly',
          currency: 'NGN',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.name).toBe('Monthly Premium');
      expect(body.data.status).toBe('active');
      expect(body.data.plan_token).toMatch(/^FLW-PLN-/);
      planId = String(body.data.id);
    });

    it('should list payment plans', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/payment-plans',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should get a payment plan', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/flutterwave/v3/payment-plans/${planId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(parseInt(planId));
    });

    it('should cancel a payment plan', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `/flutterwave/v3/payment-plans/${planId}/cancel`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('cancelled');
    });

    it('should return 400 when cancelling already cancelled plan', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `/flutterwave/v3/payment-plans/${planId}/cancel`,
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 404 for unknown payment plan', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/payment-plans/99999999',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 10. Subscriptions ───────────────────────────────────────────────────

  describe('Subscriptions', () => {
    it('should list subscriptions (initially empty)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/subscriptions',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeInstanceOf(Array);
    });

    it('should return 404 for unknown subscription activate', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: '/flutterwave/v3/subscriptions/99999999/activate',
      });
      expect(res.statusCode).toBe(404);
    });

    it('should return 404 for unknown subscription cancel', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: '/flutterwave/v3/subscriptions/99999999/cancel',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 11. Virtual Account Numbers ─────────────────────────────────────────

  describe('Virtual Account Numbers', () => {
    let orderRef: string;

    it('should create a virtual account', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/virtual-account-numbers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          tx_ref: 'FLW-VA-TEST-001',
          amount: 5000,
          email: 'test@example.com',
          currency: 'NGN',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.account_number).toBeDefined();
      expect(body.data.bank_name).toBeDefined();
      orderRef = body.data.order_ref;
    });

    it('should get a virtual account', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/flutterwave/v3/virtual-account-numbers/${orderRef}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.order_ref).toBe(orderRef);
    });

    it('should return 404 for unknown virtual account', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/virtual-account-numbers/UNKNOWN-REF',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 12. Bill Payments ───────────────────────────────────────────────────

  describe('Bill Payments', () => {
    it('should create a bill payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/bills',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          customer: '+2348012345678',
          amount: 500,
          type: 'AIRTIME',
          country: 'NG',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.status).toBe('successful');
      expect(body.data.type).toBe('AIRTIME');
    });

    it('should list bills', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/bills',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeInstanceOf(Array);
    });

    it('should get bill categories', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/bill-categories',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBeGreaterThanOrEqual(5);
      expect(body.data[0].biller_code).toBeDefined();
    });
  });

  // ── 13. Settlements ─────────────────────────────────────────────────────

  describe('Settlements', () => {
    it('should list settlements (initially empty)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/settlements',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeInstanceOf(Array);
    });

    it('should return 404 for unknown settlement', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/settlements/99999999',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 14. Chargebacks ─────────────────────────────────────────────────────

  describe('Chargebacks', () => {
    it('should list chargebacks (initially empty)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/chargebacks',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeInstanceOf(Array);
    });

    it('should accept a chargeback (auto-creates)', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/chargebacks/12345',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ action: 'accept', comment: 'Accept this chargeback' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('accepted');
    });

    it('should decline a chargeback', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/flutterwave/v3/chargebacks/12346',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ action: 'decline', comment: 'Disputed' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('declined');
    });
  });

  // ── 15. Balances ────────────────────────────────────────────────────────

  describe('Balances', () => {
    it('should get all balances', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/balances',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBe(4);
      expect(body.data[0].currency).toBe('NGN');
    });

    it('should get balance by currency', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/balances/NGN',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.currency).toBe('NGN');
      expect(body.data.available_balance).toBeDefined();
    });

    it('should return 404 for unsupported currency', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/balances/XYZ',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 16. Banks ───────────────────────────────────────────────────────────

  describe('Banks', () => {
    it('should list Nigerian banks', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/banks/NG',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(19);
      expect(body.data[0].code).toBeDefined();
    });

    it('should list Kenyan banks', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/banks/KE',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBe(5);
    });

    it('should return empty array for unsupported country', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/banks/XX',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([]);
    });
  });

  // ── 17. resolvePersona ─────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from FLWSECK_TEST- prefix', () => {
      const mockReq = {
        headers: { authorization: 'Bearer FLWSECK_TEST-young-pro-abc123xyz' },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBe('young-pro');
    });

    it('should extract persona from FLWSECK- prefix', () => {
      const mockReq = {
        headers: { authorization: 'Bearer FLWSECK-freelancer-xyz789' },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBe('freelancer');
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

  // ── 18. Cross-surface seeding ──────────────────────────────────────────

  describe('cross-surface seeding', () => {
    it('should seed transactions from apiResponses', async () => {
      const seededAdapter = new FlutterwaveAdapter();
      const seedData = new Map<string, ExpandedData>([
        [
          'test-persona',
          {
            persona: 'test' as any,
            blueprint: {} as any,
            tables: {},
            facts: [],
            apiResponses: {
              flutterwave: {
                responses: {
                  transactions: [
                    {
                      status: 200,
                      body: {
                        id: 9999999,
                        tx_ref: 'SEEDED-TX-001',
                        amount: 25000,
                        currency: 'NGN',
                        status: 'successful',
                        payment_type: 'card',
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

      const res = await seededTs.server.inject({
        method: 'GET',
        url: '/flutterwave/v3/transactions/9999999',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(9999999);
      expect(res.json().data.tx_ref).toBe('SEEDED-TX-001');

      await seededTs.close();
    });
  });
});
