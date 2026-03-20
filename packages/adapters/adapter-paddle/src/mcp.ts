import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import meta from './adapter-meta.js';

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

// ---------------------------------------------------------------------------
// Paddle MCP Tools
// ---------------------------------------------------------------------------

export function registerPaddleTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);

  // Products
  server.tool('list_products', 'List Paddle products', {
    per_page: z.number().optional().describe('Results per page (1-200)'),
  }, async ({ per_page }) => {
    const data = await call('GET', `/products${qs({ per_page: per_page ?? 50 })}`) as any;
    if (!data.data?.length) return text('No products found.');
    const lines = data.data.map((p: any) => `- ${p.id} — ${p.name} [${p.status}]`);
    return text(`Products (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('create_product', 'Create a Paddle product', {
    name: z.string().describe('Product name'),
    description: z.string().optional().describe('Product description'),
    tax_category: z.string().optional().describe('Tax category (default: standard)'),
    custom_data: z.record(z.string()).optional().describe('Custom metadata'),
  }, async (params) => {
    const data = await call('POST', '/products', params) as any;
    return text(`Created product ${data.data.id}: ${data.data.name}`);
  });

  // Prices
  server.tool('list_prices', 'List Paddle prices', {
    product_id: z.string().optional().describe('Filter by product ID'),
  }, async ({ product_id }) => {
    const data = await call('GET', `/prices${qs({ product_id })}`) as any;
    if (!data.data?.length) return text('No prices found.');
    const lines = data.data.map((p: any) => `- ${p.id} — ${p.description ?? p.name ?? 'unnamed'} [${p.status}]`);
    return text(`Prices (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('create_price', 'Create a Paddle price', {
    product_id: z.string().describe('Product ID this price belongs to'),
    description: z.string().describe('Price description'),
    unit_price: z.object({
      amount: z.string().describe('Amount in minor units (e.g., "1000" for $10.00)'),
      currency_code: z.string().describe('Three-letter ISO currency code'),
    }).describe('Unit price details'),
    billing_cycle: z.object({
      interval: z.enum(['day', 'week', 'month', 'year']),
      frequency: z.number().int().positive(),
    }).optional().describe('Billing cycle (omit for one-time prices)'),
  }, async (params) => {
    const data = await call('POST', '/prices', params) as any;
    return text(`Created price ${data.data.id}`);
  });

  // Customers
  server.tool('list_customers', 'List Paddle customers', {
    email: z.string().optional().describe('Filter by email'),
    per_page: z.number().optional().describe('Results per page'),
  }, async ({ email, per_page }) => {
    const data = await call('GET', `/customers${qs({ email, per_page })}`) as any;
    if (!data.data?.length) return text('No customers found.');
    const lines = data.data.map((c: any) => `- ${c.id} — ${c.name ?? '(no name)'} (${c.email})`);
    return text(`Customers (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('create_customer', 'Create a Paddle customer', {
    email: z.string().describe('Customer email'),
    name: z.string().optional().describe('Customer name'),
    locale: z.string().optional().describe('Locale (e.g., en)'),
    custom_data: z.record(z.string()).optional().describe('Custom metadata'),
  }, async (params) => {
    const data = await call('POST', '/customers', params) as any;
    return text(`Created customer ${data.data.id}: ${data.data.name ?? data.data.email}`);
  });

  // Subscriptions
  server.tool('list_subscriptions', 'List Paddle subscriptions', {
    customer_id: z.string().optional().describe('Filter by customer ID'),
    status: z.enum(['active', 'canceled', 'past_due', 'paused', 'trialing']).optional(),
  }, async ({ customer_id, status }) => {
    const data = await call('GET', `/subscriptions${qs({ customer_id, status })}`) as any;
    if (!data.data?.length) return text('No subscriptions found.');
    const lines = data.data.map((s: any) => `- ${s.id} — customer ${s.customer_id} [${s.status}]`);
    return text(`Subscriptions (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('cancel_subscription', 'Cancel a Paddle subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    effective_from: z.enum(['immediately', 'next_billing_period']).optional().describe('When cancellation takes effect'),
  }, async ({ subscription_id, effective_from }) => {
    const data = await call('POST', `/subscriptions/${subscription_id}/cancel`, { effective_from }) as any;
    return text(`Cancelled subscription ${data.data.id} [${data.data.status}]`);
  });

  server.tool('pause_subscription', 'Pause a Paddle subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    effective_from: z.enum(['immediately', 'next_billing_period']).optional(),
  }, async ({ subscription_id, effective_from }) => {
    const data = await call('POST', `/subscriptions/${subscription_id}/pause`, { effective_from }) as any;
    return text(`Paused subscription ${data.data.id} [${data.data.status}]`);
  });

  server.tool('resume_subscription', 'Resume a paused Paddle subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    effective_from: z.enum(['immediately']).optional(),
  }, async ({ subscription_id, effective_from }) => {
    const data = await call('POST', `/subscriptions/${subscription_id}/resume`, { effective_from }) as any;
    return text(`Resumed subscription ${data.data.id} [${data.data.status}]`);
  });

  // Transactions
  server.tool('list_transactions', 'List Paddle transactions', {
    customer_id: z.string().optional().describe('Filter by customer ID'),
    subscription_id: z.string().optional().describe('Filter by subscription ID'),
    status: z.enum(['draft', 'ready', 'billed', 'paid', 'completed', 'canceled', 'past_due']).optional(),
  }, async ({ customer_id, subscription_id, status }) => {
    const data = await call('GET', `/transactions${qs({ customer_id, subscription_id, status })}`) as any;
    if (!data.data?.length) return text('No transactions found.');
    const lines = data.data.map((t: any) => `- ${t.id} — ${t.currency_code} [${t.status}]`);
    return text(`Transactions (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('create_transaction', 'Create a Paddle transaction', {
    items: z.array(z.object({
      price_id: z.string().describe('Price ID'),
      quantity: z.number().int().positive().describe('Quantity'),
    })).describe('Line items'),
    customer_id: z.string().optional().describe('Customer ID'),
  }, async (params) => {
    const data = await call('POST', '/transactions', params) as any;
    return text(`Created transaction ${data.data.id} [${data.data.status}]`);
  });

  // Discounts
  server.tool('create_discount', 'Create a Paddle discount', {
    description: z.string().describe('Discount description'),
    type: z.enum(['percentage', 'flat', 'flat_per_seat']).describe('Discount type'),
    amount: z.string().describe('Discount amount (percentage or minor unit)'),
    enabled_for_checkout: z.boolean().optional().describe('Available at checkout'),
    code: z.string().optional().describe('Discount code'),
    recur: z.boolean().optional().describe('Apply to recurring payments'),
  }, async (params) => {
    const data = await call('POST', '/discounts', params) as any;
    return text(`Created discount ${data.data.id}: ${data.data.description}`);
  });

  // Adjustments
  server.tool('create_adjustment', 'Create a Paddle adjustment (refund/credit)', {
    transaction_id: z.string().describe('Transaction ID to adjust'),
    action: z.enum(['refund', 'credit', 'chargeback']).describe('Adjustment action'),
    reason: z.string().describe('Reason for adjustment'),
    items: z.array(z.object({
      item_id: z.string().describe('Transaction item ID'),
      type: z.enum(['full', 'partial']).describe('Adjustment type'),
      amount: z.string().optional().describe('Amount (for partial adjustments)'),
    })).describe('Items to adjust'),
  }, async (params) => {
    const data = await call('POST', '/adjustments', params) as any;
    return text(`Created adjustment ${data.data.id} [${data.data.status}]`);
  });

  // Search
  server.tool('search_paddle_resources', 'Search across Paddle resources', {
    query: z.string().describe('Search query string'),
    resource: z.enum(['customers', 'products', 'prices', 'subscriptions', 'transactions']).optional(),
  }, async ({ query, resource }) => {
    const types = resource ? [resource] : ['customers', 'products', 'prices', 'subscriptions', 'transactions'];
    const results: string[] = [];

    for (const type of types) {
      try {
        const data = await call('GET', `/${type}`) as any;
        if (!data.data?.length) continue;
        const matches = data.data.filter((item: any) => {
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
}

export function createPaddleMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
    description: meta.mcp.description,
  });
  registerPaddleTools(server, baseUrl);
  return server;
}

export async function startPaddleMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createPaddleMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Paddle MCP server running on stdio');
}
