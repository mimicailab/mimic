import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import meta from './adapter-meta.js';

const BP = '/v1';

function makeCall(baseUrl: string) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zuora mock error ${res.status}: ${text}`);
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

function json(data: unknown) {
  return text(JSON.stringify(data, null, 2));
}

export function registerZuoraTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);

  // ── Accounts ────────────────────────────────────────────────────

  server.tool('create_account', 'Create a new Zuora account', {
    name: z.string().describe('Account name'),
    currency: z.string().optional().describe('Currency code'),
    billCycleDay: z.number().int().optional().describe('Bill cycle day (1-31)'),
    paymentTerm: z.string().optional().describe('Payment term'),
  }, async (params) => {
    const data = await call('POST', `${BP}/accounts`, params) as any;
    return text(`Created account ${data.id} (${data.accountNumber})`);
  });

  server.tool('get_account', 'Get a Zuora account by key', {
    account_key: z.string().describe('Account ID or key'),
  }, async ({ account_key }) => {
    const data = await call('GET', `${BP}/accounts/${account_key}`);
    return json(data);
  });

  server.tool('update_account', 'Update a Zuora account', {
    account_key: z.string().describe('Account ID or key'),
    name: z.string().optional().describe('Account name'),
    paymentTerm: z.string().optional().describe('Payment term'),
  }, async ({ account_key, ...rest }) => {
    await call('PUT', `${BP}/accounts/${account_key}`, rest);
    return text(`Updated account ${account_key}`);
  });

  server.tool('get_account_summary', 'Get account summary with subscriptions, invoices, payments', {
    account_key: z.string().describe('Account ID or key'),
  }, async ({ account_key }) => {
    const data = await call('GET', `${BP}/accounts/${account_key}/summary`);
    return json(data);
  });

  // ── Subscriptions ───────────────────────────────────────────────

  server.tool('create_subscription', 'Create a new Zuora subscription', {
    accountKey: z.string().optional().describe('Account key'),
    termType: z.enum(['TERMED', 'EVERGREEN']).optional().describe('Term type'),
    currentTerm: z.number().int().optional().describe('Current term length'),
  }, async (params) => {
    const data = await call('POST', `${BP}/subscriptions`, params) as any;
    return text(`Created subscription ${data.subscriptionId} (${data.subscriptionNumber})`);
  });

  server.tool('get_subscription', 'Get a Zuora subscription by key', {
    subscription_key: z.string().describe('Subscription ID or key'),
  }, async ({ subscription_key }) => {
    const data = await call('GET', `${BP}/subscriptions/${subscription_key}`);
    return json(data);
  });

  server.tool('update_subscription', 'Update a Zuora subscription', {
    subscription_key: z.string().describe('Subscription ID or key'),
    autoRenew: z.boolean().optional().describe('Auto-renew'),
  }, async ({ subscription_key, ...rest }) => {
    await call('PUT', `${BP}/subscriptions/${subscription_key}`, rest);
    return text(`Updated subscription ${subscription_key}`);
  });

  server.tool('cancel_subscription', 'Cancel a Zuora subscription', {
    subscription_key: z.string().describe('Subscription ID or key'),
  }, async ({ subscription_key }) => {
    await call('PUT', `${BP}/subscriptions/${subscription_key}/cancel`);
    return text(`Cancelled subscription ${subscription_key}`);
  });

  server.tool('renew_subscription', 'Renew a Zuora subscription', {
    subscription_key: z.string().describe('Subscription ID or key'),
  }, async ({ subscription_key }) => {
    await call('PUT', `${BP}/subscriptions/${subscription_key}/renew`);
    return text(`Renewed subscription ${subscription_key}`);
  });

  server.tool('suspend_subscription', 'Suspend a Zuora subscription', {
    subscription_key: z.string().describe('Subscription ID or key'),
  }, async ({ subscription_key }) => {
    await call('PUT', `${BP}/subscriptions/${subscription_key}/suspend`);
    return text(`Suspended subscription ${subscription_key}`);
  });

  server.tool('resume_subscription', 'Resume a suspended Zuora subscription', {
    subscription_key: z.string().describe('Subscription ID or key'),
  }, async ({ subscription_key }) => {
    await call('PUT', `${BP}/subscriptions/${subscription_key}/resume`);
    return text(`Resumed subscription ${subscription_key}`);
  });

  server.tool('list_subscriptions', 'List subscriptions by account', {
    account_key: z.string().describe('Account ID or key'),
  }, async ({ account_key }) => {
    const data = await call('GET', `${BP}/subscriptions/accounts/${account_key}`) as any;
    if (!data.data?.length) return text('No subscriptions found.');
    const lines = data.data.map((s: any) => `• ${s.id} — ${s.subscriptionNumber} [${s.status}]`);
    return text(`Subscriptions (${data.data.length}):\n${lines.join('\n')}`);
  });

  // ── Orders ──────────────────────────────────────────────────────

  server.tool('create_order', 'Create a new Zuora order', {
    orderDate: z.string().optional().describe('Order date (YYYY-MM-DD)'),
    description: z.string().optional().describe('Order description'),
  }, async (params) => {
    const data = await call('POST', `${BP}/orders`, params) as any;
    return text(`Created order ${data.orderNumber}`);
  });

  server.tool('list_orders', 'List Zuora orders', {}, async () => {
    const data = await call('GET', `${BP}/orders`) as any;
    if (!data.data?.length) return text('No orders found.');
    const lines = data.data.map((o: any) => `• ${o.orderNumber} [${o.status}]`);
    return text(`Orders (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_order', 'Get a Zuora order by number', {
    order_number: z.string().describe('Order number'),
  }, async ({ order_number }) => {
    const data = await call('GET', `${BP}/orders/${order_number}`);
    return json(data);
  });

  server.tool('delete_order', 'Delete a Zuora order', {
    order_number: z.string().describe('Order number'),
  }, async ({ order_number }) => {
    await call('DELETE', `${BP}/orders/${order_number}`);
    return text(`Deleted order ${order_number}`);
  });

  // ── Products ────────────────────────────────────────────────────

  server.tool('list_products', 'List Zuora catalog products', {}, async () => {
    const data = await call('GET', `${BP}/catalog/products`) as any;
    if (!data.data?.length) return text('No products found.');
    const lines = data.data.map((p: any) => `• ${p.Id ?? p.id} — ${p.Name ?? p.name}`);
    return text(`Products (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('create_product', 'Create a Zuora product', {
    Name: z.string().describe('Product name'),
    SKU: z.string().optional().describe('Product SKU'),
  }, async (params) => {
    const data = await call('POST', `${BP}/object/product`, params) as any;
    return text(`Created product ${data.Id}`);
  });

  // ── Invoices ────────────────────────────────────────────────────

  server.tool('create_invoice', 'Create a Zuora invoice', {
    accountId: z.string().describe('Account ID'),
    amount: z.number().optional().describe('Invoice amount'),
  }, async (params) => {
    const data = await call('POST', `${BP}/invoices`, params) as any;
    return text(`Created invoice ${data.id} (${data.invoiceNumber})`);
  });

  server.tool('list_invoices', 'List Zuora invoices', {}, async () => {
    const data = await call('GET', `${BP}/invoices`) as any;
    if (!data.data?.length) return text('No invoices found.');
    const lines = data.data.map((i: any) => `• ${i.id} — ${i.invoiceNumber} ${i.amount} [${i.status}]`);
    return text(`Invoices (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('invoice_collect', 'Generate invoice and collect payment atomically', {
    accountId: z.string().describe('Account ID'),
    invoiceAmount: z.number().optional().describe('Invoice amount'),
  }, async (params) => {
    const data = await call('POST', `${BP}/operations/invoice-collect`, params) as any;
    return text(`Invoice ${data.invoiceId} created and payment ${data.paymentId} collected`);
  });

  // ── Payments ────────────────────────────────────────────────────

  server.tool('create_payment', 'Create a Zuora payment', {
    accountId: z.string().describe('Account ID'),
    amount: z.number().describe('Payment amount'),
  }, async (params) => {
    const data = await call('POST', `${BP}/payments`, params) as any;
    return text(`Created payment ${data.id} (${data.paymentNumber})`);
  });

  server.tool('list_payments', 'List Zuora payments', {}, async () => {
    const data = await call('GET', `${BP}/payments`) as any;
    if (!data.data?.length) return text('No payments found.');
    const lines = data.data.map((p: any) => `• ${p.id} — ${p.paymentNumber} ${p.amount} [${p.status}]`);
    return text(`Payments (${data.data.length}):\n${lines.join('\n')}`);
  });

  // ── Credit Memos ────────────────────────────────────────────────

  server.tool('create_credit_memo', 'Create a Zuora credit memo', {
    accountId: z.string().describe('Account ID'),
    amount: z.number().optional().describe('Credit amount'),
    reasonCode: z.string().optional().describe('Reason code'),
  }, async (params) => {
    const data = await call('POST', `${BP}/creditmemos`, params) as any;
    return text(`Created credit memo ${data.id} (${data.memoNumber})`);
  });

  server.tool('apply_credit_memo', 'Apply a credit memo to invoices', {
    credit_memo_id: z.string().describe('Credit memo ID'),
  }, async ({ credit_memo_id }) => {
    await call('PUT', `${BP}/creditmemos/${credit_memo_id}/apply`);
    return text(`Applied credit memo ${credit_memo_id}`);
  });

  // ── Debit Memos ─────────────────────────────────────────────────

  server.tool('create_debit_memo', 'Create a Zuora debit memo', {
    accountId: z.string().describe('Account ID'),
    amount: z.number().optional().describe('Debit amount'),
    reasonCode: z.string().optional().describe('Reason code'),
  }, async (params) => {
    const data = await call('POST', `${BP}/debitmemos`, params) as any;
    return text(`Created debit memo ${data.id} (${data.memoNumber})`);
  });

  // ── Usage ───────────────────────────────────────────────────────

  server.tool('create_usage', 'Create a Zuora usage record', {
    accountId: z.string().describe('Account ID'),
    quantity: z.number().describe('Usage quantity'),
    unitOfMeasure: z.string().optional().describe('Unit of measure'),
  }, async (params) => {
    const data = await call('POST', `${BP}/usage`, params) as any;
    return text(`Created usage record ${data.id}`);
  });

  // ── Contacts ────────────────────────────────────────────────────

  server.tool('create_contact', 'Create a Zuora contact', {
    FirstName: z.string().describe('First name'),
    LastName: z.string().describe('Last name'),
    WorkEmail: z.string().optional().describe('Work email'),
    Country: z.string().optional().describe('Country'),
  }, async (params) => {
    const data = await call('POST', `${BP}/object/contact`, params) as any;
    return text(`Created contact ${data.Id}`);
  });
}

export function createZuoraMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
  });
  registerZuoraTools(server, baseUrl);
  return server;
}

export async function startZuoraMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createZuoraMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
