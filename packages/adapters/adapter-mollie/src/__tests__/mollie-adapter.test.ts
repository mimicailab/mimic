import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData, Blueprint } from '@mimicai/core';
import { MollieAdapter } from '../mollie-adapter.js';

describe('MollieAdapter', () => {
  let ts: TestServer;
  let adapter: MollieAdapter;

  beforeAll(async () => {
    adapter = new MollieAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('mollie');
      expect(adapter.name).toBe('Mollie API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/mollie/v2');
    });
  });

  // ── 2. Endpoints count ────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return the correct number of endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      // 5 customers + 5 payments + 5 refunds + 5 orders + 3 shipments
      // + 3 captures + 4 mandates + 5 subscriptions + 3 payment links
      // + 3 methods + 2 chargebacks + 4 settlements = 47
      expect(endpoints.length).toBe(47);
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
        url: '/mollie/v2/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'test@example.com', name: 'Test User' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.resource).toBe('customer');
      expect(body.id).toMatch(/^cst_/);
      expect(body.email).toBe('test@example.com');
      expect(body.name).toBe('Test User');
      expect(body.mode).toBe('test');
      expect(body._links.self).toBeDefined();
      customerId = body.id;
    });

    it('should get a customer by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(customerId);
      expect(body.email).toBe('test@example.com');
    });

    it('should list customers', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mollie/v2/customers',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBeGreaterThanOrEqual(1);
      expect(body._embedded.customers.length).toBeGreaterThanOrEqual(1);
      expect(body._links.self).toBeDefined();
    });

    it('should update a customer', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/mollie/v2/customers/${customerId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Updated User' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.name).toBe('Updated User');
      expect(body.email).toBe('test@example.com'); // unchanged
    });

    it('should delete a customer', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/mollie/v2/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('should return 404 for deleted customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 4. Payment lifecycle ──────────────────────────────────────────────

  describe('Payments', () => {
    let paymentId: string;

    it('should create a payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mollie/v2/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: '10.00', currency: 'EUR' },
          description: 'Test payment',
          redirectUrl: 'https://example.com/redirect',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.resource).toBe('payment');
      expect(body.id).toMatch(/^tr_/);
      expect(body.status).toBe('open');
      expect(body.isCancelable).toBe(true);
      expect(body.amount.value).toBe('10.00');
      expect(body.amount.currency).toBe('EUR');
      expect(body._links.checkout).toBeDefined();
      paymentId = body.id;
    });

    it('should reject payment without amount', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mollie/v2/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ description: 'No amount' }),
      });
      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.title).toBe('Unprocessable Entity');
      expect(body.field).toBe('amount');
    });

    it('should get a payment by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/payments/${paymentId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(paymentId);
    });

    it('should list payments', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mollie/v2/payments',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBeGreaterThanOrEqual(1);
      expect(body._embedded.payments.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a payment', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/mollie/v2/payments/${paymentId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ description: 'Updated description' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().description).toBe('Updated description');
    });

    it('should cancel a payment', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/mollie/v2/payments/${paymentId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('canceled');
      expect(body.isCancelable).toBe(false);
      expect(body.canceledAt).toBeDefined();
    });

    it('should not cancel an already canceled payment', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/mollie/v2/payments/${paymentId}`,
      });
      expect(res.statusCode).toBe(422);
    });
  });

  // ── 5. Refund lifecycle ───────────────────────────────────────────────

  describe('Refunds', () => {
    let paidPaymentId: string;
    let refundId: string;

    beforeAll(async () => {
      // Create a payment and transition it to "paid"
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/mollie/v2/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: '25.00', currency: 'EUR' },
          description: 'Refund test payment',
        }),
      });
      paidPaymentId = createRes.json().id;

      // Transition to paid via PATCH
      await ts.server.inject({
        method: 'PATCH',
        url: `/mollie/v2/payments/${paidPaymentId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ status: 'paid', paidAt: new Date().toISOString() }),
      });
    });

    it('should create a refund for a paid payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/mollie/v2/payments/${paidPaymentId}/refunds`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: '10.00', currency: 'EUR' },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.resource).toBe('refund');
      expect(body.id).toMatch(/^re_/);
      expect(body.status).toBe('pending');
      expect(body.paymentId).toBe(paidPaymentId);
      refundId = body.id;
    });

    it('should not refund a non-paid payment', async () => {
      // Create an open payment
      const openRes = await ts.server.inject({
        method: 'POST',
        url: '/mollie/v2/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: '5.00', currency: 'EUR' },
          description: 'Open payment',
        }),
      });
      const openId = openRes.json().id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/mollie/v2/payments/${openId}/refunds`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(422);
    });

    it('should list refunds for a payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/payments/${paidPaymentId}/refunds`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(1);
      expect(body._embedded.refunds[0].id).toBe(refundId);
    });

    it('should list all refunds', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mollie/v2/refunds',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBeGreaterThanOrEqual(1);
    });

    it('should cancel a pending refund', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/mollie/v2/payments/${paidPaymentId}/refunds/${refundId}`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 6. Order lifecycle ────────────────────────────────────────────────

  describe('Orders', () => {
    let orderId: string;

    it('should create an order', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mollie/v2/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: '100.00', currency: 'EUR' },
          orderNumber: 'ORD-001',
          lines: [
            {
              name: 'Widget',
              quantity: 2,
              unitPrice: { value: '50.00', currency: 'EUR' },
              totalAmount: { value: '100.00', currency: 'EUR' },
            },
          ],
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.resource).toBe('order');
      expect(body.id).toMatch(/^ord_/);
      expect(body.status).toBe('created');
      expect(body.lines.length).toBe(1);
      expect(body.lines[0].name).toBe('Widget');
      expect(body.lines[0].orderId).toBe(body.id);
      orderId = body.id;
    });

    it('should reject order without amount or lines', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mollie/v2/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ orderNumber: 'bad' }),
      });
      expect(res.statusCode).toBe(422);
    });

    it('should get an order by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/orders/${orderId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(orderId);
    });

    it('should cancel an order in created status', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/mollie/v2/orders/${orderId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('canceled');
    });

    it('should not cancel a non-created order', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/mollie/v2/orders/${orderId}`,
      });
      expect(res.statusCode).toBe(422);
    });
  });

  // ── 7. Shipments ──────────────────────────────────────────────────────

  describe('Shipments', () => {
    let orderId: string;
    let shipmentId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mollie/v2/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: '50.00', currency: 'EUR' },
          lines: [
            {
              name: 'Gadget',
              quantity: 1,
              unitPrice: { value: '50.00', currency: 'EUR' },
              totalAmount: { value: '50.00', currency: 'EUR' },
            },
          ],
        }),
      });
      orderId = res.json().id;
    });

    it('should create a shipment and transition order to shipping', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/mollie/v2/orders/${orderId}/shipments`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          tracking: { carrier: 'PostNL', code: '3S1234567890' },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.resource).toBe('shipment');
      expect(body.id).toMatch(/^shp_/);
      expect(body.orderId).toBe(orderId);
      shipmentId = body.id;

      // Verify order transitioned to shipping
      const orderRes = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/orders/${orderId}`,
      });
      expect(orderRes.json().status).toBe('shipping');
    });

    it('should list shipments for an order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/orders/${orderId}/shipments`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(1);
    });

    it('should get a shipment by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/orders/${orderId}/shipments/${shipmentId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(shipmentId);
    });
  });

  // ── 8. Captures ───────────────────────────────────────────────────────

  describe('Captures', () => {
    let paymentId: string;

    beforeAll(async () => {
      // Create a payment and transition to authorized
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/mollie/v2/payments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: '75.00', currency: 'EUR' },
          description: 'Capture test',
        }),
      });
      paymentId = createRes.json().id;
      await ts.server.inject({
        method: 'PATCH',
        url: `/mollie/v2/payments/${paymentId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ status: 'authorized' }),
      });
    });

    it('should capture an authorized payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/mollie/v2/payments/${paymentId}/captures`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.resource).toBe('capture');
      expect(body.id).toMatch(/^cpt_/);
      expect(body.paymentId).toBe(paymentId);

      // Verify payment transitioned to paid
      const paymentRes = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/payments/${paymentId}`,
      });
      expect(paymentRes.json().status).toBe('paid');
    });

    it('should not capture a non-authorized payment', async () => {
      // paymentId is now "paid", not "authorized"
      const res = await ts.server.inject({
        method: 'POST',
        url: `/mollie/v2/payments/${paymentId}/captures`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(422);
    });

    it('should list captures for a payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/payments/${paymentId}/captures`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(1);
    });
  });

  // ── 9. Mandates ───────────────────────────────────────────────────────

  describe('Mandates', () => {
    let customerId: string;
    let mandateId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mollie/v2/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Mandate Customer', email: 'mandate@test.com' }),
      });
      customerId = res.json().id;
    });

    it('should create a mandate', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/mollie/v2/customers/${customerId}/mandates`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          method: 'directdebit',
          consumerName: 'Test Consumer',
          consumerAccount: 'NL55INGB0000000000',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.resource).toBe('mandate');
      expect(body.id).toMatch(/^mdt_/);
      expect(body.status).toBe('valid');
      expect(body.details.consumerName).toBe('Test Consumer');
      mandateId = body.id;
    });

    it('should list mandates for a customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/customers/${customerId}/mandates`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(1);
    });

    it('should get a mandate by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/customers/${customerId}/mandates/${mandateId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(mandateId);
    });

    it('should revoke a mandate', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/mollie/v2/customers/${customerId}/mandates/${mandateId}`,
      });
      expect(res.statusCode).toBe(204);

      // Verify mandate is revoked
      const getRes = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/customers/${customerId}/mandates/${mandateId}`,
      });
      expect(getRes.json().status).toBe('revoked');
    });
  });

  // ── 10. Subscriptions ─────────────────────────────────────────────────

  describe('Subscriptions', () => {
    let customerId: string;
    let subscriptionId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mollie/v2/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Sub Customer', email: 'sub@test.com' }),
      });
      customerId = res.json().id;
    });

    it('should create a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/mollie/v2/customers/${customerId}/subscriptions`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: '25.00', currency: 'EUR' },
          interval: '1 month',
          description: 'Monthly plan',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.resource).toBe('subscription');
      expect(body.id).toMatch(/^sub_/);
      expect(body.status).toBe('active');
      expect(body.interval).toBe('1 month');
      expect(body.customerId).toBe(customerId);
      subscriptionId = body.id;
    });

    it('should list subscriptions for a customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/customers/${customerId}/subscriptions`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(1);
    });

    it('should update a subscription', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/mollie/v2/customers/${customerId}/subscriptions/${subscriptionId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ description: 'Updated plan' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().description).toBe('Updated plan');
    });

    it('should cancel a subscription', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/mollie/v2/customers/${customerId}/subscriptions/${subscriptionId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('canceled');
      expect(body.canceledAt).toBeDefined();
    });
  });

  // ── 11. Payment Links ─────────────────────────────────────────────────

  describe('Payment Links', () => {
    let linkId: string;

    it('should create a payment link', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/mollie/v2/payment-links',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: { value: '20.00', currency: 'EUR' },
          description: 'Donation',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.resource).toBe('payment-link');
      expect(body.id).toMatch(/^pl_/);
      expect(body._links.paymentLink).toBeDefined();
      linkId = body.id;
    });

    it('should list payment links', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mollie/v2/payment-links',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBeGreaterThanOrEqual(1);
    });

    it('should get a payment link by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/mollie/v2/payment-links/${linkId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(linkId);
    });
  });

  // ── 12. Methods ───────────────────────────────────────────────────────

  describe('Methods', () => {
    it('should list active payment methods', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mollie/v2/methods',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(6); // active subset
      expect(body._embedded.methods.some((m: any) => m.id === 'ideal')).toBe(true);
    });

    it('should list all payment methods', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mollie/v2/methods/all',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(17);
    });

    it('should get a specific payment method', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mollie/v2/methods/ideal',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe('ideal');
      expect(body.description).toBe('iDEAL');
    });

    it('should return 404 for unknown method', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mollie/v2/methods/unknown',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 13. Chargebacks ───────────────────────────────────────────────────

  describe('Chargebacks', () => {
    it('should list all chargebacks (empty initially)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mollie/v2/chargebacks',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(0);
    });
  });

  // ── 14. Settlements ───────────────────────────────────────────────────

  describe('Settlements', () => {
    it('should get next settlement', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mollie/v2/settlements/next',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.resource).toBe('settlement');
      expect(body.status).toBe('open');
    });

    it('should get open settlement', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mollie/v2/settlements/open',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().resource).toBe('settlement');
    });
  });

  // ── 15. Error handling ────────────────────────────────────────────────

  describe('Error handling', () => {
    it('should return Mollie RFC 7807 error format', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/mollie/v2/customers/cst_doesnotexist',
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.status).toBe(404);
      expect(body.title).toBe('Not Found');
      expect(body.detail).toContain('cst_doesnotexist');
      expect(body._links.documentation).toBeDefined();
    });
  });

  // ── 16. resolvePersona ────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from test_ Bearer token', () => {
      const mockReq = {
        headers: { authorization: 'Bearer test_youngprofessional' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBe('youngprofessional');
    });

    it('should return null for missing auth header', () => {
      const mockReq = {
        headers: {},
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });

    it('should return null for live_ tokens', () => {
      const mockReq = {
        headers: { authorization: 'Bearer live_somekey' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 17. Cross-surface seeding ─────────────────────────────────────────

  describe('Cross-surface seeding', () => {
    let seededTs: TestServer;

    beforeAll(async () => {
      const seededAdapter = new MollieAdapter();
      const seedData = new Map<string, ExpandedData>([
        [
          'test-persona',
          {
            personaId: 'test-persona',
            blueprint: {} as Blueprint,
            tables: {},
            documents: {},
            apiResponses: {
              mollie: {
                adapterId: 'mollie',
                responses: {
                  customers: [
                    {
                      statusCode: 200,
                      headers: {},
                      body: {
                        id: 'cst_seeded1',
                        name: 'Seeded Customer',
                        email: 'seeded@test.com',
                      },
                      personaId: 'test-persona',
                      stateKey: 'mollie_customers',
                    },
                  ],
                  payments: [
                    {
                      statusCode: 200,
                      headers: {},
                      body: {
                        id: 'tr_seeded1',
                        amount: { value: '42.00', currency: 'EUR' },
                        description: 'Seeded payment',
                        status: 'paid',
                      },
                      personaId: 'test-persona',
                      stateKey: 'mollie_payments',
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

    it('should list pre-seeded customers', async () => {
      const res = await seededTs.server.inject({
        method: 'GET',
        url: '/mollie/v2/customers',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(1);
      expect(body._embedded.customers[0].id).toBe('cst_seeded1');
      expect(body._embedded.customers[0].name).toBe('Seeded Customer');
    });

    it('should retrieve a pre-seeded payment', async () => {
      const res = await seededTs.server.inject({
        method: 'GET',
        url: '/mollie/v2/payments/tr_seeded1',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe('tr_seeded1');
      expect(body.status).toBe('paid');
      expect(body.resource).toBe('payment');
      expect(body.mode).toBe('test');
    });

    it('should allow creating new resources alongside seeded ones', async () => {
      await seededTs.server.inject({
        method: 'POST',
        url: '/mollie/v2/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'New Customer', email: 'new@test.com' }),
      });

      const res = await seededTs.server.inject({
        method: 'GET',
        url: '/mollie/v2/customers',
      });
      expect(res.json().count).toBe(2);
    });
  });
});
