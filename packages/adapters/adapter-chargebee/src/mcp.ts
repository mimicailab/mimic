import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import meta from './adapter-meta.js';

function makeCall(baseUrl: string) {
  return async (method: string, path: string, body?: unknown) => {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {};

    if (method === 'POST') {
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? new URLSearchParams(body as Record<string, string>).toString() : undefined,
    });
    return res.json();
  };
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

function qs(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
}

export function registerChargebeeTools(server: McpServer, baseUrl: string): void {
  const call = makeCall(baseUrl);

  // ── Customers ──
  server.tool('list_customers', 'List Chargebee customers', {
    limit: z.number().optional().describe('Max results (1-100)'),
    offset: z.string().optional().describe('Pagination offset'),
  }, async ({ limit, offset }) => {
    const data = await call('GET', `/chargebee/customers${qs({ limit, offset })}`);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('create_customer', 'Create a Chargebee customer', {
    id: z.string().optional().describe('Customer ID (auto-generated if omitted)'),
    first_name: z.string().optional().describe('First name'),
    last_name: z.string().optional().describe('Last name'),
    email: z.string().optional().describe('Email'),
    company: z.string().optional().describe('Company name'),
  }, async (params) => {
    const data = await call('POST', '/chargebee/customers', params);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('retrieve_customer', 'Retrieve a Chargebee customer', {
    id: z.string().describe('Customer ID'),
  }, async ({ id }) => {
    const data = await call('GET', `/chargebee/customers/${id}`);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('update_customer', 'Update a Chargebee customer', {
    id: z.string().describe('Customer ID'),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    email: z.string().optional(),
    company: z.string().optional(),
  }, async ({ id, ...params }) => {
    const data = await call('POST', `/chargebee/customers/${id}`, params);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('delete_customer', 'Delete a Chargebee customer', {
    id: z.string().describe('Customer ID'),
  }, async ({ id }) => {
    const data = await call('POST', `/chargebee/customers/${id}/delete`);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Subscriptions ──
  server.tool('list_subscriptions', 'List Chargebee subscriptions', {
    limit: z.number().optional(),
    offset: z.string().optional(),
  }, async ({ limit, offset }) => {
    const data = await call('GET', `/chargebee/subscriptions${qs({ limit, offset })}`);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('retrieve_subscription', 'Retrieve a Chargebee subscription', {
    id: z.string().describe('Subscription ID'),
  }, async ({ id }) => {
    const data = await call('GET', `/chargebee/subscriptions/${id}`);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('cancel_subscription', 'Cancel a Chargebee subscription', {
    id: z.string().describe('Subscription ID'),
    end_of_term: z.boolean().optional().describe('Cancel at end of term'),
  }, async ({ id, end_of_term }) => {
    const data = await call('POST', `/chargebee/subscriptions/${id}/cancel`, { end_of_term: String(end_of_term ?? false) });
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('reactivate_subscription', 'Reactivate a cancelled subscription', {
    id: z.string().describe('Subscription ID'),
  }, async ({ id }) => {
    const data = await call('POST', `/chargebee/subscriptions/${id}/reactivate`);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Invoices ──
  server.tool('list_invoices', 'List Chargebee invoices', {
    limit: z.number().optional(),
    offset: z.string().optional(),
  }, async ({ limit, offset }) => {
    const data = await call('GET', `/chargebee/invoices${qs({ limit, offset })}`);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('retrieve_invoice', 'Retrieve a Chargebee invoice', {
    id: z.string().describe('Invoice ID'),
  }, async ({ id }) => {
    const data = await call('GET', `/chargebee/invoices/${id}`);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('void_invoice', 'Void a Chargebee invoice', {
    id: z.string().describe('Invoice ID'),
  }, async ({ id }) => {
    const data = await call('POST', `/chargebee/invoices/${id}/void`);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('record_invoice_payment', 'Record payment for an invoice', {
    id: z.string().describe('Invoice ID'),
    amount: z.number().optional().describe('Payment amount in cents'),
  }, async ({ id, amount }) => {
    const data = await call('POST', `/chargebee/invoices/${id}/record_payment`, amount ? { amount: String(amount) } : undefined);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Items ──
  server.tool('list_items', 'List Chargebee items (products)', {
    limit: z.number().optional(),
  }, async ({ limit }) => {
    const data = await call('GET', `/chargebee/items${qs({ limit })}`);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('create_item', 'Create a Chargebee item', {
    id: z.string().describe('Item ID'),
    name: z.string().describe('Item name'),
    type: z.enum(['plan', 'addon', 'charge']).describe('Item type'),
  }, async (params) => {
    const data = await call('POST', '/chargebee/items', params);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Item Prices ──
  server.tool('list_item_prices', 'List Chargebee item prices', {
    limit: z.number().optional(),
  }, async ({ limit }) => {
    const data = await call('GET', `/chargebee/item_prices${qs({ limit })}`);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('create_item_price', 'Create a Chargebee item price', {
    id: z.string().describe('Item price ID'),
    item_id: z.string().describe('Parent item ID'),
    name: z.string().describe('Price name'),
    pricing_model: z.enum(['flat_fee', 'per_unit', 'tiered', 'volume', 'stairstep']).describe('Pricing model'),
    price: z.number().optional().describe('Price in cents'),
    period: z.number().optional().describe('Billing period'),
    period_unit: z.enum(['day', 'week', 'month', 'year']).optional(),
  }, async (params) => {
    const data = await call('POST', '/chargebee/item_prices', params);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Coupons ──
  server.tool('list_coupons', 'List Chargebee coupons', {
    limit: z.number().optional(),
  }, async ({ limit }) => {
    const data = await call('GET', `/chargebee/coupons${qs({ limit })}`);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Mimic-specific tools ──
  server.tool('mimic_list_endpoints', 'List all available Chargebee mock endpoints', {}, async () => {
    const data = await call('GET', '/chargebee/endpoints');
    return text(JSON.stringify(data, null, 2));
  });
}

export function createChargebeeMcpServer(baseUrl = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
  });
  registerChargebeeTools(server, baseUrl);
  return server;
}

export async function startChargebeeMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL ?? 'http://localhost:4100';
  const server = createChargebeeMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
