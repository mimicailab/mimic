import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCall(baseUrl: string, accessToken: string) {
  return async (path: string, body: Record<string, unknown> = {}, opts?: { skipAccessToken?: boolean }): Promise<any> => {
    const payload = opts?.skipAccessToken ? { ...body } : { access_token: accessToken, ...body };
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Plaid mock error ${res.status}: ${errText}`);
    }
    return res.json();
  };
}

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

function dollars(n: number | null | undefined): string {
  if (n == null) return 'N/A';
  return `$${Number(n).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Register all Plaid MCP tools on the given McpServer.
 * Shared implementation used by both the standalone server and
 * the unified MimicMcpServer registration via `mcp: true`.
 */
export function registerPlaidTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4100',
  accessToken: string = 'access-test-user-sandbox123',
): void {
  const call = makeCall(baseUrl, accessToken);

  // 1. create_link_token
  server.tool('plaid_create_link_token', 'Create a Plaid Link token for initializing the Link flow', {
    client_name: z.string().default('Mimic App').describe('App name shown in Link'),
    language: z.string().default('en').describe('Language code'),
    country_codes: z.array(z.string()).default(['US']).describe('Country codes'),
    products: z.array(z.string()).default(['transactions']).describe('Plaid products to enable'),
  }, async ({ client_name, language, country_codes, products }) => {
    const data = await call('/plaid/link/token/create', {
      client_name, language, country_codes, products, user: { client_user_id: 'mimic-user-1' },
    }, { skipAccessToken: true });
    return text(`Created link token: ${data.link_token}, expires: ${data.expiration}`);
  });

  // 2. exchange_public_token
  server.tool('plaid_exchange_public_token', 'Exchange a public token from Plaid Link for an access token', {
    public_token: z.string().describe('Public token from Link'),
  }, async ({ public_token }) => {
    const data = await call('/plaid/item/public_token/exchange', { public_token }, { skipAccessToken: true });
    return text(`Exchanged token. Access token: ${data.access_token}, Item ID: ${data.item_id}`);
  });

  // 3. plaid_get_accounts
  server.tool('plaid_get_accounts', 'Get all bank accounts linked via Plaid', {}, async () => {
    const data = await call('/plaid/accounts/get');
    const accounts = data.accounts ?? [];
    const lines = accounts.map((a: any) =>
      `${a.name} (${a.type}/${a.subtype}) — Balance: ${dollars(a.balances?.current)} current, ${dollars(a.balances?.available)} available`
    );
    return text(`Found ${accounts.length} accounts:\n${lines.join('\n')}`);
  });

  // 4. plaid_get_transactions
  server.tool('plaid_get_transactions', 'Get bank transactions from Plaid for a date range', {
    start_date: z.string().describe('Start date (YYYY-MM-DD)'),
    end_date: z.string().describe('End date (YYYY-MM-DD)'),
    count: z.number().default(100).describe('Max transactions to return'),
    offset: z.number().default(0).describe('Pagination offset'),
  }, async ({ start_date, end_date, count, offset }) => {
    const data = await call('/plaid/transactions/get', { start_date, end_date, options: { count, offset } });
    const txns = data.transactions ?? [];
    const total = data.total_transactions ?? txns.length;
    const lines = txns.map((t: any) => `${t.date} | ${t.name} | ${dollars(t.amount)} | ${(t.category ?? []).join(', ')}`);
    return text(`Found ${total} transactions:\n${lines.join('\n')}`);
  });

  // 5. sync_transactions
  server.tool('plaid_sync_transactions', 'Incrementally sync transactions from Plaid using a cursor', {
    cursor: z.string().optional().describe('Cursor from previous sync (omit for initial sync)'),
  }, async ({ cursor }) => {
    const body: Record<string, unknown> = {};
    if (cursor) body.cursor = cursor;
    const data = await call('/plaid/transactions/sync', body);
    return text(`${(data.added ?? []).length} new, ${(data.modified ?? []).length} modified, ${(data.removed ?? []).length} removed. Next cursor: ${data.next_cursor ?? ''}`);
  });

  // 6. get_auth
  server.tool('plaid_get_auth', 'Get account and routing numbers for ACH transfers via Plaid', {}, async () => {
    const data = await call('/plaid/auth/get');
    const ach = data.numbers?.ach ?? [];
    const lines = ach.map((n: any) => `Account #: ${n.account}, Routing #: ${n.routing}`);
    return text(`Auth info for ${ach.length} accounts:\n${lines.join('\n')}`);
  });

  // 7. get_identity
  server.tool('plaid_get_identity', 'Get identity information for account owners via Plaid', {}, async () => {
    const data = await call('/plaid/identity/get');
    const accounts = data.accounts ?? [];
    const lines: string[] = [];
    for (const acct of accounts) {
      for (const owner of acct.owners ?? []) {
        lines.push(`Name: ${(owner.names ?? []).join(', ')}`);
        const emails = (owner.emails ?? []).map((e: any) => e.data).join(', ');
        if (emails) lines.push(`Email: ${emails}`);
        const phones = (owner.phone_numbers ?? []).map((p: any) => p.data).join(', ');
        if (phones) lines.push(`Phone: ${phones}`);
      }
    }
    return text(lines.join('\n') || 'No identity data available');
  });

  // 8. get_balance
  server.tool('plaid_get_balance', 'Get real-time account balances via Plaid', {}, async () => {
    const data = await call('/plaid/accounts/balance/get');
    const accounts = data.accounts ?? [];
    const lines = accounts.map((a: any) => {
      const b = a.balances ?? {};
      return `${a.name} — Current: ${dollars(b.current)}, Available: ${dollars(b.available)}`;
    });
    return text(`Balances for ${accounts.length} accounts:\n${lines.join('\n')}`);
  });

  // 9. get_holdings
  server.tool('plaid_get_holdings', 'Get investment holdings via Plaid', {}, async () => {
    const data = await call('/plaid/investments/holdings/get');
    const holdings = data.holdings ?? [];
    if (!holdings.length) return text('No investment holdings found.');
    return text(`Found ${holdings.length} holdings.`);
  });

  // 10. get_liabilities
  server.tool('plaid_get_liabilities', 'Get liabilities (credit cards, student loans, mortgages) via Plaid', {}, async () => {
    const data = await call('/plaid/liabilities/get');
    const liab = data.liabilities ?? {};
    const credit = liab.credit?.length ?? 0;
    const student = liab.student?.length ?? 0;
    const mortgage = liab.mortgage?.length ?? 0;
    if (!credit && !student && !mortgage) return text('No liabilities found.');
    return text(`Liabilities: ${credit} credit, ${student} student loans, ${mortgage} mortgages`);
  });

}

/**
 * Create a standalone Mimic MCP server for Plaid.
 * Call `.connect(transport)` to start it.
 */
export function createPlaidMcpServer(
  baseUrl: string = 'http://localhost:4100',
  accessToken: string = 'access-test-user-sandbox123',
): McpServer {
  const server = new McpServer({
    name: 'mimic-plaid',
    version: '0.2.0',
    description: 'Mimic MCP server for Plaid — bank accounts, transactions, balances, identity against mock data',
  });
  registerPlaidTools(server, baseUrl, accessToken);
  return server;
}

export async function startPlaidMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const accessToken = process.env.PLAID_ACCESS_TOKEN || 'access-test-user-sandbox123';
  const server = createPlaidMcpServer(baseUrl, accessToken);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Plaid MCP server running on stdio');
}
