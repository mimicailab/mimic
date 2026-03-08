import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Basic auth header for Xendit mock calls */
function basicAuth(key: string = 'xnd_development_mock_key'): string {
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

function makeCall(baseUrl: string) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 201 && res.status !== 202 && res.status !== 204) {
      const text = await res.text();
      throw new Error(`Xendit mock error ${res.status}: ${text}`);
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

export function registerXenditTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4104',
): void {
  const call = makeCall(baseUrl);

  // ── 1. create_payment_request
  server.tool('create_payment_request', 'Create a Xendit payment request', {
    amount: z.number().describe('Payment amount'),
    currency: z.string().length(3).optional().describe('Currency code (e.g. IDR)'),
    country: z.string().length(2).optional().describe('Country code (e.g. ID)'),
    reference_id: z.string().optional().describe('Reference ID'),
    description: z.string().optional().describe('Payment description'),
  }, async ({ amount, currency, country, reference_id, description }) => {
    const data = await call('POST', '/xendit/v3/payment_requests', {
      amount,
      currency: currency || 'IDR',
      country: country || 'ID',
      reference_id,
      description,
      payment_method: { type: 'EWALLET', reusability: 'ONE_TIME_USE' },
    }) as any;
    return text(`Payment request ${data.id} created [${data.status}]\nAmount: ${data.amount} ${data.currency}`);
  });

  // ── 2. get_payment_request
  server.tool('get_payment_request', 'Get a Xendit payment request by ID', {
    payment_request_id: z.string().describe('Payment request ID'),
  }, async ({ payment_request_id }) => {
    const data = await call('GET', `/xendit/v3/payment_requests/${payment_request_id}`) as any;
    return text(`Payment request ${data.id}: ${data.amount} ${data.currency} [${data.status}]`);
  });

  // ── 3. list_payment_requests
  server.tool('list_payment_requests', 'List Xendit payment requests', {
    status: z.string().optional().describe('Filter by status'),
    limit: z.number().optional().describe('Max results'),
  }, async ({ status, limit }) => {
    const qp = new URLSearchParams();
    if (status) qp.set('status', status);
    if (limit) qp.set('limit', String(limit));
    const data = await call('GET', `/xendit/v3/payment_requests?${qp.toString()}`) as any;
    const items = data.data || [];
    if (!items.length) return text('No payment requests found.');
    const lines = items.map((pr: any) =>
      `- ${pr.id} — ${pr.amount} ${pr.currency} [${pr.status}]`,
    );
    return text(`Payment requests (${items.length}):\n${lines.join('\n')}`);
  });

  // ── 4. create_payment_method
  server.tool('create_payment_method', 'Create a Xendit payment method', {
    type: z.enum(['EWALLET', 'CARDS', 'DIRECT_DEBIT', 'RETAIL_OUTLET', 'VIRTUAL_ACCOUNT', 'QR_CODE']).describe('Payment method type'),
    reusability: z.enum(['ONE_TIME_USE', 'MULTIPLE_USE']).optional().describe('Reusability'),
    country: z.string().length(2).optional().describe('Country code'),
    reference_id: z.string().optional().describe('Reference ID'),
  }, async ({ type, reusability, country, reference_id }) => {
    const data = await call('POST', '/xendit/v3/payment_methods', {
      type,
      reusability: reusability || 'ONE_TIME_USE',
      country: country || 'ID',
      reference_id,
    }) as any;
    return text(`Payment method ${data.id} created [${data.status}] — ${data.type}`);
  });

  // ── 5. get_payment_method
  server.tool('get_payment_method', 'Get a Xendit payment method by ID', {
    payment_method_id: z.string().describe('Payment method ID'),
  }, async ({ payment_method_id }) => {
    const data = await call('GET', `/xendit/v3/payment_methods/${payment_method_id}`) as any;
    return text(`Payment method ${data.id}: ${data.type} [${data.status}]`);
  });

  // ── 6. list_payment_methods
  server.tool('list_payment_methods', 'List Xendit payment methods', {
    type: z.string().optional().describe('Filter by type'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ type, status }) => {
    const qp = new URLSearchParams();
    if (type) qp.set('type', type);
    if (status) qp.set('status', status);
    const data = await call('GET', `/xendit/v3/payment_methods?${qp.toString()}`) as any;
    const items = data.data || [];
    if (!items.length) return text('No payment methods found.');
    const lines = items.map((pm: any) =>
      `- ${pm.id} — ${pm.type} [${pm.status}]`,
    );
    return text(`Payment methods (${items.length}):\n${lines.join('\n')}`);
  });

  // ── 7. create_invoice
  server.tool('create_invoice', 'Create a Xendit invoice', {
    external_id: z.string().describe('External invoice ID'),
    amount: z.number().describe('Invoice amount'),
    currency: z.string().optional().describe('Currency (default IDR)'),
    payer_email: z.string().optional().describe('Payer email'),
    description: z.string().optional().describe('Invoice description'),
  }, async ({ external_id, amount, currency, payer_email, description }) => {
    const data = await call('POST', '/xendit/v2/invoices/', {
      external_id,
      amount,
      currency: currency || 'IDR',
      payer_email,
      description,
    }) as any;
    return text(`Invoice ${data.id} created [${data.status}]\nURL: ${data.invoice_url}\nAmount: ${data.amount} ${data.currency}`);
  });

  // ── 8. get_invoice
  server.tool('get_invoice', 'Get a Xendit invoice by ID', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('GET', `/xendit/v2/invoices/${invoice_id}`) as any;
    return text(`Invoice ${data.id}: ${data.amount} ${data.currency} [${data.status}]\nExternal ID: ${data.external_id}`);
  });

  // ── 9. list_invoices
  server.tool('list_invoices', 'List Xendit invoices', {
    external_id: z.string().optional().describe('Filter by external ID'),
    limit: z.number().optional().describe('Max results'),
  }, async ({ external_id, limit }) => {
    const qp = new URLSearchParams();
    if (external_id) qp.set('external_id', external_id);
    if (limit) qp.set('limit', String(limit));
    const data = await call('GET', `/xendit/v2/invoices?${qp.toString()}`) as any;
    const items = Array.isArray(data) ? data : [];
    if (!items.length) return text('No invoices found.');
    const lines = items.map((inv: any) =>
      `- ${inv.id} — ${inv.amount} ${inv.currency} [${inv.status}]`,
    );
    return text(`Invoices (${items.length}):\n${lines.join('\n')}`);
  });

  // ── 10. expire_invoice
  server.tool('expire_invoice', 'Expire a Xendit invoice', {
    invoice_id: z.string().describe('Invoice ID to expire'),
  }, async ({ invoice_id }) => {
    const data = await call('POST', `/xendit/invoices/${invoice_id}/expire`) as any;
    return text(`Invoice ${data.id} expired [${data.status}]`);
  });

  // ── 11. create_payout
  server.tool('create_payout', 'Create a Xendit payout', {
    reference_id: z.string().describe('Reference ID'),
    channel_code: z.string().describe('Channel code (e.g. ID_BCA)'),
    amount: z.number().describe('Payout amount'),
    currency: z.string().optional().describe('Currency (default IDR)'),
    description: z.string().optional().describe('Payout description'),
  }, async ({ reference_id, channel_code, amount, currency, description }) => {
    const data = await call('POST', '/xendit/v2/payouts', {
      reference_id,
      channel_code,
      amount,
      currency: currency || 'IDR',
      description,
      channel_properties: {},
    }) as any;
    return text(`Payout ${data.id} created [${data.status}]\nAmount: ${data.amount} ${data.currency}`);
  });

  // ── 12. get_payout
  server.tool('get_payout', 'Get a Xendit payout by ID', {
    payout_id: z.string().describe('Payout ID'),
  }, async ({ payout_id }) => {
    const data = await call('GET', `/xendit/v2/payouts/${payout_id}`) as any;
    return text(`Payout ${data.id}: ${data.amount} ${data.currency} [${data.status}]`);
  });

  // ── 13. list_payouts
  server.tool('list_payouts', 'List Xendit payouts', {
    status: z.string().optional().describe('Filter by status'),
    limit: z.number().optional().describe('Max results'),
  }, async ({ status, limit }) => {
    const qp = new URLSearchParams();
    if (status) qp.set('status', status);
    if (limit) qp.set('limit', String(limit));
    const data = await call('GET', `/xendit/v2/payouts?${qp.toString()}`) as any;
    const items = data.data || [];
    if (!items.length) return text('No payouts found.');
    const lines = items.map((p: any) =>
      `- ${p.id} — ${p.amount} ${p.currency} [${p.status}]`,
    );
    return text(`Payouts (${items.length}):\n${lines.join('\n')}`);
  });

  // ── 14. cancel_payout
  server.tool('cancel_payout', 'Cancel a Xendit payout', {
    payout_id: z.string().describe('Payout ID to cancel'),
  }, async ({ payout_id }) => {
    const data = await call('POST', `/xendit/v2/payouts/${payout_id}/cancel`) as any;
    return text(`Payout ${data.id} cancelled [${data.status}]`);
  });

  // ── 15. create_refund
  server.tool('create_refund', 'Create a Xendit refund', {
    payment_request_id: z.string().optional().describe('Payment request ID to refund'),
    invoice_id: z.string().optional().describe('Invoice ID to refund'),
    reference_id: z.string().optional().describe('Reference ID'),
    amount: z.number().optional().describe('Refund amount'),
    reason: z.string().optional().describe('Refund reason'),
  }, async ({ payment_request_id, invoice_id, reference_id, amount, reason }) => {
    const data = await call('POST', '/xendit/refunds', {
      payment_request_id,
      invoice_id,
      reference_id,
      amount,
      reason,
    }) as any;
    return text(`Refund ${data.id} created [${data.status}]\nAmount: ${data.amount} ${data.currency}`);
  });

  // ── 16. get_refund
  server.tool('get_refund', 'Get a Xendit refund by ID', {
    refund_id: z.string().describe('Refund ID'),
  }, async ({ refund_id }) => {
    const data = await call('GET', `/xendit/refunds/${refund_id}`) as any;
    return text(`Refund ${data.id}: ${data.amount} ${data.currency} [${data.status}]`);
  });

  // ── 17. list_refunds
  server.tool('list_refunds', 'List Xendit refunds', {
    payment_request_id: z.string().optional().describe('Filter by payment request ID'),
    invoice_id: z.string().optional().describe('Filter by invoice ID'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ payment_request_id, invoice_id, status }) => {
    const qp = new URLSearchParams();
    if (payment_request_id) qp.set('payment_request_id', payment_request_id);
    if (invoice_id) qp.set('invoice_id', invoice_id);
    if (status) qp.set('status', status);
    const data = await call('GET', `/xendit/refunds?${qp.toString()}`) as any;
    const items = data.data || [];
    if (!items.length) return text('No refunds found.');
    const lines = items.map((r: any) =>
      `- ${r.id} — ${r.amount} ${r.currency} [${r.status}]`,
    );
    return text(`Refunds (${items.length}):\n${lines.join('\n')}`);
  });

  // ── 18. create_customer
  server.tool('create_customer', 'Create a Xendit customer', {
    reference_id: z.string().describe('Customer reference ID'),
    type: z.enum(['INDIVIDUAL', 'BUSINESS']).optional().describe('Customer type'),
    email: z.string().optional().describe('Customer email'),
    mobile_number: z.string().optional().describe('Customer mobile number'),
  }, async ({ reference_id, type, email, mobile_number }) => {
    const data = await call('POST', '/xendit/customers', {
      reference_id,
      type: type || 'INDIVIDUAL',
      email,
      mobile_number,
    }) as any;
    return text(`Customer ${data.id} created — ref: ${data.reference_id}`);
  });

  // ── 19. get_customer
  server.tool('get_customer', 'Get a Xendit customer by ID', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `/xendit/customers/${customer_id}`) as any;
    return text(`Customer ${data.id}: ${data.type} — ref: ${data.reference_id}\nEmail: ${data.email || 'N/A'}`);
  });

  // ── 20. get_balance
  server.tool('get_balance', 'Get Xendit account balance', {
    account_type: z.enum(['CASH', 'HOLDING', 'TAX']).optional().describe('Account type'),
  }, async ({ account_type }) => {
    const qp = new URLSearchParams();
    if (account_type) qp.set('account_type', account_type);
    const data = await call('GET', `/xendit/balance?${qp.toString()}`) as any;
    return text(`Balance: ${data.balance} ${data.currency} [${data.account_type}]`);
  });

  // ── 21. search_xendit_documentation
  server.tool('search_xendit_documentation', 'Search Xendit documentation', {
    query: z.string().describe('Topic to search'),
  }, async ({ query }) => {
    return text(
      `Xendit documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real docs, visit https://developers.xendit.co\n\n` +
      `Payment Flow: Create Payment Request → REQUIRES_ACTION → SUCCEEDED\n\n` +
      `API Products:\n` +
      `- Payment Requests: POST /v3/payment_requests\n` +
      `- Payment Methods: POST /v3/payment_methods\n` +
      `- Invoices: POST /v2/invoices/\n` +
      `- Payouts: POST /v2/payouts\n` +
      `- Refunds: POST /refunds\n` +
      `- Customers: POST /customers\n` +
      `- Balance: GET /balance\n\n` +
      `Supported countries: ID, PH, VN, TH, MY, SG\n`,
    );
  });
}

/**
 * Create a standalone Mimic MCP server for Xendit.
 */
export function createXenditMcpServer(
  baseUrl: string = 'http://localhost:4104',
): McpServer {
  const server = new McpServer({
    name: 'mimic-xendit',
    version: '0.7.0',
    description:
      'Mimic MCP server for Xendit — payment requests, invoices, payouts, refunds, customers, payment methods, and balance against mock data',
  });
  registerXenditTools(server, baseUrl);
  return server;
}

/**
 * Start the Xendit MCP server on stdio transport.
 */
export async function startXenditMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4104';
  const server = createXenditMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Xendit MCP server running on stdio');
}
