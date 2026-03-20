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
      throw new Error(`RevenueCat mock error ${res.status}: ${text}`);
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

const PROJECT_ID = 'proj_mock';

// ---------------------------------------------------------------------------
// RevenueCat MCP Tools
// ---------------------------------------------------------------------------

export function registerRevenueCatTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);
  const p = `/projects/${PROJECT_ID}`;

  // Customers
  server.tool('list_customers', 'List RevenueCat customers', {
    limit: z.number().optional().describe('Results per page (max 100)'),
  }, async ({ limit }) => {
    const data = await call('GET', `${p}/customers${qs({ limit })}`) as any;
    if (!data.items?.length) return text('No customers found.');
    const lines = data.items.map((c: any) => `- ${c.id} — platform: ${c.last_seen_platform ?? 'unknown'}`);
    return text(`Customers (${data.items.length}):\n${lines.join('\n')}`);
  });

  server.tool('get_customer', 'Get a RevenueCat customer by ID', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `${p}/customers/${customer_id}`) as any;
    return text(`Customer ${data.id}:\n${JSON.stringify(data, null, 2)}`);
  });

  // Entitlements
  server.tool('list_entitlements', 'List RevenueCat entitlements', {
    limit: z.number().optional(),
  }, async ({ limit }) => {
    const data = await call('GET', `${p}/entitlements${qs({ limit })}`) as any;
    if (!data.items?.length) return text('No entitlements found.');
    const lines = data.items.map((e: any) => `- ${e.id} — ${e.display_name} (${e.lookup_key}) [${e.state}]`);
    return text(`Entitlements (${data.items.length}):\n${lines.join('\n')}`);
  });

  server.tool('create_entitlement', 'Create a RevenueCat entitlement', {
    lookup_key: z.string().describe('Unique identifier for the entitlement'),
    display_name: z.string().describe('Display name'),
  }, async (params) => {
    const data = await call('POST', `${p}/entitlements`, params) as any;
    return text(`Created entitlement ${data.id}: ${data.display_name}`);
  });

  // Offerings
  server.tool('list_offerings', 'List RevenueCat offerings', {
    limit: z.number().optional(),
  }, async ({ limit }) => {
    const data = await call('GET', `${p}/offerings${qs({ limit })}`) as any;
    if (!data.items?.length) return text('No offerings found.');
    const lines = data.items.map((o: any) => `- ${o.id} — ${o.display_name} (${o.lookup_key}) [${o.state}]`);
    return text(`Offerings (${data.items.length}):\n${lines.join('\n')}`);
  });

  server.tool('create_offering', 'Create a RevenueCat offering', {
    lookup_key: z.string().describe('Unique identifier'),
    display_name: z.string().describe('Display name'),
    metadata: z.record(z.string()).optional().describe('Custom metadata'),
  }, async (params) => {
    const data = await call('POST', `${p}/offerings`, params) as any;
    return text(`Created offering ${data.id}: ${data.display_name}`);
  });

  // Products
  server.tool('list_products', 'List RevenueCat products', {
    limit: z.number().optional(),
  }, async ({ limit }) => {
    const data = await call('GET', `${p}/products${qs({ limit })}`) as any;
    if (!data.items?.length) return text('No products found.');
    const lines = data.items.map((pr: any) => `- ${pr.id} — ${pr.display_name ?? pr.store_identifier} [${pr.state}]`);
    return text(`Products (${data.items.length}):\n${lines.join('\n')}`);
  });

  // Subscriptions
  server.tool('get_subscription', 'Get a RevenueCat subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('GET', `${p}/subscriptions/${subscription_id}`) as any;
    return text(`Subscription ${data.id} [${data.status}]:\n${JSON.stringify(data, null, 2)}`);
  });

  server.tool('cancel_subscription', 'Cancel a RevenueCat subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('POST', `${p}/subscriptions/${subscription_id}/actions/cancel`) as any;
    return text(`Cancelled subscription ${data.id} [${data.status}]`);
  });

  server.tool('refund_subscription', 'Refund a RevenueCat subscription', {
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ subscription_id }) => {
    const data = await call('POST', `${p}/subscriptions/${subscription_id}/actions/refund`) as any;
    return text(`Refunded subscription ${data.id} [${data.status}]`);
  });

  // Packages
  server.tool('list_packages', 'List packages for a RevenueCat offering', {
    offering_id: z.string().describe('Offering ID'),
  }, async ({ offering_id }) => {
    const data = await call('GET', `${p}/offerings/${offering_id}/packages`) as any;
    if (!data.items?.length) return text('No packages found.');
    const lines = data.items.map((pk: any) => `- ${pk.id} — ${pk.display_name} (${pk.lookup_key})`);
    return text(`Packages (${data.items.length}):\n${lines.join('\n')}`);
  });

  // Search
  server.tool('search_revenuecat_resources', 'Search across RevenueCat resources', {
    query: z.string().describe('Search query string'),
    resource: z.enum(['customers', 'entitlements', 'offerings', 'products', 'subscriptions']).optional(),
  }, async ({ query, resource }) => {
    const types = resource ? [resource] : ['customers', 'entitlements', 'offerings', 'products'];
    const results: string[] = [];

    for (const type of types) {
      try {
        const data = await call('GET', `${p}/${type}`) as any;
        if (!data.items?.length) continue;
        const matches = data.items.filter((item: any) => {
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

export function createRevenueCatMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
    description: meta.mcp.description,
  });
  registerRevenueCatTools(server, baseUrl);
  return server;
}

export async function startRevenueCatMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createRevenueCatMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic RevenueCat MCP server running on stdio');
}
