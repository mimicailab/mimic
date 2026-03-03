/**
 * End-to-end integration test for the Stripe mock adapter.
 * Tests the full lifecycle: customers, payment intents, subscriptions, invoices, refunds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import { StripeAdapter } from '../stripe-adapter.js';

describe('Stripe E2E Lifecycle', () => {
  let ts: TestServer;

  beforeAll(async () => {
    const adapter = new StripeAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  it('should run a full billing lifecycle', async () => {
    // ── 1. Create a customer ──────────────────────────────────
    const createCust = await ts.server.inject({
      method: 'POST',
      url: '/stripe/v1/customers',
      payload: { name: 'Jane Doe', email: 'jane@acme.com', phone: '+15551234567' },
    });
    expect(createCust.statusCode).toBe(200);
    const cust = createCust.json();
    expect(cust.id).toMatch(/^cus_/);
    expect(cust.name).toBe('Jane Doe');
    expect(cust.email).toBe('jane@acme.com');
    console.log(`✓ Created customer: ${cust.id}`);

    // ── 2. Create a product + price ───────────────────────────
    const createProd = await ts.server.inject({
      method: 'POST',
      url: '/stripe/v1/products',
      payload: { name: 'Pro Plan' },
    });
    expect(createProd.statusCode).toBe(200);
    const prod = createProd.json();
    expect(prod.id).toMatch(/^prod_/);
    console.log(`✓ Created product: ${prod.id} "${prod.name}"`);

    const createPrice = await ts.server.inject({
      method: 'POST',
      url: '/stripe/v1/prices',
      payload: { unit_amount: 9900, currency: 'usd', product: prod.id, recurring: { interval: 'month' } },
    });
    expect(createPrice.statusCode).toBe(200);
    const price = createPrice.json();
    expect(price.id).toMatch(/^price_/);
    expect(price.unit_amount).toBe(9900);
    console.log(`✓ Created price: ${price.id} $${(price.unit_amount / 100).toFixed(2)}/month`);

    // ── 3. Create a subscription ──────────────────────────────
    const createSub = await ts.server.inject({
      method: 'POST',
      url: '/stripe/v1/subscriptions',
      payload: { customer: cust.id, price: price.id },
    });
    expect(createSub.statusCode).toBe(200);
    const sub = createSub.json();
    expect(sub.id).toMatch(/^sub_/);
    expect(sub.status).toBe('active');
    expect(sub.customer).toBe(cust.id);
    console.log(`✓ Created subscription: ${sub.id} [${sub.status}]`);

    // ── 4. Create a payment intent + confirm ──────────────────
    const createPI = await ts.server.inject({
      method: 'POST',
      url: '/stripe/v1/payment_intents',
      payload: { amount: 9900, currency: 'usd', customer: cust.id, description: 'Pro plan monthly' },
    });
    expect(createPI.statusCode).toBe(200);
    const pi = createPI.json();
    expect(pi.id).toMatch(/^pi_/);
    expect(pi.status).toBe('requires_payment_method');
    expect(pi.amount).toBe(9900);
    console.log(`✓ Created PI: ${pi.id} $${(pi.amount / 100).toFixed(2)} [${pi.status}]`);

    const confirmPI = await ts.server.inject({
      method: 'POST',
      url: `/stripe/v1/payment_intents/${pi.id}/confirm`,
    });
    expect(confirmPI.statusCode).toBe(200);
    const confirmedPI = confirmPI.json();
    expect(confirmedPI.status).toBe('succeeded');
    expect(confirmedPI.latest_charge).toMatch(/^ch_/);
    console.log(`✓ Confirmed PI: ${confirmedPI.id} → ${confirmedPI.status}, charge: ${confirmedPI.latest_charge}`);

    // ── 5. Verify charge was created ──────────────────────────
    const listCharges = await ts.server.inject({ method: 'GET', url: '/stripe/v1/charges' });
    const charges = listCharges.json();
    expect(charges.object).toBe('list');
    expect(charges.data.length).toBeGreaterThanOrEqual(1);
    const charge = charges.data.find((c: any) => c.payment_intent === pi.id);
    expect(charge).toBeDefined();
    expect(charge.amount).toBe(9900);
    expect(charge.status).toBe('succeeded');
    console.log(`✓ Charge verified: ${charge.id} $${(charge.amount / 100).toFixed(2)} [${charge.status}]`);

    // ── 6. Create invoice + pay ───────────────────────────────
    const createInv = await ts.server.inject({
      method: 'POST',
      url: '/stripe/v1/invoices',
      payload: { customer: cust.id },
    });
    expect(createInv.statusCode).toBe(200);
    const inv = createInv.json();
    expect(inv.id).toMatch(/^in_/);
    expect(inv.status).toBe('draft');
    console.log(`✓ Created invoice: ${inv.id} [${inv.status}]`);

    const payInv = await ts.server.inject({
      method: 'POST',
      url: `/stripe/v1/invoices/${inv.id}/pay`,
    });
    expect(payInv.statusCode).toBe(200);
    const paidInv = payInv.json();
    expect(paidInv.status).toBe('paid');
    console.log(`✓ Paid invoice: ${paidInv.id} [${paidInv.status}]`);

    // ── 7. Create refund ──────────────────────────────────────
    const createRefund = await ts.server.inject({
      method: 'POST',
      url: '/stripe/v1/refunds',
      payload: { payment_intent: pi.id, amount: 5000, reason: 'requested_by_customer' },
    });
    expect(createRefund.statusCode).toBe(200);
    const refund = createRefund.json();
    expect(refund.id).toMatch(/^re_/);
    expect(refund.amount).toBe(5000);
    expect(refund.status).toBe('succeeded');
    console.log(`✓ Created refund: ${refund.id} $${(refund.amount / 100).toFixed(2)} [${refund.status}]`);

    // ── 8. Cancel subscription ────────────────────────────────
    const cancelSub = await ts.server.inject({
      method: 'DELETE',
      url: `/stripe/v1/subscriptions/${sub.id}`,
    });
    expect(cancelSub.statusCode).toBe(200);
    const canceledSub = cancelSub.json();
    expect(canceledSub.status).toBe('canceled');
    console.log(`✓ Cancelled subscription: ${canceledSub.id} [${canceledSub.status}]`);

    // ── 9. Get balance ────────────────────────────────────────
    const balance = await ts.server.inject({ method: 'GET', url: '/stripe/v1/balance' });
    expect(balance.statusCode).toBe(200);
    const bal = balance.json();
    expect(bal.object).toBe('balance');
    expect(bal.available[0].amount).toBeGreaterThan(0);
    console.log(`✓ Balance: $${(bal.available[0].amount / 100).toFixed(2)} available, $${(bal.pending[0].amount / 100).toFixed(2)} pending`);

    // ── 10. List all resources ────────────────────────────────
    const [custs, subs, invs, refunds, prods, prices] = await Promise.all([
      ts.server.inject({ method: 'GET', url: '/stripe/v1/customers' }).then(r => r.json()),
      ts.server.inject({ method: 'GET', url: '/stripe/v1/subscriptions' }).then(r => r.json()),
      ts.server.inject({ method: 'GET', url: '/stripe/v1/invoices' }).then(r => r.json()),
      ts.server.inject({ method: 'GET', url: '/stripe/v1/refunds' }).then(r => r.json()),
      ts.server.inject({ method: 'GET', url: '/stripe/v1/products' }).then(r => r.json()),
      ts.server.inject({ method: 'GET', url: '/stripe/v1/prices' }).then(r => r.json()),
    ]);

    console.log('\n── Final State ──');
    console.log(`Customers: ${custs.data.length}`);
    console.log(`Subscriptions: ${subs.data.length} (${subs.data.map((s: any) => s.status).join(', ')})`);
    console.log(`Invoices: ${invs.data.length} (${invs.data.map((i: any) => i.status).join(', ')})`);
    console.log(`Refunds: ${refunds.data.length}`);
    console.log(`Products: ${prods.data.length}`);
    console.log(`Prices: ${prices.data.length}`);

    // ── 11. Error handling ────────────────────────────────────
    const notFound = await ts.server.inject({ method: 'GET', url: '/stripe/v1/customers/cus_nonexistent' });
    expect(notFound.statusCode).toBe(404);
    const err = notFound.json();
    expect(err.error.type).toBe('invalid_request_error');
    expect(err.error.code).toBe('resource_missing');
    console.log(`\n✓ 404 returns proper Stripe error format: ${err.error.code}`);
  });
});
