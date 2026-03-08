import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { MollieConfig } from './config.js';
import { mollieError } from './mollie-errors.js';
import { registerMollieTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  customers: 'mollie_customers',
  payments: 'mollie_payments',
  refunds: 'mollie_refunds',
  orders: 'mollie_orders',
  shipments: 'mollie_shipments',
  captures: 'mollie_captures',
  mandates: 'mollie_mandates',
  subscriptions: 'mollie_subscriptions',
  paymentLinks: 'mollie_payment_links',
  chargebacks: 'mollie_chargebacks',
  settlements: 'mollie_settlements',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selfLink(resource: string, id: string) {
  return {
    self: {
      href: `https://api.mollie.com/v2/${resource}/${id}`,
      type: 'application/hal+json',
    },
    documentation: {
      href: `https://docs.mollie.com/reference/${resource}-api/get-${resource.replace(/s$/, '')}`,
      type: 'text/html',
    },
  };
}

function listLinks(resource: string) {
  return {
    self: {
      href: `https://api.mollie.com/v2/${resource}`,
      type: 'application/hal+json',
    },
    documentation: {
      href: `https://docs.mollie.com/reference/${resource}-api/list-${resource}`,
      type: 'text/html',
    },
  };
}

function isoNow(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Payment methods (static data)
// ---------------------------------------------------------------------------

const MOLLIE_METHODS = [
  { id: 'ideal', description: 'iDEAL', minimumAmount: { value: '0.01', currency: 'EUR' }, maximumAmount: { value: '50000.00', currency: 'EUR' } },
  { id: 'creditcard', description: 'Credit card', minimumAmount: { value: '0.01', currency: 'EUR' }, maximumAmount: { value: '10000.00', currency: 'EUR' } },
  { id: 'bancontact', description: 'Bancontact', minimumAmount: { value: '0.02', currency: 'EUR' }, maximumAmount: { value: '50000.00', currency: 'EUR' } },
  { id: 'sofort', description: 'SOFORT Banking', minimumAmount: { value: '0.10', currency: 'EUR' }, maximumAmount: { value: '5000.00', currency: 'EUR' } },
  { id: 'banktransfer', description: 'Bank transfer', minimumAmount: { value: '0.01', currency: 'EUR' }, maximumAmount: { value: '1000000.00', currency: 'EUR' } },
  { id: 'directdebit', description: 'SEPA Direct Debit', minimumAmount: { value: '0.01', currency: 'EUR' }, maximumAmount: { value: '10000.00', currency: 'EUR' } },
  { id: 'paypal', description: 'PayPal', minimumAmount: { value: '0.01', currency: 'EUR' }, maximumAmount: { value: '8000.00', currency: 'EUR' } },
  { id: 'applepay', description: 'Apple Pay', minimumAmount: { value: '0.01', currency: 'EUR' }, maximumAmount: { value: '10000.00', currency: 'EUR' } },
  { id: 'klarnapaylater', description: 'Klarna Pay later', minimumAmount: { value: '0.01', currency: 'EUR' }, maximumAmount: { value: '10000.00', currency: 'EUR' } },
  { id: 'klarnasliceit', description: 'Klarna Slice it', minimumAmount: { value: '0.01', currency: 'EUR' }, maximumAmount: { value: '10000.00', currency: 'EUR' } },
  { id: 'przelewy24', description: 'Przelewy24', minimumAmount: { value: '0.01', currency: 'PLN' }, maximumAmount: { value: '54000.00', currency: 'PLN' } },
  { id: 'eps', description: 'eps', minimumAmount: { value: '1.00', currency: 'EUR' }, maximumAmount: { value: '50000.00', currency: 'EUR' } },
  { id: 'kbc', description: 'KBC/CBC Payment Button', minimumAmount: { value: '0.01', currency: 'EUR' }, maximumAmount: { value: '50000.00', currency: 'EUR' } },
  { id: 'belfius', description: 'Belfius Pay Button', minimumAmount: { value: '0.01', currency: 'EUR' }, maximumAmount: { value: '50000.00', currency: 'EUR' } },
  { id: 'twint', description: 'TWINT', minimumAmount: { value: '0.01', currency: 'CHF' }, maximumAmount: { value: '50000.00', currency: 'CHF' } },
  { id: 'blik', description: 'BLIK', minimumAmount: { value: '0.01', currency: 'PLN' }, maximumAmount: { value: '100000.00', currency: 'PLN' } },
  { id: 'in3', description: 'in3', minimumAmount: { value: '1.00', currency: 'EUR' }, maximumAmount: { value: '3000.00', currency: 'EUR' } },
].map((m) => ({
  resource: 'method' as const,
  ...m,
  image: {
    size1x: `https://www.mollie.com/external/icons/payment-methods/${m.id}.png`,
    size2x: `https://www.mollie.com/external/icons/payment-methods/${m.id}%402x.png`,
    svg: `https://www.mollie.com/external/icons/payment-methods/${m.id}.svg`,
  },
  status: 'activated' as const,
  _links: {
    self: {
      href: `https://api.mollie.com/v2/methods/${m.id}`,
      type: 'application/hal+json',
    },
    documentation: {
      href: 'https://docs.mollie.com/reference/methods-api/get-method',
      type: 'text/html',
    },
  },
}));

const ACTIVE_METHODS = MOLLIE_METHODS.filter((m) =>
  ['ideal', 'creditcard', 'bancontact', 'paypal', 'applepay', 'banktransfer'].includes(m.id),
);

// ---------------------------------------------------------------------------
// Mollie Adapter
// ---------------------------------------------------------------------------

export class MollieAdapter extends BaseApiMockAdapter<MollieConfig> {
  readonly id = 'mollie';
  readonly name = 'Mollie API';
  readonly basePath = '/mollie/v2';
  readonly versions = ['v2'];

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerMollieTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const token = auth.replace('Bearer ', '');
    const match = token.match(/^test_([a-zA-Z0-9-]+)$/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    const p = this.basePath;

    // ── Seed from expanded apiResponses ──────────────────────────────────
    this.seedFromApiResponses(data, store);

    // ── Customers ────────────────────────────────────────────────────────

    server.post(`${p}/customers`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const customer = {
        resource: 'customer',
        id: generateId('cst_', 10),
        mode: 'test',
        name: body.name || null,
        email: body.email || null,
        locale: body.locale || null,
        metadata: body.metadata || null,
        createdDatetime: isoNow(),
        _links: {} as Record<string, unknown>,
      };
      customer._links = {
        ...selfLink('customers', customer.id),
        mandates: {
          href: `https://api.mollie.com/v2/customers/${customer.id}/mandates`,
          type: 'application/hal+json',
        },
        subscriptions: {
          href: `https://api.mollie.com/v2/customers/${customer.id}/subscriptions`,
          type: 'application/hal+json',
        },
        payments: {
          href: `https://api.mollie.com/v2/customers/${customer.id}/payments`,
          type: 'application/hal+json',
        },
      };
      store.set(NS.customers, customer.id, customer);
      return reply.status(201).send(customer);
    });

    server.get(`${p}/customers`, async (req, reply) => {
      const q = req.query as Record<string, string>;
      const limit = parseInt(q.limit || '50');
      const customers = store.list<Record<string, unknown>>(NS.customers);
      const page = customers.slice(0, limit);
      return reply.send({
        count: page.length,
        _embedded: { customers: page },
        _links: { ...listLinks('customers'), previous: null, next: null },
      });
    });

    server.get(`${p}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = store.get(NS.customers, id);
      if (!customer) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The customer ${id} was not found`));
      }
      return reply.send(customer);
    });

    server.patch(`${p}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const customer = store.get(NS.customers, id);
      if (!customer) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The customer ${id} was not found`));
      }
      store.update(NS.customers, id, body);
      return reply.send(store.get(NS.customers, id));
    });

    server.delete(`${p}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = store.get(NS.customers, id);
      if (!customer) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The customer ${id} was not found`));
      }
      store.delete(NS.customers, id);
      return reply.status(204).send();
    });

    // ── Payments ─────────────────────────────────────────────────────────

    server.post(`${p}/payments`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const amount = body.amount as { currency?: string; value?: string } | undefined;
      if (!amount || !amount.currency || !amount.value) {
        return reply
          .status(422)
          .send(
            mollieError(
              422,
              'Unprocessable Entity',
              'The amount is required and must contain currency and value',
              'amount',
            ),
          );
      }
      const payment = {
        resource: 'payment',
        id: generateId('tr_', 10),
        mode: 'test',
        createdAt: isoNow(),
        amount: body.amount,
        description: body.description || '',
        redirectUrl: body.redirectUrl || null,
        webhookUrl: body.webhookUrl || null,
        method: body.method || null,
        metadata: body.metadata || null,
        status: 'open',
        isCancelable: true,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        profileId: 'pfl_mock123',
        sequenceType: body.sequenceType || 'oneoff',
        customerId: body.customerId || null,
        mandateId: body.mandateId || null,
        _links: {} as Record<string, unknown>,
      };
      payment._links = {
        ...selfLink('payments', payment.id),
        checkout: {
          href: `https://www.mollie.com/checkout/select-method/${generateId('', 10)}`,
          type: 'text/html',
        },
        dashboard: {
          href: `https://www.mollie.com/dashboard/org_mock/payments/${payment.id}`,
          type: 'text/html',
        },
      };
      store.set(NS.payments, payment.id, payment);
      return reply.status(201).send(payment);
    });

    server.get(`${p}/payments`, async (req, reply) => {
      const q = req.query as Record<string, string>;
      const limit = parseInt(q.limit || '50');
      const payments = store.list<Record<string, unknown>>(NS.payments);
      const page = payments.slice(0, limit);
      return reply.send({
        count: page.length,
        _embedded: { payments: page },
        _links: { ...listLinks('payments'), previous: null, next: null },
      });
    });

    server.get(`${p}/payments/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const payment = store.get(NS.payments, id);
      if (!payment) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The payment ${id} was not found`));
      }
      return reply.send(payment);
    });

    server.patch(`${p}/payments/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const payment = store.get(NS.payments, id);
      if (!payment) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The payment ${id} was not found`));
      }
      store.update(NS.payments, id, body);
      return reply.send(store.get(NS.payments, id));
    });

    server.delete(`${p}/payments/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const payment = store.get<Record<string, unknown>>(NS.payments, id);
      if (!payment) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The payment ${id} was not found`));
      }
      if (!payment.isCancelable) {
        return reply
          .status(422)
          .send(
            mollieError(
              422,
              'Unprocessable Entity',
              `The payment ${id} cannot be canceled`,
            ),
          );
      }
      store.update(NS.payments, id, {
        status: 'canceled',
        canceledAt: isoNow(),
        isCancelable: false,
      });
      return reply.send(store.get(NS.payments, id));
    });

    // ── Refunds ──────────────────────────────────────────────────────────

    server.post(`${p}/payments/:paymentId/refunds`, async (req, reply) => {
      const { paymentId } = req.params as { paymentId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const payment = store.get<Record<string, unknown>>(NS.payments, paymentId);
      if (!payment) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The payment ${paymentId} was not found`));
      }
      if (payment.status !== 'paid') {
        return reply
          .status(422)
          .send(
            mollieError(
              422,
              'Unprocessable Entity',
              `The payment ${paymentId} cannot be refunded because it is not paid`,
            ),
          );
      }
      const refund = {
        resource: 'refund',
        id: generateId('re_', 10),
        amount: body.amount || payment.amount,
        status: 'pending',
        description: body.description || `Refund for ${paymentId}`,
        metadata: body.metadata || null,
        paymentId,
        createdAt: isoNow(),
        _links: {
          self: {
            href: `https://api.mollie.com/v2/payments/${paymentId}/refunds/${generateId('re_', 10)}`,
            type: 'application/hal+json',
          },
          payment: {
            href: `https://api.mollie.com/v2/payments/${paymentId}`,
            type: 'application/hal+json',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/refunds-api/create-refund',
            type: 'text/html',
          },
        },
      };
      store.set(NS.refunds, refund.id, refund);
      return reply.status(201).send(refund);
    });

    server.get(`${p}/payments/:paymentId/refunds`, async (req, reply) => {
      const { paymentId } = req.params as { paymentId: string };
      const refunds = store
        .list<Record<string, unknown>>(NS.refunds)
        .filter((r) => r.paymentId === paymentId);
      return reply.send({
        count: refunds.length,
        _embedded: { refunds },
        _links: {
          self: {
            href: `https://api.mollie.com/v2/payments/${paymentId}/refunds`,
            type: 'application/hal+json',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/refunds-api/list-refunds',
            type: 'text/html',
          },
        },
      });
    });

    server.get(`${p}/payments/:paymentId/refunds/:id`, async (req, reply) => {
      const { paymentId, id } = req.params as { paymentId: string; id: string };
      const refund = store.get<Record<string, unknown>>(NS.refunds, id);
      if (!refund || refund.paymentId !== paymentId) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The refund ${id} was not found`));
      }
      return reply.send(refund);
    });

    server.delete(`${p}/payments/:paymentId/refunds/:id`, async (req, reply) => {
      const { paymentId, id } = req.params as { paymentId: string; id: string };
      const refund = store.get<Record<string, unknown>>(NS.refunds, id);
      if (!refund || refund.paymentId !== paymentId) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The refund ${id} was not found`));
      }
      if (refund.status !== 'pending' && refund.status !== 'queued') {
        return reply
          .status(422)
          .send(
            mollieError(
              422,
              'Unprocessable Entity',
              `The refund ${id} cannot be canceled because its status is ${refund.status}`,
            ),
          );
      }
      store.delete(NS.refunds, id);
      return reply.status(204).send();
    });

    server.get(`${p}/refunds`, async (req, reply) => {
      const q = req.query as Record<string, string>;
      const limit = parseInt(q.limit || '50');
      const refunds = store.list<Record<string, unknown>>(NS.refunds);
      const page = refunds.slice(0, limit);
      return reply.send({
        count: page.length,
        _embedded: { refunds: page },
        _links: { ...listLinks('refunds'), previous: null, next: null },
      });
    });

    // ── Orders ───────────────────────────────────────────────────────────

    server.post(`${p}/orders`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const amount = body.amount as { currency?: string; value?: string } | undefined;
      const lines = body.lines as Record<string, unknown>[] | undefined;
      if (!amount || !lines) {
        return reply
          .status(422)
          .send(
            mollieError(
              422,
              'Unprocessable Entity',
              'The amount and lines are required',
              'amount',
            ),
          );
      }
      const orderId = generateId('ord_', 10);
      const order = {
        resource: 'order',
        id: orderId,
        mode: 'test',
        createdAt: isoNow(),
        amount: body.amount,
        amountCaptured: { value: '0.00', currency: (amount as Record<string, string>).currency },
        amountRefunded: { value: '0.00', currency: (amount as Record<string, string>).currency },
        status: 'created',
        method: body.method || null,
        metadata: body.metadata || null,
        billingAddress: body.billingAddress || null,
        shippingAddress: body.shippingAddress || null,
        locale: body.locale || 'en_US',
        orderNumber: body.orderNumber || `ord-${Date.now()}`,
        redirectUrl: body.redirectUrl || null,
        webhookUrl: body.webhookUrl || null,
        lines: (lines || []).map((line: Record<string, unknown>) => ({
          resource: 'orderline',
          id: `odl_${generateId('', 6)}`,
          orderId,
          name: line.name,
          status: 'created',
          isCancelable: true,
          quantity: line.quantity || 1,
          quantityShipped: 0,
          quantityRefunded: 0,
          quantityCanceled: 0,
          unitPrice: line.unitPrice,
          totalAmount: line.totalAmount,
          vatRate: line.vatRate || '0.00',
          vatAmount: line.vatAmount || { value: '0.00', currency: (amount as Record<string, string>).currency },
          sku: line.sku || null,
          createdAt: isoNow(),
        })),
        _links: {} as Record<string, unknown>,
      };
      order._links = {
        ...selfLink('orders', order.id),
        checkout: {
          href: `https://www.mollie.com/checkout/order/${generateId('', 10)}`,
          type: 'text/html',
        },
        dashboard: {
          href: `https://www.mollie.com/dashboard/org_mock/orders/${order.id}`,
          type: 'text/html',
        },
      };
      store.set(NS.orders, order.id, order);
      return reply.status(201).send(order);
    });

    server.get(`${p}/orders`, async (req, reply) => {
      const q = req.query as Record<string, string>;
      const limit = parseInt(q.limit || '50');
      const orders = store.list<Record<string, unknown>>(NS.orders);
      const page = orders.slice(0, limit);
      return reply.send({
        count: page.length,
        _embedded: { orders: page },
        _links: { ...listLinks('orders'), previous: null, next: null },
      });
    });

    server.get(`${p}/orders/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const order = store.get(NS.orders, id);
      if (!order) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The order ${id} was not found`));
      }
      return reply.send(order);
    });

    server.patch(`${p}/orders/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const order = store.get(NS.orders, id);
      if (!order) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The order ${id} was not found`));
      }
      store.update(NS.orders, id, body);
      return reply.send(store.get(NS.orders, id));
    });

    server.delete(`${p}/orders/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const order = store.get<Record<string, unknown>>(NS.orders, id);
      if (!order) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The order ${id} was not found`));
      }
      if (order.status !== 'created') {
        return reply
          .status(422)
          .send(
            mollieError(
              422,
              'Unprocessable Entity',
              `The order ${id} cannot be canceled because its status is ${order.status}`,
            ),
          );
      }
      store.update(NS.orders, id, { status: 'canceled', canceledAt: isoNow() });
      return reply.send(store.get(NS.orders, id));
    });

    // ── Shipments ────────────────────────────────────────────────────────

    server.post(`${p}/orders/:orderId/shipments`, async (req, reply) => {
      const { orderId } = req.params as { orderId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const order = store.get<Record<string, unknown>>(NS.orders, orderId);
      if (!order) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The order ${orderId} was not found`));
      }
      const shipment = {
        resource: 'shipment',
        id: generateId('shp_', 10),
        orderId,
        createdAt: isoNow(),
        tracking: body.tracking || null,
        lines: body.lines || order.lines,
        _links: {
          self: {
            href: `https://api.mollie.com/v2/orders/${orderId}/shipments/${generateId('shp_', 10)}`,
            type: 'application/hal+json',
          },
          order: {
            href: `https://api.mollie.com/v2/orders/${orderId}`,
            type: 'application/hal+json',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/shipments-api/create-shipment',
            type: 'text/html',
          },
        },
      };
      store.set(NS.shipments, shipment.id, shipment);
      store.update(NS.orders, orderId, { status: 'shipping' });
      return reply.status(201).send(shipment);
    });

    server.get(`${p}/orders/:orderId/shipments`, async (req, reply) => {
      const { orderId } = req.params as { orderId: string };
      const shipments = store
        .list<Record<string, unknown>>(NS.shipments)
        .filter((s) => s.orderId === orderId);
      return reply.send({
        count: shipments.length,
        _embedded: { shipments },
        _links: {
          self: {
            href: `https://api.mollie.com/v2/orders/${orderId}/shipments`,
            type: 'application/hal+json',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/shipments-api/list-shipments',
            type: 'text/html',
          },
        },
      });
    });

    server.get(`${p}/orders/:orderId/shipments/:id`, async (req, reply) => {
      const { orderId, id } = req.params as { orderId: string; id: string };
      const shipment = store.get<Record<string, unknown>>(NS.shipments, id);
      if (!shipment || shipment.orderId !== orderId) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The shipment ${id} was not found`));
      }
      return reply.send(shipment);
    });

    // ── Captures ─────────────────────────────────────────────────────────

    server.post(`${p}/payments/:paymentId/captures`, async (req, reply) => {
      const { paymentId } = req.params as { paymentId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const payment = store.get<Record<string, unknown>>(NS.payments, paymentId);
      if (!payment) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The payment ${paymentId} was not found`));
      }
      if (payment.status !== 'authorized') {
        return reply
          .status(422)
          .send(
            mollieError(
              422,
              'Unprocessable Entity',
              `The payment ${paymentId} is not authorized and cannot be captured`,
            ),
          );
      }
      const capture = {
        resource: 'capture',
        id: generateId('cpt_', 10),
        mode: 'test',
        amount: body.amount || payment.amount,
        paymentId,
        createdAt: isoNow(),
        _links: {
          self: {
            href: `https://api.mollie.com/v2/payments/${paymentId}/captures/${generateId('cpt_', 10)}`,
            type: 'application/hal+json',
          },
          payment: {
            href: `https://api.mollie.com/v2/payments/${paymentId}`,
            type: 'application/hal+json',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/captures-api/create-capture',
            type: 'text/html',
          },
        },
      };
      store.set(NS.captures, capture.id, capture);
      store.update(NS.payments, paymentId, { status: 'paid', paidAt: isoNow() });
      return reply.status(201).send(capture);
    });

    server.get(`${p}/payments/:paymentId/captures`, async (req, reply) => {
      const { paymentId } = req.params as { paymentId: string };
      const captures = store
        .list<Record<string, unknown>>(NS.captures)
        .filter((c) => c.paymentId === paymentId);
      return reply.send({
        count: captures.length,
        _embedded: { captures },
        _links: {
          self: {
            href: `https://api.mollie.com/v2/payments/${paymentId}/captures`,
            type: 'application/hal+json',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/captures-api/list-captures',
            type: 'text/html',
          },
        },
      });
    });

    server.get(`${p}/payments/:paymentId/captures/:id`, async (req, reply) => {
      const { paymentId, id } = req.params as { paymentId: string; id: string };
      const capture = store.get<Record<string, unknown>>(NS.captures, id);
      if (!capture || capture.paymentId !== paymentId) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The capture ${id} was not found`));
      }
      return reply.send(capture);
    });

    // ── Mandates ─────────────────────────────────────────────────────────

    server.post(`${p}/customers/:customerId/mandates`, async (req, reply) => {
      const { customerId } = req.params as { customerId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const customer = store.get(NS.customers, customerId);
      if (!customer) {
        return reply
          .status(404)
          .send(
            mollieError(404, 'Not Found', `The customer ${customerId} was not found`),
          );
      }
      const mandate = {
        resource: 'mandate',
        id: generateId('mdt_', 10),
        mode: 'test',
        status: 'valid',
        method: body.method || 'directdebit',
        details: body.consumerName
          ? {
              consumerName: body.consumerName,
              consumerAccount: body.consumerAccount || 'NL55INGB0000000000',
              consumerBic: body.consumerBic || 'INGBNL2A',
            }
          : null,
        customerId,
        mandateReference: body.mandateReference || null,
        signatureDate: body.signatureDate || isoNow().split('T')[0],
        createdAt: isoNow(),
        _links: {
          self: {
            href: `https://api.mollie.com/v2/customers/${customerId}/mandates/${generateId('mdt_', 10)}`,
            type: 'application/hal+json',
          },
          customer: {
            href: `https://api.mollie.com/v2/customers/${customerId}`,
            type: 'application/hal+json',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/mandates-api/create-mandate',
            type: 'text/html',
          },
        },
      };
      store.set(NS.mandates, mandate.id, mandate);
      return reply.status(201).send(mandate);
    });

    server.get(`${p}/customers/:customerId/mandates`, async (req, reply) => {
      const { customerId } = req.params as { customerId: string };
      const mandates = store
        .list<Record<string, unknown>>(NS.mandates)
        .filter((m) => m.customerId === customerId);
      return reply.send({
        count: mandates.length,
        _embedded: { mandates },
        _links: {
          self: {
            href: `https://api.mollie.com/v2/customers/${customerId}/mandates`,
            type: 'application/hal+json',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/mandates-api/list-mandates',
            type: 'text/html',
          },
        },
      });
    });

    server.get(`${p}/customers/:customerId/mandates/:id`, async (req, reply) => {
      const { customerId, id } = req.params as { customerId: string; id: string };
      const mandate = store.get<Record<string, unknown>>(NS.mandates, id);
      if (!mandate || mandate.customerId !== customerId) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The mandate ${id} was not found`));
      }
      return reply.send(mandate);
    });

    server.delete(`${p}/customers/:customerId/mandates/:id`, async (req, reply) => {
      const { customerId, id } = req.params as { customerId: string; id: string };
      const mandate = store.get<Record<string, unknown>>(NS.mandates, id);
      if (!mandate || mandate.customerId !== customerId) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The mandate ${id} was not found`));
      }
      store.update(NS.mandates, id, { status: 'revoked' });
      return reply.status(204).send();
    });

    // ── Subscriptions ────────────────────────────────────────────────────

    server.post(`${p}/customers/:customerId/subscriptions`, async (req, reply) => {
      const { customerId } = req.params as { customerId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const customer = store.get(NS.customers, customerId);
      if (!customer) {
        return reply
          .status(404)
          .send(
            mollieError(404, 'Not Found', `The customer ${customerId} was not found`),
          );
      }
      const subscription = {
        resource: 'subscription',
        id: generateId('sub_', 10),
        mode: 'test',
        createdAt: isoNow(),
        status: 'active',
        amount: body.amount,
        times: body.times || null,
        timesRemaining: body.times || null,
        interval: body.interval,
        startDate: body.startDate || isoNow().split('T')[0],
        nextPaymentDate: body.startDate || isoNow().split('T')[0],
        description: body.description || '',
        method: body.method || null,
        mandateId: body.mandateId || null,
        webhookUrl: body.webhookUrl || null,
        metadata: body.metadata || null,
        customerId,
        _links: {
          self: {
            href: `https://api.mollie.com/v2/customers/${customerId}/subscriptions/${generateId('sub_', 10)}`,
            type: 'application/hal+json',
          },
          customer: {
            href: `https://api.mollie.com/v2/customers/${customerId}`,
            type: 'application/hal+json',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/subscriptions-api/create-subscription',
            type: 'text/html',
          },
        },
      };
      store.set(NS.subscriptions, subscription.id, subscription);
      return reply.status(201).send(subscription);
    });

    server.get(`${p}/customers/:customerId/subscriptions`, async (req, reply) => {
      const { customerId } = req.params as { customerId: string };
      const subscriptions = store
        .list<Record<string, unknown>>(NS.subscriptions)
        .filter((s) => s.customerId === customerId);
      return reply.send({
        count: subscriptions.length,
        _embedded: { subscriptions },
        _links: {
          self: {
            href: `https://api.mollie.com/v2/customers/${customerId}/subscriptions`,
            type: 'application/hal+json',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/subscriptions-api/list-subscriptions',
            type: 'text/html',
          },
        },
      });
    });

    server.get(`${p}/customers/:customerId/subscriptions/:id`, async (req, reply) => {
      const { customerId, id } = req.params as { customerId: string; id: string };
      const subscription = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!subscription || subscription.customerId !== customerId) {
        return reply
          .status(404)
          .send(
            mollieError(404, 'Not Found', `The subscription ${id} was not found`),
          );
      }
      return reply.send(subscription);
    });

    server.patch(`${p}/customers/:customerId/subscriptions/:id`, async (req, reply) => {
      const { customerId, id } = req.params as { customerId: string; id: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const subscription = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!subscription || subscription.customerId !== customerId) {
        return reply
          .status(404)
          .send(
            mollieError(404, 'Not Found', `The subscription ${id} was not found`),
          );
      }
      store.update(NS.subscriptions, id, body);
      return reply.send(store.get(NS.subscriptions, id));
    });

    server.delete(`${p}/customers/:customerId/subscriptions/:id`, async (req, reply) => {
      const { customerId, id } = req.params as { customerId: string; id: string };
      const subscription = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!subscription || subscription.customerId !== customerId) {
        return reply
          .status(404)
          .send(
            mollieError(404, 'Not Found', `The subscription ${id} was not found`),
          );
      }
      store.update(NS.subscriptions, id, { status: 'canceled', canceledAt: isoNow() });
      return reply.send(store.get(NS.subscriptions, id));
    });

    // ── Payment Links ────────────────────────────────────────────────────

    server.post(`${p}/payment-links`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const link = {
        resource: 'payment-link',
        id: generateId('pl_', 10),
        mode: 'test',
        description: body.description || '',
        amount: body.amount,
        redirectUrl: body.redirectUrl || null,
        webhookUrl: body.webhookUrl || null,
        profileId: 'pfl_mock123',
        createdAt: isoNow(),
        expiresAt: body.expiresAt || null,
        paidAt: null,
        _links: {
          self: {
            href: `https://api.mollie.com/v2/payment-links/${generateId('pl_', 10)}`,
            type: 'application/hal+json',
          },
          paymentLink: {
            href: `https://paymentlink.mollie.com/payment/${generateId('', 10)}/`,
            type: 'text/html',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/payment-links-api/create-payment-link',
            type: 'text/html',
          },
        },
      };
      store.set(NS.paymentLinks, link.id, link);
      return reply.status(201).send(link);
    });

    server.get(`${p}/payment-links`, async (req, reply) => {
      const q = req.query as Record<string, string>;
      const limit = parseInt(q.limit || '50');
      const links = store.list<Record<string, unknown>>(NS.paymentLinks);
      const page = links.slice(0, limit);
      return reply.send({
        count: page.length,
        _embedded: { payment_links: page },
        _links: {
          self: {
            href: 'https://api.mollie.com/v2/payment-links',
            type: 'application/hal+json',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/payment-links-api/list-payment-links',
            type: 'text/html',
          },
          previous: null,
          next: null,
        },
      });
    });

    server.get(`${p}/payment-links/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const link = store.get(NS.paymentLinks, id);
      if (!link) {
        return reply
          .status(404)
          .send(
            mollieError(404, 'Not Found', `The payment link ${id} was not found`),
          );
      }
      return reply.send(link);
    });

    // ── Methods ──────────────────────────────────────────────────────────

    server.get(`${p}/methods`, async (_req, reply) => {
      return reply.send({
        count: ACTIVE_METHODS.length,
        _embedded: { methods: ACTIVE_METHODS },
        _links: { ...listLinks('methods'), previous: null, next: null },
      });
    });

    server.get(`${p}/methods/all`, async (_req, reply) => {
      return reply.send({
        count: MOLLIE_METHODS.length,
        _embedded: { methods: MOLLIE_METHODS },
        _links: {
          self: {
            href: 'https://api.mollie.com/v2/methods/all',
            type: 'application/hal+json',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/methods-api/list-all-methods',
            type: 'text/html',
          },
        },
      });
    });

    server.get(`${p}/methods/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const method = MOLLIE_METHODS.find((m) => m.id === id);
      if (!method) {
        return reply
          .status(404)
          .send(mollieError(404, 'Not Found', `The method ${id} was not found`));
      }
      return reply.send(method);
    });

    // ── Chargebacks ──────────────────────────────────────────────────────

    server.get(`${p}/payments/:paymentId/chargebacks`, async (req, reply) => {
      const { paymentId } = req.params as { paymentId: string };
      const chargebacks = store
        .list<Record<string, unknown>>(NS.chargebacks)
        .filter((c) => c.paymentId === paymentId);
      return reply.send({
        count: chargebacks.length,
        _embedded: { chargebacks },
        _links: {
          self: {
            href: `https://api.mollie.com/v2/payments/${paymentId}/chargebacks`,
            type: 'application/hal+json',
          },
          documentation: {
            href: 'https://docs.mollie.com/reference/chargebacks-api/list-chargebacks',
            type: 'text/html',
          },
        },
      });
    });

    server.get(`${p}/chargebacks`, async (_req, reply) => {
      const chargebacks = store.list<Record<string, unknown>>(NS.chargebacks);
      return reply.send({
        count: chargebacks.length,
        _embedded: { chargebacks },
        _links: { ...listLinks('chargebacks'), previous: null, next: null },
      });
    });

    // ── Settlements ──────────────────────────────────────────────────────

    server.get(`${p}/settlements`, async (_req, reply) => {
      const settlements = store.list<Record<string, unknown>>(NS.settlements);
      return reply.send({
        count: settlements.length,
        _embedded: { settlements },
        _links: { ...listLinks('settlements'), previous: null, next: null },
      });
    });

    server.get(`${p}/settlements/next`, async (_req, reply) => {
      const settlement = {
        resource: 'settlement',
        id: generateId('stl_', 10),
        status: 'open',
        amount: { value: '0.00', currency: 'EUR' },
        createdAt: isoNow(),
        periods: {},
        _links: selfLink('settlements', 'next'),
      };
      return reply.send(settlement);
    });

    server.get(`${p}/settlements/open`, async (_req, reply) => {
      const settlement = {
        resource: 'settlement',
        id: generateId('stl_', 10),
        status: 'open',
        amount: { value: '0.00', currency: 'EUR' },
        createdAt: isoNow(),
        periods: {},
        _links: selfLink('settlements', 'open'),
      };
      return reply.send(settlement);
    });

    server.get(`${p}/settlements/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const settlement = store.get(NS.settlements, id);
      if (!settlement) {
        return reply
          .status(404)
          .send(
            mollieError(404, 'Not Found', `The settlement ${id} was not found`),
          );
      }
      return reply.send(settlement);
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Customers
      { method: 'POST', path: '/mollie/v2/customers', description: 'Create customer' },
      { method: 'GET', path: '/mollie/v2/customers', description: 'List customers' },
      { method: 'GET', path: '/mollie/v2/customers/:id', description: 'Get customer' },
      { method: 'PATCH', path: '/mollie/v2/customers/:id', description: 'Update customer' },
      { method: 'DELETE', path: '/mollie/v2/customers/:id', description: 'Delete customer' },

      // Payments
      { method: 'POST', path: '/mollie/v2/payments', description: 'Create payment' },
      { method: 'GET', path: '/mollie/v2/payments', description: 'List payments' },
      { method: 'GET', path: '/mollie/v2/payments/:id', description: 'Get payment' },
      { method: 'PATCH', path: '/mollie/v2/payments/:id', description: 'Update payment' },
      { method: 'DELETE', path: '/mollie/v2/payments/:id', description: 'Cancel payment' },

      // Refunds
      { method: 'POST', path: '/mollie/v2/payments/:paymentId/refunds', description: 'Create refund' },
      { method: 'GET', path: '/mollie/v2/payments/:paymentId/refunds', description: 'List refunds for payment' },
      { method: 'GET', path: '/mollie/v2/payments/:paymentId/refunds/:id', description: 'Get refund' },
      { method: 'DELETE', path: '/mollie/v2/payments/:paymentId/refunds/:id', description: 'Cancel refund' },
      { method: 'GET', path: '/mollie/v2/refunds', description: 'List all refunds' },

      // Orders
      { method: 'POST', path: '/mollie/v2/orders', description: 'Create order' },
      { method: 'GET', path: '/mollie/v2/orders', description: 'List orders' },
      { method: 'GET', path: '/mollie/v2/orders/:id', description: 'Get order' },
      { method: 'PATCH', path: '/mollie/v2/orders/:id', description: 'Update order' },
      { method: 'DELETE', path: '/mollie/v2/orders/:id', description: 'Cancel order' },

      // Shipments
      { method: 'POST', path: '/mollie/v2/orders/:orderId/shipments', description: 'Create shipment' },
      { method: 'GET', path: '/mollie/v2/orders/:orderId/shipments', description: 'List shipments' },
      { method: 'GET', path: '/mollie/v2/orders/:orderId/shipments/:id', description: 'Get shipment' },

      // Captures
      { method: 'POST', path: '/mollie/v2/payments/:paymentId/captures', description: 'Create capture' },
      { method: 'GET', path: '/mollie/v2/payments/:paymentId/captures', description: 'List captures' },
      { method: 'GET', path: '/mollie/v2/payments/:paymentId/captures/:id', description: 'Get capture' },

      // Mandates
      { method: 'POST', path: '/mollie/v2/customers/:customerId/mandates', description: 'Create mandate' },
      { method: 'GET', path: '/mollie/v2/customers/:customerId/mandates', description: 'List mandates' },
      { method: 'GET', path: '/mollie/v2/customers/:customerId/mandates/:id', description: 'Get mandate' },
      { method: 'DELETE', path: '/mollie/v2/customers/:customerId/mandates/:id', description: 'Revoke mandate' },

      // Subscriptions
      { method: 'POST', path: '/mollie/v2/customers/:customerId/subscriptions', description: 'Create subscription' },
      { method: 'GET', path: '/mollie/v2/customers/:customerId/subscriptions', description: 'List subscriptions' },
      { method: 'GET', path: '/mollie/v2/customers/:customerId/subscriptions/:id', description: 'Get subscription' },
      { method: 'PATCH', path: '/mollie/v2/customers/:customerId/subscriptions/:id', description: 'Update subscription' },
      { method: 'DELETE', path: '/mollie/v2/customers/:customerId/subscriptions/:id', description: 'Cancel subscription' },

      // Payment Links
      { method: 'POST', path: '/mollie/v2/payment-links', description: 'Create payment link' },
      { method: 'GET', path: '/mollie/v2/payment-links', description: 'List payment links' },
      { method: 'GET', path: '/mollie/v2/payment-links/:id', description: 'Get payment link' },

      // Methods
      { method: 'GET', path: '/mollie/v2/methods', description: 'List active payment methods' },
      { method: 'GET', path: '/mollie/v2/methods/all', description: 'List all payment methods' },
      { method: 'GET', path: '/mollie/v2/methods/:id', description: 'Get payment method' },

      // Chargebacks
      { method: 'GET', path: '/mollie/v2/payments/:paymentId/chargebacks', description: 'List chargebacks for payment' },
      { method: 'GET', path: '/mollie/v2/chargebacks', description: 'List all chargebacks' },

      // Settlements
      { method: 'GET', path: '/mollie/v2/settlements', description: 'List settlements' },
      { method: 'GET', path: '/mollie/v2/settlements/:id', description: 'Get settlement' },
      { method: 'GET', path: '/mollie/v2/settlements/next', description: 'Get next settlement' },
      { method: 'GET', path: '/mollie/v2/settlements/open', description: 'Get open settlement' },
    ];
  }

  // ── Cross-surface seeding ──────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    customers: NS.customers,
    payments: NS.payments,
    refunds: NS.refunds,
    orders: NS.orders,
    shipments: NS.shipments,
    captures: NS.captures,
    mandates: NS.mandates,
    subscriptions: NS.subscriptions,
    payment_links: NS.paymentLinks,
    chargebacks: NS.chargebacks,
    settlements: NS.settlements,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const mollieData = expanded.apiResponses?.mollie;
      if (!mollieData) continue;

      for (const [resourceType, responses] of Object.entries(
        mollieData.responses,
      )) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          if (!body.id) continue;

          const enriched = {
            resource: resourceType.replace(/s$/, ''),
            mode: 'test',
            createdAt: body.createdAt ?? isoNow(),
            ...body,
          };

          store.set(namespace, String(body.id), enriched);
        }
      }
    }
  }
}
