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
      throw new Error(`GoCardless mock error ${res.status}: ${text}`);
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

export function registerGoCardlessTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);

  // Customers
  server.tool('list_customers', 'List GoCardless customers', {
    limit: z.number().optional().describe('Max results (1-500)'),
  }, async ({ limit }) => {
    const data = await call('GET', `/customers${qs({ limit: limit ?? 50 })}`) as any;
    if (!data.customers?.length) return text('No customers found.');
    const lines = data.customers.map((c: any) => `- ${c.id} — ${c.given_name ?? ''} ${c.family_name ?? ''} (${c.email ?? 'no email'})`);
    return text(`Customers (${data.customers.length}):\n${lines.join('\n')}`);
  });

  server.tool('create_customer', 'Create a GoCardless customer', {
    email: z.string().describe('Customer email'),
    given_name: z.string().optional().describe('First name'),
    family_name: z.string().optional().describe('Last name'),
    country_code: z.string().optional().describe('ISO country code'),
    metadata: z.record(z.string()).optional(),
  }, async (params) => {
    const data = await call('POST', '/customers', { customers: params }) as any;
    const c = data.customers;
    return text(`Created customer ${c.id}: ${c.given_name ?? ''} ${c.family_name ?? ''}`);
  });

  // Mandates
  server.tool('list_mandates', 'List Direct Debit mandates', {
    customer: z.string().optional().describe('Filter by customer ID'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ customer, status }) => {
    const data = await call('GET', `/mandates${qs({ customer, status })}`) as any;
    if (!data.mandates?.length) return text('No mandates found.');
    const lines = data.mandates.map((m: any) => `- ${m.id} — ${m.scheme} [${m.status}]`);
    return text(`Mandates (${data.mandates.length}):\n${lines.join('\n')}`);
  });

  server.tool('create_mandate', 'Create a Direct Debit mandate', {
    scheme: z.string().describe('Direct Debit scheme (e.g. bacs, sepa_core, ach)'),
    metadata: z.record(z.string()).optional(),
  }, async (params) => {
    const data = await call('POST', '/mandates', { mandates: params }) as any;
    return text(`Created mandate ${data.mandates.id} [${data.mandates.status}]`);
  });

  server.tool('cancel_mandate', 'Cancel a Direct Debit mandate', {
    mandate_id: z.string().describe('Mandate ID'),
  }, async ({ mandate_id }) => {
    const data = await call('POST', `/mandates/${mandate_id}/actions/cancel`) as any;
    return text(`Cancelled mandate ${data.mandates.id} [${data.mandates.status}]`);
  });

  // Payments
  server.tool('list_payments', 'List payments', {
    customer: z.string().optional(),
    mandate: z.string().optional(),
    status: z.string().optional(),
  }, async ({ customer, mandate, status }) => {
    const data = await call('GET', `/payments${qs({ customer, mandate, status })}`) as any;
    if (!data.payments?.length) return text('No payments found.');
    const lines = data.payments.map((p: any) => `- ${p.id} — ${p.amount} ${p.currency} [${p.status}]`);
    return text(`Payments (${data.payments.length}):\n${lines.join('\n')}`);
  });

  server.tool('create_payment', 'Create a payment', {
    amount: z.number().int().positive().describe('Amount in minor units (e.g. pence)'),
    currency: z.string().describe('ISO currency code'),
    description: z.string().optional(),
    mandate: z.string().describe('Mandate ID to charge'),
    metadata: z.record(z.string()).optional(),
  }, async ({ mandate, ...rest }) => {
    const data = await call('POST', '/payments', { payments: { ...rest, links: { mandate } } }) as any;
    return text(`Created payment ${data.payments.id} — ${data.payments.amount} ${data.payments.currency} [${data.payments.status}]`);
  });

  server.tool('cancel_payment', 'Cancel a payment', {
    payment_id: z.string().describe('Payment ID'),
  }, async ({ payment_id }) => {
    const data = await call('POST', `/payments/${payment_id}/actions/cancel`) as any;
    return text(`Cancelled payment ${data.payments.id} [${data.payments.status}]`);
  });

  // Subscriptions
  server.tool('list_subscriptions', 'List subscriptions', {
    customer: z.string().optional(),
    mandate: z.string().optional(),
    status: z.string().optional(),
  }, async ({ customer, mandate, status }) => {
    const data = await call('GET', `/subscriptions${qs({ customer, mandate, status })}`) as any;
    if (!data.subscriptions?.length) return text('No subscriptions found.');
    const lines = data.subscriptions.map((s: any) => `- ${s.id} — ${s.amount} ${s.currency} every ${s.interval} ${s.interval_unit}(s) [${s.status}]`);
    return text(`Subscriptions (${data.subscriptions.length}):\n${lines.join('\n')}`);
  });

  server.tool('create_subscription', 'Create a subscription', {
    amount: z.number().int().positive().describe('Amount in minor units'),
    currency: z.string().describe('ISO currency code'),
    interval_unit: z.enum(['weekly', 'monthly', 'yearly']).describe('Billing interval unit'),
    interval: z.number().int().positive().optional().describe('Number of intervals between charges'),
    mandate: z.string().describe('Mandate ID'),
    name: z.string().optional(),
    metadata: z.record(z.string()).optional(),
  }, async ({ mandate, ...rest }) => {
    const data = await call('POST', '/subscriptions', { subscriptions: { ...rest, links: { mandate } } }) as any;
    return text(`Created subscription ${data.subscriptions.id} [${data.subscriptions.status}]`);
  });

  server.tool('cancel_subscription', 'Cancel a subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('POST', `/subscriptions/${subscription_id}/actions/cancel`) as any;
    return text(`Cancelled subscription ${data.subscriptions.id} [${data.subscriptions.status}]`);
  });

  // Refunds
  server.tool('create_refund', 'Create a refund', {
    amount: z.number().int().positive().describe('Refund amount in minor units'),
    payment: z.string().describe('Payment ID to refund'),
    total_amount_confirmation: z.number().int().describe('Total amount of payment for confirmation'),
    metadata: z.record(z.string()).optional(),
  }, async ({ payment, total_amount_confirmation, ...rest }) => {
    const data = await call('POST', '/refunds', { refunds: { ...rest, total_amount_confirmation, links: { payment } } }) as any;
    return text(`Created refund ${data.refunds.id} — ${data.refunds.amount} ${data.refunds.currency} [${data.refunds.status}]`);
  });

  // Search
  server.tool('search_gocardless_resources', 'Search across GoCardless resources', {
    query: z.string().describe('Search query'),
    resource: z.enum(['customers', 'mandates', 'payments', 'subscriptions', 'refunds']).optional(),
  }, async ({ query, resource }) => {
    const types = resource ? [resource] : ['customers', 'mandates', 'payments', 'subscriptions', 'refunds'];
    const results: string[] = [];

    for (const type of types) {
      try {
        const data = await call('GET', `/${type}`) as any;
        const items = data[type] ?? [];
        if (!items.length) continue;
        const matches = items.filter((item: any) => {
          return JSON.stringify(item).toLowerCase().includes(query.toLowerCase());
        });
        for (const m of matches) {
          results.push(`[${type}] ${m.id} — ${JSON.stringify(m).slice(0, 120)}`);
        }
      } catch { /* skip */ }
    }

    if (!results.length) return text(`No results for "${query}".`);
    return text(`Search results (${results.length}):\n${results.join('\n')}`);
  });
}

export function createGoCardlessMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
    description: meta.mcp.description,
  });
  registerGoCardlessTools(server, baseUrl);
  return server;
}

export async function startGoCardlessMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createGoCardlessMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic GoCardless MCP server running on stdio');
}
