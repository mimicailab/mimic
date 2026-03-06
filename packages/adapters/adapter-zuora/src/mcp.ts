import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BP = '/zuora/v1';

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

// ---------------------------------------------------------------------------
// Factory — Zuora MCP tools (Tier 3: Mimic-built)
// ---------------------------------------------------------------------------

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
    contractEffectiveDate: z.string().optional().describe('Contract effective date (YYYY-MM-DD)'),
    currentTerm: z.number().int().optional().describe('Current term length'),
    currentTermPeriodType: z.enum(['Month', 'Year', 'Day', 'Week']).optional().describe('Term period type'),
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
    renewalTerm: z.number().int().optional().describe('Renewal term length'),
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
    status: z.string().optional().describe('Filter by status'),
  }, async ({ account_key, status }) => {
    const data = await call('GET', `${BP}/subscriptions/accounts/${account_key}${qs({ status })}`) as any;
    if (!data.data?.length) return text('No subscriptions found.');
    const lines = data.data.map((s: any) => `• ${s.id} — ${s.subscriptionNumber} [${s.status}]`);
    return text(`Subscriptions (${data.data.length}):\n${lines.join('\n')}`);
  });

  // ── Orders ──────────────────────────────────────────────────────

  server.tool('create_order', 'Create a new Zuora order', {
    existingAccountNumber: z.string().optional().describe('Existing account number'),
    orderDate: z.string().optional().describe('Order date (YYYY-MM-DD)'),
    description: z.string().optional().describe('Order description'),
  }, async (params) => {
    const data = await call('POST', `${BP}/orders`, params) as any;
    return text(`Created order ${data.orderNumber}`);
  });

  server.tool('list_orders', 'List Zuora orders', {
    accountId: z.string().optional().describe('Filter by account ID'),
  }, async ({ accountId }) => {
    const data = await call('GET', `${BP}/orders${qs({ accountId })}`) as any;
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

  server.tool('list_orders_by_subscription', 'List orders by subscription number', {
    subscription_number: z.string().describe('Subscription number'),
  }, async ({ subscription_number }) => {
    const data = await call('GET', `${BP}/orders/subscription/${subscription_number}`) as any;
    if (!data.data?.length) return text('No orders found.');
    const lines = data.data.map((o: any) => `• ${o.orderNumber}`);
    return text(`Orders (${data.data.length}):\n${lines.join('\n')}`);
  });

  // ── Products ────────────────────────────────────────────────────

  server.tool('list_products', 'List Zuora catalog products', {}, async () => {
    const data = await call('GET', `${BP}/catalog/products`) as any;
    if (!data.data?.length) return text('No products found.');
    const lines = data.data.map((p: any) => `• ${p.Id ?? p.id} — ${p.Name ?? p.name}`);
    return text(`Products (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_product', 'Get a Zuora product by ID', {
    product_id: z.string().describe('Product ID'),
  }, async ({ product_id }) => {
    const data = await call('GET', `${BP}/catalog/product/${product_id}`);
    return json(data);
  });

  server.tool('create_product', 'Create a Zuora product', {
    Name: z.string().describe('Product name'),
    SKU: z.string().optional().describe('Product SKU'),
    Description: z.string().optional().describe('Description'),
    EffectiveStartDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    EffectiveEndDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
  }, async (params) => {
    const data = await call('POST', `${BP}/object/product`, params) as any;
    return text(`Created product ${data.Id}`);
  });

  server.tool('update_product', 'Update a Zuora product', {
    product_id: z.string().describe('Product ID'),
    Name: z.string().optional().describe('Product name'),
    Description: z.string().optional().describe('Description'),
  }, async ({ product_id, ...rest }) => {
    await call('PUT', `${BP}/object/product/${product_id}`, rest);
    return text(`Updated product ${product_id}`);
  });

  // ── Product Rate Plans ──────────────────────────────────────────

  server.tool('list_product_rate_plans', 'List rate plans for a product', {
    product_id: z.string().describe('Product ID'),
  }, async ({ product_id }) => {
    const data = await call('GET', `${BP}/rateplan/${product_id}/productRatePlans`) as any;
    if (!data.data?.length) return text('No rate plans found.');
    const lines = data.data.map((p: any) => `• ${p.Id} — ${p.Name}`);
    return text(`Rate plans (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('create_product_rate_plan', 'Create a product rate plan', {
    ProductId: z.string().describe('Product ID'),
    Name: z.string().describe('Rate plan name'),
    Description: z.string().optional().describe('Description'),
  }, async (params) => {
    const data = await call('POST', `${BP}/object/product-rate-plan`, params) as any;
    return text(`Created rate plan ${data.Id}`);
  });

  server.tool('get_product_rate_plan', 'Get a product rate plan by ID', {
    rate_plan_id: z.string().describe('Rate plan ID'),
  }, async ({ rate_plan_id }) => {
    const data = await call('GET', `${BP}/object/product-rate-plan/${rate_plan_id}`);
    return json(data);
  });

  server.tool('update_product_rate_plan', 'Update a product rate plan', {
    rate_plan_id: z.string().describe('Rate plan ID'),
    Name: z.string().optional().describe('Rate plan name'),
    Description: z.string().optional().describe('Description'),
  }, async ({ rate_plan_id, ...rest }) => {
    await call('PUT', `${BP}/object/product-rate-plan/${rate_plan_id}`, rest);
    return text(`Updated rate plan ${rate_plan_id}`);
  });

  // ── Invoices ────────────────────────────────────────────────────

  server.tool('create_invoice', 'Create a Zuora invoice', {
    accountId: z.string().describe('Account ID'),
    amount: z.number().optional().describe('Invoice amount'),
    invoiceDate: z.string().optional().describe('Invoice date (YYYY-MM-DD)'),
    dueDate: z.string().optional().describe('Due date (YYYY-MM-DD)'),
  }, async (params) => {
    const data = await call('POST', `${BP}/invoices`, params) as any;
    return text(`Created invoice ${data.id} (${data.invoiceNumber})`);
  });

  server.tool('list_invoices', 'List Zuora invoices', {
    accountId: z.string().optional().describe('Filter by account'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ accountId, status }) => {
    const data = await call('GET', `${BP}/invoices${qs({ accountId, status })}`) as any;
    if (!data.data?.length) return text('No invoices found.');
    const lines = data.data.map((i: any) => `• ${i.id} — ${i.invoiceNumber} ${i.amount} ${i.currency} [${i.status}]`);
    return text(`Invoices (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_invoice', 'Get a Zuora invoice by ID', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('GET', `${BP}/invoices/${invoice_id}`);
    return json(data);
  });

  server.tool('update_invoice', 'Update a Zuora invoice', {
    invoice_id: z.string().describe('Invoice ID'),
    status: z.string().optional().describe('Invoice status'),
  }, async ({ invoice_id, ...rest }) => {
    await call('PUT', `${BP}/invoices/${invoice_id}`, rest);
    return text(`Updated invoice ${invoice_id}`);
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
    currency: z.string().optional().describe('Currency code'),
    type: z.enum(['Electronic', 'External']).optional().describe('Payment type'),
    effectiveDate: z.string().optional().describe('Effective date (YYYY-MM-DD)'),
  }, async (params) => {
    const data = await call('POST', `${BP}/payments`, params) as any;
    return text(`Created payment ${data.id} (${data.paymentNumber})`);
  });

  server.tool('list_payments', 'List Zuora payments', {
    accountId: z.string().optional().describe('Filter by account'),
  }, async ({ accountId }) => {
    const data = await call('GET', `${BP}/payments${qs({ accountId })}`) as any;
    if (!data.data?.length) return text('No payments found.');
    const lines = data.data.map((p: any) => `• ${p.id} — ${p.paymentNumber} ${p.amount} [${p.status}]`);
    return text(`Payments (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_payment', 'Get a Zuora payment by ID', {
    payment_id: z.string().describe('Payment ID'),
  }, async ({ payment_id }) => {
    const data = await call('GET', `${BP}/payments/${payment_id}`);
    return json(data);
  });

  server.tool('update_payment', 'Update a Zuora payment', {
    payment_id: z.string().describe('Payment ID'),
    comment: z.string().optional().describe('Comment'),
  }, async ({ payment_id, ...rest }) => {
    await call('PUT', `${BP}/payments/${payment_id}`, rest);
    return text(`Updated payment ${payment_id}`);
  });

  // ── Payment Methods ─────────────────────────────────────────────

  server.tool('create_payment_method', 'Create a Zuora payment method', {
    accountId: z.string().describe('Account ID'),
    type: z.enum(['CreditCard', 'ACH', 'PayPal']).optional().describe('Payment method type'),
    isDefault: z.boolean().optional().describe('Set as default'),
  }, async (params) => {
    const data = await call('POST', `${BP}/payment-methods`, params) as any;
    return text(`Created payment method ${data.id}`);
  });

  server.tool('list_payment_methods', 'List Zuora payment methods', {
    accountId: z.string().optional().describe('Filter by account'),
  }, async ({ accountId }) => {
    const data = await call('GET', `${BP}/payment-methods${qs({ accountId })}`) as any;
    if (!data.data?.length) return text('No payment methods found.');
    const lines = data.data.map((m: any) => `• ${m.id} — ${m.type} [${m.status}]`);
    return text(`Payment methods (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_payment_method', 'Get a Zuora payment method by ID', {
    payment_method_id: z.string().describe('Payment method ID'),
  }, async ({ payment_method_id }) => {
    const data = await call('GET', `${BP}/payment-methods/${payment_method_id}`);
    return json(data);
  });

  server.tool('update_payment_method', 'Update a Zuora payment method', {
    payment_method_id: z.string().describe('Payment method ID'),
    isDefault: z.boolean().optional().describe('Set as default'),
  }, async ({ payment_method_id, ...rest }) => {
    await call('PUT', `${BP}/payment-methods/${payment_method_id}`, rest);
    return text(`Updated payment method ${payment_method_id}`);
  });

  server.tool('delete_payment_method', 'Delete a Zuora payment method', {
    payment_method_id: z.string().describe('Payment method ID'),
  }, async ({ payment_method_id }) => {
    await call('DELETE', `${BP}/payment-methods/${payment_method_id}`);
    return text(`Deleted payment method ${payment_method_id}`);
  });

  // ── Credit Memos ────────────────────────────────────────────────

  server.tool('create_credit_memo', 'Create a Zuora credit memo', {
    accountId: z.string().describe('Account ID'),
    amount: z.number().optional().describe('Credit amount'),
    currency: z.string().optional().describe('Currency'),
    reasonCode: z.string().optional().describe('Reason code'),
    comment: z.string().optional().describe('Comment'),
  }, async (params) => {
    const data = await call('POST', `${BP}/creditmemos`, params) as any;
    return text(`Created credit memo ${data.id} (${data.memoNumber})`);
  });

  server.tool('list_credit_memos', 'List Zuora credit memos', {
    accountId: z.string().optional().describe('Filter by account'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ accountId, status }) => {
    const data = await call('GET', `${BP}/creditmemos${qs({ accountId, status })}`) as any;
    if (!data.data?.length) return text('No credit memos found.');
    const lines = data.data.map((m: any) => `• ${m.id} — ${m.memoNumber} ${m.amount} [${m.status}]`);
    return text(`Credit memos (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_credit_memo', 'Get a Zuora credit memo by ID', {
    credit_memo_id: z.string().describe('Credit memo ID'),
  }, async ({ credit_memo_id }) => {
    const data = await call('GET', `${BP}/creditmemos/${credit_memo_id}`);
    return json(data);
  });

  server.tool('update_credit_memo', 'Update a Zuora credit memo', {
    credit_memo_id: z.string().describe('Credit memo ID'),
    comment: z.string().optional().describe('Comment'),
    reasonCode: z.string().optional().describe('Reason code'),
  }, async ({ credit_memo_id, ...rest }) => {
    await call('PUT', `${BP}/creditmemos/${credit_memo_id}`, rest);
    return text(`Updated credit memo ${credit_memo_id}`);
  });

  server.tool('apply_credit_memo', 'Apply a credit memo to invoices', {
    credit_memo_id: z.string().describe('Credit memo ID'),
  }, async ({ credit_memo_id }) => {
    await call('PUT', `${BP}/creditmemos/${credit_memo_id}/apply`);
    return text(`Applied credit memo ${credit_memo_id}`);
  });

  server.tool('create_credit_memo_from_invoice', 'Create a credit memo from an invoice', {
    invoice_id: z.string().describe('Invoice ID'),
    amount: z.number().optional().describe('Credit amount'),
    reasonCode: z.string().optional().describe('Reason code'),
    comment: z.string().optional().describe('Comment'),
  }, async ({ invoice_id, ...rest }) => {
    const data = await call('POST', `${BP}/creditmemos/invoice/${invoice_id}`, rest) as any;
    return text(`Created credit memo ${data.id} (${data.memoNumber}) from invoice ${invoice_id}`);
  });

  // ── Debit Memos ─────────────────────────────────────────────────

  server.tool('create_debit_memo', 'Create a Zuora debit memo', {
    accountId: z.string().describe('Account ID'),
    amount: z.number().optional().describe('Debit amount'),
    currency: z.string().optional().describe('Currency'),
    reasonCode: z.string().optional().describe('Reason code'),
    comment: z.string().optional().describe('Comment'),
  }, async (params) => {
    const data = await call('POST', `${BP}/debitmemos`, params) as any;
    return text(`Created debit memo ${data.id} (${data.memoNumber})`);
  });

  server.tool('list_debit_memos', 'List Zuora debit memos', {
    accountId: z.string().optional().describe('Filter by account'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ accountId, status }) => {
    const data = await call('GET', `${BP}/debitmemos${qs({ accountId, status })}`) as any;
    if (!data.data?.length) return text('No debit memos found.');
    const lines = data.data.map((m: any) => `• ${m.id} — ${m.memoNumber} ${m.amount} [${m.status}]`);
    return text(`Debit memos (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_debit_memo', 'Get a Zuora debit memo by ID', {
    debit_memo_id: z.string().describe('Debit memo ID'),
  }, async ({ debit_memo_id }) => {
    const data = await call('GET', `${BP}/debitmemos/${debit_memo_id}`);
    return json(data);
  });

  server.tool('update_debit_memo', 'Update a Zuora debit memo', {
    debit_memo_id: z.string().describe('Debit memo ID'),
    comment: z.string().optional().describe('Comment'),
    reasonCode: z.string().optional().describe('Reason code'),
  }, async ({ debit_memo_id, ...rest }) => {
    await call('PUT', `${BP}/debitmemos/${debit_memo_id}`, rest);
    return text(`Updated debit memo ${debit_memo_id}`);
  });

  // ── Usage ───────────────────────────────────────────────────────

  server.tool('create_usage', 'Create a Zuora usage record', {
    accountId: z.string().describe('Account ID'),
    subscriptionId: z.string().optional().describe('Subscription ID'),
    quantity: z.number().describe('Usage quantity'),
    unitOfMeasure: z.string().optional().describe('Unit of measure'),
    startDateTime: z.string().optional().describe('Start date/time (ISO 8601)'),
    description: z.string().optional().describe('Description'),
  }, async (params) => {
    const data = await call('POST', `${BP}/usage`, params) as any;
    return text(`Created usage record ${data.id}`);
  });

  server.tool('list_usage', 'List usage records by account', {
    account_key: z.string().describe('Account ID or key'),
  }, async ({ account_key }) => {
    const data = await call('GET', `${BP}/usage/accounts/${account_key}`) as any;
    if (!data.data?.length) return text('No usage records found.');
    const lines = data.data.map((u: any) => `• ${u.id} — qty: ${u.quantity} ${u.unitOfMeasure ?? ''}`);
    return text(`Usage records (${data.data.length}):\n${lines.join('\n')}`);
  });

  // ── Contacts ────────────────────────────────────────────────────

  server.tool('create_contact', 'Create a Zuora contact', {
    AccountId: z.string().optional().describe('Account ID'),
    FirstName: z.string().describe('First name'),
    LastName: z.string().describe('Last name'),
    WorkEmail: z.string().optional().describe('Work email'),
    Country: z.string().optional().describe('Country'),
  }, async (params) => {
    const data = await call('POST', `${BP}/object/contact`, params) as any;
    return text(`Created contact ${data.Id}`);
  });

  server.tool('get_contact', 'Get a Zuora contact by ID', {
    contact_id: z.string().describe('Contact ID'),
  }, async ({ contact_id }) => {
    const data = await call('GET', `${BP}/object/contact/${contact_id}`);
    return json(data);
  });

  server.tool('update_contact', 'Update a Zuora contact', {
    contact_id: z.string().describe('Contact ID'),
    FirstName: z.string().optional().describe('First name'),
    LastName: z.string().optional().describe('Last name'),
    WorkEmail: z.string().optional().describe('Work email'),
  }, async ({ contact_id, ...rest }) => {
    await call('PUT', `${BP}/object/contact/${contact_id}`, rest);
    return text(`Updated contact ${contact_id}`);
  });
}

/**
 * Create a standalone Mimic MCP server for Zuora.
 */
export function createZuoraMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: 'mimic-zuora',
    version: '0.5.0',
    description: 'Mimic MCP server for Zuora — enterprise subscription management, orders, billing, invoicing',
  });
  registerZuoraTools(server, baseUrl);
  return server;
}

/**
 * Start the Zuora MCP server on stdio transport.
 */
export async function startZuoraMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createZuoraMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Zuora MCP server running on stdio');
}
