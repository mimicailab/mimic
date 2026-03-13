import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import meta from './adapter-meta.js';

function makeCall(baseUrl: string) {
  return async (path: string, body?: unknown) => {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : JSON.stringify({}),
    });
    return res.json();
  };
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

export function registerPlaidTools(server: McpServer, baseUrl: string): void {
  const call = makeCall(baseUrl);

  // ── Sandbox Setup ───────────────────────────────────────────────────────
  server.tool('sandbox_create_public_token', 'Create a sandbox public token linked to a test institution', {
    institution_id: z.string().optional().describe('Institution ID (default: ins_109508)'),
    initial_products: z.array(z.string()).optional().describe('Products to enable (default: [transactions])'),
  }, async (params) => {
    const data = await call('/plaid/sandbox/public_token/create', params);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('exchange_public_token', 'Exchange a public token for an access token', {
    public_token: z.string().describe('The public token to exchange'),
  }, async (params) => {
    const data = await call('/plaid/item/public_token/exchange', params);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Item ────────────────────────────────────────────────────────────────
  server.tool('get_item', 'Retrieve an Item', {
    access_token: z.string().describe('The access token for the Item'),
  }, async (params) => {
    const data = await call('/plaid/item/get', params);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('remove_item', 'Remove an Item', {
    access_token: z.string().describe('The access token for the Item'),
  }, async (params) => {
    const data = await call('/plaid/item/remove', params);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Accounts ────────────────────────────────────────────────────────────
  server.tool('get_accounts', 'Retrieve accounts for an Item', {
    access_token: z.string().describe('The access token for the Item'),
  }, async (params) => {
    const data = await call('/plaid/accounts/get', params);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('get_balance', 'Get real-time account balances', {
    access_token: z.string().describe('The access token for the Item'),
  }, async (params) => {
    const data = await call('/plaid/accounts/balance/get', params);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Auth ────────────────────────────────────────────────────────────────
  server.tool('get_auth', 'Retrieve auth data (account + routing numbers)', {
    access_token: z.string().describe('The access token for the Item'),
  }, async (params) => {
    const data = await call('/plaid/auth/get', params);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Transactions ────────────────────────────────────────────────────────
  server.tool('get_transactions', 'Get transactions for an Item', {
    access_token: z.string().describe('The access token for the Item'),
    start_date: z.string().describe('Start date (YYYY-MM-DD)'),
    end_date: z.string().describe('End date (YYYY-MM-DD)'),
    count: z.number().optional().describe('Max results (default 100)'),
    offset: z.number().optional().describe('Pagination offset (default 0)'),
  }, async ({ count, offset, ...params }) => {
    const body = { ...params, options: { count, offset } };
    const data = await call('/plaid/transactions/get', body);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('sync_transactions', 'Incrementally sync transactions', {
    access_token: z.string().describe('The access token for the Item'),
    cursor: z.string().optional().describe('Sync cursor from previous call'),
  }, async (params) => {
    const data = await call('/plaid/transactions/sync', params);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Identity ────────────────────────────────────────────────────────────
  server.tool('get_identity', 'Get identity data for accounts', {
    access_token: z.string().describe('The access token for the Item'),
  }, async (params) => {
    const data = await call('/plaid/identity/get', params);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Institutions ────────────────────────────────────────────────────────
  server.tool('search_institutions', 'Search financial institutions', {
    query: z.string().describe('Search query'),
    products: z.array(z.string()).optional().describe('Filter by supported products'),
    country_codes: z.array(z.string()).optional().describe('Filter by country codes'),
  }, async (params) => {
    const data = await call('/plaid/institutions/search', params);
    return text(JSON.stringify(data, null, 2));
  });

  server.tool('get_institution_by_id', 'Get institution details by ID', {
    institution_id: z.string().describe('The institution ID'),
    country_codes: z.array(z.string()).optional().describe('Country codes'),
  }, async (params) => {
    const data = await call('/plaid/institutions/get_by_id', params);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Investments ─────────────────────────────────────────────────────────
  server.tool('get_holdings', 'Get investment holdings', {
    access_token: z.string().describe('The access token for the Item'),
  }, async (params) => {
    const data = await call('/plaid/investments/holdings/get', params);
    return text(JSON.stringify(data, null, 2));
  });

  // ── Mimic admin tools ──────────────────────────────────────────────────
  server.tool('plaid_list_endpoints', 'List all available Plaid mock API endpoints', {}, async () => {
    const endpoints = await call('/plaid/endpoints', {}).catch(() => ({ endpoints: 'Use GET /plaid/endpoints' }));
    return text(JSON.stringify(endpoints, null, 2));
  });
}

export function createPlaidMcpServer(baseUrl = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
  });
  registerPlaidTools(server, baseUrl);
  return server;
}

export async function startPlaidMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL ?? 'http://localhost:4100';
  const server = createPlaidMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
