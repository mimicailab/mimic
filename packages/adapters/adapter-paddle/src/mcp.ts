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
      throw new Error(`Paddle mock error ${res.status}: ${text}`);
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
// Factory — Official Paddle MCP parity (78 tools)
// ---------------------------------------------------------------------------

export function registerPaddleTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);

  // ── Products & Prices ──────────────────────────────────────────────

  // 1. create_product
  server.tool('create_product', 'Create a new Paddle product', {
    name: z.string().describe('Product name'),
    description: z.string().optional().describe('Product description'),
    type: z.enum(['standard', 'custom']).optional().describe('Product type'),
    tax_category: z.string().optional().describe('Tax category'),
    image_url: z.string().optional().describe('Image URL'),
    custom_data: z.record(z.string()).optional().describe('Custom data'),
  }, async (params) => {
    const data = await call('POST', '/paddle/products', params) as any;
    return text(`Created product ${data.data.id}: ${data.data.name}`);
  });

  // 2. list_products
  server.tool('list_products', 'List all Paddle products', {
    status: z.enum(['active', 'archived']).optional().describe('Filter by status'),
  }, async ({ status }) => {
    const data = await call('GET', `/paddle/products${qs({ status })}`) as any;
    if (!data.data?.length) return text('No products found.');
    const lines = data.data.map((p: any) => `• ${p.id} — ${p.name} [${p.status}]`);
    return text(`Products (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 3. get_product
  server.tool('get_product', 'Get a Paddle product by ID', {
    product_id: z.string().describe('Product ID'),
  }, async ({ product_id }) => {
    const data = await call('GET', `/paddle/products/${product_id}`);
    return json(data);
  });

  // 4. update_product
  server.tool('update_product', 'Update a Paddle product', {
    product_id: z.string().describe('Product ID'),
    name: z.string().optional().describe('Product name'),
    description: z.string().optional().describe('Product description'),
    status: z.enum(['active', 'archived']).optional().describe('Product status'),
    tax_category: z.string().optional().describe('Tax category'),
    image_url: z.string().optional().describe('Image URL'),
    custom_data: z.record(z.string()).optional().describe('Custom data'),
  }, async ({ product_id, ...rest }) => {
    const data = await call('PATCH', `/paddle/products/${product_id}`, rest) as any;
    return text(`Updated product ${data.data.id}`);
  });

  // 5. create_price
  server.tool('create_price', 'Create a new price for a product', {
    product_id: z.string().describe('Product this price belongs to'),
    description: z.string().describe('Price description'),
    unit_price: z.object({
      amount: z.string().describe('Amount in minor units'),
      currency_code: z.string().describe('ISO 4217 currency code'),
    }).describe('Unit price'),
    billing_cycle: z.object({
      interval: z.enum(['day', 'week', 'month', 'year']),
      frequency: z.number().int().positive(),
    }).optional().describe('Billing cycle for recurring prices'),
    trial_period: z.object({
      interval: z.enum(['day', 'week', 'month', 'year']),
      frequency: z.number().int().positive(),
    }).optional().describe('Trial period'),
    tax_mode: z.enum(['account_setting', 'external', 'internal']).optional().describe('Tax mode'),
    custom_data: z.record(z.string()).optional().describe('Custom data'),
  }, async (params) => {
    const data = await call('POST', '/paddle/prices', params) as any;
    return text(`Created price ${data.data.id}`);
  });

  // 6. list_prices
  server.tool('list_prices', 'List Paddle prices', {
    product_id: z.string().optional().describe('Filter by product'),
    status: z.enum(['active', 'archived']).optional().describe('Filter by status'),
  }, async ({ product_id, status }) => {
    const data = await call('GET', `/paddle/prices${qs({ product_id, status })}`) as any;
    if (!data.data?.length) return text('No prices found.');
    const lines = data.data.map((p: any) => `• ${p.id} — ${p.description} [${p.status}]`);
    return text(`Prices (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 7. get_price
  server.tool('get_price', 'Get a Paddle price by ID', {
    price_id: z.string().describe('Price ID'),
  }, async ({ price_id }) => {
    const data = await call('GET', `/paddle/prices/${price_id}`);
    return json(data);
  });

  // 8. update_price
  server.tool('update_price', 'Update a Paddle price', {
    price_id: z.string().describe('Price ID'),
    description: z.string().optional().describe('Price description'),
    status: z.enum(['active', 'archived']).optional().describe('Price status'),
    unit_price: z.object({
      amount: z.string(),
      currency_code: z.string(),
    }).optional().describe('Unit price'),
    custom_data: z.record(z.string()).optional().describe('Custom data'),
  }, async ({ price_id, ...rest }) => {
    const data = await call('PATCH', `/paddle/prices/${price_id}`, rest) as any;
    return text(`Updated price ${data.data.id}`);
  });

  // 9. preview_prices
  server.tool('preview_prices', 'Preview price calculations', {
    items: z.array(z.object({
      price_id: z.string().describe('Price ID'),
      quantity: z.number().int().positive().describe('Quantity'),
    })).describe('Items to preview'),
    customer_id: z.string().optional().describe('Customer ID'),
    address_id: z.string().optional().describe('Address ID for tax calculation'),
    currency_code: z.string().optional().describe('Currency code'),
    discount_id: z.string().optional().describe('Discount ID'),
  }, async (params) => {
    const data = await call('POST', '/paddle/pricing-preview', params);
    return json(data);
  });

  // ── Customers ──────────────────────────────────────────────────────

  // 10. create_customer
  server.tool('create_customer', 'Create a new Paddle customer', {
    email: z.string().describe('Customer email'),
    name: z.string().optional().describe('Customer name'),
    locale: z.string().optional().describe('Locale (e.g. en)'),
    custom_data: z.record(z.string()).optional().describe('Custom data'),
  }, async (params) => {
    const data = await call('POST', '/paddle/customers', params) as any;
    return text(`Created customer ${data.data.id}: ${data.data.email}`);
  });

  // 11. get_customer
  server.tool('get_customer', 'Get a Paddle customer by ID', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `/paddle/customers/${customer_id}`);
    return json(data);
  });

  // 12. list_customers
  server.tool('list_customers', 'List Paddle customers', {
    email: z.string().optional().describe('Filter by email'),
    status: z.enum(['active', 'archived']).optional().describe('Filter by status'),
  }, async ({ email, status }) => {
    const data = await call('GET', `/paddle/customers${qs({ email, status })}`) as any;
    if (!data.data?.length) return text('No customers found.');
    const lines = data.data.map((c: any) => `• ${c.id} — ${c.name ?? '(no name)'} (${c.email})`);
    return text(`Customers (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 13. update_customer
  server.tool('update_customer', 'Update a Paddle customer', {
    customer_id: z.string().describe('Customer ID'),
    name: z.string().optional().describe('Customer name'),
    email: z.string().optional().describe('Customer email'),
    locale: z.string().optional().describe('Locale'),
    status: z.enum(['active', 'archived']).optional().describe('Customer status'),
    custom_data: z.record(z.string()).optional().describe('Custom data'),
  }, async ({ customer_id, ...rest }) => {
    const data = await call('PATCH', `/paddle/customers/${customer_id}`, rest) as any;
    return text(`Updated customer ${data.data.id}`);
  });

  // 14. list_credit_balances
  server.tool('list_credit_balances', 'List credit balances for a customer', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `/paddle/customers/${customer_id}/credit-balances`);
    return json(data);
  });

  // ── Addresses ──────────────────────────────────────────────────────

  // 15. create_address
  server.tool('create_address', 'Create an address for a customer', {
    customer_id: z.string().describe('Customer ID'),
    country_code: z.string().describe('ISO 3166-1 alpha-2 country code'),
    description: z.string().optional().describe('Address description'),
    first_line: z.string().optional().describe('First line'),
    second_line: z.string().optional().describe('Second line'),
    city: z.string().optional().describe('City'),
    postal_code: z.string().optional().describe('Postal code'),
    region: z.string().optional().describe('Region/state'),
  }, async ({ customer_id, ...rest }) => {
    const data = await call('POST', `/paddle/customers/${customer_id}/addresses`, rest) as any;
    return text(`Created address ${data.data.id} for customer ${customer_id}`);
  });

  // 16. list_addresses
  server.tool('list_addresses', 'List addresses for a customer', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `/paddle/customers/${customer_id}/addresses`) as any;
    if (!data.data?.length) return text('No addresses found.');
    const lines = data.data.map((a: any) => `• ${a.id} — ${a.country_code} ${a.city ?? ''}`);
    return text(`Addresses (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 17. get_address
  server.tool('get_address', 'Get an address by ID', {
    customer_id: z.string().describe('Customer ID'),
    address_id: z.string().describe('Address ID'),
  }, async ({ customer_id, address_id }) => {
    const data = await call('GET', `/paddle/customers/${customer_id}/addresses/${address_id}`);
    return json(data);
  });

  // 18. update_address
  server.tool('update_address', 'Update an address', {
    customer_id: z.string().describe('Customer ID'),
    address_id: z.string().describe('Address ID'),
    description: z.string().optional().describe('Description'),
    first_line: z.string().optional().describe('First line'),
    city: z.string().optional().describe('City'),
    postal_code: z.string().optional().describe('Postal code'),
    region: z.string().optional().describe('Region/state'),
    country_code: z.string().optional().describe('Country code'),
  }, async ({ customer_id, address_id, ...rest }) => {
    const data = await call('PATCH', `/paddle/customers/${customer_id}/addresses/${address_id}`, rest) as any;
    return text(`Updated address ${data.data.id}`);
  });

  // ── Businesses ─────────────────────────────────────────────────────

  // 19. create_business
  server.tool('create_business', 'Create a business for a customer', {
    customer_id: z.string().describe('Customer ID'),
    name: z.string().describe('Business name'),
    company_number: z.string().optional().describe('Company number'),
    tax_identifier: z.string().optional().describe('Tax identifier'),
    contacts: z.array(z.object({
      name: z.string(),
      email: z.string(),
    })).optional().describe('Business contacts'),
  }, async ({ customer_id, ...rest }) => {
    const data = await call('POST', `/paddle/customers/${customer_id}/businesses`, rest) as any;
    return text(`Created business ${data.data.id}: ${data.data.name}`);
  });

  // 20. list_businesses
  server.tool('list_businesses', 'List businesses for a customer', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `/paddle/customers/${customer_id}/businesses`) as any;
    if (!data.data?.length) return text('No businesses found.');
    const lines = data.data.map((b: any) => `• ${b.id} — ${b.name}`);
    return text(`Businesses (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 21. get_business
  server.tool('get_business', 'Get a business by ID', {
    customer_id: z.string().describe('Customer ID'),
    business_id: z.string().describe('Business ID'),
  }, async ({ customer_id, business_id }) => {
    const data = await call('GET', `/paddle/customers/${customer_id}/businesses/${business_id}`);
    return json(data);
  });

  // 22. update_business
  server.tool('update_business', 'Update a business', {
    customer_id: z.string().describe('Customer ID'),
    business_id: z.string().describe('Business ID'),
    name: z.string().optional().describe('Business name'),
    company_number: z.string().optional().describe('Company number'),
    tax_identifier: z.string().optional().describe('Tax identifier'),
  }, async ({ customer_id, business_id, ...rest }) => {
    const data = await call('PATCH', `/paddle/customers/${customer_id}/businesses/${business_id}`, rest) as any;
    return text(`Updated business ${data.data.id}`);
  });

  // ── Subscriptions ──────────────────────────────────────────────────

  // 23. get_subscription
  server.tool('get_subscription', 'Get a Paddle subscription by ID', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('GET', `/paddle/subscriptions/${subscription_id}`);
    return json(data);
  });

  // 24. list_subscriptions
  server.tool('list_subscriptions', 'List Paddle subscriptions', {
    customer_id: z.string().optional().describe('Filter by customer'),
    status: z.enum(['active', 'canceled', 'past_due', 'paused', 'trialing']).optional().describe('Filter by status'),
  }, async ({ customer_id, status }) => {
    const data = await call('GET', `/paddle/subscriptions${qs({ customer_id, status })}`) as any;
    if (!data.data?.length) return text('No subscriptions found.');
    const lines = data.data.map((s: any) => `• ${s.id} — customer ${s.customer_id} [${s.status}]`);
    return text(`Subscriptions (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 25. update_subscription
  server.tool('update_subscription', 'Update a Paddle subscription (change plan, quantity, etc.)', {
    subscription_id: z.string().describe('Subscription ID'),
    items: z.array(z.object({
      price_id: z.string(),
      quantity: z.number().int().positive(),
    })).optional().describe('Updated items'),
    proration_billing_mode: z.string().optional().describe('Proration mode'),
    custom_data: z.record(z.string()).optional().describe('Custom data'),
  }, async ({ subscription_id, ...rest }) => {
    const data = await call('PATCH', `/paddle/subscriptions/${subscription_id}`, rest) as any;
    return text(`Updated subscription ${data.data.id}`);
  });

  // 26. pause_subscription
  server.tool('pause_subscription', 'Pause a Paddle subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    effective_from: z.enum(['immediately', 'next_billing_period']).optional().describe('When to pause'),
  }, async ({ subscription_id, ...rest }) => {
    const data = await call('POST', `/paddle/subscriptions/${subscription_id}/pause`, rest) as any;
    return text(`Paused subscription ${data.data.id}`);
  });

  // 27. resume_subscription
  server.tool('resume_subscription', 'Resume a paused Paddle subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    effective_from: z.enum(['immediately', 'next_billing_period']).optional().describe('When to resume'),
  }, async ({ subscription_id, ...rest }) => {
    const data = await call('POST', `/paddle/subscriptions/${subscription_id}/resume`, rest) as any;
    return text(`Resumed subscription ${data.data.id}`);
  });

  // 28. cancel_subscription
  server.tool('cancel_subscription', 'Cancel a Paddle subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    effective_from: z.enum(['immediately', 'next_billing_period']).optional().describe('When to cancel'),
  }, async ({ subscription_id, ...rest }) => {
    const data = await call('POST', `/paddle/subscriptions/${subscription_id}/cancel`, rest) as any;
    return text(`Cancelled subscription ${data.data.id}`);
  });

  // 29. activate_subscription
  server.tool('activate_subscription', 'Activate a trialing Paddle subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('POST', `/paddle/subscriptions/${subscription_id}/activate`) as any;
    return text(`Activated subscription ${data.data.id}`);
  });

  // 30. preview_subscription_update
  server.tool('preview_subscription_update', 'Preview a subscription payment method update', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('GET', `/paddle/subscriptions/${subscription_id}/update-payment-method-transaction`);
    return json(data);
  });

  // 31. create_subscription_charge
  server.tool('create_subscription_charge', 'Create a one-time charge on a subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    items: z.array(z.object({
      price_id: z.string(),
      quantity: z.number().int().positive(),
    })).describe('Items to charge'),
    effective_from: z.enum(['immediately', 'next_billing_period']).optional().describe('When to charge'),
  }, async ({ subscription_id, ...rest }) => {
    const data = await call('POST', `/paddle/subscriptions/${subscription_id}/charge`, rest) as any;
    return text(`Created charge transaction ${data.data.id} on subscription ${subscription_id}`);
  });

  // 32. preview_subscription_charge
  server.tool('preview_subscription_charge', 'Preview a one-time charge on a subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    items: z.array(z.object({
      price_id: z.string(),
      quantity: z.number().int().positive(),
    })).describe('Items to preview'),
  }, async ({ subscription_id, ...rest }) => {
    const data = await call('POST', `/paddle/subscriptions/${subscription_id}/charge/preview`, rest);
    return json(data);
  });

  // ── Transactions ───────────────────────────────────────────────────

  // 33. create_transaction
  server.tool('create_transaction', 'Create a new Paddle transaction', {
    items: z.array(z.object({
      price_id: z.string(),
      quantity: z.number().int().positive(),
    })).describe('Transaction items'),
    customer_id: z.string().optional().describe('Customer ID'),
    address_id: z.string().optional().describe('Address ID'),
    business_id: z.string().optional().describe('Business ID'),
    currency_code: z.string().optional().describe('Currency code'),
    discount_id: z.string().optional().describe('Discount ID'),
    custom_data: z.record(z.string()).optional().describe('Custom data'),
  }, async (params) => {
    const data = await call('POST', '/paddle/transactions', params) as any;
    return text(`Created transaction ${data.data.id} [${data.data.status}]`);
  });

  // 34. get_transaction
  server.tool('get_transaction', 'Get a Paddle transaction by ID', {
    transaction_id: z.string().describe('Transaction ID'),
  }, async ({ transaction_id }) => {
    const data = await call('GET', `/paddle/transactions/${transaction_id}`);
    return json(data);
  });

  // 35. list_transactions
  server.tool('list_transactions', 'List Paddle transactions', {
    customer_id: z.string().optional().describe('Filter by customer'),
    subscription_id: z.string().optional().describe('Filter by subscription'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ customer_id, subscription_id, status }) => {
    const data = await call('GET', `/paddle/transactions${qs({ customer_id, subscription_id, status })}`) as any;
    if (!data.data?.length) return text('No transactions found.');
    const lines = data.data.map((t: any) => `• ${t.id} — [${t.status}] ${t.currency_code ?? ''}`);
    return text(`Transactions (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 36. update_transaction
  server.tool('update_transaction', 'Update a Paddle transaction', {
    transaction_id: z.string().describe('Transaction ID'),
    items: z.array(z.object({
      price_id: z.string(),
      quantity: z.number().int().positive(),
    })).optional().describe('Updated items'),
    custom_data: z.record(z.string()).optional().describe('Custom data'),
  }, async ({ transaction_id, ...rest }) => {
    const data = await call('PATCH', `/paddle/transactions/${transaction_id}`, rest) as any;
    return text(`Updated transaction ${data.data.id}`);
  });

  // 37. preview_transaction_create
  server.tool('preview_transaction_create', 'Preview a transaction before creating it', {
    items: z.array(z.object({
      price_id: z.string(),
      quantity: z.number().int().positive(),
    })).describe('Items to preview'),
    customer_id: z.string().optional().describe('Customer ID'),
    address_id: z.string().optional().describe('Address ID'),
    currency_code: z.string().optional().describe('Currency code'),
    discount_id: z.string().optional().describe('Discount ID'),
  }, async (params) => {
    const data = await call('POST', '/paddle/transactions/preview', params);
    return json(data);
  });

  // 38. revise_transaction
  server.tool('revise_transaction', 'Revise customer information on a transaction', {
    transaction_id: z.string().describe('Transaction ID'),
    customer_id: z.string().optional().describe('Customer ID'),
    address_id: z.string().optional().describe('Address ID'),
    business_id: z.string().optional().describe('Business ID'),
  }, async ({ transaction_id, ...rest }) => {
    const data = await call('POST', `/paddle/transactions/${transaction_id}/revise`, rest) as any;
    return text(`Revised transaction ${data.data.id}`);
  });

  // 39. get_transaction_invoice
  server.tool('get_transaction_invoice', 'Get invoice PDF URL for a transaction', {
    transaction_id: z.string().describe('Transaction ID'),
  }, async ({ transaction_id }) => {
    const data = await call('GET', `/paddle/transactions/${transaction_id}/invoice`) as any;
    return text(`Invoice URL: ${data.data.url}`);
  });

  // ── Adjustments ────────────────────────────────────────────────────

  // 40. create_adjustment
  server.tool('create_adjustment', 'Create an adjustment (refund/credit) for a transaction', {
    transaction_id: z.string().describe('Transaction to adjust'),
    action: z.enum(['refund', 'credit', 'chargeback']).describe('Adjustment action'),
    reason: z.string().describe('Reason for adjustment'),
    items: z.array(z.object({
      item_id: z.string(),
      type: z.enum(['full', 'partial']),
      amount: z.string().optional(),
    })).describe('Items to adjust'),
  }, async (params) => {
    const data = await call('POST', '/paddle/adjustments', params) as any;
    return text(`Created adjustment ${data.data.id} [${data.data.action}]`);
  });

  // 41. list_adjustments
  server.tool('list_adjustments', 'List adjustments', {
    transaction_id: z.string().optional().describe('Filter by transaction'),
    subscription_id: z.string().optional().describe('Filter by subscription'),
  }, async ({ transaction_id, subscription_id }) => {
    const data = await call('GET', `/paddle/adjustments${qs({ transaction_id, subscription_id })}`) as any;
    if (!data.data?.length) return text('No adjustments found.');
    const lines = data.data.map((a: any) => `• ${a.id} — ${a.action} [${a.status}]`);
    return text(`Adjustments (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 42. get_adjustment_credit_note
  server.tool('get_adjustment_credit_note', 'Get credit note PDF for an adjustment', {
    adjustment_id: z.string().describe('Adjustment ID'),
  }, async ({ adjustment_id }) => {
    const data = await call('GET', `/paddle/adjustments/${adjustment_id}/credit-note`) as any;
    return text(`Credit note URL: ${data.data.url}`);
  });

  // ── Discounts ──────────────────────────────────────────────────────

  // 43. create_discount
  server.tool('create_discount', 'Create a Paddle discount', {
    description: z.string().describe('Discount description'),
    type: z.enum(['percentage', 'flat', 'flat_per_seat']).describe('Discount type'),
    amount: z.string().describe('Discount amount'),
    enabled_for_checkout: z.boolean().optional().describe('Available at checkout'),
    code: z.string().optional().describe('Discount code'),
    currency_code: z.string().optional().describe('Currency (for flat discounts)'),
    recur: z.boolean().optional().describe('Apply to recurring payments'),
    maximum_recurring_intervals: z.number().int().optional().describe('Max recurring intervals'),
    usage_limit: z.number().int().optional().describe('Max uses'),
    restrict_to: z.array(z.string()).optional().describe('Restrict to price IDs'),
    expires_at: z.string().optional().describe('Expiry datetime'),
  }, async (params) => {
    const data = await call('POST', '/paddle/discounts', params) as any;
    return text(`Created discount ${data.data.id}: ${data.data.description}`);
  });

  // 44. list_discounts
  server.tool('list_discounts', 'List Paddle discounts', {
    status: z.enum(['active', 'archived', 'expired', 'used']).optional().describe('Filter by status'),
    code: z.string().optional().describe('Filter by code'),
  }, async ({ status, code }) => {
    const data = await call('GET', `/paddle/discounts${qs({ status, code })}`) as any;
    if (!data.data?.length) return text('No discounts found.');
    const lines = data.data.map((d: any) => `• ${d.id} — ${d.description} (${d.type}: ${d.amount})`);
    return text(`Discounts (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 45. get_discount
  server.tool('get_discount', 'Get a Paddle discount by ID', {
    discount_id: z.string().describe('Discount ID'),
  }, async ({ discount_id }) => {
    const data = await call('GET', `/paddle/discounts/${discount_id}`);
    return json(data);
  });

  // 46. update_discount
  server.tool('update_discount', 'Update a Paddle discount', {
    discount_id: z.string().describe('Discount ID'),
    description: z.string().optional().describe('Description'),
    status: z.enum(['active', 'archived']).optional().describe('Status'),
    enabled_for_checkout: z.boolean().optional().describe('Available at checkout'),
    code: z.string().optional().describe('Discount code'),
    usage_limit: z.number().int().optional().describe('Max uses'),
    expires_at: z.string().optional().describe('Expiry datetime'),
  }, async ({ discount_id, ...rest }) => {
    const data = await call('PATCH', `/paddle/discounts/${discount_id}`, rest) as any;
    return text(`Updated discount ${data.data.id}`);
  });

  // ── Discount Groups ────────────────────────────────────────────────

  // 47. create_discount_group
  server.tool('create_discount_group', 'Create a discount group', {
    name: z.string().describe('Group name'),
    description: z.string().optional().describe('Group description'),
    discount_ids: z.array(z.string()).describe('Discount IDs in this group'),
  }, async (params) => {
    const data = await call('POST', '/paddle/discount-groups', params) as any;
    return text(`Created discount group ${data.data.id}: ${data.data.name}`);
  });

  // 48. list_discount_groups
  server.tool('list_discount_groups', 'List discount groups', {}, async () => {
    const data = await call('GET', '/paddle/discount-groups') as any;
    if (!data.data?.length) return text('No discount groups found.');
    const lines = data.data.map((g: any) => `• ${g.id} — ${g.name} [${g.status}]`);
    return text(`Discount groups (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 49. get_discount_group
  server.tool('get_discount_group', 'Get a discount group by ID', {
    discount_group_id: z.string().describe('Discount group ID'),
  }, async ({ discount_group_id }) => {
    const data = await call('GET', `/paddle/discount-groups/${discount_group_id}`);
    return json(data);
  });

  // 50. update_discount_group
  server.tool('update_discount_group', 'Update a discount group', {
    discount_group_id: z.string().describe('Discount group ID'),
    name: z.string().optional().describe('Group name'),
    description: z.string().optional().describe('Group description'),
    discount_ids: z.array(z.string()).optional().describe('Discount IDs'),
  }, async ({ discount_group_id, ...rest }) => {
    const data = await call('PATCH', `/paddle/discount-groups/${discount_group_id}`, rest) as any;
    return text(`Updated discount group ${data.data.id}`);
  });

  // 51. archive_discount_group
  server.tool('archive_discount_group', 'Archive a discount group', {
    discount_group_id: z.string().describe('Discount group ID'),
  }, async ({ discount_group_id }) => {
    const data = await call('POST', `/paddle/discount-groups/${discount_group_id}/archive`) as any;
    return text(`Archived discount group ${data.data.id}`);
  });

  // ── Payment Methods ────────────────────────────────────────────────

  // 52. list_saved_payment_methods
  server.tool('list_saved_payment_methods', 'List saved payment methods for a customer', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `/paddle/customers/${customer_id}/payment-methods`) as any;
    if (!data.data?.length) return text('No payment methods found.');
    const lines = data.data.map((m: any) => `• ${m.id} — ${m.type ?? 'card'}`);
    return text(`Payment methods (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 53. get_saved_payment_method
  server.tool('get_saved_payment_method', 'Get a saved payment method by ID', {
    customer_id: z.string().describe('Customer ID'),
    payment_method_id: z.string().describe('Payment method ID'),
  }, async ({ customer_id, payment_method_id }) => {
    const data = await call('GET', `/paddle/customers/${customer_id}/payment-methods/${payment_method_id}`);
    return json(data);
  });

  // 54. delete_saved_payment_method
  server.tool('delete_saved_payment_method', 'Delete a saved payment method', {
    customer_id: z.string().describe('Customer ID'),
    payment_method_id: z.string().describe('Payment method ID'),
  }, async ({ customer_id, payment_method_id }) => {
    await call('DELETE', `/paddle/customers/${customer_id}/payment-methods/${payment_method_id}`);
    return text(`Deleted payment method ${payment_method_id}`);
  });

  // ── Customer Portal ────────────────────────────────────────────────

  // 55. create_customer_portal_session
  server.tool('create_customer_portal_session', 'Create a customer portal session', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('POST', `/paddle/customers/${customer_id}/portal-sessions`) as any;
    return text(`Created portal session ${data.data.id}`);
  });

  // ── Notifications ──────────────────────────────────────────────────

  // 56. list_notifications
  server.tool('list_notifications', 'List Paddle notifications', {
    status: z.string().optional().describe('Filter by status'),
  }, async ({ status }) => {
    const data = await call('GET', `/paddle/notifications${qs({ status })}`) as any;
    if (!data.data?.length) return text('No notifications found.');
    const lines = data.data.map((n: any) => `• ${n.id} — [${n.status}]`);
    return text(`Notifications (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 57. get_notification
  server.tool('get_notification', 'Get a Paddle notification by ID', {
    notification_id: z.string().describe('Notification ID'),
  }, async ({ notification_id }) => {
    const data = await call('GET', `/paddle/notifications/${notification_id}`);
    return json(data);
  });

  // 58. list_notification_logs
  server.tool('list_notification_logs', 'List delivery logs for a notification', {
    notification_id: z.string().describe('Notification ID'),
  }, async ({ notification_id }) => {
    const data = await call('GET', `/paddle/notifications/${notification_id}/logs`);
    return json(data);
  });

  // 59. replay_notification
  server.tool('replay_notification', 'Replay a notification', {
    notification_id: z.string().describe('Notification ID'),
  }, async ({ notification_id }) => {
    const data = await call('POST', `/paddle/notifications/${notification_id}/replay`) as any;
    return text(`Replayed notification ${data.data.id}`);
  });

  // ── Notification Settings ──────────────────────────────────────────

  // 60. create_notification_setting
  server.tool('create_notification_setting', 'Create a notification setting (webhook destination)', {
    description: z.string().describe('Description'),
    destination: z.string().describe('Webhook URL'),
    type: z.enum(['url', 'email']).optional().describe('Destination type'),
    subscribed_events: z.array(z.string()).describe('Event types to subscribe to'),
    api_version: z.number().int().optional().describe('API version'),
    include_sensitive_fields: z.boolean().optional().describe('Include sensitive fields'),
  }, async (params) => {
    const data = await call('POST', '/paddle/notification-settings', params) as any;
    return text(`Created notification setting ${data.data.id}`);
  });

  // 61. list_notification_settings
  server.tool('list_notification_settings', 'List notification settings', {}, async () => {
    const data = await call('GET', '/paddle/notification-settings') as any;
    if (!data.data?.length) return text('No notification settings found.');
    const lines = data.data.map((s: any) => `• ${s.id} — ${s.destination} (${s.type})`);
    return text(`Notification settings (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 62. get_notification_setting
  server.tool('get_notification_setting', 'Get a notification setting by ID', {
    notification_setting_id: z.string().describe('Notification setting ID'),
  }, async ({ notification_setting_id }) => {
    const data = await call('GET', `/paddle/notification-settings/${notification_setting_id}`);
    return json(data);
  });

  // 63. update_notification_setting
  server.tool('update_notification_setting', 'Update a notification setting', {
    notification_setting_id: z.string().describe('Notification setting ID'),
    description: z.string().optional().describe('Description'),
    destination: z.string().optional().describe('Webhook URL'),
    subscribed_events: z.array(z.string()).optional().describe('Event types'),
    active: z.boolean().optional().describe('Whether setting is active'),
  }, async ({ notification_setting_id, ...rest }) => {
    const data = await call('PATCH', `/paddle/notification-settings/${notification_setting_id}`, rest) as any;
    return text(`Updated notification setting ${data.data.id}`);
  });

  // 64. delete_notification_setting
  server.tool('delete_notification_setting', 'Delete a notification setting', {
    notification_setting_id: z.string().describe('Notification setting ID'),
  }, async ({ notification_setting_id }) => {
    await call('DELETE', `/paddle/notification-settings/${notification_setting_id}`);
    return text(`Deleted notification setting ${notification_setting_id}`);
  });

  // ── Events ─────────────────────────────────────────────────────────

  // 65. list_events
  server.tool('list_events', 'List Paddle events', {}, async () => {
    const data = await call('GET', '/paddle/events') as any;
    if (!data.data?.length) return text('No events found.');
    const lines = data.data.map((e: any) => `• ${e.id} — ${e.event_type ?? 'unknown'}`);
    return text(`Events (${data.data.length}):\n${lines.join('\n')}`);
  });

  // ── Simulations ────────────────────────────────────────────────────

  // 66. create_simulation
  server.tool('create_simulation', 'Create a webhook simulation', {
    name: z.string().describe('Simulation name'),
    notification_setting_id: z.string().describe('Notification setting ID'),
    type: z.enum(['single', 'scenario']).optional().describe('Simulation type'),
    scenario_type: z.string().optional().describe('Scenario type'),
    payload: z.record(z.unknown()).optional().describe('Custom payload'),
  }, async (params) => {
    const data = await call('POST', '/paddle/simulations', params) as any;
    return text(`Created simulation ${data.data.id}: ${data.data.name}`);
  });

  // 67. list_simulations
  server.tool('list_simulations', 'List simulations', {}, async () => {
    const data = await call('GET', '/paddle/simulations') as any;
    if (!data.data?.length) return text('No simulations found.');
    const lines = data.data.map((s: any) => `• ${s.id} — ${s.name} [${s.status}]`);
    return text(`Simulations (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 68. get_simulation
  server.tool('get_simulation', 'Get a simulation by ID', {
    simulation_id: z.string().describe('Simulation ID'),
  }, async ({ simulation_id }) => {
    const data = await call('GET', `/paddle/simulations/${simulation_id}`);
    return json(data);
  });

  // 69. update_simulation
  server.tool('update_simulation', 'Update a simulation', {
    simulation_id: z.string().describe('Simulation ID'),
    name: z.string().optional().describe('Simulation name'),
    notification_setting_id: z.string().optional().describe('Notification setting ID'),
    payload: z.record(z.unknown()).optional().describe('Custom payload'),
  }, async ({ simulation_id, ...rest }) => {
    const data = await call('PATCH', `/paddle/simulations/${simulation_id}`, rest) as any;
    return text(`Updated simulation ${data.data.id}`);
  });

  // 70. create_simulation_run
  server.tool('create_simulation_run', 'Run a simulation', {
    simulation_id: z.string().describe('Simulation ID'),
  }, async ({ simulation_id }) => {
    const data = await call('POST', `/paddle/simulations/${simulation_id}/runs`) as any;
    return text(`Created simulation run ${data.data.id}`);
  });

  // 71. list_simulation_runs
  server.tool('list_simulation_runs', 'List runs for a simulation', {
    simulation_id: z.string().describe('Simulation ID'),
  }, async ({ simulation_id }) => {
    const data = await call('GET', `/paddle/simulations/${simulation_id}/runs`) as any;
    if (!data.data?.length) return text('No simulation runs found.');
    const lines = data.data.map((r: any) => `• ${r.id} — [${r.status}]`);
    return text(`Simulation runs (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 72. get_simulation_run
  server.tool('get_simulation_run', 'Get a simulation run by ID', {
    simulation_id: z.string().describe('Simulation ID'),
    run_id: z.string().describe('Run ID'),
  }, async ({ simulation_id, run_id }) => {
    const data = await call('GET', `/paddle/simulations/${simulation_id}/runs/${run_id}`);
    return json(data);
  });

  // 73. list_simulation_run_events
  server.tool('list_simulation_run_events', 'List events for a simulation run', {
    simulation_id: z.string().describe('Simulation ID'),
    run_id: z.string().describe('Run ID'),
  }, async ({ simulation_id, run_id }) => {
    const data = await call('GET', `/paddle/simulations/${simulation_id}/runs/${run_id}/events`) as any;
    if (!data.data?.length) return text('No simulation run events found.');
    const lines = data.data.map((e: any) => `• ${e.id}`);
    return text(`Simulation run events (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 74. get_simulation_run_event
  server.tool('get_simulation_run_event', 'Get a simulation run event by ID', {
    simulation_id: z.string().describe('Simulation ID'),
    run_id: z.string().describe('Run ID'),
    event_id: z.string().describe('Event ID'),
  }, async ({ simulation_id, run_id, event_id }) => {
    const data = await call('GET', `/paddle/simulations/${simulation_id}/runs/${run_id}/events/${event_id}`);
    return json(data);
  });

  // 75. replay_simulation_run_event
  server.tool('replay_simulation_run_event', 'Replay a simulation run event', {
    simulation_id: z.string().describe('Simulation ID'),
    run_id: z.string().describe('Run ID'),
    event_id: z.string().describe('Event ID'),
  }, async ({ simulation_id, run_id, event_id }) => {
    const data = await call('POST', `/paddle/simulations/${simulation_id}/runs/${run_id}/events/${event_id}/replay`) as any;
    return text(`Replayed simulation run event ${data.data.id ?? event_id}`);
  });

  // ── Reports ────────────────────────────────────────────────────────

  // 76. create_report
  server.tool('create_report', 'Create a financial report', {
    type: z.enum(['transactions', 'discounts', 'product_prices']).describe('Report type'),
    filters: z.array(z.object({
      name: z.string(),
      operator: z.string().optional(),
      value: z.union([z.string(), z.array(z.string())]),
    })).optional().describe('Report filters'),
  }, async (params) => {
    const data = await call('POST', '/paddle/reports', params) as any;
    return text(`Created report ${data.data.id} [${data.data.type}]`);
  });

  // 77. list_reports
  server.tool('list_reports', 'List reports', {}, async () => {
    const data = await call('GET', '/paddle/reports') as any;
    if (!data.data?.length) return text('No reports found.');
    const lines = data.data.map((r: any) => `• ${r.id} — ${r.type} [${r.status}]`);
    return text(`Reports (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 78. get_report
  server.tool('get_report', 'Get a report by ID', {
    report_id: z.string().describe('Report ID'),
  }, async ({ report_id }) => {
    const data = await call('GET', `/paddle/reports/${report_id}`);
    return json(data);
  });

  // 79. get_report_csv
  server.tool('get_report_csv', 'Get CSV download URL for a report', {
    report_id: z.string().describe('Report ID'),
  }, async ({ report_id }) => {
    const data = await call('GET', `/paddle/reports/${report_id}/csv`) as any;
    return text(`Report CSV URL: ${data.data.url}`);
  });

  // ── Client-Side Tokens ─────────────────────────────────────────────

  // 80. create_client_side_token
  server.tool('create_client_side_token', 'Create a client-side token for Paddle.js', {
    customer_id: z.string().optional().describe('Customer ID'),
    allowed_origins: z.array(z.string()).optional().describe('Allowed origins'),
  }, async (params) => {
    const data = await call('POST', '/paddle/client-side-tokens', params) as any;
    return text(`Created client-side token ${data.data.id}`);
  });

  // 81. list_client_side_tokens
  server.tool('list_client_side_tokens', 'List client-side tokens', {}, async () => {
    const data = await call('GET', '/paddle/client-side-tokens') as any;
    if (!data.data?.length) return text('No client-side tokens found.');
    const lines = data.data.map((t: any) => `• ${t.id} — [${t.status}]`);
    return text(`Client-side tokens (${data.data.length}):\n${lines.join('\n')}`);
  });

  // 82. get_client_side_token
  server.tool('get_client_side_token', 'Get a client-side token by ID', {
    token_id: z.string().describe('Token ID'),
  }, async ({ token_id }) => {
    const data = await call('GET', `/paddle/client-side-tokens/${token_id}`);
    return json(data);
  });

  // 83. revoke_client_side_token
  server.tool('revoke_client_side_token', 'Revoke a client-side token', {
    token_id: z.string().describe('Token ID'),
  }, async ({ token_id }) => {
    const data = await call('POST', `/paddle/client-side-tokens/${token_id}/revoke`) as any;
    return text(`Revoked client-side token ${data.data.id}`);
  });
}

/**
 * Create a standalone Mimic MCP server for Paddle.
 */
export function createPaddleMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: 'mimic-paddle',
    version: '0.5.0',
    description: 'Mimic MCP server for Paddle — payments, subscriptions, billing as merchant of record',
  });
  registerPaddleTools(server, baseUrl);
  return server;
}

/**
 * Start the Paddle MCP server on stdio transport.
 */
export async function startPaddleMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createPaddleMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Paddle MCP server running on stdio');
}
