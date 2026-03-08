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
      throw new Error(`MercadoPago mock error ${res.status}: ${text}`);
    }
    if (res.status === 204) return {};
    return res.json();
  };
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function registerMercadoPagoTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4104',
): void {
  const call = makeCall(baseUrl);

  // ── 1. get_oauth_token
  server.tool('mp_get_oauth_token', 'Get a MercadoPago OAuth access token', {}, async () => {
    const data = await call('POST', '/mercadopago/oauth/token') as any;
    return text(`Token: ${data.access_token?.slice(0, 40)}...\nExpires: ${data.expires_in}s`);
  });

  // ── 2. create_payment
  server.tool('mp_create_payment', 'Create a MercadoPago payment', {
    transaction_amount: z.number().describe('Payment amount'),
    currency_id: z.string().optional().describe('Currency (BRL, ARS, MXN, etc.)'),
    payment_method_id: z.string().optional().describe('Payment method (visa, master, pix, etc.)'),
    description: z.string().optional().describe('Payment description'),
    payer_email: z.string().optional().describe('Payer email'),
    installments: z.number().optional().describe('Number of installments'),
  }, async ({ transaction_amount, currency_id, payment_method_id, description, payer_email, installments }) => {
    const data = await call('POST', '/mercadopago/v1/payments', {
      transaction_amount,
      currency_id: currency_id || 'BRL',
      payment_method_id: payment_method_id || 'visa',
      description,
      payer: payer_email ? { email: payer_email } : undefined,
      installments: installments || 1,
    }) as any;
    return text(`Payment ${data.id} created [${data.status}] -- ${data.transaction_amount} ${data.currency_id}`);
  });

  // ── 3. get_payment
  server.tool('mp_get_payment', 'Get a MercadoPago payment by ID', {
    payment_id: z.string().describe('Payment ID'),
  }, async ({ payment_id }) => {
    const data = await call('GET', `/mercadopago/v1/payments/${payment_id}`) as any;
    return text(`Payment ${data.id}: ${data.transaction_amount} ${data.currency_id} [${data.status}]`);
  });

  // ── 4. search_payments
  server.tool('mp_search_payments', 'Search MercadoPago payments', {
    status: z.string().optional().describe('Filter by status (approved, pending, etc.)'),
    external_reference: z.string().optional().describe('Filter by external reference'),
  }, async ({ status, external_reference }) => {
    const qp = new URLSearchParams();
    if (status) qp.set('status', status);
    if (external_reference) qp.set('external_reference', external_reference);
    const data = await call('GET', `/mercadopago/v1/payments/search?${qp.toString()}`) as any;
    const results = data.results || [];
    if (!results.length) return text('No payments found.');
    const lines = results.map((p: any) =>
      `- ${p.id} -- ${p.transaction_amount} ${p.currency_id} [${p.status}]`,
    );
    return text(`Payments (${results.length}):\n${lines.join('\n')}`);
  });

  // ── 5. capture_payment
  server.tool('mp_capture_payment', 'Capture an authorized MercadoPago payment', {
    payment_id: z.string().describe('Payment ID to capture'),
  }, async ({ payment_id }) => {
    const data = await call('PUT', `/mercadopago/v1/payments/${payment_id}`, { capture: true }) as any;
    return text(`Payment ${data.id} captured [${data.status}]`);
  });

  // ── 6. cancel_payment
  server.tool('mp_cancel_payment', 'Cancel a MercadoPago payment', {
    payment_id: z.string().describe('Payment ID to cancel'),
  }, async ({ payment_id }) => {
    const data = await call('PUT', `/mercadopago/v1/payments/${payment_id}`, { status: 'cancelled' }) as any;
    return text(`Payment ${data.id} cancelled [${data.status}]`);
  });

  // ── 7. refund_payment
  server.tool('mp_refund_payment', 'Refund a MercadoPago payment', {
    payment_id: z.string().describe('Payment ID'),
    amount: z.number().optional().describe('Partial refund amount (omit for full refund)'),
  }, async ({ payment_id, amount }) => {
    const body: any = {};
    if (amount) body.amount = amount;
    const data = await call('POST', `/mercadopago/v1/payments/${payment_id}/refunds`, body) as any;
    return text(`Refund ${data.id} created [${data.status}] -- ${data.amount}`);
  });

  // ── 8. create_preference
  server.tool('mp_create_preference', 'Create a Checkout Pro preference', {
    title: z.string().describe('Item title'),
    unit_price: z.number().describe('Item unit price'),
    quantity: z.number().optional().describe('Item quantity'),
    currency_id: z.string().optional().describe('Currency'),
  }, async ({ title, unit_price, quantity, currency_id }) => {
    const data = await call('POST', '/mercadopago/checkout/preferences', {
      items: [{ title, unit_price, quantity: quantity || 1, currency_id: currency_id || 'BRL' }],
    }) as any;
    return text(`Preference ${data.id} created\nCheckout: ${data.sandbox_init_point}`);
  });

  // ── 9. create_customer
  server.tool('mp_create_customer', 'Create a MercadoPago customer', {
    email: z.string().describe('Customer email'),
    first_name: z.string().optional().describe('First name'),
    last_name: z.string().optional().describe('Last name'),
  }, async ({ email, first_name, last_name }) => {
    const data = await call('POST', '/mercadopago/v1/customers', {
      email,
      first_name: first_name || '',
      last_name: last_name || '',
    }) as any;
    return text(`Customer ${data.id} created -- ${data.email}`);
  });

  // ── 10. get_customer
  server.tool('mp_get_customer', 'Get a MercadoPago customer', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `/mercadopago/v1/customers/${customer_id}`) as any;
    return text(`Customer ${data.id}: ${data.email} (${data.first_name} ${data.last_name})`);
  });

  // ── 11. search_customers
  server.tool('mp_search_customers', 'Search MercadoPago customers', {
    email: z.string().optional().describe('Filter by email'),
  }, async ({ email }) => {
    const qp = new URLSearchParams();
    if (email) qp.set('email', email);
    const data = await call('GET', `/mercadopago/v1/customers/search?${qp.toString()}`) as any;
    const results = data.results || [];
    if (!results.length) return text('No customers found.');
    const lines = results.map((c: any) => `- ${c.id} -- ${c.email}`);
    return text(`Customers (${results.length}):\n${lines.join('\n')}`);
  });

  // ── 12. create_subscription
  server.tool('mp_create_subscription', 'Create a MercadoPago subscription', {
    reason: z.string().describe('Subscription reason/name'),
    payer_email: z.string().optional().describe('Payer email'),
    transaction_amount: z.number().optional().describe('Recurring amount'),
    currency_id: z.string().optional().describe('Currency'),
  }, async ({ reason, payer_email, transaction_amount, currency_id }) => {
    const data = await call('POST', '/mercadopago/preapproval', {
      reason,
      payer_email,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: transaction_amount || 0,
        currency_id: currency_id || 'BRL',
      },
    }) as any;
    return text(`Subscription ${data.id} created [${data.status}]`);
  });

  // ── 13. get_subscription
  server.tool('mp_get_subscription', 'Get a MercadoPago subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('GET', `/mercadopago/preapproval/${subscription_id}`) as any;
    return text(`Subscription ${data.id} [${data.status}] -- ${data.reason}`);
  });

  // ── 14. create_plan
  server.tool('mp_create_plan', 'Create a MercadoPago subscription plan', {
    reason: z.string().describe('Plan reason/name'),
    transaction_amount: z.number().optional().describe('Recurring amount'),
    currency_id: z.string().optional().describe('Currency'),
  }, async ({ reason, transaction_amount, currency_id }) => {
    const data = await call('POST', '/mercadopago/preapproval_plan', {
      reason,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: transaction_amount || 0,
        currency_id: currency_id || 'BRL',
      },
    }) as any;
    return text(`Plan ${data.id} created [${data.status}]`);
  });

  // ── 15. create_merchant_order
  server.tool('mp_create_merchant_order', 'Create a MercadoPago merchant order', {
    external_reference: z.string().optional().describe('External reference'),
    total_amount: z.number().optional().describe('Total amount'),
    site_id: z.string().optional().describe('Site ID (MLB, MLA, MLM, etc.)'),
  }, async ({ external_reference, total_amount, site_id }) => {
    const data = await call('POST', '/mercadopago/merchant_orders', {
      external_reference,
      total_amount: total_amount || 0,
      site_id: site_id || 'MLB',
    }) as any;
    return text(`Merchant order ${data.id} created [${data.status}]`);
  });

  // ── 16. list_payment_methods
  server.tool('mp_list_payment_methods', 'List available MercadoPago payment methods', {}, async () => {
    const data = await call('GET', '/mercadopago/v1/payment_methods') as any[];
    const lines = data.map((m: any) => `- ${m.id}: ${m.name} (${m.payment_type_id})`);
    return text(`Payment methods (${data.length}):\n${lines.join('\n')}`);
  });

  // ── 17. search_mercadopago_documentation
  server.tool('mp_search_documentation', 'Search MercadoPago documentation', {
    query: z.string().describe('Topic to search'),
  }, async ({ query }) => {
    return text(
      `MercadoPago documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real docs, visit https://www.mercadopago.com.br/developers\n\n` +
      `Checkout Flow: Create Preference -> Redirect -> Payment\n\n` +
      `API Products:\n` +
      `- Payments: POST /v1/payments (credit card, PIX, boleto)\n` +
      `- Refunds: POST /v1/payments/:id/refunds\n` +
      `- Preferences: POST /checkout/preferences (Checkout Pro)\n` +
      `- Customers: /v1/customers + /cards\n` +
      `- Subscriptions: /preapproval (preapproval)\n` +
      `- Plans: /preapproval_plan\n` +
      `- Merchant Orders: /merchant_orders\n` +
      `- Payment Methods: GET /v1/payment_methods\n`,
    );
  });
}

/**
 * Create a standalone Mimic MCP server for MercadoPago.
 */
export function createMercadoPagoMcpServer(
  baseUrl: string = 'http://localhost:4104',
): McpServer {
  const server = new McpServer({
    name: 'mimic-mercadopago',
    version: '0.7.0',
    description:
      'Mimic MCP server for MercadoPago — payments, refunds, preferences, customers, subscriptions, plans, merchant orders against mock data',
  });
  registerMercadoPagoTools(server, baseUrl);
  return server;
}

/**
 * Start the MercadoPago MCP server on stdio transport.
 */
export async function startMercadoPagoMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4104';
  const server = createMercadoPagoMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic MercadoPago MCP server running on stdio');
}
