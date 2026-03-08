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
      throw new Error(`Mollie mock error ${res.status}: ${text}`);
    }
    if (res.status === 204) return {};
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
// Mollie amount helper
// ---------------------------------------------------------------------------

const amountSchema = z.object({
  value: z.string().describe('Amount value as string, e.g. "10.00"'),
  currency: z.string().length(3).describe('ISO 4217 currency code, e.g. EUR'),
});

// ---------------------------------------------------------------------------
// Factory — Official Mollie MCP parity (21 tools) + Mimic extras (7 tools)
// ---------------------------------------------------------------------------

export function registerMollieTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4101',
): void {
  const call = makeCall(baseUrl);
  const p = '/mollie/v2';

  // ── 1. create_payment
  server.tool('create_payment', 'Create a new Mollie payment', {
    amount: amountSchema.describe('Payment amount'),
    description: z.string().describe('Payment description'),
    redirectUrl: z.string().optional().describe('URL to redirect after payment'),
    webhookUrl: z.string().optional().describe('URL for payment status webhooks'),
    method: z.string().optional().describe('Payment method (e.g. ideal, creditcard)'),
    metadata: z.record(z.string()).optional().describe('Arbitrary metadata'),
  }, async (params) => {
    const data = await call('POST', `${p}/payments`, params) as any;
    return text(`Created payment ${data.id}: ${data.amount.value} ${data.amount.currency} [${data.status}]`);
  });

  // ── 2. get_payment
  server.tool('get_payment', 'Retrieve a specific payment by ID', {
    payment_id: z.string().describe('Payment ID (tr_xxx)'),
  }, async ({ payment_id }) => {
    const data = await call('GET', `${p}/payments/${payment_id}`) as any;
    return text(`Payment ${data.id}: ${data.amount.value} ${data.amount.currency} [${data.status}] — ${data.description}`);
  });

  // ── 3. list_payments
  server.tool('list_payments', 'List all payments', {
    limit: z.number().int().min(1).max(250).optional().describe('Max results'),
  }, async ({ limit }) => {
    const data = await call('GET', `${p}/payments${qs({ limit })}`) as any;
    const payments = data._embedded?.payments || [];
    if (!payments.length) return text('No payments found.');
    const lines = payments.map((p: any) => `• ${p.id} — ${p.amount.value} ${p.amount.currency} [${p.status}]`);
    return text(`Payments (${data.count}):\n${lines.join('\n')}`);
  });

  // ── 4. cancel_payment
  server.tool('cancel_payment', 'Cancel a payment', {
    payment_id: z.string().describe('Payment ID to cancel'),
  }, async ({ payment_id }) => {
    const data = await call('DELETE', `${p}/payments/${payment_id}`) as any;
    return text(`Payment ${data.id} canceled [${data.status}]`);
  });

  // ── 5. create_refund
  server.tool('create_refund', 'Create a refund for a paid payment', {
    payment_id: z.string().describe('Payment ID to refund'),
    amount: amountSchema.optional().describe('Refund amount (full refund if omitted)'),
    description: z.string().optional().describe('Refund description'),
  }, async ({ payment_id, amount, description }) => {
    const data = await call('POST', `${p}/payments/${payment_id}/refunds`, { amount, description }) as any;
    return text(`Created refund ${data.id} for payment ${payment_id} [${data.status}]`);
  });

  // ── 6. list_refunds
  server.tool('list_refunds', 'List all refunds', {
    limit: z.number().int().min(1).max(250).optional().describe('Max results'),
  }, async ({ limit }) => {
    const data = await call('GET', `${p}/refunds${qs({ limit })}`) as any;
    const refunds = data._embedded?.refunds || [];
    if (!refunds.length) return text('No refunds found.');
    const lines = refunds.map((r: any) => `• ${r.id} — ${r.amount.value} ${r.amount.currency} [${r.status}]`);
    return text(`Refunds (${data.count}):\n${lines.join('\n')}`);
  });

  // ── 7. create_customer
  server.tool('create_customer', 'Create a new Mollie customer', {
    name: z.string().optional().describe('Customer name'),
    email: z.string().optional().describe('Customer email'),
    locale: z.string().optional().describe('Customer locale (e.g. en_US, nl_NL)'),
    metadata: z.record(z.string()).optional().describe('Arbitrary metadata'),
  }, async (params) => {
    const data = await call('POST', `${p}/customers`, params) as any;
    return text(`Created customer ${data.id}: ${data.name ?? data.email ?? '(no name)'}`);
  });

  // ── 8. get_customer
  server.tool('get_customer', 'Retrieve a customer by ID', {
    customer_id: z.string().describe('Customer ID (cst_xxx)'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `${p}/customers/${customer_id}`) as any;
    return text(`Customer ${data.id}: ${data.name ?? '(no name)'} (${data.email ?? 'no email'})`);
  });

  // ── 9. list_customers
  server.tool('list_customers', 'List all customers', {
    limit: z.number().int().min(1).max(250).optional().describe('Max results'),
  }, async ({ limit }) => {
    const data = await call('GET', `${p}/customers${qs({ limit })}`) as any;
    const customers = data._embedded?.customers || [];
    if (!customers.length) return text('No customers found.');
    const lines = customers.map((c: any) => `• ${c.id} — ${c.name ?? '(no name)'} (${c.email ?? 'no email'})`);
    return text(`Customers (${data.count}):\n${lines.join('\n')}`);
  });

  // ── 10. update_customer
  server.tool('update_customer', 'Update a customer', {
    customer_id: z.string().describe('Customer ID to update'),
    name: z.string().optional().describe('New name'),
    email: z.string().optional().describe('New email'),
    locale: z.string().optional().describe('New locale'),
  }, async ({ customer_id, ...rest }) => {
    const data = await call('PATCH', `${p}/customers/${customer_id}`, rest) as any;
    return text(`Updated customer ${data.id}: ${data.name ?? '(no name)'}`);
  });

  // ── 11. create_order
  server.tool('create_order', 'Create a new order', {
    amount: amountSchema.describe('Total order amount'),
    orderNumber: z.string().optional().describe('Your order number'),
    lines: z.array(z.object({
      name: z.string().describe('Line item name'),
      quantity: z.number().int().positive().describe('Quantity'),
      unitPrice: amountSchema.describe('Unit price'),
      totalAmount: amountSchema.describe('Total amount for this line'),
    })).describe('Order lines'),
    redirectUrl: z.string().optional().describe('URL to redirect after payment'),
    locale: z.string().optional().describe('Locale (default en_US)'),
  }, async (params) => {
    const data = await call('POST', `${p}/orders`, params) as any;
    return text(`Created order ${data.id}: ${data.amount.value} ${data.amount.currency} [${data.status}]`);
  });

  // ── 12. get_order
  server.tool('get_order', 'Retrieve an order by ID', {
    order_id: z.string().describe('Order ID (ord_xxx)'),
  }, async ({ order_id }) => {
    const data = await call('GET', `${p}/orders/${order_id}`) as any;
    return text(`Order ${data.id}: ${data.amount.value} ${data.amount.currency} [${data.status}]`);
  });

  // ── 13. list_orders
  server.tool('list_orders', 'List all orders', {
    limit: z.number().int().min(1).max(250).optional().describe('Max results'),
  }, async ({ limit }) => {
    const data = await call('GET', `${p}/orders${qs({ limit })}`) as any;
    const orders = data._embedded?.orders || [];
    if (!orders.length) return text('No orders found.');
    const lines = orders.map((o: any) => `• ${o.id} — ${o.amount.value} ${o.amount.currency} [${o.status}]`);
    return text(`Orders (${data.count}):\n${lines.join('\n')}`);
  });

  // ── 14. cancel_order
  server.tool('cancel_order', 'Cancel an order', {
    order_id: z.string().describe('Order ID to cancel'),
  }, async ({ order_id }) => {
    const data = await call('DELETE', `${p}/orders/${order_id}`) as any;
    return text(`Order ${data.id} canceled [${data.status}]`);
  });

  // ── 15. create_shipment
  server.tool('create_shipment', 'Create a shipment for an order', {
    order_id: z.string().describe('Order ID'),
    tracking: z.object({
      carrier: z.string().describe('Carrier name'),
      code: z.string().describe('Tracking code'),
      url: z.string().optional().describe('Tracking URL'),
    }).optional().describe('Tracking information'),
  }, async ({ order_id, tracking }) => {
    const data = await call('POST', `${p}/orders/${order_id}/shipments`, { tracking }) as any;
    return text(`Created shipment ${data.id} for order ${order_id}`);
  });

  // ── 16. list_methods
  server.tool('list_methods', 'List active payment methods', {}, async () => {
    const data = await call('GET', `${p}/methods`) as any;
    const methods = data._embedded?.methods || [];
    const lines = methods.map((m: any) => `• ${m.id} — ${m.description}`);
    return text(`Active payment methods (${data.count}):\n${lines.join('\n')}`);
  });

  // ── 17. create_mandate
  server.tool('create_mandate', 'Create a mandate for a customer', {
    customer_id: z.string().describe('Customer ID'),
    method: z.string().optional().describe('Payment method (e.g. directdebit)'),
    consumerName: z.string().optional().describe('Consumer name for SEPA'),
    consumerAccount: z.string().optional().describe('IBAN account number'),
  }, async ({ customer_id, ...rest }) => {
    const data = await call('POST', `${p}/customers/${customer_id}/mandates`, rest) as any;
    return text(`Created mandate ${data.id} for customer ${customer_id} [${data.status}]`);
  });

  // ── 18. list_mandates
  server.tool('list_mandates', 'List mandates for a customer', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `${p}/customers/${customer_id}/mandates`) as any;
    const mandates = data._embedded?.mandates || [];
    if (!mandates.length) return text('No mandates found.');
    const lines = mandates.map((m: any) => `• ${m.id} — ${m.method} [${m.status}]`);
    return text(`Mandates (${data.count}):\n${lines.join('\n')}`);
  });

  // ── 19. create_subscription
  server.tool('create_subscription', 'Create a subscription for a customer', {
    customer_id: z.string().describe('Customer ID'),
    amount: amountSchema.describe('Subscription amount'),
    interval: z.string().describe('Billing interval (e.g. "1 month", "3 months")'),
    description: z.string().optional().describe('Subscription description'),
    times: z.number().int().positive().optional().describe('Number of charges (omit for indefinite)'),
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
  }, async ({ customer_id, ...rest }) => {
    const data = await call('POST', `${p}/customers/${customer_id}/subscriptions`, rest) as any;
    return text(`Created subscription ${data.id} for customer ${customer_id} [${data.status}]`);
  });

  // ── 20. list_subscriptions
  server.tool('list_subscriptions', 'List subscriptions for a customer', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `${p}/customers/${customer_id}/subscriptions`) as any;
    const subs = data._embedded?.subscriptions || [];
    if (!subs.length) return text('No subscriptions found.');
    const lines = subs.map((s: any) => `• ${s.id} — ${s.amount.value} ${s.amount.currency} every ${s.interval} [${s.status}]`);
    return text(`Subscriptions (${data.count}):\n${lines.join('\n')}`);
  });

  // ── 21. cancel_subscription
  server.tool('cancel_subscription', 'Cancel a subscription', {
    customer_id: z.string().describe('Customer ID'),
    subscription_id: z.string().describe('Subscription ID to cancel'),
  }, async ({ customer_id, subscription_id }) => {
    const data = await call('DELETE', `${p}/customers/${customer_id}/subscriptions/${subscription_id}`) as any;
    return text(`Subscription ${data.id} canceled [${data.status}]`);
  });

  // ── 22. create_payment_link
  server.tool('create_payment_link', 'Create a payment link', {
    amount: amountSchema.describe('Payment link amount'),
    description: z.string().describe('Payment link description'),
    redirectUrl: z.string().optional().describe('URL to redirect after payment'),
    expiresAt: z.string().optional().describe('Expiry datetime (ISO 8601)'),
  }, async (params) => {
    const data = await call('POST', `${p}/payment-links`, params) as any;
    return text(`Created payment link ${data.id}: ${data._links?.paymentLink?.href ?? 'N/A'}`);
  });

  // ── 23. list_settlements
  server.tool('list_settlements', 'List settlements', {}, async () => {
    const data = await call('GET', `${p}/settlements`) as any;
    const settlements = data._embedded?.settlements || [];
    if (!settlements.length) return text('No settlements found.');
    const lines = settlements.map((s: any) => `• ${s.id} — ${s.amount.value} ${s.amount.currency} [${s.status}]`);
    return text(`Settlements (${data.count}):\n${lines.join('\n')}`);
  });

  // ── 24. get_settlement
  server.tool('get_settlement', 'Retrieve a settlement by ID', {
    settlement_id: z.string().describe('Settlement ID (stl_xxx)'),
  }, async ({ settlement_id }) => {
    const data = await call('GET', `${p}/settlements/${settlement_id}`) as any;
    return text(`Settlement ${data.id}: ${data.amount.value} ${data.amount.currency} [${data.status}]`);
  });

  // ── Mimic-only extras ─────────────────────────────────────────────────

  // M1. transition_payment (for lifecycle testing)
  server.tool('transition_payment', 'Transition a payment to a new status (Mimic-only, for testing)', {
    payment_id: z.string().describe('Payment ID'),
    status: z.enum(['open', 'pending', 'authorized', 'paid', 'canceled', 'expired', 'failed']).describe('Target status'),
  }, async ({ payment_id, status }) => {
    const patch: Record<string, unknown> = { status };
    if (status === 'paid') patch.paidAt = new Date().toISOString();
    if (status === 'canceled') { patch.canceledAt = new Date().toISOString(); patch.isCancelable = false; }
    if (status === 'expired') patch.expiredAt = new Date().toISOString();
    const data = await call('PATCH', `${p}/payments/${payment_id}`, patch) as any;
    return text(`Payment ${data.id} transitioned to [${data.status}]`);
  });

  // M2. capture_payment
  server.tool('capture_payment', 'Capture an authorized payment (creates a capture)', {
    payment_id: z.string().describe('Payment ID to capture'),
    amount: amountSchema.optional().describe('Capture amount (full capture if omitted)'),
  }, async ({ payment_id, amount }) => {
    const data = await call('POST', `${p}/payments/${payment_id}/captures`, { amount }) as any;
    return text(`Created capture ${data.id} for payment ${payment_id}`);
  });

  // M3. list_chargebacks
  server.tool('list_chargebacks', 'List all chargebacks', {}, async () => {
    const data = await call('GET', `${p}/chargebacks`) as any;
    const chargebacks = data._embedded?.chargebacks || [];
    if (!chargebacks.length) return text('No chargebacks found.');
    const lines = chargebacks.map((c: any) => `• ${c.id} — ${c.amount.value} ${c.amount.currency}`);
    return text(`Chargebacks (${data.count}):\n${lines.join('\n')}`);
  });

  // M4. search_mollie_documentation
  server.tool('search_mollie_documentation', 'Search Mollie documentation for API guidance', {
    query: z.string().describe('Documentation topic'),
  }, async ({ query }) => {
    return text(
      `Mollie documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real Mollie documentation, visit https://docs.mollie.com\n\n` +
      `Common topics:\n` +
      `• Payments: POST /v2/payments with amount { value, currency } + description\n` +
      `• Refunds: POST /v2/payments/:id/refunds (payment must be paid)\n` +
      `• Orders: POST /v2/orders with amount + lines array\n` +
      `• Customers: POST /v2/customers with name + email\n` +
      `• Subscriptions: POST /v2/customers/:id/subscriptions with amount + interval\n` +
      `• Mandates: POST /v2/customers/:id/mandates for recurring payments\n` +
      `• Payment Links: POST /v2/payment-links for hosted payment pages\n`,
    );
  });

  // M5. fetch_mollie_resource
  server.tool('fetch_mollie_resource', 'Fetch a specific Mollie resource by type and ID', {
    resource_type: z.enum([
      'payments', 'customers', 'orders', 'refunds',
    ]).describe('The type of resource to fetch'),
    resource_id: z.string().describe('The ID of the resource'),
  }, async ({ resource_type, resource_id }) => {
    const data = await call('GET', `${p}/${resource_type}/${resource_id}`) as any;
    return text(JSON.stringify(data, null, 2));
  });

  // M6. revoke_mandate
  server.tool('revoke_mandate', 'Revoke a customer mandate', {
    customer_id: z.string().describe('Customer ID'),
    mandate_id: z.string().describe('Mandate ID to revoke'),
  }, async ({ customer_id, mandate_id }) => {
    await call('DELETE', `${p}/customers/${customer_id}/mandates/${mandate_id}`);
    return text(`Mandate ${mandate_id} revoked for customer ${customer_id}`);
  });

  // M7. list_all_methods
  server.tool('list_all_methods', 'List all available payment methods (including inactive)', {}, async () => {
    const data = await call('GET', `${p}/methods/all`) as any;
    const methods = data._embedded?.methods || [];
    const lines = methods.map((m: any) => `• ${m.id} — ${m.description} [${m.status}]`);
    return text(`All payment methods (${data.count}):\n${lines.join('\n')}`);
  });
}

/**
 * Create a standalone Mimic MCP server for Mollie.
 */
export function createMollieMcpServer(
  baseUrl: string = 'http://localhost:4101',
): McpServer {
  const server = new McpServer({
    name: 'mimic-mollie',
    version: '0.7.0',
    description:
      'Mimic MCP server for Mollie — payments, refunds, orders, customers against mock data',
  });
  registerMollieTools(server, baseUrl);
  return server;
}

/**
 * Start the Mollie MCP server on stdio transport.
 */
export async function startMollieMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4101';
  const server = createMollieMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Mollie MCP server running on stdio');
}
