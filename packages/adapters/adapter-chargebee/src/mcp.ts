import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BP = '/chargebee/api/v2';

function makeCall(baseUrl: string) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Chargebee mock error ${res.status}: ${text}`);
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
// Factory — Chargebee MCP tools (Tier 3: Mimic-built)
// ---------------------------------------------------------------------------

export function registerChargebeeTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);

  // ── Subscriptions ──────────────────────────────────────────────────

  server.tool('create_subscription', 'Create a new Chargebee subscription', {
    customer_id: z.string().optional().describe('Customer ID'),
    subscription_items: z.array(z.object({
      item_price_id: z.string(),
      quantity: z.number().int().positive().optional(),
    })).optional().describe('Subscription items'),
    currency_code: z.string().optional().describe('Currency code'),
  }, async (params) => {
    const data = await call('POST', `${BP}/subscriptions`, params) as any;
    return text(`Created subscription ${data.subscription.id} [${data.subscription.status}]`);
  });

  server.tool('get_subscription', 'Get a Chargebee subscription by ID', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('GET', `${BP}/subscriptions/${subscription_id}`);
    return json(data);
  });

  server.tool('list_subscriptions', 'List Chargebee subscriptions', {
    customer_id: z.string().optional().describe('Filter by customer'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ customer_id, status }) => {
    const q: Record<string, string | undefined> = {};
    if (customer_id) q['customer_id[is]'] = customer_id;
    if (status) q['status[is]'] = status;
    const data = await call('GET', `${BP}/subscriptions${qs(q)}`) as any;
    if (!data.list?.length) return text('No subscriptions found.');
    const lines = data.list.map((e: any) => `• ${e.subscription.id} — ${e.subscription.customer_id} [${e.subscription.status}]`);
    return text(`Subscriptions (${data.list.length}):\n${lines.join('\n')}`);
  });

  server.tool('cancel_subscription', 'Cancel a Chargebee subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    end_of_term: z.boolean().optional().describe('Cancel at end of term (default: immediate)'),
  }, async ({ subscription_id, end_of_term }) => {
    const data = await call('POST', `${BP}/subscriptions/${subscription_id}/cancel`, { end_of_term }) as any;
    return text(`Cancelled subscription ${data.subscription.id} [${data.subscription.status}]`);
  });

  server.tool('reactivate_subscription', 'Reactivate a cancelled Chargebee subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('POST', `${BP}/subscriptions/${subscription_id}/reactivate`) as any;
    return text(`Reactivated subscription ${data.subscription.id}`);
  });

  server.tool('pause_subscription', 'Pause a Chargebee subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('POST', `${BP}/subscriptions/${subscription_id}/pause`) as any;
    return text(`Paused subscription ${data.subscription.id}`);
  });

  server.tool('resume_subscription', 'Resume a paused Chargebee subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('POST', `${BP}/subscriptions/${subscription_id}/resume`) as any;
    return text(`Resumed subscription ${data.subscription.id}`);
  });

  server.tool('change_subscription_term_end', 'Change subscription term end date', {
    subscription_id: z.string().describe('Subscription ID'),
    term_ends_at: z.number().int().describe('New term end (Unix timestamp)'),
  }, async ({ subscription_id, term_ends_at }) => {
    const data = await call('POST', `${BP}/subscriptions/${subscription_id}/change_term_end`, { term_ends_at }) as any;
    return text(`Updated term end for ${data.subscription.id}`);
  });

  server.tool('update_subscription', 'Update a Chargebee subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    subscription_items: z.array(z.object({
      item_price_id: z.string(),
      quantity: z.number().int().positive().optional(),
    })).optional().describe('Updated items'),
  }, async ({ subscription_id, ...rest }) => {
    const data = await call('POST', `${BP}/subscriptions/${subscription_id}/update`, rest) as any;
    return text(`Updated subscription ${data.subscription.id}`);
  });

  // ── Customers ──────────────────────────────────────────────────────

  server.tool('create_customer', 'Create a new Chargebee customer', {
    first_name: z.string().optional().describe('First name'),
    last_name: z.string().optional().describe('Last name'),
    email: z.string().optional().describe('Email'),
    company: z.string().optional().describe('Company'),
  }, async (params) => {
    const data = await call('POST', `${BP}/customers`, params) as any;
    return text(`Created customer ${data.customer.id}: ${data.customer.first_name ?? ''} ${data.customer.last_name ?? ''}`);
  });

  server.tool('get_customer', 'Get a Chargebee customer by ID', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `${BP}/customers/${customer_id}`);
    return json(data);
  });

  server.tool('list_customers', 'List Chargebee customers', {
    email: z.string().optional().describe('Filter by email'),
  }, async ({ email }) => {
    const q: Record<string, string | undefined> = {};
    if (email) q['email[is]'] = email;
    const data = await call('GET', `${BP}/customers${qs(q)}`) as any;
    if (!data.list?.length) return text('No customers found.');
    const lines = data.list.map((e: any) => `• ${e.customer.id} — ${e.customer.first_name ?? ''} ${e.customer.last_name ?? ''} (${e.customer.email ?? 'no email'})`);
    return text(`Customers (${data.list.length}):\n${lines.join('\n')}`);
  });

  server.tool('update_customer', 'Update a Chargebee customer', {
    customer_id: z.string().describe('Customer ID'),
    first_name: z.string().optional().describe('First name'),
    last_name: z.string().optional().describe('Last name'),
    email: z.string().optional().describe('Email'),
    company: z.string().optional().describe('Company'),
  }, async ({ customer_id, ...rest }) => {
    const data = await call('POST', `${BP}/customers/${customer_id}`, rest) as any;
    return text(`Updated customer ${data.customer.id}`);
  });

  // ── Items ──────────────────────────────────────────────────────────

  server.tool('create_item', 'Create a Chargebee item (product)', {
    id: z.string().optional().describe('Item ID'),
    name: z.string().describe('Item name'),
    type: z.enum(['plan', 'addon', 'charge']).describe('Item type'),
    item_family_id: z.string().optional().describe('Item family ID'),
    description: z.string().optional().describe('Description'),
  }, async (params) => {
    const data = await call('POST', `${BP}/items`, params) as any;
    return text(`Created item ${data.item.id}: ${data.item.name}`);
  });

  server.tool('get_item', 'Get a Chargebee item by ID', {
    item_id: z.string().describe('Item ID'),
  }, async ({ item_id }) => {
    const data = await call('GET', `${BP}/items/${item_id}`);
    return json(data);
  });

  server.tool('list_items', 'List Chargebee items', {
    type: z.enum(['plan', 'addon', 'charge']).optional().describe('Filter by type'),
    item_family_id: z.string().optional().describe('Filter by item family'),
  }, async ({ type, item_family_id }) => {
    const q: Record<string, string | undefined> = {};
    if (type) q['type[is]'] = type;
    if (item_family_id) q['item_family_id[is]'] = item_family_id;
    const data = await call('GET', `${BP}/items${qs(q)}`) as any;
    if (!data.list?.length) return text('No items found.');
    const lines = data.list.map((e: any) => `• ${e.item.id} — ${e.item.name} (${e.item.type})`);
    return text(`Items (${data.list.length}):\n${lines.join('\n')}`);
  });

  // ── Item Prices ────────────────────────────────────────────────────

  server.tool('create_item_price', 'Create a Chargebee item price', {
    id: z.string().optional().describe('Item price ID'),
    name: z.string().describe('Item price name'),
    item_id: z.string().describe('Item ID'),
    pricing_model: z.enum(['flat_fee', 'per_unit', 'tiered', 'volume', 'stairstep']).optional().describe('Pricing model'),
    price: z.number().int().optional().describe('Price in minor units'),
    period: z.number().int().optional().describe('Billing period count'),
    period_unit: z.enum(['day', 'week', 'month', 'year']).optional().describe('Period unit'),
    currency_code: z.string().optional().describe('Currency code'),
  }, async (params) => {
    const data = await call('POST', `${BP}/item_prices`, params) as any;
    return text(`Created item price ${data.item_price.id}`);
  });

  server.tool('get_item_price', 'Get a Chargebee item price by ID', {
    item_price_id: z.string().describe('Item price ID'),
  }, async ({ item_price_id }) => {
    const data = await call('GET', `${BP}/item_prices/${item_price_id}`);
    return json(data);
  });

  server.tool('list_item_prices', 'List Chargebee item prices', {
    item_id: z.string().optional().describe('Filter by item'),
  }, async ({ item_id }) => {
    const q: Record<string, string | undefined> = {};
    if (item_id) q['item_id[is]'] = item_id;
    const data = await call('GET', `${BP}/item_prices${qs(q)}`) as any;
    if (!data.list?.length) return text('No item prices found.');
    const lines = data.list.map((e: any) => `• ${e.item_price.id} — ${e.item_price.name} (${e.item_price.price} ${e.item_price.currency_code}/${e.item_price.period_unit})`);
    return text(`Item prices (${data.list.length}):\n${lines.join('\n')}`);
  });

  // ── Item Families ──────────────────────────────────────────────────

  server.tool('create_item_family', 'Create a Chargebee item family', {
    id: z.string().optional().describe('Item family ID'),
    name: z.string().describe('Family name'),
    description: z.string().optional().describe('Description'),
  }, async (params) => {
    const data = await call('POST', `${BP}/item_families`, params) as any;
    return text(`Created item family ${data.item_family.id}: ${data.item_family.name}`);
  });

  server.tool('get_item_family', 'Get a Chargebee item family by ID', {
    item_family_id: z.string().describe('Item family ID'),
  }, async ({ item_family_id }) => {
    const data = await call('GET', `${BP}/item_families/${item_family_id}`);
    return json(data);
  });

  server.tool('list_item_families', 'List Chargebee item families', {}, async () => {
    const data = await call('GET', `${BP}/item_families`) as any;
    if (!data.list?.length) return text('No item families found.');
    const lines = data.list.map((e: any) => `• ${e.item_family.id} — ${e.item_family.name}`);
    return text(`Item families (${data.list.length}):\n${lines.join('\n')}`);
  });

  // ── Invoices ───────────────────────────────────────────────────────

  server.tool('get_invoice', 'Get a Chargebee invoice by ID', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('GET', `${BP}/invoices/${invoice_id}`);
    return json(data);
  });

  server.tool('list_invoices', 'List Chargebee invoices', {
    customer_id: z.string().optional().describe('Filter by customer'),
    subscription_id: z.string().optional().describe('Filter by subscription'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ customer_id, subscription_id, status }) => {
    const q: Record<string, string | undefined> = {};
    if (customer_id) q['customer_id[is]'] = customer_id;
    if (subscription_id) q['subscription_id[is]'] = subscription_id;
    if (status) q['status[is]'] = status;
    const data = await call('GET', `${BP}/invoices${qs(q)}`) as any;
    if (!data.list?.length) return text('No invoices found.');
    const lines = data.list.map((e: any) => `• ${e.invoice.id} — ${e.invoice.total} ${e.invoice.currency_code} [${e.invoice.status}]`);
    return text(`Invoices (${data.list.length}):\n${lines.join('\n')}`);
  });

  server.tool('collect_invoice_payment', 'Collect payment on an invoice', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('POST', `${BP}/invoices/${invoice_id}/collect_payment`) as any;
    return text(`Collected payment for invoice ${data.invoice.id} [${data.invoice.status}]`);
  });

  server.tool('void_invoice', 'Void an invoice', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('POST', `${BP}/invoices/${invoice_id}/void`) as any;
    return text(`Voided invoice ${data.invoice.id}`);
  });

  server.tool('write_off_invoice', 'Write off an invoice', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('POST', `${BP}/invoices/${invoice_id}/write_off`) as any;
    return text(`Wrote off invoice ${data.invoice.id}`);
  });

  server.tool('get_invoice_pdf', 'Get invoice PDF download URL', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('GET', `${BP}/invoices/${invoice_id}/pdf`) as any;
    return text(`Invoice PDF: ${data.download.download_url}`);
  });

  // ── Credit Notes ───────────────────────────────────────────────────

  server.tool('create_credit_note', 'Create a credit note', {
    reference_invoice_id: z.string().describe('Reference invoice ID'),
    customer_id: z.string().optional().describe('Customer ID'),
    type: z.enum(['adjustment', 'refundable']).optional().describe('Credit note type'),
    total: z.number().int().optional().describe('Total amount'),
    reason_code: z.string().optional().describe('Reason code'),
  }, async (params) => {
    const data = await call('POST', `${BP}/credit_notes`, params) as any;
    return text(`Created credit note ${data.credit_note.id}`);
  });

  server.tool('get_credit_note', 'Get a credit note by ID', {
    credit_note_id: z.string().describe('Credit note ID'),
  }, async ({ credit_note_id }) => {
    const data = await call('GET', `${BP}/credit_notes/${credit_note_id}`);
    return json(data);
  });

  server.tool('list_credit_notes', 'List credit notes', {
    customer_id: z.string().optional().describe('Filter by customer'),
  }, async ({ customer_id }) => {
    const q: Record<string, string | undefined> = {};
    if (customer_id) q['customer_id[is]'] = customer_id;
    const data = await call('GET', `${BP}/credit_notes${qs(q)}`) as any;
    if (!data.list?.length) return text('No credit notes found.');
    const lines = data.list.map((e: any) => `• ${e.credit_note.id} — ${e.credit_note.total} ${e.credit_note.currency_code}`);
    return text(`Credit notes (${data.list.length}):\n${lines.join('\n')}`);
  });

  // ── Coupons ────────────────────────────────────────────────────────

  server.tool('create_coupon', 'Create a Chargebee coupon', {
    id: z.string().optional().describe('Coupon ID'),
    name: z.string().describe('Coupon name'),
    discount_type: z.enum(['percentage', 'fixed_amount']).describe('Discount type'),
    discount_percentage: z.number().optional().describe('Discount percentage (0-100)'),
    discount_amount: z.number().int().optional().describe('Fixed discount in minor units'),
    currency_code: z.string().optional().describe('Currency (for fixed amount)'),
    duration_type: z.enum(['one_time', 'forever', 'limited_period']).optional().describe('Duration'),
    max_redemptions: z.number().int().optional().describe('Max uses'),
  }, async (params) => {
    const data = await call('POST', `${BP}/coupons`, params) as any;
    return text(`Created coupon ${data.coupon.id}: ${data.coupon.name}`);
  });

  server.tool('get_coupon', 'Get a Chargebee coupon by ID', {
    coupon_id: z.string().describe('Coupon ID'),
  }, async ({ coupon_id }) => {
    const data = await call('GET', `${BP}/coupons/${coupon_id}`);
    return json(data);
  });

  server.tool('list_coupons', 'List Chargebee coupons', {}, async () => {
    const data = await call('GET', `${BP}/coupons`) as any;
    if (!data.list?.length) return text('No coupons found.');
    const lines = data.list.map((e: any) => `• ${e.coupon.id} — ${e.coupon.name} (${e.coupon.discount_type})`);
    return text(`Coupons (${data.list.length}):\n${lines.join('\n')}`);
  });

  server.tool('update_coupon', 'Update a Chargebee coupon', {
    coupon_id: z.string().describe('Coupon ID'),
    name: z.string().optional().describe('Coupon name'),
    max_redemptions: z.number().int().optional().describe('Max uses'),
  }, async ({ coupon_id, ...rest }) => {
    const data = await call('POST', `${BP}/coupons/${coupon_id}`, rest) as any;
    return text(`Updated coupon ${data.coupon.id}`);
  });

  server.tool('delete_coupon', 'Delete a Chargebee coupon', {
    coupon_id: z.string().describe('Coupon ID'),
  }, async ({ coupon_id }) => {
    await call('DELETE', `${BP}/coupons/${coupon_id}/delete`);
    return text(`Deleted coupon ${coupon_id}`);
  });

  // ── Usage ──────────────────────────────────────────────────────────

  server.tool('create_usage', 'Create a usage record for metered billing', {
    subscription_id: z.string().describe('Subscription ID'),
    item_price_id: z.string().describe('Item price ID'),
    quantity: z.string().describe('Usage quantity'),
    usage_date: z.number().int().optional().describe('Usage date (Unix timestamp)'),
  }, async ({ subscription_id, ...rest }) => {
    const data = await call('POST', `${BP}/subscriptions/${subscription_id}/usages`, rest) as any;
    return text(`Created usage record ${data.usage.id}`);
  });

  server.tool('list_usages', 'List usage records for a subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('GET', `${BP}/subscriptions/${subscription_id}/usages`) as any;
    if (!data.list?.length) return text('No usage records found.');
    const lines = data.list.map((e: any) => `• ${e.usage.id} — qty ${e.usage.quantity}`);
    return text(`Usage records (${data.list.length}):\n${lines.join('\n')}`);
  });

  server.tool('delete_usage', 'Delete a usage record', {
    usage_id: z.string().describe('Usage record ID'),
  }, async ({ usage_id }) => {
    await call('DELETE', `${BP}/usages/${usage_id}`);
    return text(`Deleted usage ${usage_id}`);
  });

  // ── Payment Sources ────────────────────────────────────────────────

  server.tool('create_payment_source', 'Create a payment source', {
    customer_id: z.string().describe('Customer ID'),
    type: z.enum(['card', 'bank_account', 'paypal_express_checkout']).describe('Payment source type'),
    gateway: z.string().optional().describe('Payment gateway'),
  }, async (params) => {
    const data = await call('POST', `${BP}/payment_sources`, params) as any;
    return text(`Created payment source ${data.payment_source.id}`);
  });

  server.tool('list_payment_sources', 'List payment sources', {
    customer_id: z.string().optional().describe('Filter by customer'),
  }, async ({ customer_id }) => {
    const q: Record<string, string | undefined> = {};
    if (customer_id) q['customer_id[is]'] = customer_id;
    const data = await call('GET', `${BP}/payment_sources${qs(q)}`) as any;
    if (!data.list?.length) return text('No payment sources found.');
    const lines = data.list.map((e: any) => `• ${e.payment_source.id} — ${e.payment_source.type} [${e.payment_source.status}]`);
    return text(`Payment sources (${data.list.length}):\n${lines.join('\n')}`);
  });

  server.tool('delete_payment_source', 'Delete a payment source', {
    payment_source_id: z.string().describe('Payment source ID'),
  }, async ({ payment_source_id }) => {
    await call('DELETE', `${BP}/payment_sources/${payment_source_id}/delete`);
    return text(`Deleted payment source ${payment_source_id}`);
  });

  // ── Transactions ───────────────────────────────────────────────────

  server.tool('get_transaction', 'Get a Chargebee transaction by ID', {
    transaction_id: z.string().describe('Transaction ID'),
  }, async ({ transaction_id }) => {
    const data = await call('GET', `${BP}/transactions/${transaction_id}`);
    return json(data);
  });

  server.tool('list_transactions', 'List Chargebee transactions', {
    customer_id: z.string().optional().describe('Filter by customer'),
  }, async ({ customer_id }) => {
    const q: Record<string, string | undefined> = {};
    if (customer_id) q['customer_id[is]'] = customer_id;
    const data = await call('GET', `${BP}/transactions${qs(q)}`) as any;
    if (!data.list?.length) return text('No transactions found.');
    const lines = data.list.map((e: any) => `• ${e.transaction.id}`);
    return text(`Transactions (${data.list.length}):\n${lines.join('\n')}`);
  });

  // ── Events ─────────────────────────────────────────────────────────

  server.tool('get_event', 'Get a Chargebee event by ID', {
    event_id: z.string().describe('Event ID'),
  }, async ({ event_id }) => {
    const data = await call('GET', `${BP}/events/${event_id}`);
    return json(data);
  });

  server.tool('list_events', 'List Chargebee events', {}, async () => {
    const data = await call('GET', `${BP}/events`) as any;
    if (!data.list?.length) return text('No events found.');
    const lines = data.list.map((e: any) => `• ${e.event.id} — ${e.event.event_type ?? 'unknown'}`);
    return text(`Events (${data.list.length}):\n${lines.join('\n')}`);
  });

  // ── Hosted Pages ───────────────────────────────────────────────────

  server.tool('create_checkout_hosted_page', 'Create a checkout hosted page for a new subscription', {
    customer_id: z.string().optional().describe('Customer ID'),
    subscription_items: z.array(z.object({
      item_price_id: z.string(),
      quantity: z.number().int().positive().optional(),
    })).optional().describe('Subscription items'),
  }, async (params) => {
    const data = await call('POST', `${BP}/hosted_pages/checkout_new`, params) as any;
    return text(`Created checkout page: ${data.hosted_page.url}`);
  });

  server.tool('create_manage_payment_sources_page', 'Create a hosted page to manage payment sources', {
    customer_id: z.string().describe('Customer ID'),
  }, async (params) => {
    const data = await call('POST', `${BP}/hosted_pages/manage_payment_sources`, params) as any;
    return text(`Created payment sources page: ${data.hosted_page.url}`);
  });

  // ── Portal Sessions ────────────────────────────────────────────────

  server.tool('create_portal_session', 'Create a Chargebee customer portal session', {
    customer_id: z.string().describe('Customer ID'),
  }, async (params) => {
    const data = await call('POST', `${BP}/portal_sessions`, params) as any;
    return text(`Created portal session: ${data.portal_session.access_url}`);
  });

  // ── Quotes ─────────────────────────────────────────────────────────

  server.tool('create_quote', 'Create a Chargebee quote', {
    customer_id: z.string().optional().describe('Customer ID'),
    name: z.string().optional().describe('Quote name'),
    operation_type: z.string().optional().describe('Operation type'),
    currency_code: z.string().optional().describe('Currency code'),
  }, async (params) => {
    const data = await call('POST', `${BP}/quotes`, params) as any;
    return text(`Created quote ${data.quote.id} [${data.quote.status}]`);
  });

  server.tool('get_quote', 'Get a Chargebee quote by ID', {
    quote_id: z.string().describe('Quote ID'),
  }, async ({ quote_id }) => {
    const data = await call('GET', `${BP}/quotes/${quote_id}`);
    return json(data);
  });

  server.tool('list_quotes', 'List Chargebee quotes', {}, async () => {
    const data = await call('GET', `${BP}/quotes`) as any;
    if (!data.list?.length) return text('No quotes found.');
    const lines = data.list.map((e: any) => `• ${e.quote.id} — [${e.quote.status}]`);
    return text(`Quotes (${data.list.length}):\n${lines.join('\n')}`);
  });

  server.tool('convert_quote', 'Convert a quote to a subscription', {
    quote_id: z.string().describe('Quote ID'),
  }, async ({ quote_id }) => {
    const data = await call('POST', `${BP}/quotes/${quote_id}/convert`) as any;
    return text(`Converted quote ${data.quote.id} → subscription ${data.subscription?.id ?? '(created)'}`);
  });

  // ── Unbilled Charges ───────────────────────────────────────────────

  server.tool('list_unbilled_charges', 'List unbilled charges', {
    subscription_id: z.string().optional().describe('Filter by subscription'),
  }, async ({ subscription_id }) => {
    const q: Record<string, string | undefined> = {};
    if (subscription_id) q['subscription_id[is]'] = subscription_id;
    const data = await call('GET', `${BP}/unbilled_charges${qs(q)}`) as any;
    if (!data.list?.length) return text('No unbilled charges found.');
    const lines = data.list.map((e: any) => `• ${e.unbilled_charge.id ?? 'charge'}`);
    return text(`Unbilled charges (${data.list.length}):\n${lines.join('\n')}`);
  });

  server.tool('invoice_unbilled_charges', 'Invoice unbilled charges for a subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('POST', `${BP}/unbilled_charges/invoice_unbilled_charges`, { subscription_id }) as any;
    return text(`Created invoice ${data.invoice.id} from unbilled charges`);
  });
}

/**
 * Create a standalone Mimic MCP server for Chargebee.
 */
export function createChargebeeMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: 'mimic-chargebee',
    version: '0.5.0',
    description: 'Mimic MCP server for Chargebee — subscriptions, invoicing, billing, product catalog',
  });
  registerChargebeeTools(server, baseUrl);
  return server;
}

/**
 * Start the Chargebee MCP server on stdio transport.
 */
export async function startChargebeeMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createChargebeeMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Chargebee MCP server running on stdio');
}
