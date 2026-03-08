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
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      const text = await res.text();
      throw new Error(`Wise mock error ${res.status}: ${text}`);
    }
    if (res.status === 204) return {};
    return res.json();
  };
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function registerWiseTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4104',
): void {
  const call = makeCall(baseUrl);

  // ── 1. list_profiles
  server.tool('list_profiles', 'List Wise profiles', {}, async () => {
    const data = (await call('GET', '/wise/v2/profiles')) as any[];
    if (!data.length) return text('No profiles found.');
    const lines = data.map(
      (p: any) => `- ${p.id}: ${p.fullName} (${p.type})`,
    );
    return text(`Profiles (${data.length}):\n${lines.join('\n')}`);
  });

  // ── 2. get_profile
  server.tool('get_profile', 'Get a Wise profile by ID', {
    profile_id: z.string().describe('Profile ID'),
  }, async ({ profile_id }) => {
    const data = (await call('GET', `/wise/v2/profiles/${profile_id}`)) as any;
    return text(`Profile ${data.id}: ${data.fullName} (${data.type})`);
  });

  // ── 3. create_quote
  server.tool('create_quote', 'Create a Wise quote', {
    profile_id: z.string().describe('Profile ID'),
    source_currency: z.string().length(3).optional().describe('Source currency code'),
    target_currency: z.string().length(3).optional().describe('Target currency code'),
    source_amount: z.number().optional().describe('Source amount'),
    target_amount: z.number().optional().describe('Target amount'),
  }, async ({ profile_id, source_currency, target_currency, source_amount, target_amount }) => {
    const body: any = {};
    if (source_currency) body.sourceCurrency = source_currency;
    if (target_currency) body.targetCurrency = target_currency;
    if (source_amount) body.sourceAmount = source_amount;
    if (target_amount) body.targetAmount = target_amount;
    const data = (await call('POST', `/wise/v3/profiles/${profile_id}/quotes`, body)) as any;
    return text(
      `Quote ${data.id}: ${data.sourceAmount} ${data.sourceCurrency} -> ${data.targetAmount} ${data.targetCurrency}\n` +
      `Rate: ${data.rate} | Fee: ${data.fee} | Status: ${data.status}`,
    );
  });

  // ── 4. get_quote
  server.tool('get_quote', 'Get a Wise quote by ID', {
    profile_id: z.string().describe('Profile ID'),
    quote_id: z.string().describe('Quote ID'),
  }, async ({ profile_id, quote_id }) => {
    const data = (await call('GET', `/wise/v3/profiles/${profile_id}/quotes/${quote_id}`)) as any;
    return text(
      `Quote ${data.id}: ${data.sourceAmount} ${data.sourceCurrency} -> ${data.targetAmount} ${data.targetCurrency}\n` +
      `Rate: ${data.rate} | Fee: ${data.fee} | Status: ${data.status}`,
    );
  });

  // ── 5. create_recipient
  server.tool('create_recipient', 'Create a Wise recipient', {
    profile: z.number().describe('Profile ID'),
    account_holder_name: z.string().describe('Recipient name'),
    currency: z.string().length(3).optional().describe('Currency code'),
    type: z.string().optional().describe('Account type (e.g. sort_code, iban)'),
    country: z.string().optional().describe('Country code'),
  }, async ({ profile, account_holder_name, currency, type, country }) => {
    const data = (await call('POST', '/wise/v1/accounts', {
      profile,
      accountHolderName: account_holder_name,
      currency: currency || 'GBP',
      type: type || 'sort_code',
      country: country || 'GB',
    })) as any;
    return text(`Recipient ${data.id}: ${data.accountHolderName} (${data.currency})`);
  });

  // ── 6. get_recipient
  server.tool('get_recipient', 'Get a Wise recipient by ID', {
    account_id: z.string().describe('Account/Recipient ID'),
  }, async ({ account_id }) => {
    const data = (await call('GET', `/wise/v1/accounts/${account_id}`)) as any;
    return text(`Recipient ${data.id}: ${data.accountHolderName} (${data.currency}) [active=${data.isActive}]`);
  });

  // ── 7. list_recipients
  server.tool('list_recipients', 'List Wise recipients', {
    profile: z.string().optional().describe('Filter by profile ID'),
    currency: z.string().optional().describe('Filter by currency'),
  }, async ({ profile, currency }) => {
    const qp = new URLSearchParams();
    if (profile) qp.set('profile', profile);
    if (currency) qp.set('currency', currency);
    const data = (await call('GET', `/wise/v1/accounts?${qp.toString()}`)) as any[];
    if (!data.length) return text('No recipients found.');
    const lines = data.map(
      (r: any) => `- ${r.id}: ${r.accountHolderName} (${r.currency})`,
    );
    return text(`Recipients (${data.length}):\n${lines.join('\n')}`);
  });

  // ── 8. delete_recipient
  server.tool('delete_recipient', 'Delete a Wise recipient', {
    account_id: z.string().describe('Account/Recipient ID'),
  }, async ({ account_id }) => {
    await call('DELETE', `/wise/v1/accounts/${account_id}`);
    return text(`Recipient ${account_id} deactivated`);
  });

  // ── 9. create_transfer
  server.tool('create_transfer', 'Create a Wise transfer', {
    target_account: z.number().describe('Recipient account ID'),
    quote_uuid: z.string().describe('Quote UUID'),
    reference: z.string().optional().describe('Transfer reference'),
  }, async ({ target_account, quote_uuid, reference }) => {
    const data = (await call('POST', '/wise/v1/transfers', {
      targetAccount: target_account,
      quoteUuid: quote_uuid,
      details: { reference: reference || 'Transfer' },
    })) as any;
    return text(
      `Transfer ${data.id}: ${data.sourceValue} ${data.sourceCurrency} -> ${data.targetValue} ${data.targetCurrency}\n` +
      `Status: ${data.status}`,
    );
  });

  // ── 10. get_transfer
  server.tool('get_transfer', 'Get a Wise transfer by ID', {
    transfer_id: z.string().describe('Transfer ID'),
  }, async ({ transfer_id }) => {
    const data = (await call('GET', `/wise/v1/transfers/${transfer_id}`)) as any;
    return text(
      `Transfer ${data.id}: ${data.sourceValue} ${data.sourceCurrency} -> ${data.targetValue} ${data.targetCurrency}\n` +
      `Status: ${data.status}`,
    );
  });

  // ── 11. list_transfers
  server.tool('list_transfers', 'List Wise transfers', {
    profile: z.string().optional().describe('Filter by profile ID'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ profile, status }) => {
    const qp = new URLSearchParams();
    if (profile) qp.set('profile', profile);
    if (status) qp.set('status', status);
    const data = (await call('GET', `/wise/v1/transfers?${qp.toString()}`)) as any[];
    if (!data.length) return text('No transfers found.');
    const lines = data.map(
      (t: any) => `- ${t.id}: ${t.sourceValue} ${t.sourceCurrency} -> ${t.targetValue} ${t.targetCurrency} [${t.status}]`,
    );
    return text(`Transfers (${data.length}):\n${lines.join('\n')}`);
  });

  // ── 12. cancel_transfer
  server.tool('cancel_transfer', 'Cancel a Wise transfer', {
    transfer_id: z.string().describe('Transfer ID'),
  }, async ({ transfer_id }) => {
    const data = (await call('PUT', `/wise/v1/transfers/${transfer_id}/cancel`)) as any;
    return text(`Transfer ${data.id} cancelled`);
  });

  // ── 13. fund_transfer
  server.tool('fund_transfer', 'Fund a Wise transfer', {
    profile_id: z.string().describe('Profile ID'),
    transfer_id: z.string().describe('Transfer ID'),
    type: z.string().optional().describe('Payment type (BALANCE, BANK_TRANSFER)'),
  }, async ({ profile_id, transfer_id, type }) => {
    const data = (await call(
      'POST',
      `/wise/v3/profiles/${profile_id}/transfers/${transfer_id}/payments`,
      { type: type || 'BALANCE' },
    )) as any;
    return text(`Transfer ${transfer_id} funded — payment status: ${data.status}`);
  });

  // ── 14. list_balances
  server.tool('list_balances', 'List Wise balances for a profile', {
    profile_id: z.string().describe('Profile ID'),
    types: z.string().optional().describe('Balance types (e.g. STANDARD,SAVINGS)'),
  }, async ({ profile_id, types }) => {
    const qp = new URLSearchParams();
    if (types) qp.set('types', types);
    const data = (await call('GET', `/wise/v4/profiles/${profile_id}/balances?${qp.toString()}`)) as any[];
    if (!data.length) return text('No balances found.');
    const lines = data.map(
      (b: any) => `- ${b.currency}: ${b.amount.value} (${b.type})`,
    );
    return text(`Balances (${data.length}):\n${lines.join('\n')}`);
  });

  // ── 15. get_exchange_rates
  server.tool('get_exchange_rates', 'Get Wise exchange rates', {
    source: z.string().length(3).optional().describe('Source currency code'),
    target: z.string().length(3).optional().describe('Target currency code'),
  }, async ({ source, target }) => {
    const qp = new URLSearchParams();
    if (source) qp.set('source', source);
    if (target) qp.set('target', target);
    const data = (await call('GET', `/wise/v1/rates?${qp.toString()}`)) as any[];
    const r = data[0];
    return text(`${r.source} -> ${r.target}: ${r.rate}`);
  });

  // ── 16. list_currencies
  server.tool('list_currencies', 'List all Wise-supported currencies', {}, async () => {
    const data = (await call('GET', '/wise/v1/currencies')) as any[];
    const lines = data.map((c: any) => `- ${c.code}: ${c.name} (${c.symbol})`);
    return text(`Currencies (${data.length}):\n${lines.join('\n')}`);
  });

  // ── 17. search_wise_documentation
  server.tool('search_wise_documentation', 'Search Wise API documentation', {
    query: z.string().describe('Topic to search'),
  }, async ({ query }) => {
    return text(
      `Wise API documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real docs, visit https://docs.wise.com\n\n` +
      `Transfer Flow: Create Profile -> Create Quote -> Create Recipient -> Create Transfer -> Fund Transfer\n\n` +
      `API Products:\n` +
      `- Profiles: GET /v2/profiles\n` +
      `- Quotes: POST /v3/profiles/{profileId}/quotes\n` +
      `- Recipients: POST /v1/accounts\n` +
      `- Transfers: POST /v1/transfers + PUT cancel + POST fund\n` +
      `- Balances: GET /v4/profiles/{profileId}/balances\n` +
      `- Exchange Rates: GET /v1/rates\n` +
      `- Currencies: GET /v1/currencies\n`,
    );
  });
}

/**
 * Create a standalone Mimic MCP server for Wise.
 */
export function createWiseMcpServer(
  baseUrl: string = 'http://localhost:4104',
): McpServer {
  const server = new McpServer({
    name: 'mimic-wise',
    version: '0.7.0',
    description:
      'Mimic MCP server for Wise — profiles, quotes, recipients, transfers, balances, exchange rates against mock data',
  });
  registerWiseTools(server, baseUrl);
  return server;
}

/**
 * Start the Wise MCP server on stdio transport.
 */
export async function startWiseMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4104';
  const server = createWiseMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Wise MCP server running on stdio');
}
