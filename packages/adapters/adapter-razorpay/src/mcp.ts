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
    if (!res.ok && res.status !== 201 && res.status !== 202 && res.status !== 204) {
      const text = await res.text();
      throw new Error(`Razorpay mock error ${res.status}: ${text}`);
    }
    if (res.status === 204 || res.status === 202) return {};
    return res.json();
  };
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function registerRazorpayTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4104',
): void {
  const call = makeCall(baseUrl);

  // ── 1. create_order
  server.tool('create_order', 'Create a Razorpay order', {
    amount: z.number().int().describe('Amount in paise (e.g. 50000 = INR 500)'),
    currency: z.string().default('INR').describe('Currency code'),
    receipt: z.string().optional().describe('Receipt reference'),
    notes: z.record(z.string()).optional().describe('Key-value notes'),
  }, async ({ amount, currency, receipt, notes }) => {
    const data = await call('POST', '/razorpay/v1/orders', { amount, currency, receipt, notes }) as any;
    return text(`Order ${data.id} created [${data.status}] — ${data.amount} ${data.currency}`);
  });

  // ── 2. get_order
  server.tool('get_order', 'Get a Razorpay order by ID', {
    order_id: z.string().describe('Order ID'),
  }, async ({ order_id }) => {
    const data = await call('GET', `/razorpay/v1/orders/${order_id}`) as any;
    return text(`Order ${data.id}: ${data.amount} ${data.currency} [${data.status}]`);
  });

  // ── 3. list_orders
  server.tool('list_orders', 'List all Razorpay orders', {}, async () => {
    const data = await call('GET', '/razorpay/v1/orders') as any;
    const items = data.items || [];
    if (!items.length) return text('No orders found.');
    const lines = items.map((o: any) => `  ${o.id} — ${o.amount} ${o.currency} [${o.status}]`);
    return text(`Orders (${items.length}):\n${lines.join('\n')}`);
  });

  // ── 4. capture_payment
  server.tool('capture_payment', 'Capture an authorized Razorpay payment', {
    payment_id: z.string().describe('Payment ID'),
    amount: z.number().int().optional().describe('Amount to capture in paise'),
    currency: z.string().optional().describe('Currency'),
  }, async ({ payment_id, amount, currency }) => {
    const body: any = {};
    if (amount) body.amount = amount;
    if (currency) body.currency = currency;
    const data = await call('POST', `/razorpay/v1/payments/${payment_id}/capture`, body) as any;
    return text(`Payment ${data.id} captured [${data.status}] — ${data.amount} ${data.currency}`);
  });

  // ── 5. get_payment
  server.tool('get_payment', 'Get a Razorpay payment by ID', {
    payment_id: z.string().describe('Payment ID'),
  }, async ({ payment_id }) => {
    const data = await call('GET', `/razorpay/v1/payments/${payment_id}`) as any;
    return text(`Payment ${data.id}: ${data.amount} ${data.currency} [${data.status}]`);
  });

  // ── 6. list_payments
  server.tool('list_payments', 'List all Razorpay payments', {}, async () => {
    const data = await call('GET', '/razorpay/v1/payments') as any;
    const items = data.items || [];
    if (!items.length) return text('No payments found.');
    const lines = items.map((p: any) => `  ${p.id} — ${p.amount} ${p.currency} [${p.status}]`);
    return text(`Payments (${items.length}):\n${lines.join('\n')}`);
  });

  // ── 7. refund_payment
  server.tool('refund_payment', 'Refund a captured Razorpay payment', {
    payment_id: z.string().describe('Payment ID to refund'),
    amount: z.number().int().optional().describe('Refund amount in paise'),
    speed: z.enum(['normal', 'optimum']).optional().describe('Refund speed'),
    notes: z.record(z.string()).optional().describe('Notes'),
  }, async ({ payment_id, amount, speed, notes }) => {
    const data = await call('POST', `/razorpay/v1/payments/${payment_id}/refund`, { amount, speed, notes }) as any;
    return text(`Refund ${data.id} [${data.status}] — ${data.amount} ${data.currency}`);
  });

  // ── 8. create_refund
  server.tool('create_refund', 'Create a standalone Razorpay refund', {
    payment_id: z.string().describe('Payment ID'),
    amount: z.number().int().optional().describe('Refund amount in paise'),
    speed: z.enum(['normal', 'optimum']).optional().describe('Refund speed'),
  }, async ({ payment_id, amount, speed }) => {
    const data = await call('POST', '/razorpay/v1/refunds', { payment_id, amount, speed }) as any;
    return text(`Refund ${data.id} [${data.status}] — ${data.amount} ${data.currency}`);
  });

  // ── 9. get_refund
  server.tool('get_refund', 'Get a Razorpay refund by ID', {
    refund_id: z.string().describe('Refund ID'),
  }, async ({ refund_id }) => {
    const data = await call('GET', `/razorpay/v1/refunds/${refund_id}`) as any;
    return text(`Refund ${data.id}: ${data.amount} ${data.currency} [${data.status}]`);
  });

  // ── 10. list_refunds
  server.tool('list_refunds', 'List all Razorpay refunds', {}, async () => {
    const data = await call('GET', '/razorpay/v1/refunds') as any;
    const items = data.items || [];
    if (!items.length) return text('No refunds found.');
    const lines = items.map((r: any) => `  ${r.id} — ${r.amount} ${r.currency} [${r.status}]`);
    return text(`Refunds (${items.length}):\n${lines.join('\n')}`);
  });

  // ── 11. create_customer
  server.tool('create_customer', 'Create a Razorpay customer', {
    name: z.string().optional().describe('Customer name'),
    email: z.string().optional().describe('Customer email'),
    contact: z.string().optional().describe('Customer phone'),
    notes: z.record(z.string()).optional().describe('Notes'),
  }, async ({ name, email, contact, notes }) => {
    const data = await call('POST', '/razorpay/v1/customers', { name, email, contact, notes }) as any;
    return text(`Customer ${data.id} created — ${data.name || 'N/A'} (${data.email || 'N/A'})`);
  });

  // ── 12. get_customer
  server.tool('get_customer', 'Get a Razorpay customer by ID', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `/razorpay/v1/customers/${customer_id}`) as any;
    return text(`Customer ${data.id}: ${data.name || 'N/A'} (${data.email || 'N/A'})`);
  });

  // ── 13. list_customers
  server.tool('list_customers', 'List all Razorpay customers', {}, async () => {
    const data = await call('GET', '/razorpay/v1/customers') as any;
    const items = data.items || [];
    if (!items.length) return text('No customers found.');
    const lines = items.map((c: any) => `  ${c.id} — ${c.name || 'N/A'} (${c.email || 'N/A'})`);
    return text(`Customers (${items.length}):\n${lines.join('\n')}`);
  });

  // ── 14. create_plan
  server.tool('create_plan', 'Create a Razorpay billing plan', {
    period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).describe('Billing period'),
    interval: z.number().int().describe('Interval count'),
    item_name: z.string().describe('Item name'),
    item_amount: z.number().int().describe('Amount in paise'),
    item_currency: z.string().default('INR').describe('Currency'),
  }, async ({ period, interval, item_name, item_amount, item_currency }) => {
    const data = await call('POST', '/razorpay/v1/plans', {
      period, interval,
      item: { name: item_name, amount: item_amount, currency: item_currency },
    }) as any;
    return text(`Plan ${data.id} created — ${data.item?.name} (${data.period})`);
  });

  // ── 15. create_subscription
  server.tool('create_subscription', 'Create a Razorpay subscription', {
    plan_id: z.string().describe('Plan ID'),
    total_count: z.number().int().optional().describe('Total billing cycles'),
    quantity: z.number().int().optional().describe('Quantity'),
  }, async ({ plan_id, total_count, quantity }) => {
    const data = await call('POST', '/razorpay/v1/subscriptions', { plan_id, total_count, quantity }) as any;
    return text(`Subscription ${data.id} created [${data.status}] — plan ${data.plan_id}`);
  });

  // ── 16. get_subscription
  server.tool('get_subscription', 'Get a Razorpay subscription by ID', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('GET', `/razorpay/v1/subscriptions/${subscription_id}`) as any;
    return text(`Subscription ${data.id} [${data.status}] — plan ${data.plan_id}`);
  });

  // ── 17. cancel_subscription
  server.tool('cancel_subscription', 'Cancel a Razorpay subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    cancel_at_cycle_end: z.boolean().optional().describe('Cancel at end of current cycle'),
  }, async ({ subscription_id, cancel_at_cycle_end }) => {
    const data = await call('POST', `/razorpay/v1/subscriptions/${subscription_id}/cancel`, { cancel_at_cycle_end }) as any;
    return text(`Subscription ${data.id} [${data.status}]`);
  });

  // ── 18. create_invoice
  server.tool('create_invoice', 'Create a Razorpay invoice', {
    description: z.string().optional().describe('Invoice description'),
    customer_name: z.string().optional().describe('Customer name'),
    customer_email: z.string().optional().describe('Customer email'),
    line_items: z.array(z.object({
      name: z.string().describe('Item name'),
      amount: z.number().int().describe('Amount in paise'),
      quantity: z.number().int().optional().describe('Quantity'),
    })).optional().describe('Line items'),
  }, async ({ description, customer_name, customer_email, line_items }) => {
    const data = await call('POST', '/razorpay/v1/invoices', {
      description,
      customer: { name: customer_name, email: customer_email },
      line_items: line_items || [],
    }) as any;
    return text(`Invoice ${data.id} created [${data.status}] — ${data.amount} ${data.currency}`);
  });

  // ── 19. issue_invoice
  server.tool('issue_invoice', 'Issue a draft Razorpay invoice', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('POST', `/razorpay/v1/invoices/${invoice_id}/issue`) as any;
    return text(`Invoice ${data.id} issued [${data.status}]`);
  });

  // ── 20. create_payment_link
  server.tool('create_payment_link', 'Create a Razorpay payment link', {
    amount: z.number().int().describe('Amount in paise'),
    currency: z.string().default('INR').describe('Currency'),
    description: z.string().optional().describe('Description'),
  }, async ({ amount, currency, description }) => {
    const data = await call('POST', '/razorpay/v1/payment_links', { amount, currency, description }) as any;
    return text(`Payment Link ${data.id} created [${data.status}]\nURL: ${data.short_url}`);
  });

  // ── 21. create_virtual_account
  server.tool('create_virtual_account', 'Create a Razorpay virtual account', {
    name: z.string().describe('Account name'),
    description: z.string().optional().describe('Description'),
    amount_expected: z.number().int().optional().describe('Expected amount in paise'),
  }, async ({ name, description, amount_expected }) => {
    const data = await call('POST', '/razorpay/v1/virtual_accounts', { name, description, amount_expected }) as any;
    return text(`Virtual Account ${data.id} created [${data.status}] — ${data.name}`);
  });

  // ── 22. create_qr_code
  server.tool('create_qr_code', 'Create a Razorpay QR code', {
    name: z.string().optional().describe('QR code name'),
    usage: z.enum(['single_use', 'multiple_use']).optional().describe('Usage type'),
    payment_amount: z.number().int().optional().describe('Fixed amount in paise'),
  }, async ({ name, usage, payment_amount }) => {
    const data = await call('POST', '/razorpay/v1/payments/qr_codes', { name, usage, payment_amount }) as any;
    return text(`QR Code ${data.id} created [${data.status}]\nImage: ${data.image_url}`);
  });

  // ── 23. create_fund_account
  server.tool('create_fund_account', 'Create a Razorpay fund account', {
    contact_id: z.string().describe('Contact ID'),
    account_type: z.enum(['bank_account', 'vpa', 'card']).describe('Account type'),
  }, async ({ contact_id, account_type }) => {
    const data = await call('POST', '/razorpay/v1/fund_accounts', { contact_id, account_type }) as any;
    return text(`Fund Account ${data.id} created — ${data.account_type}`);
  });

  // ── 24. create_payout
  server.tool('create_payout', 'Create a Razorpay payout', {
    account_number: z.string().describe('Account number'),
    fund_account_id: z.string().describe('Fund account ID'),
    amount: z.number().int().describe('Amount in paise'),
    currency: z.string().default('INR').describe('Currency'),
    mode: z.enum(['NEFT', 'RTGS', 'IMPS', 'UPI']).optional().describe('Transfer mode'),
    purpose: z.string().optional().describe('Purpose'),
  }, async ({ account_number, fund_account_id, amount, currency, mode, purpose }) => {
    const data = await call('POST', '/razorpay/v1/payouts', {
      account_number, fund_account_id, amount, currency, mode, purpose,
    }) as any;
    return text(`Payout ${data.id} [${data.status}] — ${data.amount} ${data.currency}`);
  });

  // ── 25. search_razorpay_documentation
  server.tool('search_razorpay_documentation', 'Search Razorpay documentation', {
    query: z.string().describe('Topic to search'),
  }, async ({ query }) => {
    return text(
      `Razorpay documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real docs, visit https://razorpay.com/docs/\n\n` +
      `Payment Flow: Create Order -> Checkout -> Authorize -> Capture\n\n` +
      `API Products:\n` +
      `  Orders: POST /v1/orders\n` +
      `  Payments: GET /v1/payments, POST /capture, POST /refund\n` +
      `  Refunds: POST /v1/refunds\n` +
      `  Customers: /v1/customers\n` +
      `  Subscriptions: /v1/subscriptions (with plans)\n` +
      `  Invoices: /v1/invoices\n` +
      `  Payment Links: /v1/payment_links\n` +
      `  Virtual Accounts: /v1/virtual_accounts\n` +
      `  QR Codes: /v1/payments/qr_codes\n` +
      `  Payouts: /v1/payouts (with fund accounts)\n`,
    );
  });
}

/**
 * Create a standalone Mimic MCP server for Razorpay.
 */
export function createRazorpayMcpServer(
  baseUrl: string = 'http://localhost:4104',
): McpServer {
  const server = new McpServer({
    name: 'mimic-razorpay',
    version: '0.7.0',
    description:
      'Mimic MCP server for Razorpay — orders, payments, refunds, customers, subscriptions, invoices, payment links, settlements, virtual accounts, QR codes, fund accounts, payouts against mock data',
  });
  registerRazorpayTools(server, baseUrl);
  return server;
}

/**
 * Start the Razorpay MCP server on stdio transport.
 */
export async function startRazorpayMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4104';
  const server = createRazorpayMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Razorpay MCP server running on stdio');
}
