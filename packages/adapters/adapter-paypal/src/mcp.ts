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
      throw new Error(`PayPal mock error ${res.status}: ${text}`);
    }
    if (res.status === 204 || res.status === 202) return {};
    return res.json();
  };
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

const moneySchema = z.object({
  currency_code: z.string().length(3).describe('Currency code (e.g. USD)'),
  value: z.string().describe('Amount as string (e.g. "10.00")'),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function registerPayPalTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4104',
): void {
  const call = makeCall(baseUrl);

  // ── 1. get_oauth_token
  server.tool('get_oauth_token', 'Get a PayPal OAuth2 access token', {}, async () => {
    const data = await call('POST', '/paypal/v1/oauth2/token') as any;
    return text(`Token: ${data.access_token?.slice(0, 40)}...\nExpires: ${data.expires_in}s`);
  });

  // ── 2. create_order
  server.tool('create_order', 'Create a PayPal checkout order', {
    intent: z.enum(['CAPTURE', 'AUTHORIZE']).optional().describe('Payment intent'),
    currency_code: z.string().length(3).optional().describe('Currency'),
    value: z.string().describe('Amount (e.g. "100.00")'),
    description: z.string().optional().describe('Order description'),
  }, async ({ intent, currency_code, value, description }) => {
    const data = await call('POST', '/paypal/v2/checkout/orders', {
      intent: intent || 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: currency_code || 'USD', value },
        description,
      }],
    }) as any;
    return text(`Order ${data.id} created [${data.status}]\nApprove: ${data.links?.find((l: any) => l.rel === 'approve')?.href || 'N/A'}`);
  });

  // ── 3. get_order
  server.tool('get_order', 'Get a PayPal order by ID', {
    order_id: z.string().describe('Order ID'),
  }, async ({ order_id }) => {
    const data = await call('GET', `/paypal/v2/checkout/orders/${order_id}`) as any;
    const pu = data.purchase_units?.[0];
    return text(`Order ${data.id}: ${pu?.amount?.value} ${pu?.amount?.currency_code} [${data.status}]`);
  });

  // ── 4. capture_order
  server.tool('capture_order', 'Capture a PayPal order', {
    order_id: z.string().describe('Order ID to capture'),
  }, async ({ order_id }) => {
    const data = await call('POST', `/paypal/v2/checkout/orders/${order_id}/capture`) as any;
    return text(`Order ${data.id} captured [${data.status}]`);
  });

  // ── 5. authorize_order
  server.tool('authorize_order', 'Authorize a PayPal order', {
    order_id: z.string().describe('Order ID to authorize'),
  }, async ({ order_id }) => {
    const data = await call('POST', `/paypal/v2/checkout/orders/${order_id}/authorize`) as any;
    return text(`Order ${data.id} authorized [${data.status}]`);
  });

  // ── 6. capture_authorization
  server.tool('capture_authorization', 'Capture an authorization', {
    authorization_id: z.string().describe('Authorization ID'),
    currency_code: z.string().optional().describe('Currency'),
    value: z.string().optional().describe('Amount to capture'),
  }, async ({ authorization_id, currency_code, value }) => {
    const body: any = {};
    if (value) body.amount = { currency_code: currency_code || 'USD', value };
    const data = await call('POST', `/paypal/v2/payments/authorizations/${authorization_id}/capture`, body) as any;
    return text(`Capture ${data.id} [${data.status}] — ${data.amount?.value} ${data.amount?.currency_code}`);
  });

  // ── 7. void_authorization
  server.tool('void_authorization', 'Void an authorization', {
    authorization_id: z.string().describe('Authorization ID to void'),
  }, async ({ authorization_id }) => {
    await call('POST', `/paypal/v2/payments/authorizations/${authorization_id}/void`);
    return text(`Authorization ${authorization_id} voided`);
  });

  // ── 8. refund_capture
  server.tool('refund_capture', 'Refund a captured payment', {
    capture_id: z.string().describe('Capture ID'),
    currency_code: z.string().optional().describe('Currency'),
    value: z.string().optional().describe('Refund amount'),
    note_to_payer: z.string().optional().describe('Note to payer'),
  }, async ({ capture_id, currency_code, value, note_to_payer }) => {
    const body: any = {};
    if (value) body.amount = { currency_code: currency_code || 'USD', value };
    if (note_to_payer) body.note_to_payer = note_to_payer;
    const data = await call('POST', `/paypal/v2/payments/captures/${capture_id}/refund`, body) as any;
    return text(`Refund ${data.id} [${data.status}] — ${data.amount?.value} ${data.amount?.currency_code}`);
  });

  // ── 9. create_payout
  server.tool('create_payout', 'Create a batch payout', {
    email_subject: z.string().optional().describe('Payout email subject'),
    items: z.array(z.object({
      recipient_type: z.enum(['EMAIL', 'PHONE', 'PAYPAL_ID']).optional(),
      receiver: z.string().describe('Recipient email/phone/ID'),
      amount: moneySchema.describe('Payout amount'),
      note: z.string().optional(),
    })).describe('Payout items'),
  }, async ({ email_subject, items }) => {
    const data = await call('POST', '/paypal/v1/payments/payouts', {
      sender_batch_header: {
        sender_batch_id: `batch-${Date.now()}`,
        email_subject: email_subject || 'You have a payout!',
      },
      items: items.map((i) => ({
        recipient_type: i.recipient_type || 'EMAIL',
        amount: i.amount,
        receiver: i.receiver,
        note: i.note || '',
      })),
    }) as any;
    return text(`Payout batch ${data.batch_header?.payout_batch_id} [${data.batch_header?.batch_status}] — ${data.items?.length} items`);
  });

  // ── 10. get_payout_batch
  server.tool('get_payout_batch', 'Get payout batch details', {
    batch_id: z.string().describe('Payout batch ID'),
  }, async ({ batch_id }) => {
    const data = await call('GET', `/paypal/v1/payments/payouts/${batch_id}`) as any;
    return text(`Batch ${data.batch_header?.payout_batch_id} [${data.batch_header?.batch_status}] — ${data.items?.length} items`);
  });

  // ── 11. list_disputes
  server.tool('list_disputes', 'List PayPal disputes', {}, async () => {
    const data = await call('GET', '/paypal/v1/customer/disputes') as any;
    const items = data.items || [];
    if (!items.length) return text('No disputes found.');
    const lines = items.map((d: any) =>
      `• ${d.dispute_id} — ${d.dispute_amount?.value} ${d.dispute_amount?.currency_code} [${d.status}] ${d.reason}`,
    );
    return text(`Disputes (${items.length}):\n${lines.join('\n')}`);
  });

  // ── 12. accept_dispute_claim
  server.tool('accept_dispute_claim', 'Accept a dispute claim', {
    dispute_id: z.string().describe('Dispute ID'),
    note: z.string().optional().describe('Note for acceptance'),
  }, async ({ dispute_id, note }) => {
    const data = await call('POST', `/paypal/v1/customer/disputes/${dispute_id}/accept-claim`, { note }) as any;
    return text(`Dispute ${data.dispute_id} — accepted [${data.status}]`);
  });

  // ── 13. create_billing_plan
  server.tool('create_billing_plan', 'Create a billing plan', {
    name: z.string().describe('Plan name'),
    description: z.string().optional().describe('Plan description'),
    billing_cycles: z.array(z.object({
      frequency: z.object({
        interval_unit: z.enum(['DAY', 'WEEK', 'MONTH', 'YEAR']),
        interval_count: z.number().int().optional(),
      }),
      tenure_type: z.enum(['REGULAR', 'TRIAL']),
      sequence: z.number().int(),
      total_cycles: z.number().int(),
      pricing_scheme: z.object({
        fixed_price: moneySchema,
      }),
    })).optional().describe('Billing cycles'),
  }, async ({ name, description, billing_cycles }) => {
    const data = await call('POST', '/paypal/v1/billing/plans', { name, description, billing_cycles }) as any;
    return text(`Plan ${data.id} created [${data.status}] — ${data.name}`);
  });

  // ── 14. create_subscription
  server.tool('create_subscription', 'Create a subscription', {
    plan_id: z.string().describe('Billing plan ID'),
    subscriber_email: z.string().optional().describe('Subscriber email'),
  }, async ({ plan_id, subscriber_email }) => {
    const data = await call('POST', '/paypal/v1/billing/subscriptions', {
      plan_id,
      subscriber: subscriber_email ? { email_address: subscriber_email } : {},
    }) as any;
    return text(`Subscription ${data.id} created [${data.status}] — plan ${data.plan_id}`);
  });

  // ── 15. get_subscription
  server.tool('get_subscription', 'Get subscription details', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('GET', `/paypal/v1/billing/subscriptions/${subscription_id}`) as any;
    return text(`Subscription ${data.id} [${data.status}] — plan ${data.plan_id}\nNext billing: ${data.billing_info?.next_billing_time}`);
  });

  // ── 16. cancel_subscription
  server.tool('cancel_subscription', 'Cancel a subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    reason: z.string().optional().describe('Cancellation reason'),
  }, async ({ subscription_id, reason }) => {
    await call('POST', `/paypal/v1/billing/subscriptions/${subscription_id}/cancel`, { reason });
    return text(`Subscription ${subscription_id} cancelled`);
  });

  // ── 17. create_invoice
  server.tool('create_invoice', 'Create a draft invoice', {
    currency_code: z.string().optional().describe('Currency'),
    recipient_email: z.string().optional().describe('Recipient email'),
    items: z.array(z.object({
      name: z.string().describe('Item name'),
      quantity: z.string().describe('Quantity'),
      unit_amount: moneySchema.describe('Unit amount'),
    })).optional().describe('Invoice items'),
  }, async ({ currency_code, recipient_email, items }) => {
    const data = await call('POST', '/paypal/v2/invoicing/invoices', {
      detail: { currency_code: currency_code || 'USD' },
      primary_recipients: recipient_email ? [{ billing_info: { email_address: recipient_email } }] : [],
      items: items || [],
    }) as any;
    return text(`Invoice ${data.id} created [${data.status}]`);
  });

  // ── 18. send_invoice
  server.tool('send_invoice', 'Send an invoice', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    await call('POST', `/paypal/v2/invoicing/invoices/${invoice_id}/send`);
    return text(`Invoice ${invoice_id} sent`);
  });

  // ── 19. list_transactions
  server.tool('list_transactions', 'Search/list transactions', {
    start_date: z.string().optional().describe('Start date ISO 8601'),
    end_date: z.string().optional().describe('End date ISO 8601'),
  }, async ({ start_date, end_date }) => {
    const qp = new URLSearchParams();
    if (start_date) qp.set('start_date', start_date);
    if (end_date) qp.set('end_date', end_date);
    const data = await call('GET', `/paypal/v1/reporting/transactions?${qp.toString()}`) as any;
    const txns = data.transaction_details || [];
    if (!txns.length) return text('No transactions found.');
    const lines = txns.map((t: any) =>
      `• ${t.transaction_info?.transaction_id} — ${t.transaction_info?.transaction_amount?.value} [${t.transaction_info?.transaction_status}]`,
    );
    return text(`Transactions (${txns.length}):\n${lines.join('\n')}`);
  });

  // ── 20. create_webhook
  server.tool('create_webhook', 'Create a webhook subscription', {
    url: z.string().describe('Webhook URL'),
    event_types: z.array(z.string()).describe('Event types to subscribe to'),
  }, async ({ url, event_types }) => {
    const data = await call('POST', '/paypal/v1/notifications/webhooks', {
      url,
      event_types: event_types.map((t) => ({ name: t })),
    }) as any;
    return text(`Webhook ${data.id} created for ${url}`);
  });

  // ── 21. search_paypal_documentation
  server.tool('search_paypal_documentation', 'Search PayPal documentation', {
    query: z.string().describe('Topic to search'),
  }, async ({ query }) => {
    return text(
      `PayPal documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real docs, visit https://developer.paypal.com\n\n` +
      `Checkout Flow: Create Order → Approve → Capture/Authorize\n\n` +
      `API Products:\n` +
      `• Orders: POST /v2/checkout/orders + /capture or /authorize\n` +
      `• Payments: /v2/payments/authorizations|captures|refunds\n` +
      `• Payouts: POST /v1/payments/payouts (batch)\n` +
      `• Subscriptions: /v1/billing/plans + /subscriptions\n` +
      `• Invoicing: /v2/invoicing/invoices\n` +
      `• Disputes: /v1/customer/disputes\n` +
      `• Vault: /v3/vault/payment-tokens\n` +
      `• Webhooks: /v1/notifications/webhooks\n`,
    );
  });
}

/**
 * Create a standalone Mimic MCP server for PayPal.
 */
export function createPayPalMcpServer(
  baseUrl: string = 'http://localhost:4104',
): McpServer {
  const server = new McpServer({
    name: 'mimic-paypal',
    version: '0.7.0',
    description:
      'Mimic MCP server for PayPal — orders, payments, payouts, disputes, subscriptions, invoicing against mock data',
  });
  registerPayPalTools(server, baseUrl);
  return server;
}

/**
 * Start the PayPal MCP server on stdio transport.
 */
export async function startPayPalMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4104';
  const server = createPayPalMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic PayPal MCP server running on stdio');
}
