import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import meta from './adapter-meta.js';

function makeCall(baseUrl: string) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Lemon Squeezy mock error ${res.status}: ${text}`);
    }
    if (res.status === 204) return null;
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

function extractData(response: any): any {
  if (response?.data?.attributes) {
    return { id: response.data.id, ...response.data.attributes };
  }
  return response;
}

function extractListData(response: any): any[] {
  if (response?.data && Array.isArray(response.data)) {
    return response.data.map((item: any) => ({
      id: item.id,
      ...item.attributes,
    }));
  }
  return [];
}

export function registerLemonSqueezyTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);

  // ── Stores ──────────────────────────────────────────────────────────

  server.tool('list_stores', 'List Lemon Squeezy stores', {}, async () => {
    const data = await call('GET', '/v1/stores');
    const items = extractListData(data);
    if (!items.length) return text('No stores found.');
    const lines = items.map((s: any) => `• ${s.id} — ${s.name} (${s.currency})`);
    return text(`Stores (${items.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_store', 'Get a specific store', {
    store_id: z.string().describe('Store ID'),
  }, async ({ store_id }) => {
    const data = await call('GET', `/v1/stores/${store_id}`);
    return text(JSON.stringify(extractData(data), null, 2));
  });

  // ── Customers ───────────────────────────────────────────────────────

  server.tool('create_customer', 'Create a customer', {
    name: z.string().describe('Customer name'),
    email: z.string().describe('Customer email'),
    store_id: z.string().describe('Store ID'),
    city: z.string().optional().describe('City'),
    region: z.string().optional().describe('Region'),
    country: z.string().optional().describe('Country (ISO 3166-1 alpha-2)'),
  }, async ({ name, email, store_id, city, region, country }) => {
    const data = await call('POST', '/v1/customers', {
      data: { type: 'customers', attributes: { name, email, city, region, country }, relationships: { store: { data: { type: 'stores', id: store_id } } } },
    });
    const item = extractData(data);
    return text(`Created customer ${item.id}: ${item.name} (${item.email})`);
  });

  server.tool('list_customers', 'List customers', {
    store_id: z.string().optional().describe('Filter by store ID'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results'),
  }, async ({ store_id, limit }) => {
    const data = await call('GET', `/v1/customers${qs({ 'page[size]': limit ?? 10, store_id })}`);
    const items = extractListData(data);
    if (!items.length) return text('No customers found.');
    const lines = items.map((c: any) => `• ${c.id} — ${c.name} (${c.email}) [${c.status}]`);
    return text(`Customers (${items.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_customer', 'Get a specific customer', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `/v1/customers/${customer_id}`);
    return text(JSON.stringify(extractData(data), null, 2));
  });

  // ── Products ────────────────────────────────────────────────────────

  server.tool('list_products', 'List products', {
    store_id: z.string().optional().describe('Filter by store ID'),
  }, async ({ store_id }) => {
    const data = await call('GET', `/v1/products${qs({ store_id })}`);
    const items = extractListData(data);
    if (!items.length) return text('No products found.');
    const lines = items.map((p: any) => `• ${p.id} — ${p.name} [${p.status}] ${p.price_formatted}`);
    return text(`Products (${items.length}):\n${lines.join('\n')}`);
  });

  // ── Orders ──────────────────────────────────────────────────────────

  server.tool('list_orders', 'List orders', {
    store_id: z.string().optional().describe('Filter by store ID'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results'),
  }, async ({ store_id, limit }) => {
    const data = await call('GET', `/v1/orders${qs({ 'page[size]': limit ?? 10, store_id })}`);
    const items = extractListData(data);
    if (!items.length) return text('No orders found.');
    const lines = items.map((o: any) => `• ${o.id} — ${o.user_name} ${o.total_formatted} [${o.status}]`);
    return text(`Orders (${items.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_order', 'Get a specific order', {
    order_id: z.string().describe('Order ID'),
  }, async ({ order_id }) => {
    const data = await call('GET', `/v1/orders/${order_id}`);
    return text(JSON.stringify(extractData(data), null, 2));
  });

  // ── Subscriptions ───────────────────────────────────────────────────

  server.tool('list_subscriptions', 'List subscriptions', {
    store_id: z.string().optional().describe('Filter by store ID'),
    status: z.enum(['on_trial', 'active', 'paused', 'past_due', 'unpaid', 'cancelled', 'expired']).optional().describe('Filter by status'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results'),
  }, async ({ store_id, status, limit }) => {
    const data = await call('GET', `/v1/subscriptions${qs({ 'page[size]': limit ?? 10, store_id, status })}`);
    const items = extractListData(data);
    if (!items.length) return text('No subscriptions found.');
    const lines = items.map((s: any) => `• ${s.id} — ${s.product_name} [${s.status}]`);
    return text(`Subscriptions (${items.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_subscription', 'Get a specific subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('GET', `/v1/subscriptions/${subscription_id}`);
    return text(JSON.stringify(extractData(data), null, 2));
  });

  server.tool('cancel_subscription', 'Cancel a subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('DELETE', `/v1/subscriptions/${subscription_id}`);
    const item = extractData(data);
    return text(`Cancelled subscription ${item.id} [${item.status}]`);
  });

  server.tool('pause_subscription', 'Pause a subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    mode: z.enum(['void', 'free']).optional().describe('Pause mode (default: void)'),
  }, async ({ subscription_id, mode }) => {
    const data = await call('PATCH', `/v1/subscriptions/${subscription_id}`, {
      data: { type: 'subscriptions', id: subscription_id, attributes: { pause: { mode: mode ?? 'void' } } },
    });
    const item = extractData(data);
    return text(`Paused subscription ${item.id} [${item.status}]`);
  });

  server.tool('resume_subscription', 'Resume a paused subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('PATCH', `/v1/subscriptions/${subscription_id}`, {
      data: { type: 'subscriptions', id: subscription_id, attributes: { pause: null } },
    });
    const item = extractData(data);
    return text(`Resumed subscription ${item.id} [${item.status}]`);
  });

  // ── Discounts ───────────────────────────────────────────────────────

  server.tool('create_discount', 'Create a discount', {
    name: z.string().describe('Discount name'),
    code: z.string().describe('Discount code'),
    amount: z.number().describe('Amount (cents for fixed, percentage for percent)'),
    amount_type: z.enum(['percent', 'fixed']).describe('Amount type'),
    store_id: z.string().describe('Store ID'),
  }, async ({ name, code, amount, amount_type, store_id }) => {
    const data = await call('POST', '/v1/discounts', {
      data: {
        type: 'discounts',
        attributes: { name, code, amount, amount_type },
        relationships: { store: { data: { type: 'stores', id: store_id } } },
      },
    });
    const item = extractData(data);
    return text(`Created discount ${item.id}: ${item.name} (${item.code})`);
  });

  server.tool('list_discounts', 'List discounts', {
    store_id: z.string().optional().describe('Filter by store ID'),
  }, async ({ store_id }) => {
    const data = await call('GET', `/v1/discounts${qs({ store_id })}`);
    const items = extractListData(data);
    if (!items.length) return text('No discounts found.');
    const lines = items.map((d: any) => `• ${d.id} — ${d.name} (${d.code}) [${d.status}]`);
    return text(`Discounts (${items.length}):\n${lines.join('\n')}`);
  });

  server.tool('delete_discount', 'Delete a discount', {
    discount_id: z.string().describe('Discount ID'),
  }, async ({ discount_id }) => {
    await call('DELETE', `/v1/discounts/${discount_id}`);
    return text(`Deleted discount ${discount_id}`);
  });

  // ── License Keys ────────────────────────────────────────────────────

  server.tool('list_license_keys', 'List license keys', {
    store_id: z.string().optional().describe('Filter by store ID'),
    status: z.enum(['inactive', 'active', 'expired', 'disabled']).optional().describe('Filter by status'),
  }, async ({ store_id, status }) => {
    const data = await call('GET', `/v1/license-keys${qs({ store_id, status })}`);
    const items = extractListData(data);
    if (!items.length) return text('No license keys found.');
    const lines = items.map((l: any) => `• ${l.id} — ${l.key_short} [${l.status}]`);
    return text(`License Keys (${items.length}):\n${lines.join('\n')}`);
  });

  // ── Checkouts ───────────────────────────────────────────────────────

  server.tool('create_checkout', 'Create a checkout', {
    store_id: z.string().describe('Store ID'),
    variant_id: z.string().describe('Variant ID'),
    custom_price: z.number().optional().describe('Custom price in cents'),
  }, async ({ store_id, variant_id, custom_price }) => {
    const data = await call('POST', '/v1/checkouts', {
      data: {
        type: 'checkouts',
        attributes: { custom_price },
        relationships: {
          store: { data: { type: 'stores', id: store_id } },
          variant: { data: { type: 'variants', id: variant_id } },
        },
      },
    });
    const item = extractData(data);
    return text(`Created checkout ${item.id}: ${item.url ?? 'no url'}`);
  });

  // ── Search ──────────────────────────────────────────────────────────

  server.tool('search_lemonsqueezy_resources', 'Search across Lemon Squeezy resources', {
    query: z.string().describe('Search query string'),
    resource: z.enum(['customers', 'subscriptions', 'orders', 'products', 'discounts']).optional().describe('Limit to resource type'),
  }, async ({ query, resource }) => {
    const types = resource ? [resource] : ['customers', 'subscriptions', 'orders', 'products', 'discounts'];
    const results: string[] = [];

    for (const type of types) {
      try {
        const data = await call('GET', `/v1/${type}`) as any;
        const items = extractListData(data);
        const matches = items.filter((item: any) => {
          const str = JSON.stringify(item).toLowerCase();
          return str.includes(query.toLowerCase());
        });
        for (const m of matches) {
          results.push(`[${type}] ${m.id} — ${JSON.stringify(m).slice(0, 120)}`);
        }
      } catch { /* skip */ }
    }

    if (!results.length) return text(`No results found for "${query}".`);
    return text(`Search results (${results.length}):\n${results.join('\n')}`);
  });

  server.tool('search_lemonsqueezy_documentation', 'Search Lemon Squeezy documentation', {
    query: z.string().describe('Documentation topic to search for'),
  }, async ({ query }) => {
    return text(
      `Lemon Squeezy documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real Lemon Squeezy docs, visit ${meta.documentationUrl}\n\n` +
      `Common topics:\n` +
      `• Customers: POST /v1/customers with name + email\n` +
      `• Products: GET /v1/products (read-only)\n` +
      `• Subscriptions: GET/PATCH/DELETE /v1/subscriptions\n` +
      `• Orders: GET /v1/orders (read-only)\n` +
      `• Discounts: POST/DELETE /v1/discounts\n` +
      `• Checkouts: POST /v1/checkouts\n` +
      `• License Keys: GET/PATCH /v1/license-keys\n`,
    );
  });
}

export function createLemonSqueezyMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
    description: meta.mcp.description,
  });
  registerLemonSqueezyTools(server, baseUrl);
  return server;
}

export async function startLemonSqueezyMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createLemonSqueezyMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Lemon Squeezy MCP server running on stdio');
}
