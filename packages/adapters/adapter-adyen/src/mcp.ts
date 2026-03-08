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
      throw new Error(`Adyen mock error ${res.status}: ${text}`);
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

const amountSchema = z.object({
  value: z.number().int().describe('Amount in minor units (e.g. cents)'),
  currency: z.string().length(3).describe('ISO 4217 currency code'),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function registerAdyenTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4102',
): void {
  const call = makeCall(baseUrl);
  const p = '/adyen/v71';

  // ── 1. create_payment
  server.tool('create_payment', 'Create an Adyen payment', {
    amount: amountSchema.describe('Payment amount'),
    merchantAccount: z.string().describe('Merchant account name'),
    reference: z.string().optional().describe('Your payment reference'),
    paymentMethod: z.object({
      type: z.string().describe('Payment method type (e.g. scheme, paypal, ideal)'),
    }).optional().describe('Payment method details'),
    returnUrl: z.string().optional().describe('Return URL for redirects'),
    shopperReference: z.string().optional().describe('Shopper reference for tokenization'),
  }, async (params) => {
    const data = await call('POST', `${p}/payments`, params) as any;
    return text(`Payment ${data.pspReference}: ${data.resultCode} — ${data.amount.value / 100} ${data.amount.currency}`);
  });

  // ── 2. submit_payment_details
  server.tool('submit_payment_details', 'Submit 3DS/redirect details to complete payment', {
    details: z.record(z.string()).describe('Details from the redirect/challenge'),
    paymentData: z.string().optional().describe('Payment data from initial response'),
  }, async (params) => {
    const data = await call('POST', `${p}/payments/details`, params) as any;
    return text(`Payment details submitted: ${data.pspReference} — ${data.resultCode}`);
  });

  // ── 3. create_session
  server.tool('create_session', 'Create a Drop-in checkout session', {
    amount: amountSchema.describe('Session amount'),
    merchantAccount: z.string().describe('Merchant account name'),
    returnUrl: z.string().describe('URL to redirect after checkout'),
    reference: z.string().optional().describe('Your order reference'),
  }, async (params) => {
    const data = await call('POST', `${p}/sessions`, params) as any;
    return text(`Session created: ${data.id} (expires ${data.expiresAt})`);
  });

  // ── 4. get_payment_methods
  server.tool('get_payment_methods', 'Get available payment methods', {
    merchantAccount: z.string().optional().describe('Merchant account name'),
    countryCode: z.string().optional().describe('Country code filter'),
  }, async (params) => {
    const data = await call('POST', `${p}/paymentMethods`, params) as any;
    const lines = data.paymentMethods.map((m: any) => `• ${m.type} — ${m.name}`);
    return text(`Payment methods (${data.paymentMethods.length}):\n${lines.join('\n')}`);
  });

  // ── 5. capture_payment
  server.tool('capture_payment', 'Capture an authorized payment', {
    psp_reference: z.string().describe('PSP reference of the original payment'),
    amount: amountSchema.describe('Amount to capture'),
    merchantAccount: z.string().optional().describe('Merchant account'),
  }, async ({ psp_reference, amount, merchantAccount }) => {
    const data = await call('POST', `${p}/payments/${psp_reference}/captures`, { amount, merchantAccount }) as any;
    return text(`Capture ${data.status} for ${data.paymentPspReference}`);
  });

  // ── 6. refund_payment
  server.tool('refund_payment', 'Refund a captured payment', {
    psp_reference: z.string().describe('PSP reference of the original payment'),
    amount: amountSchema.describe('Amount to refund'),
    merchantAccount: z.string().optional().describe('Merchant account'),
  }, async ({ psp_reference, amount, merchantAccount }) => {
    const data = await call('POST', `${p}/payments/${psp_reference}/refunds`, { amount, merchantAccount }) as any;
    return text(`Refund ${data.status} for ${data.paymentPspReference}`);
  });

  // ── 7. cancel_payment
  server.tool('cancel_payment', 'Cancel an authorized payment', {
    psp_reference: z.string().describe('PSP reference of the payment to cancel'),
    merchantAccount: z.string().optional().describe('Merchant account'),
  }, async ({ psp_reference, merchantAccount }) => {
    const data = await call('POST', `${p}/payments/${psp_reference}/cancels`, { merchantAccount }) as any;
    return text(`Cancel ${data.status} for ${data.paymentPspReference}`);
  });

  // ── 8. reverse_payment
  server.tool('reverse_payment', 'Reverse a payment (refund or cancel depending on state)', {
    psp_reference: z.string().describe('PSP reference'),
    merchantAccount: z.string().optional().describe('Merchant account'),
  }, async ({ psp_reference, merchantAccount }) => {
    const data = await call('POST', `${p}/payments/${psp_reference}/reversals`, { merchantAccount }) as any;
    return text(`Reversal ${data.status} for ${data.paymentPspReference}`);
  });

  // ── 9. update_payment_amount
  server.tool('update_payment_amount', 'Update the amount of an authorized payment', {
    psp_reference: z.string().describe('PSP reference'),
    amount: amountSchema.describe('New amount'),
    merchantAccount: z.string().optional().describe('Merchant account'),
  }, async ({ psp_reference, amount, merchantAccount }) => {
    const data = await call('POST', `${p}/payments/${psp_reference}/amountUpdates`, { amount, merchantAccount }) as any;
    return text(`Amount update ${data.status} for ${data.paymentPspReference}`);
  });

  // ── 10. create_stored_payment_method
  server.tool('create_stored_payment_method', 'Tokenize a payment method for recurring', {
    shopperReference: z.string().describe('Unique shopper reference'),
    merchantAccount: z.string().optional().describe('Merchant account'),
    paymentMethod: z.object({
      brand: z.string().optional().describe('Card brand'),
    }).optional().describe('Payment method to tokenize'),
  }, async (params) => {
    const data = await call('POST', `${p}/storedPaymentMethods`, params) as any;
    return text(`Tokenized: ${data.id} (${data.brand} ****${data.lastFour})`);
  });

  // ── 11. list_stored_payment_methods
  server.tool('list_stored_payment_methods', 'List stored payment methods for a shopper', {
    shopperReference: z.string().optional().describe('Shopper reference filter'),
    merchantAccount: z.string().optional().describe('Merchant account filter'),
  }, async ({ shopperReference, merchantAccount }) => {
    const data = await call('GET', `${p}/storedPaymentMethods${qs({ shopperReference, merchantAccount })}`) as any;
    const tokens = data.storedPaymentMethods || [];
    if (!tokens.length) return text('No stored payment methods found.');
    const lines = tokens.map((t: any) => `• ${t.id} — ${t.brand} ****${t.lastFour} (${t.expiryMonth}/${t.expiryYear})`);
    return text(`Stored methods (${tokens.length}):\n${lines.join('\n')}`);
  });

  // ── 12. delete_stored_payment_method
  server.tool('delete_stored_payment_method', 'Delete a stored payment method', {
    token_id: z.string().describe('Token ID to delete'),
  }, async ({ token_id }) => {
    await call('DELETE', `${p}/storedPaymentMethods/${token_id}`);
    return text(`Deleted stored payment method ${token_id}`);
  });

  // ── 13. create_payout
  server.tool('create_payout', 'Create an instant payout', {
    amount: amountSchema.describe('Payout amount'),
    merchantAccount: z.string().optional().describe('Merchant account'),
    reference: z.string().optional().describe('Payout reference'),
  }, async (params) => {
    const data = await call('POST', `${p}/payouts`, params) as any;
    return text(`Payout ${data.pspReference}: ${data.resultCode}`);
  });

  // ── 14. create_payment_link
  server.tool('create_payment_link', 'Create a payment link', {
    amount: amountSchema.describe('Payment link amount'),
    merchantAccount: z.string().optional().describe('Merchant account'),
    reference: z.string().optional().describe('Reference'),
    description: z.string().optional().describe('Description'),
  }, async (params) => {
    const data = await call('POST', `${p}/paymentLinks`, params) as any;
    return text(`Payment link ${data.id}: ${data.url} [${data.status}]`);
  });

  // ── 15. get_payment_link
  server.tool('get_payment_link', 'Get a payment link by ID', {
    link_id: z.string().describe('Payment link ID'),
  }, async ({ link_id }) => {
    const data = await call('GET', `${p}/paymentLinks/${link_id}`) as any;
    return text(`Payment link ${data.id}: ${data.url} [${data.status}]`);
  });

  // ── 16. expire_payment_link
  server.tool('expire_payment_link', 'Expire/update a payment link', {
    link_id: z.string().describe('Payment link ID'),
    status: z.enum(['active', 'expired']).optional().describe('New status'),
  }, async ({ link_id, status }) => {
    const data = await call('PATCH', `${p}/paymentLinks/${link_id}`, { status: status ?? 'expired' }) as any;
    return text(`Payment link ${data.id} updated [${data.status}]`);
  });

  // ── 17. create_order
  server.tool('create_order', 'Create an order for partial/gift card payments', {
    amount: amountSchema.describe('Order amount'),
    merchantAccount: z.string().optional().describe('Merchant account'),
    reference: z.string().optional().describe('Order reference'),
  }, async (params) => {
    const data = await call('POST', `${p}/orders`, params) as any;
    return text(`Order ${data.pspReference}: ${data.resultCode}`);
  });

  // ── 18. cancel_order
  server.tool('cancel_order', 'Cancel an order', {
    psp_reference: z.string().describe('Order PSP reference'),
    orderData: z.string().optional().describe('Order data token'),
    merchantAccount: z.string().optional().describe('Merchant account'),
  }, async ({ psp_reference, orderData, merchantAccount }) => {
    const data = await call('POST', `${p}/orders/cancel`, {
      order: { pspReference: psp_reference, orderData },
      merchantAccount,
    }) as any;
    return text(`Order cancel: ${data.pspReference} — ${data.resultCode}`);
  });

  // ── 19. make_donation
  server.tool('make_donation', 'Make a donation payment', {
    amount: amountSchema.describe('Donation amount'),
    donationAccount: z.string().optional().describe('Donation charity account'),
    merchantAccount: z.string().optional().describe('Merchant account'),
  }, async (params) => {
    const data = await call('POST', `${p}/donations`, params) as any;
    return text(`Donation ${data.pspReference}: ${data.status}`);
  });

  // ── 20. get_card_details
  server.tool('get_card_details', 'Get card brand/network info for a card number', {
    cardNumber: z.string().describe('Card number (or BIN)'),
    merchantAccount: z.string().optional().describe('Merchant account'),
  }, async (params) => {
    const data = await call('POST', `${p}/cardDetails`, params) as any;
    const brands = data.brands || [];
    const lines = brands.map((b: any) => `• ${b.type} (supported: ${b.supported}, cvc: ${b.cvcPolicy})`);
    return text(`Card brands:\n${lines.join('\n')}`);
  });

  // ── 21. search_adyen_documentation
  server.tool('search_adyen_documentation', 'Search Adyen documentation for API guidance', {
    query: z.string().describe('Documentation topic'),
  }, async ({ query }) => {
    return text(
      `Adyen documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real Adyen documentation, visit https://docs.adyen.com\n\n` +
      `Common topics:\n` +
      `• Payments: POST /v71/payments with amount { value, currency } + merchantAccount\n` +
      `• 3DS: Respond to action.type redirect/threeDS2 via /payments/details\n` +
      `• Capture: POST /v71/payments/:pspRef/captures\n` +
      `• Refund: POST /v71/payments/:pspRef/refunds\n` +
      `• Cancel: POST /v71/payments/:pspRef/cancels\n` +
      `• Sessions: POST /v71/sessions for Drop-in component\n` +
      `• Tokenization: POST /v71/storedPaymentMethods\n` +
      `• Payment Links: POST /v71/paymentLinks\n`,
    );
  });
}

/**
 * Create a standalone Mimic MCP server for Adyen.
 */
export function createAdyenMcpServer(
  baseUrl: string = 'http://localhost:4102',
): McpServer {
  const server = new McpServer({
    name: 'mimic-adyen',
    version: '0.7.0',
    description:
      'Mimic MCP server for Adyen — checkout, captures, refunds, tokenization against mock data',
  });
  registerAdyenTools(server, baseUrl);
  return server;
}

/**
 * Start the Adyen MCP server on stdio transport.
 */
export async function startAdyenMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4102';
  const server = createAdyenMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Adyen MCP server running on stdio');
}
