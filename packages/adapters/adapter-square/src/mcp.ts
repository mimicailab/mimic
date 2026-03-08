import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCall(baseUrl: string) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      const text = await res.text();
      throw new Error(`Square mock error ${res.status}: ${text}`);
    }
    if (res.status === 204) return {};
    return res.json();
  };
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

const moneySchema = z.object({
  amount: z.number().int().describe('Amount in smallest currency unit'),
  currency: z.string().length(3).describe('Currency code'),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function registerSquareTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4105',
): void {
  const call = makeCall(baseUrl);

  // ── 1. create_payment
  server.tool('create_payment', 'Create a Square payment', {
    amount: z.number().int().describe('Amount in minor units'),
    currency: z.string().optional().describe('Currency code'),
    location_id: z.string().optional().describe('Location ID'),
  }, async ({ amount, currency, location_id }) => {
    const data = await call('POST', '/square/v2/payments', {
      amount_money: { amount, currency: currency || 'USD' },
      location_id,
      idempotency_key: `mcp-${Date.now()}`,
    }) as any;
    return text(`Payment ${data.payment.id} [${data.payment.status}] — ${data.payment.amount_money.amount} ${data.payment.amount_money.currency}`);
  });

  // ── 2. get_payment
  server.tool('get_payment', 'Get a Square payment', {
    payment_id: z.string().describe('Payment ID'),
  }, async ({ payment_id }) => {
    const data = await call('GET', `/square/v2/payments/${payment_id}`) as any;
    return text(`Payment ${data.payment.id} [${data.payment.status}] — ${data.payment.amount_money.amount} ${data.payment.amount_money.currency}`);
  });

  // ── 3. list_payments
  server.tool('list_payments', 'List Square payments', {}, async () => {
    const data = await call('GET', '/square/v2/payments') as any;
    const payments = data.payments || [];
    if (!payments.length) return text('No payments found.');
    const lines = payments.map((p: any) => `• ${p.id} — ${p.amount_money.amount} ${p.amount_money.currency} [${p.status}]`);
    return text(`Payments (${payments.length}):\n${lines.join('\n')}`);
  });

  // ── 4. create_order
  server.tool('create_order', 'Create a Square order', {
    location_id: z.string().optional().describe('Location ID'),
    line_items: z.array(z.object({
      name: z.string().describe('Item name'),
      quantity: z.string().describe('Quantity'),
      base_price_amount: z.number().int().describe('Price in minor units'),
      currency: z.string().optional().describe('Currency'),
    })).describe('Order line items'),
  }, async ({ location_id, line_items }) => {
    const data = await call('POST', '/square/v2/orders', {
      idempotency_key: `mcp-${Date.now()}`,
      order: {
        location_id,
        line_items: line_items.map((li) => ({
          name: li.name,
          quantity: li.quantity,
          base_price_money: { amount: li.base_price_amount, currency: li.currency || 'USD' },
        })),
      },
    }) as any;
    return text(`Order ${data.order.id} [${data.order.state}] — ${data.order.total_money.amount} ${data.order.total_money.currency}`);
  });

  // ── 5. get_order
  server.tool('get_order', 'Get a Square order', {
    order_id: z.string().describe('Order ID'),
  }, async ({ order_id }) => {
    const data = await call('GET', `/square/v2/orders/${order_id}`) as any;
    return text(`Order ${data.order.id} [${data.order.state}] — ${data.order.total_money.amount} ${data.order.total_money.currency}`);
  });

  // ── 6. create_customer
  server.tool('create_customer', 'Create a Square customer', {
    given_name: z.string().describe('First name'),
    family_name: z.string().describe('Last name'),
    email_address: z.string().optional().describe('Email'),
    phone_number: z.string().optional().describe('Phone'),
  }, async (params) => {
    const data = await call('POST', '/square/v2/customers', {
      ...params,
      idempotency_key: `mcp-${Date.now()}`,
    }) as any;
    return text(`Customer ${data.customer.id} — ${data.customer.given_name} ${data.customer.family_name}`);
  });

  // ── 7. list_customers
  server.tool('list_customers', 'List Square customers', {}, async () => {
    const data = await call('GET', '/square/v2/customers') as any;
    const customers = data.customers || [];
    if (!customers.length) return text('No customers found.');
    const lines = customers.map((c: any) => `• ${c.id} — ${c.given_name} ${c.family_name} (${c.email_address || 'no email'})`);
    return text(`Customers (${customers.length}):\n${lines.join('\n')}`);
  });

  // ── 8. upsert_catalog_object
  server.tool('upsert_catalog_object', 'Create/update a catalog item', {
    name: z.string().describe('Item name'),
    price_amount: z.number().int().describe('Price in minor units'),
    currency: z.string().optional().describe('Currency'),
  }, async ({ name, price_amount, currency }) => {
    const data = await call('POST', '/square/v2/catalog/object', {
      idempotency_key: `mcp-${Date.now()}`,
      object: {
        type: 'ITEM',
        item_data: {
          name,
          variations: [{
            type: 'ITEM_VARIATION',
            item_variation_data: {
              name: 'Regular',
              pricing_type: 'FIXED_PRICING',
              price_money: { amount: price_amount, currency: currency || 'USD' },
            },
          }],
        },
      },
    }) as any;
    return text(`Catalog object ${data.catalog_object.id} created [${data.catalog_object.type}]`);
  });

  // ── 9. create_subscription
  server.tool('create_subscription', 'Create a Square subscription', {
    customer_id: z.string().describe('Customer ID'),
    plan_variation_id: z.string().describe('Plan variation ID'),
    location_id: z.string().optional().describe('Location ID'),
  }, async ({ customer_id, plan_variation_id, location_id }) => {
    const data = await call('POST', '/square/v2/subscriptions', {
      customer_id,
      plan_variation_id,
      location_id,
      idempotency_key: `mcp-${Date.now()}`,
    }) as any;
    return text(`Subscription ${data.subscription.id} [${data.subscription.status}]`);
  });

  // ── 10. cancel_subscription
  server.tool('cancel_subscription', 'Cancel a Square subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('POST', `/square/v2/subscriptions/${subscription_id}/cancel`) as any;
    return text(`Subscription ${data.subscription.id} [${data.subscription.status}]`);
  });

  // ── 11. create_invoice
  server.tool('create_invoice', 'Create a Square invoice', {
    location_id: z.string().optional().describe('Location ID'),
    order_id: z.string().optional().describe('Order ID'),
    title: z.string().optional().describe('Invoice title'),
  }, async ({ location_id, order_id, title }) => {
    const data = await call('POST', '/square/v2/invoices', {
      idempotency_key: `mcp-${Date.now()}`,
      invoice: { location_id, order_id, title },
    }) as any;
    return text(`Invoice ${data.invoice.id} [${data.invoice.status}]`);
  });

  // ── 12. create_gift_card
  server.tool('create_gift_card', 'Create a Square gift card', {
    type: z.enum(['DIGITAL', 'PHYSICAL']).optional().describe('Card type'),
  }, async ({ type }) => {
    const data = await call('POST', '/square/v2/gift-cards', {
      type: type || 'DIGITAL',
      idempotency_key: `mcp-${Date.now()}`,
    }) as any;
    return text(`Gift Card ${data.gift_card.id} [${data.gift_card.state}] GAN: ${data.gift_card.gan}`);
  });

  // ── 13. create_booking
  server.tool('create_booking', 'Create a Square booking', {
    location_id: z.string().optional().describe('Location ID'),
    customer_id: z.string().optional().describe('Customer ID'),
    start_at: z.string().optional().describe('Start time ISO 8601'),
  }, async ({ location_id, customer_id, start_at }) => {
    const data = await call('POST', '/square/v2/bookings', {
      idempotency_key: `mcp-${Date.now()}`,
      booking: { location_id, customer_id, start_at },
    }) as any;
    return text(`Booking ${data.booking.id} [${data.booking.status}] at ${data.booking.start_at}`);
  });

  // ── 14. create_loyalty_account
  server.tool('create_loyalty_account', 'Create a loyalty account', {
    program_id: z.string().describe('Loyalty program ID'),
    customer_id: z.string().optional().describe('Customer ID'),
  }, async ({ program_id, customer_id }) => {
    const data = await call('POST', '/square/v2/loyalty/accounts', {
      idempotency_key: `mcp-${Date.now()}`,
      loyalty_account: { program_id, customer_id },
    }) as any;
    return text(`Loyalty account ${data.loyalty_account.id} — balance: ${data.loyalty_account.balance}`);
  });

  // ── 15. accumulate_loyalty_points
  server.tool('accumulate_loyalty_points', 'Add loyalty points', {
    account_id: z.string().describe('Loyalty account ID'),
    points: z.number().int().describe('Points to add'),
  }, async ({ account_id, points }) => {
    const data = await call('POST', `/square/v2/loyalty/accounts/${account_id}/accumulate`, {
      accumulate_points: { points },
      idempotency_key: `mcp-${Date.now()}`,
    }) as any;
    return text(`Added ${points} points — event: ${data.event.id}`);
  });

  // ── 16. search_square_documentation
  server.tool('search_square_documentation', 'Search Square documentation', {
    query: z.string().describe('Topic to search'),
  }, async ({ query }) => {
    return text(
      `Square documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real docs, visit https://developer.squareup.com\n\n` +
      `API Products:\n` +
      `• Payments: POST /v2/payments + /cancel\n` +
      `• Orders: POST /v2/orders + /search + /calculate\n` +
      `• Catalog: /v2/catalog/object + /search + /list\n` +
      `• Customers: /v2/customers CRUD\n` +
      `• Subscriptions: /v2/subscriptions + /cancel + /pause + /resume\n` +
      `• Invoices: /v2/invoices + /publish + /cancel\n` +
      `• Gift Cards: /v2/gift-cards + /activities\n` +
      `• Bookings: /v2/bookings + /cancel\n` +
      `• Loyalty: /v2/loyalty/accounts + /accumulate\n`,
    );
  });
}

export function createSquareMcpServer(baseUrl: string = 'http://localhost:4105'): McpServer {
  const server = new McpServer({
    name: 'mimic-square',
    version: '0.7.0',
    description: 'Mimic MCP server for Square — payments, orders, catalog, customers, subscriptions against mock data',
  });
  registerSquareTools(server, baseUrl);
  return server;
}

export async function startSquareMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4105';
  const server = createSquareMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Square MCP server running on stdio');
}
