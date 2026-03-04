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
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Stripe mock error ${res.status}: ${text}`);
    }
    return res.json();
  };
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (e): e is [string, string | number] => e[1] !== undefined,
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Register all Stripe MCP tools on the given McpServer.
 * Shared implementation used by both the standalone server and
 * the unified MimicMcpServer registration via `mcp: true`.
 */
export function registerStripeTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);

  // 1. create_customer
  server.tool('create_customer', 'Create a new Stripe customer', {
    name: z.string().describe('Full name of the customer'),
    email: z.string().describe('Email address'),
    phone: z.string().optional().describe('Phone number'),
    description: z.string().optional().describe('Internal description'),
    metadata: z.record(z.string()).optional().describe('Arbitrary key-value metadata'),
  }, async ({ name, email, phone, description, metadata }) => {
    const data = await call('POST', '/stripe/v1/customers', { name, email, phone, description, metadata }) as any;
    return text(`Created customer ${data.id}: ${data.name}`);
  });

  // 2. list_customers
  server.tool('list_customers', 'List Stripe customers, optionally filtered by email', {
    email: z.string().optional().describe('Filter by email address'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results (default 10)'),
  }, async ({ email, limit }) => {
    const data = await call('GET', `/stripe/v1/customers${qs({ email, limit: limit ?? 10 })}`) as any;
    if (!data.data?.length) return text('No customers found.');
    const lines = data.data.map((c: any) => `• ${c.id} — ${c.name} (${c.email})`);
    return text(`Customers (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 3. create_payment_intent
  server.tool('create_payment_intent', 'Create a new payment intent', {
    amount: z.number().int().positive().describe('Amount in smallest currency unit (e.g. cents)'),
    currency: z.string().length(3).optional().describe('Three-letter ISO currency code (default usd)'),
    customer: z.string().optional().describe('Customer ID to attach'),
    description: z.string().optional().describe('Description of the payment'),
    metadata: z.record(z.string()).optional().describe('Arbitrary key-value metadata'),
  }, async ({ amount, currency, customer, description, metadata }) => {
    const cur = currency ?? 'usd';
    const data = await call('POST', '/stripe/v1/payment_intents', { amount, currency: cur, customer, description, metadata }) as any;
    return text(`Created payment intent ${data.id} for ${(data.amount / 100).toFixed(2)} ${data.currency}`);
  });

  // 4. list_payment_intents
  server.tool('list_payment_intents', 'List payment intents', {}, async () => {
    const data = await call('GET', '/stripe/v1/payment_intents') as any;
    if (!data.data?.length) return text('No payment intents found.');
    const lines = data.data.map((pi: any) => `• ${pi.id} — ${(pi.amount / 100).toFixed(2)} ${pi.currency} [${pi.status}]`);
    return text(`Payment intents (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 5. confirm_payment_intent
  server.tool('confirm_payment_intent', 'Confirm a payment intent', {
    payment_intent_id: z.string().describe('Payment intent ID to confirm'),
  }, async ({ payment_intent_id }) => {
    const data = await call('POST', `/stripe/v1/payment_intents/${payment_intent_id}/confirm`) as any;
    return text(`Confirmed ${data.id}, status: ${data.status}`);
  });

  // 6. capture_payment_intent
  server.tool('capture_payment_intent', 'Capture a previously authorized payment intent', {
    payment_intent_id: z.string().describe('Payment intent ID to capture'),
    amount_to_capture: z.number().int().positive().optional().describe('Amount to capture (captures full amount if omitted)'),
  }, async ({ payment_intent_id, amount_to_capture }) => {
    const body = amount_to_capture !== undefined ? { amount_to_capture } : undefined;
    const data = await call('POST', `/stripe/v1/payment_intents/${payment_intent_id}/capture`, body) as any;
    return text(`Captured ${data.id}`);
  });

  // 7. cancel_payment_intent
  server.tool('cancel_payment_intent', 'Cancel a payment intent', {
    payment_intent_id: z.string().describe('Payment intent ID to cancel'),
  }, async ({ payment_intent_id }) => {
    const data = await call('POST', `/stripe/v1/payment_intents/${payment_intent_id}/cancel`) as any;
    return text(`Cancelled ${data.id}`);
  });

  // 8. create_refund
  server.tool('create_refund', 'Create a refund for a payment', {
    payment_intent: z.string().optional().describe('Payment intent ID to refund'),
    charge: z.string().optional().describe('Charge ID to refund'),
    amount: z.number().int().positive().optional().describe('Amount to refund (full refund if omitted)'),
    reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional().describe('Reason for the refund'),
  }, async ({ payment_intent, charge, amount, reason }) => {
    const data = await call('POST', '/stripe/v1/refunds', { payment_intent, charge, amount, reason }) as any;
    return text(`Created refund ${data.id}`);
  });

  // 9. list_subscriptions
  server.tool('list_subscriptions', 'List subscriptions, optionally filtered by customer or status', {
    customer: z.string().optional().describe('Filter by customer ID'),
    status: z.enum(['active', 'past_due', 'canceled', 'unpaid', 'trialing']).optional().describe('Filter by status'),
  }, async ({ customer, status }) => {
    const data = await call('GET', `/stripe/v1/subscriptions${qs({ customer, status })}`) as any;
    if (!data.data?.length) return text('No subscriptions found.');
    const lines = data.data.map((s: any) => `• ${s.id} — customer ${s.customer} [${s.status}]`);
    return text(`Subscriptions (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 10. cancel_subscription
  server.tool('cancel_subscription', 'Cancel a subscription', {
    subscription_id: z.string().describe('Subscription ID to cancel'),
  }, async ({ subscription_id }) => {
    const data = await call('DELETE', `/stripe/v1/subscriptions/${subscription_id}`) as any;
    return text(`Cancelled subscription ${data.id}`);
  });

  // 11. create_invoice
  server.tool('create_invoice', 'Create a draft invoice for a customer', {
    customer: z.string().describe('Customer ID to invoice'),
  }, async ({ customer }) => {
    const data = await call('POST', '/stripe/v1/invoices', { customer }) as any;
    return text(`Created invoice ${data.id}`);
  });

  // 12. list_invoices
  server.tool('list_invoices', 'List invoices', {}, async () => {
    const data = await call('GET', '/stripe/v1/invoices') as any;
    if (!data.data?.length) return text('No invoices found.');
    const lines = data.data.map((inv: any) => `• ${inv.id} — customer ${inv.customer} [${inv.status}]`);
    return text(`Invoices (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 13. create_product
  server.tool('create_product', 'Create a new product', {
    name: z.string().describe('Name of the product'),
  }, async ({ name }) => {
    const data = await call('POST', '/stripe/v1/products', { name }) as any;
    return text(`Created product ${data.id}: ${data.name}`);
  });

  // 14. list_products
  server.tool('list_products', 'List products', {}, async () => {
    const data = await call('GET', '/stripe/v1/products') as any;
    if (!data.data?.length) return text('No products found.');
    const lines = data.data.map((p: any) => `• ${p.id} — ${p.name} (${p.active ? 'active' : 'inactive'})`);
    return text(`Products (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 15. create_price
  server.tool('create_price', 'Create a price for a product', {
    unit_amount: z.number().int().positive().describe('Price in smallest currency unit (e.g. cents)'),
    currency: z.string().length(3).describe('Three-letter ISO currency code'),
    product: z.string().describe('Product ID this price belongs to'),
    recurring: z.object({
      interval: z.enum(['day', 'week', 'month', 'year']),
      interval_count: z.number().int().positive().optional(),
    }).optional().describe('Recurring billing config (omit for one-time prices)'),
  }, async ({ unit_amount, currency, product, recurring }) => {
    const data = await call('POST', '/stripe/v1/prices', { unit_amount, currency, product, recurring }) as any;
    return text(`Created price ${data.id}`);
  });

  // 16. list_prices
  server.tool('list_prices', 'List prices', {}, async () => {
    const data = await call('GET', '/stripe/v1/prices') as any;
    if (!data.data?.length) return text('No prices found.');
    const lines = data.data.map((p: any) => `• ${p.id} — ${(p.unit_amount / 100).toFixed(2)} ${p.currency}`);
    return text(`Prices (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 17. retrieve_balance
  server.tool('retrieve_balance', 'Retrieve the current Stripe account balance', {}, async () => {
    const data = await call('GET', '/stripe/v1/balance') as any;
    const fmtLine = (entry: any) => `${(entry.amount / 100).toFixed(2)} ${entry.currency}`;
    const avail = data.available?.map(fmtLine).join(', ') || 'none';
    const pending = data.pending?.map(fmtLine).join(', ') || 'none';
    return text(`Balance — Available: ${avail} | Pending: ${pending}`);
  });

}

/**
 * Create a standalone Mimic MCP server for Stripe.
 * Call `.connect(transport)` to start it.
 */
export function createStripeMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: 'mimic-stripe',
    version: '0.2.0',
    description: 'Mimic MCP server for Stripe — payments, billing, subscriptions against mock data',
  });
  registerStripeTools(server, baseUrl);
  return server;
}

/**
 * Start the Stripe MCP server on stdio transport.
 * Called when running as a standalone binary.
 */
export async function startStripeMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createStripeMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Stripe MCP server running on stdio');
}
