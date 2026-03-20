import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import meta from './adapter-meta.js';

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
// Factory — Official Stripe MCP parity (26 tools)
// ---------------------------------------------------------------------------

/**
 * Register all Stripe MCP tools on the given McpServer.
 * Matches the official Stripe MCP at mcp.stripe.com (26 tools)
 * plus 4 Mimic-only extras for payment lifecycle testing.
 */
export function registerStripeTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);

  // ── Official MCP tools ──────────────────────────────────────────────

  // 1. get_stripe_account_info
  server.tool('get_stripe_account_info', 'Get information about the connected Stripe account', {}, async () => {
    const data = await call('GET', '/v1/account') as any;
    return text(`Account ${data.id}: ${data.business_type}, ${data.country}, charges_enabled=${data.charges_enabled}`);
  });

  // 2. retrieve_balance
  server.tool('retrieve_balance', 'Retrieve the current Stripe account balance', {}, async () => {
    const data = await call('GET', '/v1/balance') as any;
    const fmtLine = (entry: any) => `${(entry.amount / 100).toFixed(2)} ${entry.currency}`;
    const avail = data.available?.map(fmtLine).join(', ') || 'none';
    const pending = data.pending?.map(fmtLine).join(', ') || 'none';
    return text(`Balance — Available: ${avail} | Pending: ${pending}`);
  });

  // 3. create_coupon
  server.tool('create_coupon', 'Create a new coupon for discounts', {
    percent_off: z.number().min(0).max(100).optional().describe('Percentage discount (0-100)'),
    amount_off: z.number().int().positive().optional().describe('Fixed discount in smallest currency unit'),
    currency: z.string().length(3).optional().describe('Currency for amount_off (default usd)'),
    duration: z.enum(['once', 'repeating', 'forever']).optional().describe('Duration of coupon (default once)'),
    duration_in_months: z.number().int().positive().optional().describe('Months coupon applies (for repeating)'),
    max_redemptions: z.number().int().positive().optional().describe('Max number of times coupon can be redeemed'),
    metadata: z.record(z.string()).optional().describe('Arbitrary key-value metadata'),
  }, async (params) => {
    const data = await call('POST', '/v1/coupons', params) as any;
    const desc = data.percent_off ? `${data.percent_off}% off` : `${(data.amount_off / 100).toFixed(2)} ${data.currency} off`;
    return text(`Created coupon ${data.id}: ${desc} (${data.duration})`);
  });

  // 4. list_coupons
  server.tool('list_coupons', 'List all coupons', {}, async () => {
    const data = await call('GET', '/v1/coupons') as any;
    if (!data.data?.length) return text('No coupons found.');
    const lines = data.data.map((c: any) => {
      const desc = c.percent_off ? `${c.percent_off}% off` : `${(c.amount_off / 100).toFixed(2)} ${c.currency} off`;
      return `• ${c.id} — ${desc} (${c.duration})`;
    });
    return text(`Coupons (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 5. create_customer
  server.tool('create_customer', 'Create a new Stripe customer', {
    name: z.string().optional().describe('Full name of the customer'),
    email: z.string().optional().describe('Email address'),
    phone: z.string().optional().describe('Phone number'),
    description: z.string().optional().describe('Internal description'),
    metadata: z.record(z.string()).optional().describe('Arbitrary key-value metadata'),
  }, async (params) => {
    const data = await call('POST', '/v1/customers', params) as any;
    return text(`Created customer ${data.id}: ${data.name ?? data.email ?? '(no name)'}`);
  });

  // 6. list_customers
  server.tool('list_customers', 'List Stripe customers, optionally filtered by email', {
    email: z.string().optional().describe('Filter by email address'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results (default 10)'),
  }, async ({ email, limit }) => {
    const data = await call('GET', `/v1/customers${qs({ email, limit: limit ?? 10 })}`) as any;
    if (!data.data?.length) return text('No customers found.');
    const lines = data.data.map((c: any) => `• ${c.id} — ${c.name ?? '(no name)'} (${c.email ?? 'no email'})`);
    return text(`Customers (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 7. list_disputes
  server.tool('list_disputes', 'List all disputes', {}, async () => {
    const data = await call('GET', '/v1/disputes') as any;
    if (!data.data?.length) return text('No disputes found.');
    const lines = data.data.map((d: any) => `• ${d.id} — ${(d.amount / 100).toFixed(2)} ${d.currency} [${d.status}]`);
    return text(`Disputes (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 8. update_dispute
  server.tool('update_dispute', 'Update a dispute with evidence or metadata', {
    dispute_id: z.string().describe('Dispute ID to update'),
    evidence: z.record(z.string()).optional().describe('Evidence to submit'),
    metadata: z.record(z.string()).optional().describe('Metadata to update'),
  }, async ({ dispute_id, evidence, metadata }) => {
    const data = await call('POST', `/v1/disputes/${dispute_id}`, { evidence, metadata }) as any;
    return text(`Updated dispute ${data.id} [${data.status}]`);
  });

  // 9. create_invoice
  server.tool('create_invoice', 'Create a draft invoice for a customer', {
    customer: z.string().describe('Customer ID to invoice'),
    description: z.string().optional().describe('Description'),
    metadata: z.record(z.string()).optional().describe('Arbitrary key-value metadata'),
  }, async (params) => {
    const data = await call('POST', '/v1/invoices', params) as any;
    return text(`Created invoice ${data.id} [${data.status}]`);
  });

  // 10. create_invoice_item
  server.tool('create_invoice_item', 'Create an invoice item (line item on a draft invoice)', {
    customer: z.string().describe('Customer ID'),
    amount: z.number().int().optional().describe('Amount in smallest currency unit'),
    currency: z.string().length(3).optional().describe('Currency (default usd)'),
    description: z.string().optional().describe('Description of the line item'),
    invoice: z.string().optional().describe('Invoice ID to add item to'),
    price: z.string().optional().describe('Price ID to use'),
    quantity: z.number().int().positive().optional().describe('Quantity'),
  }, async (params) => {
    const data = await call('POST', '/v1/invoiceitems', params) as any;
    return text(`Created invoice item ${data.id} for customer ${data.customer}`);
  });

  // 11. finalize_invoice
  server.tool('finalize_invoice', 'Finalize a draft invoice so it can be paid', {
    invoice_id: z.string().describe('Invoice ID to finalize'),
  }, async ({ invoice_id }) => {
    const data = await call('POST', `/v1/invoices/${invoice_id}/finalize`) as any;
    return text(`Finalized invoice ${data.id} [${data.status}]`);
  });

  // 12. list_invoices
  server.tool('list_invoices', 'List invoices', {
    customer: z.string().optional().describe('Filter by customer ID'),
    status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']).optional().describe('Filter by status'),
  }, async ({ customer, status }) => {
    const data = await call('GET', `/v1/invoices${qs({ customer, status })}`) as any;
    if (!data.data?.length) return text('No invoices found.');
    const lines = data.data.map((inv: any) => `• ${inv.id} — customer ${inv.customer} [${inv.status}]`);
    return text(`Invoices (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 13. create_payment_link
  server.tool('create_payment_link', 'Create a payment link for checkout', {
    line_items: z.array(z.object({
      price: z.string().describe('Price ID'),
      quantity: z.number().int().positive().describe('Quantity'),
    })).describe('Line items for the payment link'),
    metadata: z.record(z.string()).optional().describe('Arbitrary key-value metadata'),
  }, async (params) => {
    const data = await call('POST', '/v1/payment_links', params) as any;
    return text(`Created payment link ${data.id}: ${data.url}`);
  });

  // 14. list_payment_intents
  server.tool('list_payment_intents', 'List payment intents', {
    customer: z.string().optional().describe('Filter by customer ID'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results'),
  }, async ({ customer, limit }) => {
    const data = await call('GET', `/v1/payment_intents${qs({ customer, limit })}`) as any;
    if (!data.data?.length) return text('No payment intents found.');
    const lines = data.data.map((pi: any) => `• ${pi.id} — ${(pi.amount / 100).toFixed(2)} ${pi.currency} [${pi.status}]`);
    return text(`Payment intents (${data.data.length}):\n${lines.join('\n')}`);
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
    const data = await call('POST', '/v1/prices', { unit_amount, currency, product, recurring }) as any;
    return text(`Created price ${data.id}`);
  });

  // 16. list_prices
  server.tool('list_prices', 'List prices', {
    product: z.string().optional().describe('Filter by product ID'),
  }, async ({ product }) => {
    const data = await call('GET', `/v1/prices${qs({ product })}`) as any;
    if (!data.data?.length) return text('No prices found.');
    const lines = data.data.map((p: any) => `• ${p.id} — ${(p.unit_amount / 100).toFixed(2)} ${p.currency}`);
    return text(`Prices (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 17. create_product
  server.tool('create_product', 'Create a new product', {
    name: z.string().describe('Name of the product'),
    description: z.string().optional().describe('Product description'),
    metadata: z.record(z.string()).optional().describe('Arbitrary key-value metadata'),
  }, async (params) => {
    const data = await call('POST', '/v1/products', params) as any;
    return text(`Created product ${data.id}: ${data.name}`);
  });

  // 18. list_products
  server.tool('list_products', 'List products', {}, async () => {
    const data = await call('GET', '/v1/products') as any;
    if (!data.data?.length) return text('No products found.');
    const lines = data.data.map((p: any) => `• ${p.id} — ${p.name} (${p.active ? 'active' : 'inactive'})`);
    return text(`Products (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 19. create_refund
  server.tool('create_refund', 'Create a refund for a payment', {
    payment_intent: z.string().optional().describe('Payment intent ID to refund'),
    charge: z.string().optional().describe('Charge ID to refund'),
    amount: z.number().int().positive().optional().describe('Amount to refund (full refund if omitted)'),
    reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional().describe('Reason for the refund'),
  }, async ({ payment_intent, charge, amount, reason }) => {
    const data = await call('POST', '/v1/refunds', { payment_intent, charge, amount, reason }) as any;
    return text(`Created refund ${data.id}`);
  });

  // 20. cancel_subscription
  server.tool('cancel_subscription', 'Cancel a subscription', {
    subscription_id: z.string().describe('Subscription ID to cancel'),
  }, async ({ subscription_id }) => {
    const data = await call('DELETE', `/v1/subscriptions/${subscription_id}`) as any;
    return text(`Cancelled subscription ${data.id}`);
  });

  // 21. list_subscriptions
  server.tool('list_subscriptions', 'List subscriptions, optionally filtered by customer or status', {
    customer: z.string().optional().describe('Filter by customer ID'),
    status: z.enum(['active', 'past_due', 'canceled', 'unpaid', 'trialing']).optional().describe('Filter by status'),
  }, async ({ customer, status }) => {
    const data = await call('GET', `/v1/subscriptions${qs({ customer, status })}`) as any;
    if (!data.data?.length) return text('No subscriptions found.');
    const lines = data.data.map((s: any) => `• ${s.id} — customer ${s.customer} [${s.status}]`);
    return text(`Subscriptions (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 22. update_subscription
  server.tool('update_subscription', 'Update an existing subscription', {
    subscription_id: z.string().describe('Subscription ID to update'),
    cancel_at_period_end: z.boolean().optional().describe('Cancel at end of billing period'),
    metadata: z.record(z.string()).optional().describe('Metadata to update'),
  }, async ({ subscription_id, ...rest }) => {
    const data = await call('POST', `/v1/subscriptions/${subscription_id}`, rest) as any;
    return text(`Updated subscription ${data.id} [${data.status}]`);
  });

  // 23. create_billing_portal_session
  server.tool('create_billing_portal_session', 'Create a billing portal session for customer self-service', {
    customer: z.string().describe('Customer ID'),
    return_url: z.string().optional().describe('URL to redirect to after portal session'),
  }, async (params) => {
    const data = await call('POST', '/v1/billing_portal/sessions', params) as any;
    return text(`Created billing portal session ${data.id}: ${data.url}`);
  });

  // 24. search_stripe_resources (synthetic — searches across all resource types)
  server.tool('search_stripe_resources', 'Search across Stripe resources (customers, subscriptions, invoices, etc.)', {
    query: z.string().describe('Search query string'),
    resource: z.enum(['customers', 'subscriptions', 'invoices', 'payment_intents', 'charges']).optional().describe('Limit search to a specific resource type'),
  }, async ({ query, resource }) => {
    const types = resource ? [resource] : ['customers', 'subscriptions', 'invoices', 'payment_intents', 'charges'];
    const results: string[] = [];

    for (const type of types) {
      const path = type === 'payment_intents'
        ? '/v1/payment_intents'
        : `/v1/${type}`;
      try {
        const data = await call('GET', path) as any;
        if (!data.data?.length) continue;
        const matches = data.data.filter((item: any) => {
          const str = JSON.stringify(item).toLowerCase();
          return str.includes(query.toLowerCase());
        });
        for (const m of matches) {
          results.push(`[${type}] ${m.id} — ${JSON.stringify(m).slice(0, 120)}`);
        }
      } catch { /* skip */ }
    }

    if (!results.length) return text(`No results found for "${query}".`);
    return text(`Search results (${results.length}):\n${results.join('\n')}`);
  });

  // 25. fetch_stripe_resources (synthetic — generic resource fetcher)
  server.tool('fetch_stripe_resources', 'Fetch a specific Stripe resource by type and ID', {
    resource_type: z.enum([
      'customers', 'payment_intents', 'charges', 'subscriptions',
      'invoices', 'refunds', 'products', 'prices', 'coupons', 'disputes',
    ]).describe('The type of resource to fetch'),
    resource_id: z.string().describe('The ID of the resource'),
  }, async ({ resource_type, resource_id }) => {
    const path = `/v1/${resource_type}/${resource_id}`;
    const data = await call('GET', path) as any;
    return text(JSON.stringify(data, null, 2));
  });

  // 26. search_stripe_documentation (informational — returns static guidance)
  server.tool('search_stripe_documentation', 'Search Stripe documentation for API guidance', {
    query: z.string().describe('Documentation topic to search for'),
  }, async ({ query }) => {
    return text(
      `Stripe documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real Stripe documentation, visit ${meta.documentationUrl}\n\n` +
      `Common topics:\n` +
      `• Payments: POST /v1/payment_intents with amount + currency\n` +
      `• Customers: POST /v1/customers with email + name\n` +
      `• Subscriptions: POST /v1/subscriptions with customer + price\n` +
      `• Invoices: POST /v1/invoices, then /finalize, then /pay\n` +
      `• Refunds: POST /v1/refunds with payment_intent or charge\n` +
      `• Webhooks: Events are delivered to your endpoint URL\n`,
    );
  });

  // ── Mimic-only tools (beyond official MCP) ─────────────────────────

  // M1. create_payment_intent
  server.tool('create_payment_intent', 'Create a new payment intent', {
    amount: z.number().int().positive().describe('Amount in smallest currency unit (e.g. cents)'),
    currency: z.string().length(3).optional().describe('Three-letter ISO currency code (default usd)'),
    customer: z.string().optional().describe('Customer ID to attach'),
    description: z.string().optional().describe('Description of the payment'),
    metadata: z.record(z.string()).optional().describe('Arbitrary key-value metadata'),
  }, async ({ amount, currency, customer, description, metadata }) => {
    const cur = currency ?? 'usd';
    const data = await call('POST', '/v1/payment_intents', { amount, currency: cur, customer, description, metadata }) as any;
    return text(`Created payment intent ${data.id} for ${(data.amount / 100).toFixed(2)} ${data.currency}`);
  });

  // M2. confirm_payment_intent
  server.tool('confirm_payment_intent', 'Confirm a payment intent', {
    payment_intent_id: z.string().describe('Payment intent ID to confirm'),
  }, async ({ payment_intent_id }) => {
    const data = await call('POST', `/v1/payment_intents/${payment_intent_id}/confirm`) as any;
    return text(`Confirmed ${data.id}, status: ${data.status}`);
  });

  // M3. capture_payment_intent
  server.tool('capture_payment_intent', 'Capture a previously authorized payment intent', {
    payment_intent_id: z.string().describe('Payment intent ID to capture'),
    amount_to_capture: z.number().int().positive().optional().describe('Amount to capture (captures full amount if omitted)'),
  }, async ({ payment_intent_id, amount_to_capture }) => {
    const body = amount_to_capture !== undefined ? { amount_to_capture } : undefined;
    const data = await call('POST', `/v1/payment_intents/${payment_intent_id}/capture`, body) as any;
    return text(`Captured ${data.id}`);
  });

  // M4. cancel_payment_intent
  server.tool('cancel_payment_intent', 'Cancel a payment intent', {
    payment_intent_id: z.string().describe('Payment intent ID to cancel'),
  }, async ({ payment_intent_id }) => {
    const data = await call('POST', `/v1/payment_intents/${payment_intent_id}/cancel`) as any;
    return text(`Cancelled ${data.id}`);
  });
}

/**
 * Create a standalone Mimic MCP server for Stripe.
 * Call `.connect(transport)` to start it.
 */
export function createStripeMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
    description: meta.mcp.description,
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
