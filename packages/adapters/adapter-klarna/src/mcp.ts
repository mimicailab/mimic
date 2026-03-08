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
    if (!res.ok && res.status !== 201 && res.status !== 204 && res.status !== 202) {
      const text = await res.text();
      throw new Error(`Klarna mock error ${res.status}: ${text}`);
    }
    if (res.status === 204 || res.status === 202) return {};
    return res.json();
  };
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

const orderLineSchema = z.object({
  type: z.string().optional().describe('Line type (e.g. physical, digital)'),
  name: z.string().describe('Item name'),
  quantity: z.number().int().positive().describe('Quantity'),
  unit_price: z.number().int().describe('Unit price in minor units'),
  total_amount: z.number().int().describe('Total amount in minor units'),
  tax_rate: z.number().int().optional().describe('Tax rate (e.g. 2500 = 25%)'),
  total_tax_amount: z.number().int().optional().describe('Total tax in minor units'),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function registerKlarnaTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4103',
): void {
  const call = makeCall(baseUrl);

  // ── 1. create_payment_session
  server.tool('create_payment_session', 'Create a Klarna payment session', {
    purchase_country: z.string().length(2).describe('Two-letter country code'),
    purchase_currency: z.string().length(3).describe('Three-letter currency code'),
    order_amount: z.number().int().describe('Total amount in minor units'),
    order_tax_amount: z.number().int().optional().describe('Tax amount in minor units'),
    order_lines: z.array(orderLineSchema).describe('Order line items'),
    locale: z.string().optional().describe('Locale (e.g. en-US)'),
  }, async (params) => {
    const data = await call('POST', '/klarna/payments/v1/sessions', params) as any;
    return text(`Session ${data.session_id} created [${data.status}]\nClient token: ${data.client_token?.slice(0, 40)}...`);
  });

  // ── 2. get_payment_session
  server.tool('get_payment_session', 'Get a payment session by ID', {
    session_id: z.string().describe('Payment session ID'),
  }, async ({ session_id }) => {
    const data = await call('GET', `/klarna/payments/v1/sessions/${session_id}`) as any;
    return text(`Session ${data.session_id}: ${data.order_amount} ${data.purchase_currency} [${data.status}]`);
  });

  // ── 3. create_order_from_auth
  server.tool('create_order_from_auth', 'Create an order from an authorization token', {
    authorization_token: z.string().describe('Authorization token from Klarna JS'),
    purchase_country: z.string().length(2).optional().describe('Country code'),
    purchase_currency: z.string().length(3).optional().describe('Currency code'),
    order_amount: z.number().int().describe('Order amount in minor units'),
    order_lines: z.array(orderLineSchema).optional().describe('Order lines'),
  }, async ({ authorization_token, ...rest }) => {
    const data = await call('POST', `/klarna/payments/v1/authorizations/${authorization_token}/order`, rest) as any;
    return text(`Order ${data.order_id} created [${data.status}] — ${data.order_amount} ${data.purchase_currency}`);
  });

  // ── 4. get_order
  server.tool('get_order', 'Get an order by ID', {
    order_id: z.string().describe('Order ID'),
  }, async ({ order_id }) => {
    const data = await call('GET', `/klarna/ordermanagement/v1/orders/${order_id}`) as any;
    return text(`Order ${data.order_id}: ${data.order_amount} ${data.purchase_currency} [${data.status}]\nCaptured: ${data.captured_amount} | Refunded: ${data.refunded_amount}`);
  });

  // ── 5. acknowledge_order
  server.tool('acknowledge_order', 'Acknowledge an order', {
    order_id: z.string().describe('Order ID to acknowledge'),
  }, async ({ order_id }) => {
    await call('POST', `/klarna/ordermanagement/v1/orders/${order_id}/acknowledge`);
    return text(`Order ${order_id} acknowledged`);
  });

  // ── 6. capture_order
  server.tool('capture_order', 'Capture an authorized order', {
    order_id: z.string().describe('Order ID'),
    captured_amount: z.number().int().optional().describe('Amount to capture (full if omitted)'),
    description: z.string().optional().describe('Capture description'),
  }, async ({ order_id, ...rest }) => {
    await call('POST', `/klarna/ordermanagement/v1/orders/${order_id}/captures`, rest);
    return text(`Capture created for order ${order_id}`);
  });

  // ── 7. refund_order
  server.tool('refund_order', 'Refund a captured order', {
    order_id: z.string().describe('Order ID'),
    refunded_amount: z.number().int().optional().describe('Amount to refund (full if omitted)'),
    description: z.string().optional().describe('Refund reason'),
  }, async ({ order_id, ...rest }) => {
    await call('POST', `/klarna/ordermanagement/v1/orders/${order_id}/refunds`, rest);
    return text(`Refund created for order ${order_id}`);
  });

  // ── 8. cancel_order
  server.tool('cancel_order', 'Cancel an authorized order', {
    order_id: z.string().describe('Order ID to cancel'),
  }, async ({ order_id }) => {
    await call('POST', `/klarna/ordermanagement/v1/orders/${order_id}/cancel`);
    return text(`Order ${order_id} cancelled`);
  });

  // ── 9. release_remaining_authorization
  server.tool('release_remaining_authorization', 'Release remaining authorization on an order', {
    order_id: z.string().describe('Order ID'),
  }, async ({ order_id }) => {
    await call('POST', `/klarna/ordermanagement/v1/orders/${order_id}/release-remaining-authorization`);
    return text(`Remaining authorization released for order ${order_id}`);
  });

  // ── 10. extend_authorization_time
  server.tool('extend_authorization_time', 'Extend authorization time for an order', {
    order_id: z.string().describe('Order ID'),
  }, async ({ order_id }) => {
    await call('POST', `/klarna/ordermanagement/v1/orders/${order_id}/extend-authorization-time`);
    return text(`Authorization time extended for order ${order_id}`);
  });

  // ── 11. create_checkout_order
  server.tool('create_checkout_order', 'Create a Klarna Checkout order', {
    purchase_country: z.string().length(2).describe('Country code'),
    purchase_currency: z.string().length(3).describe('Currency code'),
    order_amount: z.number().int().describe('Order amount in minor units'),
    order_lines: z.array(orderLineSchema).describe('Order line items'),
    merchant_urls: z.object({
      terms: z.string().optional(),
      checkout: z.string().optional(),
      confirmation: z.string().optional(),
      push: z.string().optional(),
    }).optional().describe('Merchant URLs'),
    locale: z.string().optional().describe('Locale'),
  }, async (params) => {
    const data = await call('POST', '/klarna/checkout/v3/orders', params) as any;
    return text(`Checkout order ${data.order_id} created [${data.status}]`);
  });

  // ── 12. get_checkout_order
  server.tool('get_checkout_order', 'Get a checkout order', {
    order_id: z.string().describe('Checkout order ID'),
  }, async ({ order_id }) => {
    const data = await call('GET', `/klarna/checkout/v3/orders/${order_id}`) as any;
    return text(`Checkout order ${data.order_id}: ${data.order_amount} ${data.purchase_currency} [${data.status}]`);
  });

  // ── 13. get_customer_token
  server.tool('get_customer_token', 'Get customer token details', {
    customer_token: z.string().describe('Customer token ID'),
  }, async ({ customer_token }) => {
    const data = await call('GET', `/klarna/customer-token/v1/tokens/${customer_token}`) as any;
    return text(`Token ${data.token_id}: ${data.payment_method_type} [${data.status}]`);
  });

  // ── 14. create_order_with_token
  server.tool('create_order_with_token', 'Create an order using a customer token (recurring)', {
    customer_token: z.string().describe('Customer token'),
    purchase_country: z.string().length(2).optional().describe('Country code'),
    purchase_currency: z.string().length(3).optional().describe('Currency code'),
    order_amount: z.number().int().describe('Order amount in minor units'),
    order_lines: z.array(orderLineSchema).optional().describe('Order lines'),
  }, async ({ customer_token, ...rest }) => {
    const data = await call('POST', `/klarna/customer-token/v1/tokens/${customer_token}/order`, rest) as any;
    return text(`Order ${data.order_id} created with token [${data.status}]`);
  });

  // ── 15. cancel_customer_token
  server.tool('cancel_customer_token', 'Cancel a customer token', {
    customer_token: z.string().describe('Customer token to cancel'),
  }, async ({ customer_token }) => {
    await call('PATCH', `/klarna/customer-token/v1/tokens/${customer_token}/status`, { status: 'CANCELLED' });
    return text(`Customer token ${customer_token} cancelled`);
  });

  // ── 16. create_hpp_session
  server.tool('create_hpp_session', 'Create a Hosted Payment Page session', {
    payment_session_url: z.string().optional().describe('Payment session URL'),
    merchant_urls: z.object({
      success: z.string().optional(),
      cancel: z.string().optional(),
      back: z.string().optional(),
      failure: z.string().optional(),
      error: z.string().optional(),
    }).optional().describe('Merchant redirect URLs'),
  }, async (params) => {
    const data = await call('POST', '/klarna/hpp/v1/sessions', params) as any;
    return text(`HPP session ${data.session_id} created [${data.status}]\nURL: ${data.session_url}`);
  });

  // ── 17. get_hpp_session
  server.tool('get_hpp_session', 'Get HPP session details', {
    session_id: z.string().describe('HPP session ID'),
  }, async ({ session_id }) => {
    const data = await call('GET', `/klarna/hpp/v1/sessions/${session_id}`) as any;
    return text(`HPP session ${data.session_id}: [${data.status}]\nURL: ${data.session_url}`);
  });

  // ── 18. list_payouts
  server.tool('list_payouts', 'List settlement payouts', {
    currency_code: z.string().length(3).optional().describe('Currency filter'),
  }, async ({ currency_code }) => {
    const qp = currency_code ? `?currency_code=${currency_code}` : '';
    const data = await call('GET', `/klarna/settlements/v1/payouts${qp}`) as any;
    const payouts = data.payouts || [];
    if (!payouts.length) return text('No payouts found.');
    const lines = payouts.map((p: any) =>
      `• ${p.payout_id.slice(0, 8)}... — ${p.total_amount} ${p.currency_code} (net: ${p.net_amount}) [${p.status}] ${p.payout_date}`,
    );
    return text(`Payouts (${payouts.length}):\n${lines.join('\n')}`);
  });

  // ── 19. search_klarna_documentation
  server.tool('search_klarna_documentation', 'Search Klarna documentation', {
    query: z.string().describe('Topic to search'),
  }, async ({ query }) => {
    return text(
      `Klarna documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real docs, visit https://docs.klarna.com\n\n` +
      `BNPL Flow: Create Session → Client-side Auth → Create Order → Acknowledge → Capture → Refund\n\n` +
      `API Products:\n` +
      `• Payments: POST /payments/v1/sessions + /authorizations/:token/order\n` +
      `• Order Mgmt: /ordermanagement/v1/orders/:id/captures|refunds|cancel\n` +
      `• Checkout: POST /checkout/v3/orders (server-side widget)\n` +
      `• Customer Token: /customer-token/v1/tokens/:token (recurring)\n` +
      `• HPP: /hpp/v1/sessions (hosted payment page)\n` +
      `• Settlements: /settlements/v1/payouts\n`,
    );
  });
}

/**
 * Create a standalone Mimic MCP server for Klarna.
 */
export function createKlarnaMcpServer(
  baseUrl: string = 'http://localhost:4103',
): McpServer {
  const server = new McpServer({
    name: 'mimic-klarna',
    version: '0.7.0',
    description:
      'Mimic MCP server for Klarna — BNPL, payments, order management, checkout against mock data',
  });
  registerKlarnaTools(server, baseUrl);
  return server;
}

/**
 * Start the Klarna MCP server on stdio transport.
 */
export async function startKlarnaMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4103';
  const server = createKlarnaMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Klarna MCP server running on stdio');
}
