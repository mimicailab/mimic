import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData } from '@mimicai/core';
import { SquareAdapter } from '../square-adapter.js';

describe('SquareAdapter', () => {
  let ts: TestServer;
  let adapter: SquareAdapter;

  beforeAll(async () => {
    adapter = new SquareAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  const json = (payload: unknown) => ({
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  });

  // ── 1. Metadata ──────────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('square');
      expect(adapter.name).toBe('Square API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/square/v2');
    });
  });

  describe('getEndpoints', () => {
    it('should return 57 endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(57);
    });
  });

  // ── 2. Payments ──────────────────────────────────────────────────────

  describe('Payments', () => {
    let paymentId: string;

    it('should create a payment', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/payments',
        ...json({ amount_money: { amount: 1500, currency: 'USD' }, idempotency_key: 'pay-1' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.payment.id).toBeDefined();
      expect(body.payment.status).toBe('COMPLETED');
      expect(body.payment.amount_money.amount).toBe(1500);
      paymentId = body.payment.id;
    });

    it('should handle idempotency', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/payments',
        ...json({ amount_money: { amount: 9999, currency: 'USD' }, idempotency_key: 'pay-1' }),
      });
      expect(res.json().payment.id).toBe(paymentId);
      expect(res.json().payment.amount_money.amount).toBe(1500); // original amount
    });

    it('should get a payment', async () => {
      const res = await ts.server.inject({ method: 'GET', url: `/square/v2/payments/${paymentId}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().payment.id).toBe(paymentId);
    });

    it('should list payments', async () => {
      const res = await ts.server.inject({ method: 'GET', url: '/square/v2/payments' });
      expect(res.json().payments.length).toBeGreaterThanOrEqual(1);
    });

    it('should cancel a payment', async () => {
      const res = await ts.server.inject({ method: 'POST', url: `/square/v2/payments/${paymentId}/cancel` });
      expect(res.json().payment.status).toBe('CANCELED');
    });

    it('should return 404 for unknown payment', async () => {
      const res = await ts.server.inject({ method: 'GET', url: '/square/v2/payments/unknown' });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 3. Refunds ───────────────────────────────────────────────────────

  describe('Refunds', () => {
    let refundId: string;

    it('should create a refund', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/refunds',
        ...json({ payment_id: 'some-payment', amount_money: { amount: 500, currency: 'USD' }, reason: 'Customer request' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().refund.status).toBe('COMPLETED');
      refundId = res.json().refund.id;
    });

    it('should get a refund', async () => {
      const res = await ts.server.inject({ method: 'GET', url: `/square/v2/refunds/${refundId}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().refund.amount_money.amount).toBe(500);
    });

    it('should list refunds', async () => {
      const res = await ts.server.inject({ method: 'GET', url: '/square/v2/refunds' });
      expect(res.json().refunds.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 4. Orders ────────────────────────────────────────────────────────

  describe('Orders', () => {
    let orderId: string;

    it('should create an order', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/orders',
        ...json({
          order: {
            location_id: 'loc-001',
            line_items: [
              { name: 'Widget', quantity: '2', base_price_money: { amount: 1000, currency: 'USD' } },
            ],
          },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.order.state).toBe('OPEN');
      expect(body.order.total_money.amount).toBe(2000);
      orderId = body.order.id;
    });

    it('should get an order', async () => {
      const res = await ts.server.inject({ method: 'GET', url: `/square/v2/orders/${orderId}` });
      expect(res.json().order.id).toBe(orderId);
    });

    it('should search orders', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/orders/search',
        ...json({ query: { filter: { state_filter: { states: ['OPEN'] } } } }),
      });
      expect(res.json().orders.length).toBeGreaterThanOrEqual(1);
    });

    it('should calculate an order', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/orders/calculate',
        ...json({
          order: { line_items: [{ name: 'Item', quantity: '3', base_price_money: { amount: 500, currency: 'USD' } }] },
        }),
      });
      expect(res.json().order.total_money.amount).toBe(1500);
    });
  });

  // ── 5. Catalog ───────────────────────────────────────────────────────

  describe('Catalog', () => {
    let catalogId: string;

    it('should upsert a catalog object', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/catalog/object',
        ...json({
          idempotency_key: 'cat-1',
          object: { type: 'ITEM', item_data: { name: 'Coffee' } },
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().catalog_object.type).toBe('ITEM');
      catalogId = res.json().catalog_object.id;
    });

    it('should list catalog', async () => {
      const res = await ts.server.inject({ method: 'GET', url: '/square/v2/catalog/list' });
      expect(res.json().objects.length).toBeGreaterThanOrEqual(1);
    });

    it('should search catalog', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/catalog/search',
        ...json({ object_types: ['ITEM'], query: { text_query: { keywords: ['Coffee'] } } }),
      });
      expect(res.json().objects.length).toBeGreaterThanOrEqual(1);
    });

    it('should batch upsert', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/catalog/batch-upsert',
        ...json({
          batches: [{ objects: [
            { type: 'ITEM', item_data: { name: 'Tea' } },
            { type: 'ITEM', item_data: { name: 'Juice' } },
          ] }],
        }),
      });
      expect(res.json().objects.length).toBe(2);
    });
  });

  // ── 6. Inventory ─────────────────────────────────────────────────────

  describe('Inventory', () => {
    it('should retrieve inventory counts', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/inventory/batch-retrieve-counts',
        ...json({ catalog_object_ids: ['item-var-1'] }),
      });
      expect(res.json().counts.length).toBe(1);
      expect(res.json().counts[0].catalog_object_id).toBe('item-var-1');
    });

    it('should change inventory', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/inventory/batch-change',
        ...json({
          changes: [{
            type: 'PHYSICAL_COUNT',
            physical_count: { catalog_object_id: 'item-var-1', quantity: '50', state: 'IN_STOCK', location_id: 'loc-1' },
          }],
        }),
      });
      expect(res.json().counts[0].quantity).toBe('50');
    });
  });

  // ── 7. Customers ─────────────────────────────────────────────────────

  describe('Customers', () => {
    let customerId: string;

    it('should create a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/customers',
        ...json({ given_name: 'John', family_name: 'Doe', email_address: 'john@example.com' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().customer.given_name).toBe('John');
      customerId = res.json().customer.id;
    });

    it('should get a customer', async () => {
      const res = await ts.server.inject({ method: 'GET', url: `/square/v2/customers/${customerId}` });
      expect(res.json().customer.email_address).toBe('john@example.com');
    });

    it('should update a customer', async () => {
      const res = await ts.server.inject({
        method: 'PUT', url: `/square/v2/customers/${customerId}`,
        ...json({ given_name: 'Jane' }),
      });
      expect(res.json().customer.given_name).toBe('Jane');
      expect(res.json().customer.version).toBe(1);
    });

    it('should list customers', async () => {
      const res = await ts.server.inject({ method: 'GET', url: '/square/v2/customers' });
      expect(res.json().customers.length).toBeGreaterThanOrEqual(1);
    });

    it('should delete a customer', async () => {
      const res = await ts.server.inject({ method: 'DELETE', url: `/square/v2/customers/${customerId}` });
      expect(res.statusCode).toBe(200);
      const getRes = await ts.server.inject({ method: 'GET', url: `/square/v2/customers/${customerId}` });
      expect(getRes.statusCode).toBe(404);
    });
  });

  // ── 8. Locations ─────────────────────────────────────────────────────

  describe('Locations', () => {
    it('should list locations (empty)', async () => {
      const res = await ts.server.inject({ method: 'GET', url: '/square/v2/locations' });
      expect(res.statusCode).toBe(200);
      expect(res.json().locations).toBeInstanceOf(Array);
    });

    it('should return 404 for unknown location', async () => {
      const res = await ts.server.inject({ method: 'GET', url: '/square/v2/locations/unknown' });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 9. Subscriptions ─────────────────────────────────────────────────

  describe('Subscriptions', () => {
    let subId: string;

    it('should create a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/subscriptions',
        ...json({ customer_id: 'cust-1', plan_variation_id: 'plan-1', location_id: 'loc-1' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subscription.status).toBe('ACTIVE');
      subId = res.json().subscription.id;
    });

    it('should get a subscription', async () => {
      const res = await ts.server.inject({ method: 'GET', url: `/square/v2/subscriptions/${subId}` });
      expect(res.json().subscription.id).toBe(subId);
    });

    it('should search subscriptions', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/subscriptions/search',
        ...json({ query: { filter: { customer_ids: ['cust-1'] } } }),
      });
      expect(res.json().subscriptions.length).toBeGreaterThanOrEqual(1);
    });

    it('should pause a subscription', async () => {
      const res = await ts.server.inject({ method: 'POST', url: `/square/v2/subscriptions/${subId}/pause`, ...json({}) });
      expect(res.json().subscription.status).toBe('PAUSED');
    });

    it('should resume a subscription', async () => {
      const res = await ts.server.inject({ method: 'POST', url: `/square/v2/subscriptions/${subId}/resume`, ...json({}) });
      expect(res.json().subscription.status).toBe('ACTIVE');
    });

    it('should cancel a subscription', async () => {
      const res = await ts.server.inject({ method: 'POST', url: `/square/v2/subscriptions/${subId}/cancel` });
      expect(res.json().subscription.status).toBe('CANCELED');
    });
  });

  // ── 10. Invoices ─────────────────────────────────────────────────────

  describe('Invoices', () => {
    let invoiceId: string;

    it('should create an invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/invoices',
        ...json({ invoice: { location_id: 'loc-1', title: 'Q1 Services' } }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().invoice.status).toBe('DRAFT');
      invoiceId = res.json().invoice.id;
    });

    it('should get an invoice', async () => {
      const res = await ts.server.inject({ method: 'GET', url: `/square/v2/invoices/${invoiceId}` });
      expect(res.json().invoice.title).toBe('Q1 Services');
    });

    it('should list invoices', async () => {
      const res = await ts.server.inject({ method: 'GET', url: '/square/v2/invoices' });
      expect(res.json().invoices.length).toBeGreaterThanOrEqual(1);
    });

    it('should publish an invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: `/square/v2/invoices/${invoiceId}/publish`,
        ...json({ version: 0 }),
      });
      expect(res.json().invoice.status).toBe('UNPAID');
      expect(res.json().invoice.public_url).toContain(invoiceId);
    });

    it('should cancel an invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: `/square/v2/invoices/${invoiceId}/cancel`,
        ...json({ version: 1 }),
      });
      expect(res.json().invoice.status).toBe('CANCELED');
    });
  });

  // ── 11. Terminal ─────────────────────────────────────────────────────

  describe('Terminal', () => {
    let deviceCodeId: string;

    it('should create a device code', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/terminals/codes',
        ...json({ device_code: { name: 'Register 1', product_type: 'TERMINAL_API' } }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().device_code.status).toBe('UNPAIRED');
      expect(res.json().device_code.code.length).toBe(6);
      deviceCodeId = res.json().device_code.id;
    });

    it('should get a device code', async () => {
      const res = await ts.server.inject({ method: 'GET', url: `/square/v2/terminals/codes/${deviceCodeId}` });
      expect(res.json().device_code.name).toBe('Register 1');
    });
  });

  // ── 12. Gift Cards ───────────────────────────────────────────────────

  describe('Gift Cards', () => {
    let giftCardId: string;

    it('should create a gift card', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/gift-cards',
        ...json({ type: 'DIGITAL' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().gift_card.state).toBe('ACTIVE');
      expect(res.json().gift_card.gan.length).toBe(16);
      giftCardId = res.json().gift_card.id;
    });

    it('should get a gift card', async () => {
      const res = await ts.server.inject({ method: 'GET', url: `/square/v2/gift-cards/${giftCardId}` });
      expect(res.json().gift_card.id).toBe(giftCardId);
    });

    it('should list gift cards', async () => {
      const res = await ts.server.inject({ method: 'GET', url: '/square/v2/gift-cards' });
      expect(res.json().gift_cards.length).toBeGreaterThanOrEqual(1);
    });

    it('should activate a gift card', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/gift-cards/activities',
        ...json({
          gift_card_activity: {
            type: 'ACTIVATE',
            gift_card_id: giftCardId,
            activate_activity_details: { amount_money: { amount: 5000, currency: 'USD' } },
          },
        }),
      });
      expect(res.json().gift_card_activity.gift_card_balance_money.amount).toBe(5000);
    });

    it('should load a gift card', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/gift-cards/activities',
        ...json({
          gift_card_activity: {
            type: 'LOAD',
            gift_card_id: giftCardId,
            load_activity_details: { amount_money: { amount: 2000, currency: 'USD' } },
          },
        }),
      });
      expect(res.json().gift_card_activity.gift_card_balance_money.amount).toBe(7000);
    });

    it('should redeem a gift card', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/gift-cards/activities',
        ...json({
          gift_card_activity: {
            type: 'REDEEM',
            gift_card_id: giftCardId,
            redeem_activity_details: { amount_money: { amount: 1500, currency: 'USD' } },
          },
        }),
      });
      expect(res.json().gift_card_activity.gift_card_balance_money.amount).toBe(5500);
    });
  });

  // ── 13. Bookings ─────────────────────────────────────────────────────

  describe('Bookings', () => {
    let bookingId: string;

    it('should create a booking', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/bookings',
        ...json({ booking: { location_id: 'loc-1', customer_note: 'Haircut' } }),
      });
      expect(res.json().booking.status).toBe('ACCEPTED');
      bookingId = res.json().booking.id;
    });

    it('should get a booking', async () => {
      const res = await ts.server.inject({ method: 'GET', url: `/square/v2/bookings/${bookingId}` });
      expect(res.json().booking.customer_note).toBe('Haircut');
    });

    it('should list bookings', async () => {
      const res = await ts.server.inject({ method: 'GET', url: '/square/v2/bookings' });
      expect(res.json().bookings.length).toBeGreaterThanOrEqual(1);
    });

    it('should cancel a booking', async () => {
      const res = await ts.server.inject({ method: 'POST', url: `/square/v2/bookings/${bookingId}/cancel` });
      expect(res.json().booking.status).toBe('CANCELLED_BY_SELLER');
    });
  });

  // ── 14. Loyalty ──────────────────────────────────────────────────────

  describe('Loyalty', () => {
    let accountId: string;

    it('should create a loyalty account', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/loyalty/accounts',
        ...json({ loyalty_account: { program_id: 'prog-1', customer_id: 'cust-1' } }),
      });
      expect(res.json().loyalty_account.balance).toBe(0);
      accountId = res.json().loyalty_account.id;
    });

    it('should get a loyalty program', async () => {
      const res = await ts.server.inject({ method: 'GET', url: '/square/v2/loyalty/programs/prog-1' });
      expect(res.json().program.status).toBe('ACTIVE');
    });

    it('should accumulate points', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: `/square/v2/loyalty/accounts/${accountId}/accumulate`,
        ...json({ accumulate_points: { points: 50 } }),
      });
      expect(res.json().event.type).toBe('ACCUMULATE_POINTS');
      expect(res.json().event.accumulate_points.points).toBe(50);
    });
  });

  // ── 15. Disputes ─────────────────────────────────────────────────────

  describe('Disputes', () => {
    it('should list disputes (empty)', async () => {
      const res = await ts.server.inject({ method: 'GET', url: '/square/v2/disputes' });
      expect(res.json().disputes).toBeInstanceOf(Array);
    });
  });

  // ── 16. Cards ────────────────────────────────────────────────────────

  describe('Cards', () => {
    let cardId: string;

    it('should create a card', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/cards',
        ...json({ card: { customer_id: 'cust-1', cardholder_name: 'John Doe' } }),
      });
      expect(res.json().card.enabled).toBe(true);
      expect(res.json().card.card_brand).toBe('VISA');
      cardId = res.json().card.id;
    });

    it('should get a card', async () => {
      const res = await ts.server.inject({ method: 'GET', url: `/square/v2/cards/${cardId}` });
      expect(res.json().card.cardholder_name).toBe('John Doe');
    });

    it('should list cards', async () => {
      const res = await ts.server.inject({ method: 'GET', url: '/square/v2/cards' });
      expect(res.json().cards.length).toBeGreaterThanOrEqual(1);
    });

    it('should disable a card', async () => {
      const res = await ts.server.inject({ method: 'POST', url: `/square/v2/cards/${cardId}/disable` });
      expect(res.json().card.enabled).toBe(false);
    });
  });

  // ── 17. Team ─────────────────────────────────────────────────────────

  describe('Team', () => {
    it('should search team members (empty)', async () => {
      const res = await ts.server.inject({
        method: 'POST', url: '/square/v2/team-members/search',
        ...json({}),
      });
      expect(res.json().team_members).toBeInstanceOf(Array);
    });
  });

  // ── 18. resolvePersona ───────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Bearer EAAA prefix', () => {
      const mockReq = { headers: { authorization: 'Bearer EAAAyoung-pro_abc123' } } as any;
      expect(adapter.resolvePersona(mockReq)).toBe('young-pro');
    });

    it('should return null for non-matching token', () => {
      const mockReq = { headers: { authorization: 'Bearer some-random' } } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });

    it('should return null for missing auth', () => {
      const mockReq = { headers: {} } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 19. Cross-surface seeding ────────────────────────────────────────

  describe('cross-surface seeding', () => {
    it('should seed payments from apiResponses', async () => {
      const seededAdapter = new SquareAdapter();
      const seedData = new Map<string, ExpandedData>([
        ['test', {
          persona: 'test' as any, blueprint: {} as any, tables: {}, facts: [],
          apiResponses: {
            square: {
              responses: {
                payments: [{
                  status: 200,
                  body: { id: 'seeded-pay-001', status: 'COMPLETED', amount_money: { amount: 5000, currency: 'USD' } },
                }],
              },
            },
          },
        }],
      ]);
      const seededTs = await buildTestServer(seededAdapter, seedData);
      const res = await seededTs.server.inject({ method: 'GET', url: '/square/v2/payments/seeded-pay-001' });
      expect(res.statusCode).toBe(200);
      expect(res.json().payment.amount_money.amount).toBe(5000);
      await seededTs.close();
    });
  });
});
