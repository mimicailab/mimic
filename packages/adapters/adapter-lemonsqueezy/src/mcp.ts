import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeCall(baseUrl: string, method: string, path: string, body?: unknown) {
  const url = `${baseUrl}${path}`;
  const opts: RequestInit = {
    method,
    headers: {
      'content-type': 'application/vnd.api+json',
      accept: 'application/vnd.api+json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.text();
}

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries).toString();
}

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerLemonSqueezyTools(server: McpServer, baseUrl: string) {
  // ── Users ──────────────────────────────────────────────────────────────

  server.tool('get_user', 'Get the authenticated user', {}, async () => {
    return text(await makeCall(baseUrl, 'GET', '/lemonsqueezy/v1/users/me'));
  });

  // ── Stores ─────────────────────────────────────────────────────────────

  server.tool('list_stores', 'List all stores', {}, async () => {
    return text(await makeCall(baseUrl, 'GET', '/lemonsqueezy/v1/stores'));
  });

  server.tool('get_store', 'Get a store by ID', { store_id: z.string().describe('Store ID') }, async ({ store_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/stores/${store_id}`));
  });

  // ── Products ───────────────────────────────────────────────────────────

  server.tool('list_products', 'List all products', {
    store_id: z.string().optional().describe('Filter by store ID'),
  }, async ({ store_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/products${qs({ 'filter[store_id]': store_id })}`));
  });

  server.tool('get_product', 'Get a product by ID', { product_id: z.string().describe('Product ID') }, async ({ product_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/products/${product_id}`));
  });

  // ── Variants ───────────────────────────────────────────────────────────

  server.tool('list_variants', 'List all variants', {
    product_id: z.string().optional().describe('Filter by product ID'),
  }, async ({ product_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/variants${qs({ 'filter[product_id]': product_id })}`));
  });

  server.tool('get_variant', 'Get a variant by ID', { variant_id: z.string().describe('Variant ID') }, async ({ variant_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/variants/${variant_id}`));
  });

  // ── Prices ─────────────────────────────────────────────────────────────

  server.tool('list_prices', 'List all prices', {
    variant_id: z.string().optional().describe('Filter by variant ID'),
  }, async ({ variant_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/prices${qs({ 'filter[variant_id]': variant_id })}`));
  });

  server.tool('get_price', 'Get a price by ID', { price_id: z.string().describe('Price ID') }, async ({ price_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/prices/${price_id}`));
  });

  // ── Customers ──────────────────────────────────────────────────────────

  server.tool('create_customer', 'Create a customer', {
    name: z.string().describe('Customer name'),
    email: z.string().describe('Customer email'),
    store_id: z.string().optional().describe('Store ID'),
  }, async ({ name, email, store_id }) => {
    return text(await makeCall(baseUrl, 'POST', '/lemonsqueezy/v1/customers', {
      data: { type: 'customers', attributes: { name, email, store_id } },
    }));
  });

  server.tool('list_customers', 'List all customers', {
    store_id: z.string().optional().describe('Filter by store ID'),
    email: z.string().optional().describe('Filter by email'),
  }, async ({ store_id, email }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/customers${qs({ 'filter[store_id]': store_id, 'filter[email]': email })}`));
  });

  server.tool('get_customer', 'Get a customer by ID', { customer_id: z.string().describe('Customer ID') }, async ({ customer_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/customers/${customer_id}`));
  });

  server.tool('update_customer', 'Update a customer', {
    customer_id: z.string().describe('Customer ID'),
    name: z.string().optional().describe('Customer name'),
    email: z.string().optional().describe('Customer email'),
    status: z.string().optional().describe('Customer status'),
  }, async ({ customer_id, ...attrs }) => {
    const cleanAttrs = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
    return text(await makeCall(baseUrl, 'PATCH', `/lemonsqueezy/v1/customers/${customer_id}`, {
      data: { type: 'customers', id: customer_id, attributes: cleanAttrs },
    }));
  });

  // ── Orders ─────────────────────────────────────────────────────────────

  server.tool('list_orders', 'List all orders', {
    store_id: z.string().optional().describe('Filter by store ID'),
    user_email: z.string().optional().describe('Filter by user email'),
  }, async ({ store_id, user_email }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/orders${qs({ 'filter[store_id]': store_id, 'filter[user_email]': user_email })}`));
  });

  server.tool('get_order', 'Get an order by ID', { order_id: z.string().describe('Order ID') }, async ({ order_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/orders/${order_id}`));
  });

  // ── Order Items ────────────────────────────────────────────────────────

  server.tool('list_order_items', 'List all order items', {
    order_id: z.string().optional().describe('Filter by order ID'),
  }, async ({ order_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/order-items${qs({ 'filter[order_id]': order_id })}`));
  });

  server.tool('get_order_item', 'Get an order item by ID', { order_item_id: z.string().describe('Order item ID') }, async ({ order_item_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/order-items/${order_item_id}`));
  });

  // ── Subscriptions ──────────────────────────────────────────────────────

  server.tool('list_subscriptions', 'List all subscriptions', {
    store_id: z.string().optional().describe('Filter by store ID'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ store_id, status }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/subscriptions${qs({ 'filter[store_id]': store_id, 'filter[status]': status })}`));
  });

  server.tool('get_subscription', 'Get a subscription by ID', { subscription_id: z.string().describe('Subscription ID') }, async ({ subscription_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/subscriptions/${subscription_id}`));
  });

  server.tool('update_subscription', 'Update a subscription (cancel, pause, resume)', {
    subscription_id: z.string().describe('Subscription ID'),
    cancelled: z.boolean().optional().describe('Set true to cancel'),
    pause: z.boolean().optional().describe('Set true to pause, false to resume'),
  }, async ({ subscription_id, ...attrs }) => {
    const cleanAttrs = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
    return text(await makeCall(baseUrl, 'PATCH', `/lemonsqueezy/v1/subscriptions/${subscription_id}`, {
      data: { type: 'subscriptions', id: subscription_id, attributes: cleanAttrs },
    }));
  });

  // ── Subscription Items ─────────────────────────────────────────────────

  server.tool('list_subscription_items', 'List subscription items', {
    subscription_id: z.string().optional().describe('Filter by subscription ID'),
  }, async ({ subscription_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/subscription-items${qs({ 'filter[subscription_id]': subscription_id })}`));
  });

  server.tool('get_subscription_item', 'Get a subscription item by ID', {
    subscription_item_id: z.string().describe('Subscription item ID'),
  }, async ({ subscription_item_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/subscription-items/${subscription_item_id}`));
  });

  server.tool('update_subscription_item', 'Update a subscription item', {
    subscription_item_id: z.string().describe('Subscription item ID'),
    quantity: z.number().optional().describe('New quantity'),
  }, async ({ subscription_item_id, ...attrs }) => {
    const cleanAttrs = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
    return text(await makeCall(baseUrl, 'PATCH', `/lemonsqueezy/v1/subscription-items/${subscription_item_id}`, {
      data: { type: 'subscription-items', id: subscription_item_id, attributes: cleanAttrs },
    }));
  });

  server.tool('get_subscription_item_usage', 'Get current usage for a subscription item', {
    subscription_item_id: z.string().describe('Subscription item ID'),
  }, async ({ subscription_item_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/subscription-items/${subscription_item_id}/current-usage`));
  });

  // ── Subscription Invoices ──────────────────────────────────────────────

  server.tool('list_subscription_invoices', 'List subscription invoices', {
    subscription_id: z.string().optional().describe('Filter by subscription ID'),
  }, async ({ subscription_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/subscription-invoices${qs({ 'filter[subscription_id]': subscription_id })}`));
  });

  server.tool('get_subscription_invoice', 'Get a subscription invoice by ID', {
    subscription_invoice_id: z.string().describe('Subscription invoice ID'),
  }, async ({ subscription_invoice_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/subscription-invoices/${subscription_invoice_id}`));
  });

  // ── Usage Records ──────────────────────────────────────────────────────

  server.tool('create_usage_record', 'Create a usage record', {
    subscription_item_id: z.string().describe('Subscription item ID'),
    quantity: z.number().describe('Usage quantity'),
    action: z.enum(['increment', 'set']).optional().describe('Action type'),
  }, async ({ subscription_item_id, quantity, action }) => {
    return text(await makeCall(baseUrl, 'POST', '/lemonsqueezy/v1/usage-records', {
      data: { type: 'usage-records', attributes: { subscription_item_id, quantity, action } },
    }));
  });

  server.tool('list_usage_records', 'List usage records', {
    subscription_item_id: z.string().optional().describe('Filter by subscription item ID'),
  }, async ({ subscription_item_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/usage-records${qs({ 'filter[subscription_item_id]': subscription_item_id })}`));
  });

  server.tool('get_usage_record', 'Get a usage record by ID', {
    usage_record_id: z.string().describe('Usage record ID'),
  }, async ({ usage_record_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/usage-records/${usage_record_id}`));
  });

  // ── Discounts ──────────────────────────────────────────────────────────

  server.tool('create_discount', 'Create a discount', {
    name: z.string().describe('Discount name'),
    code: z.string().describe('Discount code'),
    amount: z.number().describe('Discount amount'),
    amount_type: z.enum(['percent', 'fixed']).optional().describe('Amount type'),
    store_id: z.string().optional().describe('Store ID'),
  }, async ({ name, code, amount, amount_type, store_id }) => {
    return text(await makeCall(baseUrl, 'POST', '/lemonsqueezy/v1/discounts', {
      data: { type: 'discounts', attributes: { name, code, amount, amount_type, store_id } },
    }));
  });

  server.tool('list_discounts', 'List all discounts', {
    store_id: z.string().optional().describe('Filter by store ID'),
  }, async ({ store_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/discounts${qs({ 'filter[store_id]': store_id })}`));
  });

  server.tool('get_discount', 'Get a discount by ID', { discount_id: z.string().describe('Discount ID') }, async ({ discount_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/discounts/${discount_id}`));
  });

  server.tool('delete_discount', 'Delete a discount', { discount_id: z.string().describe('Discount ID') }, async ({ discount_id }) => {
    return text(await makeCall(baseUrl, 'DELETE', `/lemonsqueezy/v1/discounts/${discount_id}`));
  });

  // ── Discount Redemptions ───────────────────────────────────────────────

  server.tool('list_discount_redemptions', 'List discount redemptions', {
    discount_id: z.string().optional().describe('Filter by discount ID'),
  }, async ({ discount_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/discount-redemptions${qs({ 'filter[discount_id]': discount_id })}`));
  });

  server.tool('get_discount_redemption', 'Get a discount redemption by ID', {
    discount_redemption_id: z.string().describe('Discount redemption ID'),
  }, async ({ discount_redemption_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/discount-redemptions/${discount_redemption_id}`));
  });

  // ── License Keys ───────────────────────────────────────────────────────

  server.tool('list_license_keys', 'List license keys', {
    store_id: z.string().optional().describe('Filter by store ID'),
    order_id: z.string().optional().describe('Filter by order ID'),
  }, async ({ store_id, order_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/license-keys${qs({ 'filter[store_id]': store_id, 'filter[order_id]': order_id })}`));
  });

  server.tool('get_license_key', 'Get a license key by ID', {
    license_key_id: z.string().describe('License key ID'),
  }, async ({ license_key_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/license-keys/${license_key_id}`));
  });

  server.tool('update_license_key', 'Update a license key', {
    license_key_id: z.string().describe('License key ID'),
    activation_limit: z.number().optional().describe('Activation limit'),
    disabled: z.boolean().optional().describe('Whether key is disabled'),
  }, async ({ license_key_id, ...attrs }) => {
    const cleanAttrs = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
    return text(await makeCall(baseUrl, 'PATCH', `/lemonsqueezy/v1/license-keys/${license_key_id}`, {
      data: { type: 'license-keys', id: license_key_id, attributes: cleanAttrs },
    }));
  });

  // ── License Key Instances ──────────────────────────────────────────────

  server.tool('list_license_key_instances', 'List license key instances', {
    license_key_id: z.string().optional().describe('Filter by license key ID'),
  }, async ({ license_key_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/license-key-instances${qs({ 'filter[license_key_id]': license_key_id })}`));
  });

  server.tool('get_license_key_instance', 'Get a license key instance by ID', {
    license_key_instance_id: z.string().describe('License key instance ID'),
  }, async ({ license_key_instance_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/license-key-instances/${license_key_instance_id}`));
  });

  // ── Checkouts ──────────────────────────────────────────────────────────

  server.tool('create_checkout', 'Create a checkout', {
    store_id: z.string().describe('Store ID'),
    variant_id: z.string().describe('Variant ID'),
    custom_price: z.number().optional().describe('Custom price in cents'),
  }, async ({ store_id, variant_id, custom_price }) => {
    return text(await makeCall(baseUrl, 'POST', '/lemonsqueezy/v1/checkouts', {
      data: {
        type: 'checkouts',
        attributes: { custom_price },
        relationships: {
          store: { data: { type: 'stores', id: store_id } },
          variant: { data: { type: 'variants', id: variant_id } },
        },
      },
    }));
  });

  server.tool('list_checkouts', 'List all checkouts', {}, async () => {
    return text(await makeCall(baseUrl, 'GET', '/lemonsqueezy/v1/checkouts'));
  });

  server.tool('get_checkout', 'Get a checkout by ID', { checkout_id: z.string().describe('Checkout ID') }, async ({ checkout_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/checkouts/${checkout_id}`));
  });

  // ── Webhooks ───────────────────────────────────────────────────────────

  server.tool('create_webhook', 'Create a webhook', {
    url: z.string().describe('Webhook URL'),
    events: z.array(z.string()).describe('Events to subscribe to'),
    secret: z.string().describe('Webhook signing secret'),
    store_id: z.string().optional().describe('Store ID'),
  }, async ({ url, events, secret, store_id }) => {
    return text(await makeCall(baseUrl, 'POST', '/lemonsqueezy/v1/webhooks', {
      data: { type: 'webhooks', attributes: { url, events, secret, store_id } },
    }));
  });

  server.tool('list_webhooks', 'List all webhooks', {}, async () => {
    return text(await makeCall(baseUrl, 'GET', '/lemonsqueezy/v1/webhooks'));
  });

  server.tool('get_webhook', 'Get a webhook by ID', { webhook_id: z.string().describe('Webhook ID') }, async ({ webhook_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/webhooks/${webhook_id}`));
  });

  server.tool('update_webhook', 'Update a webhook', {
    webhook_id: z.string().describe('Webhook ID'),
    url: z.string().optional().describe('Webhook URL'),
    events: z.array(z.string()).optional().describe('Events to subscribe to'),
  }, async ({ webhook_id, ...attrs }) => {
    const cleanAttrs = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
    return text(await makeCall(baseUrl, 'PATCH', `/lemonsqueezy/v1/webhooks/${webhook_id}`, {
      data: { type: 'webhooks', id: webhook_id, attributes: cleanAttrs },
    }));
  });

  server.tool('delete_webhook', 'Delete a webhook', { webhook_id: z.string().describe('Webhook ID') }, async ({ webhook_id }) => {
    return text(await makeCall(baseUrl, 'DELETE', `/lemonsqueezy/v1/webhooks/${webhook_id}`));
  });

  // ── Files ──────────────────────────────────────────────────────────────

  server.tool('list_files', 'List all files', {
    variant_id: z.string().optional().describe('Filter by variant ID'),
  }, async ({ variant_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/files${qs({ 'filter[variant_id]': variant_id })}`));
  });

  server.tool('get_file', 'Get a file by ID', { file_id: z.string().describe('File ID') }, async ({ file_id }) => {
    return text(await makeCall(baseUrl, 'GET', `/lemonsqueezy/v1/files/${file_id}`));
  });
}

// ---------------------------------------------------------------------------
// MCP Server factory
// ---------------------------------------------------------------------------

export function createLemonSqueezyMcpServer(mockBaseUrl: string) {
  const server = new McpServer({ name: 'mimic-lemonsqueezy', version: '0.4.0' });
  registerLemonSqueezyTools(server, mockBaseUrl);
  return server;
}

export async function startLemonSqueezyMcpServer() {
  const baseUrl = process.env.MIMIC_MOCK_URL ?? 'http://localhost:5555';
  const server = createLemonSqueezyMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
