import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import meta from './adapter-meta.js';

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

export function registerRecurlyTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);

  // ── Accounts ──────────────────────────────────────────────────────────

  server.tool('create_account', 'Create a Recurly account', {
    code: z.string().describe('Unique account code'),
    email: z.string().optional().describe('Email address'),
    first_name: z.string().optional().describe('First name'),
    last_name: z.string().optional().describe('Last name'),
    company: z.string().optional().describe('Company name'),
  }, async (params) => {
    const data = await call('POST', '/recurly/accounts', params) as any;
    return text(`Created account ${data.id}: ${data.first_name ?? ''} ${data.last_name ?? ''} (${data.email ?? 'no email'})`);
  });

  server.tool('list_accounts', 'List Recurly accounts', {
    limit: z.number().int().min(1).max(200).optional().describe('Max results'),
  }, async ({ limit }) => {
    const data = await call('GET', `/recurly/accounts${qs({ limit: limit ?? 20 })}`) as any;
    if (!data.data?.length) return text('No accounts found.');
    const lines = data.data.map((a: any) => `• ${a.id} — ${a.first_name ?? ''} ${a.last_name ?? ''} [${a.state}]`);
    return text(`Accounts (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_account', 'Get a specific account', {
    account_id: z.string().describe('Account ID'),
  }, async ({ account_id }) => {
    const data = await call('GET', `/recurly/accounts/${account_id}`) as any;
    return text(JSON.stringify(data, null, 2));
  });

  // ── Plans ─────────────────────────────────────────────────────────────

  server.tool('create_plan', 'Create a subscription plan', {
    code: z.string().describe('Unique plan code'),
    name: z.string().describe('Display name'),
    interval_unit: z.enum(['days', 'months']).optional().describe('Billing interval unit'),
    interval_length: z.number().int().positive().optional().describe('Billing interval length'),
  }, async (params) => {
    const data = await call('POST', '/recurly/plans', params) as any;
    return text(`Created plan ${data.id}: ${data.name} (${data.code})`);
  });

  server.tool('list_plans', 'List subscription plans', {}, async () => {
    const data = await call('GET', '/recurly/plans') as any;
    if (!data.data?.length) return text('No plans found.');
    const lines = data.data.map((p: any) => `• ${p.id} — ${p.name} (${p.code}) [${p.state}]`);
    return text(`Plans (${data.data.length}):\n${lines.join('\n')}`);
  });

  // ── Subscriptions ─────────────────────────────────────────────────────

  server.tool('create_subscription', 'Create a subscription', {
    plan_code: z.string().describe('Plan code'),
    account_code: z.string().describe('Account code'),
    currency: z.string().length(3).optional().describe('Currency (default USD)'),
  }, async ({ plan_code, account_code, currency }) => {
    const data = await call('POST', '/recurly/subscriptions', {
      plan_code,
      account: { code: account_code },
      currency: currency ?? 'USD',
    }) as any;
    return text(`Created subscription ${data.id} [${data.state}]`);
  });

  server.tool('list_subscriptions', 'List subscriptions', {
    state: z.enum(['active', 'canceled', 'expired', 'future', 'paused']).optional().describe('Filter by state'),
    limit: z.number().int().min(1).max(200).optional().describe('Max results'),
  }, async ({ state, limit }) => {
    const data = await call('GET', `/recurly/subscriptions${qs({ state, limit: limit ?? 20 })}`) as any;
    if (!data.data?.length) return text('No subscriptions found.');
    const lines = data.data.map((s: any) => `• ${s.id} — [${s.state}]`);
    return text(`Subscriptions (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('cancel_subscription', 'Cancel a subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('PUT', `/recurly/subscriptions/${subscription_id}/cancel`) as any;
    return text(`Cancelled subscription ${data.id} [${data.state}]`);
  });

  server.tool('reactivate_subscription', 'Reactivate a canceled subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('PUT', `/recurly/subscriptions/${subscription_id}/reactivate`) as any;
    return text(`Reactivated subscription ${data.id} [${data.state}]`);
  });

  server.tool('pause_subscription', 'Pause a subscription', {
    subscription_id: z.string().describe('Subscription ID'),
    remaining_pause_cycles: z.number().int().positive().optional().describe('Number of pause cycles'),
  }, async ({ subscription_id, remaining_pause_cycles }) => {
    const data = await call('PUT', `/recurly/subscriptions/${subscription_id}/pause`, {
      remaining_pause_cycles: remaining_pause_cycles ?? 1,
    }) as any;
    return text(`Paused subscription ${data.id} [${data.state}]`);
  });

  server.tool('resume_subscription', 'Resume a paused subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('PUT', `/recurly/subscriptions/${subscription_id}/resume`) as any;
    return text(`Resumed subscription ${data.id} [${data.state}]`);
  });

  // ── Invoices ──────────────────────────────────────────────────────────

  server.tool('list_invoices', 'List invoices', {
    state: z.enum(['pending', 'processing', 'past_due', 'paid', 'failed', 'voided']).optional().describe('Filter by state'),
    limit: z.number().int().min(1).max(200).optional().describe('Max results'),
  }, async ({ state, limit }) => {
    const data = await call('GET', `/recurly/invoices${qs({ state, limit: limit ?? 20 })}`) as any;
    if (!data.data?.length) return text('No invoices found.');
    const lines = data.data.map((inv: any) => `• ${inv.id} — ${inv.total ?? 0} ${inv.currency ?? 'USD'} [${inv.state}]`);
    return text(`Invoices (${data.data.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_invoice', 'Get a specific invoice', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('GET', `/recurly/invoices/${invoice_id}`) as any;
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('collect_invoice', 'Collect payment on an invoice', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('PUT', `/recurly/invoices/${invoice_id}/collect`) as any;
    return text(`Collected invoice ${data.id} [${data.state}]`);
  });

  server.tool('void_invoice', 'Void an invoice', {
    invoice_id: z.string().describe('Invoice ID'),
  }, async ({ invoice_id }) => {
    const data = await call('PUT', `/recurly/invoices/${invoice_id}/void`) as any;
    return text(`Voided invoice ${data.id} [${data.state}]`);
  });

  // ── Coupons ───────────────────────────────────────────────────────────

  server.tool('create_coupon', 'Create a coupon', {
    code: z.string().describe('Unique coupon code'),
    name: z.string().describe('Display name'),
    discount_type: z.enum(['percent', 'fixed', 'free_trial']).optional().describe('Discount type'),
    discount_percent: z.number().min(0).max(100).optional().describe('Percent discount (for percent type)'),
  }, async (params) => {
    const data = await call('POST', '/recurly/coupons', params) as any;
    return text(`Created coupon ${data.id}: ${data.name} (${data.code})`);
  });

  server.tool('list_coupons', 'List coupons', {}, async () => {
    const data = await call('GET', '/recurly/coupons') as any;
    if (!data.data?.length) return text('No coupons found.');
    const lines = data.data.map((c: any) => `• ${c.id} — ${c.name} (${c.code}) [${c.state}]`);
    return text(`Coupons (${data.data.length}):\n${lines.join('\n')}`);
  });

  // ── Items ─────────────────────────────────────────────────────────────

  server.tool('create_item', 'Create a catalog item', {
    code: z.string().describe('Unique item code'),
    name: z.string().describe('Display name'),
    description: z.string().optional().describe('Item description'),
  }, async (params) => {
    const data = await call('POST', '/recurly/items', params) as any;
    return text(`Created item ${data.id}: ${data.name} (${data.code})`);
  });

  server.tool('list_items', 'List catalog items', {}, async () => {
    const data = await call('GET', '/recurly/items') as any;
    if (!data.data?.length) return text('No items found.');
    const lines = data.data.map((i: any) => `• ${i.id} — ${i.name} (${i.code}) [${i.state}]`);
    return text(`Items (${data.data.length}):\n${lines.join('\n')}`);
  });

  // ── Transactions ──────────────────────────────────────────────────────

  server.tool('list_transactions', 'List transactions', {
    limit: z.number().int().min(1).max(200).optional().describe('Max results'),
  }, async ({ limit }) => {
    const data = await call('GET', `/recurly/transactions${qs({ limit: limit ?? 20 })}`) as any;
    if (!data.data?.length) return text('No transactions found.');
    const lines = data.data.map((t: any) => `• ${t.id} — ${t.amount ?? 0} ${t.currency ?? 'USD'} [${t.status ?? t.type}]`);
    return text(`Transactions (${data.data.length}):\n${lines.join('\n')}`);
  });

  // ── Generic resource tools ────────────────────────────────────────────

  server.tool('search_recurly_resources', 'Search across Recurly resources', {
    query: z.string().describe('Search query string'),
    resource: z.enum(['accounts', 'subscriptions', 'invoices', 'plans', 'transactions']).optional().describe('Limit to resource type'),
  }, async ({ query, resource }) => {
    const types = resource ? [resource] : ['accounts', 'subscriptions', 'invoices', 'plans', 'transactions'];
    const results: string[] = [];

    for (const type of types) {
      try {
        const data = await call('GET', `/recurly/${type}`) as any;
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

  server.tool('fetch_recurly_resource', 'Fetch a specific Recurly resource', {
    resource_type: z.enum([
      'accounts', 'subscriptions', 'plans', 'invoices', 'transactions',
      'coupons', 'items', 'add_ons', 'line_items',
    ]).describe('Resource type'),
    resource_id: z.string().describe('Resource ID'),
  }, async ({ resource_type, resource_id }) => {
    const data = await call('GET', `/recurly/${resource_type}/${resource_id}`) as any;
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('search_recurly_documentation', 'Search Recurly documentation', {
    query: z.string().describe('Documentation topic to search for'),
  }, async ({ query }) => {
    return text(
      `Recurly documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real Recurly docs, visit ${meta.documentationUrl}\n\n` +
      `Common topics:\n` +
      `• Accounts: POST /accounts with code + email\n` +
      `• Plans: POST /plans with code + name\n` +
      `• Subscriptions: POST /subscriptions with plan_code + account\n` +
      `• Invoices: GET /invoices, PUT /invoices/{id}/collect\n` +
      `• Coupons: POST /coupons with code + name + discount_type\n`,
    );
  });
}

export function createRecurlyMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
    description: meta.mcp.description,
  });
  registerRecurlyTools(server, baseUrl);
  return server;
}

export async function startRecurlyMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createRecurlyMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Recurly MCP server running on stdio');
}
