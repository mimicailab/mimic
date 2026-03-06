import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BP = '/recurly/v2021-02-25';

function makeCall(baseUrl: string) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Recurly mock error ${res.status}: ${text}`);
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
// Factory — Recurly MCP tools (Tier 3: Mimic-built)
// ---------------------------------------------------------------------------

export function registerRecurlyTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);

  // ── Accounts ────────────────────────────────────────────────────

  server.tool('create_account', 'Create a new Recurly account', {
    code: z.string().optional().describe('Account code (user-defined identifier)'),
    email: z.string().optional().describe('Email address'),
    first_name: z.string().optional().describe('First name'),
    last_name: z.string().optional().describe('Last name'),
    company: z.string().optional().describe('Company name'),
  }, async (params) => {
    const data = await call('POST', `${BP}/accounts`, params) as any;
    return text(`Created account ${data.id} (code: ${data.code})`);
  });

  server.tool('get_account', 'Get a Recurly account by ID', {
    account_id: z.string().describe('Account ID'),
  }, async ({ account_id }) => {
    const data = await call('GET', `${BP}/accounts/${account_id}`);
    return json(data);
  });

  server.tool('list_accounts', 'List Recurly accounts', {
    email: z.string().optional().describe('Filter by email'),
    state: z.string().optional().describe('Filter by state'),
  }, async ({ email, state }) => {
    const data = await call('GET', `${BP}/accounts${qs({ email, state })}`) as any;
    if (!data.data?.length) return text('No accounts found.');
    const lines = data.data.map((a: any) => `• ${a.id} — ${a.first_name ?? ''} ${a.last_name ?? ''} (${a.email ?? 'no email'}) [${a.state}]`);
    return text(`Accounts (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('update_account', 'Update a Recurly account', {
    account_id: z.string().describe('Account ID'),
    first_name: z.string().optional().describe('First name'),
    last_name: z.string().optional().describe('Last name'),
    email: z.string().optional().describe('Email'),
    company: z.string().optional().describe('Company'),
  }, async ({ account_id, ...rest }) => {
    const data = await call('PUT', `${BP}/accounts/${account_id}`, rest) as any;
    return text(`Updated account ${data.id}`);
  });

  server.tool('deactivate_account', 'Deactivate a Recurly account', {
    account_id: z.string().describe('Account ID'),
  }, async ({ account_id }) => {
    const data = await call('DELETE', `${BP}/accounts/${account_id}`) as any;
    return text(`Deactivated account ${data.id} [${data.state}]`);
  });

  // ── Subscriptions ───────────────────────────────────────────────

  server.tool('create_subscription', 'Create a new Recurly subscription', {
    plan_code: z.string().optional().describe('Plan code'),
    account_id: z.string().optional().describe('Account ID'),
    currency: z.string().optional().describe('Currency code'),
    unit_amount: z.number().optional().describe('Unit amount (decimal)'),
    quantity: z.number().int().optional().describe('Quantity'),
  }, async (params) => {
    const data = await call('POST', `${BP}/subscriptions`, params) as any;
    return text(`Created subscription ${data.id} [${data.state}]`);
  });

  server.tool('get_subscription', 'Get a Recurly subscription by ID', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('GET', `${BP}/subscriptions/${subscription_id}`);
    return json(data);
  });

  server.tool('list_subscriptions', 'List Recurly subscriptions', {
    state: z.string().optional().describe('Filter by state'),
    account_id: z.string().optional().describe('Filter by account'),
  }, async ({ state, account_id }) => {
    const data = await call('GET', `${BP}/subscriptions${qs({ state, account_id })}`) as any;
    if (!data.data?.length) return text('No subscriptions found.');
    const lines = data.data.map((s: any) => `• ${s.id} — ${s.plan_code ?? 'unknown'} [${s.state}]`);
    return text(`Subscriptions (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('update_subscription', 'Update a Recurly subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    plan_code: z.string().optional().describe('New plan code'),
    unit_amount: z.number().optional().describe('New unit amount'),
    quantity: z.number().int().optional().describe('New quantity'),
  }, async ({ subscription_id, ...rest }) => {
    const data = await call('PUT', `${BP}/subscriptions/${subscription_id}`, rest) as any;
    return text(`Updated subscription ${data.id}`);
  });

  server.tool('cancel_subscription', 'Cancel a Recurly subscription (end of term)', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('PUT', `${BP}/subscriptions/${subscription_id}/cancel`) as any;
    return text(`Cancelled subscription ${data.id} [${data.state}]`);
  });

  server.tool('terminate_subscription', 'Terminate a Recurly subscription immediately', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('PUT', `${BP}/subscriptions/${subscription_id}/terminate`) as any;
    return text(`Terminated subscription ${data.id} [${data.state}]`);
  });

  server.tool('reactivate_subscription', 'Reactivate a cancelled Recurly subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('PUT', `${BP}/subscriptions/${subscription_id}/reactivate`) as any;
    return text(`Reactivated subscription ${data.id}`);
  });

  server.tool('pause_subscription', 'Pause a Recurly subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('PUT', `${BP}/subscriptions/${subscription_id}/pause`) as any;
    return text(`Paused subscription ${data.id}`);
  });

  server.tool('resume_subscription', 'Resume a paused Recurly subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('PUT', `${BP}/subscriptions/${subscription_id}/resume`) as any;
    return text(`Resumed subscription ${data.id}`);
  });

  // ── Plans ───────────────────────────────────────────────────────

  server.tool('create_plan', 'Create a Recurly plan', {
    code: z.string().describe('Plan code'),
    name: z.string().describe('Plan name'),
    interval_unit: z.enum(['days', 'months']).optional().describe('Billing interval unit'),
    interval_length: z.number().int().optional().describe('Billing interval length'),
  }, async (params) => {
    const data = await call('POST', `${BP}/plans`, params) as any;
    return text(`Created plan ${data.id} (code: ${data.code})`);
  });

  server.tool('get_plan', 'Get a Recurly plan by ID', {
    plan_id: z.string().describe('Plan ID'),
  }, async ({ plan_id }) => {
    const data = await call('GET', `${BP}/plans/${plan_id}`);
    return json(data);
  });

  server.tool('list_plans', 'List Recurly plans', {
    state: z.string().optional().describe('Filter by state'),
  }, async ({ state }) => {
    const data = await call('GET', `${BP}/plans${qs({ state })}`) as any;
    if (!data.data?.length) return text('No plans found.');
    const lines = data.data.map((p: any) => `• ${p.id} — ${p.name} (${p.code})`);
    return text(`Plans (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('update_plan', 'Update a Recurly plan', {
    plan_id: z.string().describe('Plan ID'),
    name: z.string().optional().describe('Plan name'),
  }, async ({ plan_id, ...rest }) => {
    const data = await call('PUT', `${BP}/plans/${plan_id}`, rest) as any;
    return text(`Updated plan ${data.id}`);
  });

  // ── Add-Ons ─────────────────────────────────────────────────────

  server.tool('create_add_on', 'Create an add-on for a Recurly plan', {
    plan_id: z.string().describe('Plan ID'),
    code: z.string().describe('Add-on code'),
    name: z.string().describe('Add-on name'),
    add_on_type: z.enum(['fixed', 'usage']).optional().describe('Add-on type'),
  }, async ({ plan_id, ...rest }) => {
    const data = await call('POST', `${BP}/plans/${plan_id}/add_ons`, rest) as any;
    return text(`Created add-on ${data.id} (code: ${data.code})`);
  });

  server.tool('get_add_on', 'Get an add-on by ID', {
    plan_id: z.string().describe('Plan ID'),
    add_on_id: z.string().describe('Add-on ID'),
  }, async ({ plan_id, add_on_id }) => {
    const data = await call('GET', `${BP}/plans/${plan_id}/add_ons/${add_on_id}`);
    return json(data);
  });

  server.tool('list_add_ons', 'List add-ons for a plan', {
    plan_id: z.string().describe('Plan ID'),
  }, async ({ plan_id }) => {
    const data = await call('GET', `${BP}/plans/${plan_id}/add_ons`) as any;
    if (!data.data?.length) return text('No add-ons found.');
    const lines = data.data.map((a: any) => `• ${a.id} — ${a.name} (${a.code})`);
    return text(`Add-ons (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('update_add_on', 'Update an add-on', {
    plan_id: z.string().describe('Plan ID'),
    add_on_id: z.string().describe('Add-on ID'),
    name: z.string().optional().describe('Add-on name'),
  }, async ({ plan_id, add_on_id, ...rest }) => {
    const data = await call('PUT', `${BP}/plans/${plan_id}/add_ons/${add_on_id}`, rest) as any;
    return text(`Updated add-on ${data.id}`);
  });

  server.tool('delete_add_on', 'Delete an add-on from a plan', {
    plan_id: z.string().describe('Plan ID'),
    add_on_id: z.string().describe('Add-on ID'),
  }, async ({ plan_id, add_on_id }) => {
    await call('DELETE', `${BP}/plans/${plan_id}/add_ons/${add_on_id}`);
    return text(`Deleted add-on ${add_on_id}`);
  });

  // ── Invoices ────────────────────────────────────────────────────

  server.tool('get_invoice', 'Get a Recurly invoice by ID', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('GET', `${BP}/invoices/${invoice_id}`);
    return json(data);
  });

  server.tool('list_invoices', 'List Recurly invoices', {
    account_id: z.string().optional().describe('Filter by account'),
    state: z.string().optional().describe('Filter by state'),
    subscription_id: z.string().optional().describe('Filter by subscription'),
  }, async ({ account_id, state, subscription_id }) => {
    const data = await call('GET', `${BP}/invoices${qs({ account_id, state, subscription_id })}`) as any;
    if (!data.data?.length) return text('No invoices found.');
    const lines = data.data.map((i: any) => `• ${i.id} — ${i.total ?? 0} ${i.currency ?? 'USD'} [${i.state}]`);
    return text(`Invoices (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('collect_invoice', 'Collect payment on an invoice', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('POST', `${BP}/invoices/${invoice_id}/collect`) as any;
    return text(`Collected payment for invoice ${data.id} [${data.state}]`);
  });

  server.tool('void_invoice', 'Void an invoice', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('PUT', `${BP}/invoices/${invoice_id}/void`) as any;
    return text(`Voided invoice ${data.id}`);
  });

  server.tool('mark_invoice_failed', 'Mark an invoice as failed', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('PUT', `${BP}/invoices/${invoice_id}/mark_failed`) as any;
    return text(`Marked invoice ${data.id} as failed`);
  });

  // ── Line Items ──────────────────────────────────────────────────

  server.tool('create_line_item', 'Create a line item (charge/credit) on an account', {
    account_id: z.string().describe('Account ID'),
    type: z.enum(['charge', 'credit']).describe('Line item type'),
    currency: z.string().optional().describe('Currency code'),
    unit_amount: z.number().describe('Unit amount (decimal)'),
    description: z.string().optional().describe('Description'),
    quantity: z.number().int().optional().describe('Quantity'),
  }, async ({ account_id, ...rest }) => {
    const data = await call('POST', `${BP}/accounts/${account_id}/line_items`, rest) as any;
    return text(`Created line item ${data.id} (${data.type}: ${data.unit_amount} ${data.currency})`);
  });

  server.tool('list_line_items', 'List line items for an account', {
    account_id: z.string().describe('Account ID'),
  }, async ({ account_id }) => {
    const data = await call('GET', `${BP}/accounts/${account_id}/line_items`) as any;
    if (!data.data?.length) return text('No line items found.');
    const lines = data.data.map((i: any) => `• ${i.id} — ${i.type} ${i.unit_amount} ${i.currency}`);
    return text(`Line items (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('delete_line_item', 'Delete a pending line item', {
    line_item_id: z.string().describe('Line item ID'),
  }, async ({ line_item_id }) => {
    await call('DELETE', `${BP}/line_items/${line_item_id}`);
    return text(`Deleted line item ${line_item_id}`);
  });

  // ── Transactions ────────────────────────────────────────────────

  server.tool('get_transaction', 'Get a Recurly transaction by ID', {
    transaction_id: z.string().describe('Transaction ID'),
  }, async ({ transaction_id }) => {
    const data = await call('GET', `${BP}/transactions/${transaction_id}`);
    return json(data);
  });

  server.tool('list_transactions', 'List Recurly transactions', {
    account_id: z.string().optional().describe('Filter by account'),
  }, async ({ account_id }) => {
    const data = await call('GET', `${BP}/transactions${qs({ account_id })}`) as any;
    if (!data.data?.length) return text('No transactions found.');
    const lines = data.data.map((t: any) => `• ${t.id}`);
    return text(`Transactions (${data.data.length}):\n${lines.join('\n')}`);
  });

  // ── Billing Info ────────────────────────────────────────────────

  server.tool('update_billing_info', 'Update billing info for an account', {
    account_id: z.string().describe('Account ID'),
    token_id: z.string().optional().describe('Token ID from Recurly.js'),
  }, async ({ account_id, ...rest }) => {
    const data = await call('PUT', `${BP}/accounts/${account_id}/billing_info`, rest) as any;
    return text(`Updated billing info for account ${account_id}`);
  });

  server.tool('get_billing_info', 'Get billing info for an account', {
    account_id: z.string().describe('Account ID'),
  }, async ({ account_id }) => {
    const data = await call('GET', `${BP}/accounts/${account_id}/billing_info`);
    return json(data);
  });

  server.tool('remove_billing_info', 'Remove billing info from an account', {
    account_id: z.string().describe('Account ID'),
  }, async ({ account_id }) => {
    await call('DELETE', `${BP}/accounts/${account_id}/billing_info`);
    return text(`Removed billing info for account ${account_id}`);
  });

  // ── Coupons ─────────────────────────────────────────────────────

  server.tool('create_coupon', 'Create a Recurly coupon', {
    code: z.string().describe('Coupon code'),
    name: z.string().describe('Coupon name'),
    discount_type: z.enum(['percent', 'fixed', 'free_trial']).describe('Discount type'),
    discount_percent: z.number().optional().describe('Discount percentage'),
    duration: z.enum(['single_use', 'temporal', 'forever']).optional().describe('Duration'),
    max_redemptions: z.number().int().optional().describe('Max redemptions'),
  }, async (params) => {
    const data = await call('POST', `${BP}/coupons`, params) as any;
    return text(`Created coupon ${data.id} (code: ${data.code})`);
  });

  server.tool('get_coupon', 'Get a Recurly coupon by ID', {
    coupon_id: z.string().describe('Coupon ID'),
  }, async ({ coupon_id }) => {
    const data = await call('GET', `${BP}/coupons/${coupon_id}`);
    return json(data);
  });

  server.tool('list_coupons', 'List Recurly coupons', {
    state: z.string().optional().describe('Filter by state'),
  }, async ({ state }) => {
    const data = await call('GET', `${BP}/coupons${qs({ state })}`) as any;
    if (!data.data?.length) return text('No coupons found.');
    const lines = data.data.map((c: any) => `• ${c.id} — ${c.name} (${c.code}) [${c.state}]`);
    return text(`Coupons (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('redeem_coupon', 'Redeem a coupon on an account', {
    account_id: z.string().describe('Account ID'),
    coupon_id: z.string().describe('Coupon ID'),
    currency: z.string().optional().describe('Currency code'),
  }, async ({ account_id, ...rest }) => {
    const data = await call('POST', `${BP}/accounts/${account_id}/coupon_redemptions`, rest) as any;
    return text(`Redeemed coupon on account ${account_id}`);
  });

  // ── Usage Records ───────────────────────────────────────────────

  server.tool('create_usage', 'Create a usage record for metered billing', {
    subscription_id: z.string().describe('Subscription ID'),
    add_on_id: z.string().describe('Add-on ID'),
    amount: z.number().describe('Usage amount'),
    merchant_tag: z.string().optional().describe('Merchant tag for tracking'),
  }, async ({ subscription_id, add_on_id, ...rest }) => {
    const data = await call('POST', `${BP}/subscriptions/${subscription_id}/add_ons/${add_on_id}/usage`, rest) as any;
    return text(`Created usage record ${data.id}`);
  });

  server.tool('list_usage', 'List usage records for a subscription add-on', {
    subscription_id: z.string().describe('Subscription ID'),
    add_on_id: z.string().describe('Add-on ID'),
  }, async ({ subscription_id, add_on_id }) => {
    const data = await call('GET', `${BP}/subscriptions/${subscription_id}/add_ons/${add_on_id}/usage`) as any;
    if (!data.data?.length) return text('No usage records found.');
    const lines = data.data.map((u: any) => `• ${u.id} — amount: ${u.amount}`);
    return text(`Usage records (${data.data.length}):\n${lines.join('\n')}`);
  });

  // ── Shipping Addresses ──────────────────────────────────────────

  server.tool('create_shipping_address', 'Create a shipping address for an account', {
    account_id: z.string().describe('Account ID'),
    first_name: z.string().optional().describe('First name'),
    last_name: z.string().optional().describe('Last name'),
    street1: z.string().describe('Street address'),
    city: z.string().describe('City'),
    region: z.string().optional().describe('State/region'),
    postal_code: z.string().describe('Postal code'),
    country: z.string().describe('Country code'),
  }, async ({ account_id, ...rest }) => {
    const data = await call('POST', `${BP}/accounts/${account_id}/shipping_addresses`, rest) as any;
    return text(`Created shipping address ${data.id}`);
  });

  server.tool('list_shipping_addresses', 'List shipping addresses for an account', {
    account_id: z.string().describe('Account ID'),
  }, async ({ account_id }) => {
    const data = await call('GET', `${BP}/accounts/${account_id}/shipping_addresses`) as any;
    if (!data.data?.length) return text('No shipping addresses found.');
    const lines = data.data.map((a: any) => `• ${a.id} — ${a.street1}, ${a.city} ${a.postal_code}`);
    return text(`Shipping addresses (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('update_shipping_address', 'Update a shipping address', {
    account_id: z.string().describe('Account ID'),
    address_id: z.string().describe('Shipping address ID'),
    street1: z.string().optional().describe('Street address'),
    city: z.string().optional().describe('City'),
    region: z.string().optional().describe('State/region'),
    postal_code: z.string().optional().describe('Postal code'),
    country: z.string().optional().describe('Country code'),
  }, async ({ account_id, address_id, ...rest }) => {
    const data = await call('PUT', `${BP}/accounts/${account_id}/shipping_addresses/${address_id}`, rest) as any;
    return text(`Updated shipping address ${data.id}`);
  });

  server.tool('delete_shipping_address', 'Delete a shipping address', {
    account_id: z.string().describe('Account ID'),
    address_id: z.string().describe('Shipping address ID'),
  }, async ({ account_id, address_id }) => {
    await call('DELETE', `${BP}/accounts/${account_id}/shipping_addresses/${address_id}`);
    return text(`Deleted shipping address ${address_id}`);
  });

  // ── Entitlements ────────────────────────────────────────────────

  server.tool('list_entitlements', 'List entitlements for an account', {
    account_id: z.string().describe('Account ID'),
  }, async ({ account_id }) => {
    const data = await call('GET', `${BP}/accounts/${account_id}/entitlements`) as any;
    if (!data.data?.length) return text('No entitlements found.');
    const lines = data.data.map((e: any) => `• ${e.id}`);
    return text(`Entitlements (${data.data.length}):\n${lines.join('\n')}`);
  });
}

/**
 * Create a standalone Mimic MCP server for Recurly.
 */
export function createRecurlyMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: 'mimic-recurly',
    version: '0.5.0',
    description: 'Mimic MCP server for Recurly — subscription management, recurring billing, revenue recognition',
  });
  registerRecurlyTools(server, baseUrl);
  return server;
}

/**
 * Start the Recurly MCP server on stdio transport.
 */
export async function startRecurlyMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createRecurlyMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Recurly MCP server running on stdio');
}
