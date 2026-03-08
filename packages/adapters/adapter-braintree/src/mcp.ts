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
      throw new Error(`Braintree mock error ${res.status}: ${text}`);
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

export function registerBraintreeTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4104',
): void {
  const call = makeCall(baseUrl);
  const mp = '/braintree/merchants/test_merchant';

  // ── 1. generate_client_token
  server.tool('generate_client_token', 'Generate a Braintree client token', {}, async () => {
    const data = await call('POST', `${mp}/client_token`) as any;
    return text(`Client token generated (${data.clientToken?.slice(0, 40)}...)`);
  });

  // ── 2. create_transaction
  server.tool('create_transaction', 'Create a Braintree transaction', {
    amount: z.string().describe('Transaction amount (e.g. "100.00")'),
    type: z.enum(['sale', 'credit']).optional().describe('Transaction type'),
    orderId: z.string().optional().describe('Order ID'),
    customerId: z.string().optional().describe('Customer ID'),
    submitForSettlement: z.boolean().optional().describe('Submit for settlement immediately'),
  }, async ({ amount, type, orderId, customerId, submitForSettlement }) => {
    const body: any = { amount, type: type || 'sale' };
    if (orderId) body.orderId = orderId;
    if (customerId) body.customerId = customerId;
    if (submitForSettlement) body.options = { submitForSettlement: true };
    const data = await call('POST', `${mp}/transactions`, body) as any;
    const txn = data.transaction;
    return text(`Transaction ${txn.id} created [${txn.status}] — ${txn.amount} (${txn.processorResponseText})`);
  });

  // ── 3. get_transaction
  server.tool('get_transaction', 'Get a Braintree transaction by ID', {
    transaction_id: z.string().describe('Transaction ID'),
  }, async ({ transaction_id }) => {
    const data = await call('GET', `${mp}/transactions/${transaction_id}`) as any;
    const txn = data.transaction;
    return text(`Transaction ${txn.id}: ${txn.amount} [${txn.status}] — ${txn.processorResponseText}`);
  });

  // ── 4. submit_for_settlement
  server.tool('submit_for_settlement', 'Submit a transaction for settlement', {
    transaction_id: z.string().describe('Transaction ID'),
  }, async ({ transaction_id }) => {
    const data = await call('PUT', `${mp}/transactions/${transaction_id}/submit_for_settlement`) as any;
    return text(`Transaction ${data.transaction.id} submitted for settlement [${data.transaction.status}]`);
  });

  // ── 5. void_transaction
  server.tool('void_transaction', 'Void a Braintree transaction', {
    transaction_id: z.string().describe('Transaction ID'),
  }, async ({ transaction_id }) => {
    const data = await call('PUT', `${mp}/transactions/${transaction_id}/void`) as any;
    return text(`Transaction ${data.transaction.id} voided [${data.transaction.status}]`);
  });

  // ── 6. refund_transaction
  server.tool('refund_transaction', 'Refund a Braintree transaction', {
    transaction_id: z.string().describe('Transaction ID'),
    amount: z.string().optional().describe('Refund amount (omit for full refund)'),
  }, async ({ transaction_id, amount }) => {
    const body: any = {};
    if (amount) body.amount = amount;
    const data = await call('POST', `${mp}/transactions/${transaction_id}/refund`, body) as any;
    const txn = data.transaction;
    return text(`Refund ${txn.id} created [${txn.status}] — ${txn.amount}`);
  });

  // ── 7. create_customer
  server.tool('create_customer', 'Create a Braintree customer', {
    firstName: z.string().optional().describe('First name'),
    lastName: z.string().optional().describe('Last name'),
    email: z.string().optional().describe('Email address'),
    phone: z.string().optional().describe('Phone number'),
  }, async ({ firstName, lastName, email, phone }) => {
    const data = await call('POST', `${mp}/customers`, { firstName, lastName, email, phone }) as any;
    const cust = data.customer;
    return text(`Customer ${cust.id} created — ${cust.firstName} ${cust.lastName} <${cust.email}>`);
  });

  // ── 8. get_customer
  server.tool('get_customer', 'Get a Braintree customer by ID', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `${mp}/customers/${customer_id}`) as any;
    const cust = data.customer;
    return text(`Customer ${cust.id}: ${cust.firstName} ${cust.lastName} <${cust.email}>`);
  });

  // ── 9. create_payment_method
  server.tool('create_payment_method', 'Create a payment method (vault)', {
    customerId: z.string().describe('Customer ID'),
    token: z.string().optional().describe('Payment method token'),
  }, async ({ customerId, token }) => {
    const body: any = { customerId };
    if (token) body.token = token;
    const data = await call('POST', `${mp}/payment_methods`, body) as any;
    const pm = data.paymentMethod;
    return text(`Payment method ${pm.token} created — ${pm.cardType} ending ${pm.last4}`);
  });

  // ── 10. create_subscription
  server.tool('create_subscription', 'Create a Braintree subscription', {
    planId: z.string().describe('Plan ID'),
    paymentMethodToken: z.string().describe('Payment method token'),
    price: z.string().optional().describe('Subscription price'),
  }, async ({ planId, paymentMethodToken, price }) => {
    const body: any = { planId, paymentMethodToken };
    if (price) body.price = price;
    const data = await call('POST', `${mp}/subscriptions`, body) as any;
    const sub = data.subscription;
    return text(`Subscription ${sub.id} created [${sub.status}] — plan ${sub.planId}, price ${sub.price}`);
  });

  // ── 11. cancel_subscription
  server.tool('cancel_subscription', 'Cancel a Braintree subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('PUT', `${mp}/subscriptions/${subscription_id}/cancel`) as any;
    return text(`Subscription ${data.subscription.id} canceled [${data.subscription.status}]`);
  });

  // ── 12. search_disputes
  server.tool('search_disputes', 'Search Braintree disputes', {}, async () => {
    const data = await call('POST', `${mp}/disputes/search`) as any;
    const disputes = data.disputes || [];
    if (!disputes.length) return text('No disputes found.');
    const lines = disputes.map((d: any) =>
      `- ${d.id} — ${d.amount} ${d.currencyIsoCode} [${d.status}] ${d.reason}`,
    );
    return text(`Disputes (${disputes.length}):\n${lines.join('\n')}`);
  });

  // ── 13. accept_dispute
  server.tool('accept_dispute', 'Accept a Braintree dispute', {
    dispute_id: z.string().describe('Dispute ID'),
  }, async ({ dispute_id }) => {
    const data = await call('PUT', `${mp}/disputes/${dispute_id}/accept`) as any;
    return text(`Dispute ${data.dispute.id} accepted [${data.dispute.status}]`);
  });

  // ── 14. search_braintree_documentation
  server.tool('search_braintree_documentation', 'Search Braintree documentation', {
    query: z.string().describe('Topic to search'),
  }, async ({ query }) => {
    return text(
      `Braintree documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real docs, visit https://developer.paypal.com/braintree/docs\n\n` +
      `Transaction Flow: Create → Authorize → Submit for Settlement → Settled\n\n` +
      `API Resources:\n` +
      `- Transactions: POST .../transactions (sale/authorize)\n` +
      `- Customers: POST .../customers\n` +
      `- Payment Methods: POST .../payment_methods (vault)\n` +
      `- Subscriptions: POST .../subscriptions\n` +
      `- Plans: GET .../plans\n` +
      `- Disputes: POST .../disputes/search\n`,
    );
  });
}

/**
 * Create a standalone Mimic MCP server for Braintree.
 */
export function createBraintreeMcpServer(
  baseUrl: string = 'http://localhost:4104',
): McpServer {
  const server = new McpServer({
    name: 'mimic-braintree',
    version: '0.7.0',
    description:
      'Mimic MCP server for Braintree — transactions, customers, payment methods, subscriptions, disputes against mock data',
  });
  registerBraintreeTools(server, baseUrl);
  return server;
}

/**
 * Start the Braintree MCP server on stdio transport.
 */
export async function startBraintreeMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4104';
  const server = createBraintreeMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Braintree MCP server running on stdio');
}
