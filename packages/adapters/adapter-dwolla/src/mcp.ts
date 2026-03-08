import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCall(baseUrl: string) {
  return async (method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/vnd.dwolla.v1.hal+json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 201 && res.status !== 202 && res.status !== 204) {
      const text = await res.text();
      throw new Error(`Dwolla mock error ${res.status}: ${text}`);
    }
    if (res.status === 204 || res.status === 202) return {};
    return res.json();
  };
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function registerDwollaTools(
  server: McpServer,
  baseUrl: string = 'http://localhost:4104',
): void {
  const call = makeCall(baseUrl);

  // ── 1. get_access_token
  server.tool('get_access_token', 'Get a Dwolla OAuth2 access token', {}, async () => {
    const data = await call('POST', '/dwolla/token', undefined, {
      Authorization: 'Basic dGVzdDp0ZXN0',
    }) as any;
    return text(`Token: ${data.access_token}\nExpires: ${data.expires_in}s`);
  });

  // ── 2. create_customer
  server.tool('create_customer', 'Create a Dwolla customer', {
    firstName: z.string().describe('First name'),
    lastName: z.string().describe('Last name'),
    email: z.string().describe('Email address'),
    type: z.enum(['personal', 'business', 'receive-only']).optional().describe('Customer type'),
  }, async ({ firstName, lastName, email, type }) => {
    const data = await call('POST', '/dwolla/customers', {
      firstName, lastName, email, type: type || 'personal',
    }) as any;
    return text(`Customer ${data.id} created [${data.status}] — ${data.firstName} ${data.lastName}`);
  });

  // ── 3. list_customers
  server.tool('list_customers', 'List Dwolla customers', {
    search: z.string().optional().describe('Search by name or email'),
    status: z.string().optional().describe('Filter by status'),
  }, async ({ search, status }) => {
    const qp = new URLSearchParams();
    if (search) qp.set('search', search);
    if (status) qp.set('status', status);
    const data = await call('GET', `/dwolla/customers?${qp.toString()}`) as any;
    const customers = data._embedded?.customers || [];
    if (!customers.length) return text('No customers found.');
    const lines = customers.map((c: any) =>
      `- ${c.id} — ${c.firstName} ${c.lastName} (${c.email}) [${c.status}]`,
    );
    return text(`Customers (${data.total}):\n${lines.join('\n')}`);
  });

  // ── 4. get_customer
  server.tool('get_customer', 'Get a Dwolla customer by ID', {
    customer_id: z.string().describe('Customer ID'),
  }, async ({ customer_id }) => {
    const data = await call('GET', `/dwolla/customers/${customer_id}`) as any;
    return text(`Customer ${data.id}: ${data.firstName} ${data.lastName} (${data.email}) [${data.status}]`);
  });

  // ── 5. create_funding_source
  server.tool('create_funding_source', 'Create a funding source for a customer', {
    customer_id: z.string().describe('Customer ID'),
    routingNumber: z.string().describe('Bank routing number'),
    accountNumber: z.string().describe('Bank account number'),
    bankAccountType: z.enum(['checking', 'savings']).describe('Bank account type'),
    name: z.string().describe('Funding source name'),
  }, async ({ customer_id, routingNumber, accountNumber, bankAccountType, name }) => {
    const data = await call('POST', `/dwolla/customers/${customer_id}/funding-sources`, {
      routingNumber, accountNumber, bankAccountType, name,
    }) as any;
    return text(`Funding source ${data.id} created [${data.status}] — ${data.name}`);
  });

  // ── 6. get_funding_source
  server.tool('get_funding_source', 'Get a funding source by ID', {
    funding_source_id: z.string().describe('Funding source ID'),
  }, async ({ funding_source_id }) => {
    const data = await call('GET', `/dwolla/funding-sources/${funding_source_id}`) as any;
    return text(`Funding source ${data.id}: ${data.name} [${data.status}] — ${data.bankAccountType}`);
  });

  // ── 7. verify_micro_deposits
  server.tool('verify_micro_deposits', 'Verify micro-deposits on a funding source', {
    funding_source_id: z.string().describe('Funding source ID'),
    amount1: z.string().describe('First micro-deposit amount (e.g. "0.03")'),
    amount2: z.string().describe('Second micro-deposit amount (e.g. "0.09")'),
  }, async ({ funding_source_id, amount1, amount2 }) => {
    const data = await call('POST', `/dwolla/funding-sources/${funding_source_id}/micro-deposits`, {
      amount1: { value: amount1, currency: 'USD' },
      amount2: { value: amount2, currency: 'USD' },
    }) as any;
    return text(`Funding source ${funding_source_id} verification: ${data.status || 'submitted'}`);
  });

  // ── 8. create_transfer
  server.tool('create_transfer', 'Create a Dwolla transfer', {
    source_href: z.string().describe('Source funding source URL'),
    destination_href: z.string().describe('Destination funding source URL'),
    amount: z.string().describe('Transfer amount (e.g. "50.00")'),
    currency: z.string().optional().describe('Currency (default USD)'),
  }, async ({ source_href, destination_href, amount, currency }) => {
    const data = await call('POST', '/dwolla/transfers', {
      _links: {
        source: { href: source_href },
        destination: { href: destination_href },
      },
      amount: { value: amount, currency: currency || 'USD' },
    }) as any;
    return text(`Transfer ${data.id} created [${data.status}] — ${data.amount?.value} ${data.amount?.currency}`);
  });

  // ── 9. get_transfer
  server.tool('get_transfer', 'Get a transfer by ID', {
    transfer_id: z.string().describe('Transfer ID'),
  }, async ({ transfer_id }) => {
    const data = await call('GET', `/dwolla/transfers/${transfer_id}`) as any;
    return text(`Transfer ${data.id}: ${data.amount?.value} ${data.amount?.currency} [${data.status}]`);
  });

  // ── 10. cancel_transfer
  server.tool('cancel_transfer', 'Cancel a pending transfer', {
    transfer_id: z.string().describe('Transfer ID'),
  }, async ({ transfer_id }) => {
    const data = await call('POST', `/dwolla/transfers/${transfer_id}`, { status: 'cancelled' }) as any;
    return text(`Transfer ${transfer_id} cancelled [${data.status}]`);
  });

  // ── 11. create_mass_payment
  server.tool('create_mass_payment', 'Create a mass payment', {
    source_href: z.string().describe('Source funding source URL'),
    items: z.array(z.object({
      destination_href: z.string().describe('Destination funding source URL'),
      amount: z.string().describe('Amount (e.g. "25.00")'),
    })).describe('Payment items'),
    deferred: z.boolean().optional().describe('Create as deferred'),
  }, async ({ source_href, items, deferred }) => {
    const data = await call('POST', '/dwolla/mass-payments', {
      _links: { source: { href: source_href } },
      items: items.map((i) => ({
        _links: { destination: { href: i.destination_href } },
        amount: { value: i.amount, currency: 'USD' },
      })),
      status: deferred ? 'deferred' : undefined,
    }) as any;
    return text(`Mass payment ${data.id} created [${data.status}] — total ${data.total?.value} ${data.total?.currency}`);
  });

  // ── 12. get_mass_payment
  server.tool('get_mass_payment', 'Get a mass payment by ID', {
    mass_payment_id: z.string().describe('Mass payment ID'),
  }, async ({ mass_payment_id }) => {
    const data = await call('GET', `/dwolla/mass-payments/${mass_payment_id}`) as any;
    return text(`Mass payment ${data.id}: ${data.total?.value} ${data.total?.currency} [${data.status}]`);
  });

  // ── 13. list_events
  server.tool('list_events', 'List Dwolla events', {
    limit: z.number().optional().describe('Max results'),
  }, async ({ limit }) => {
    const qp = new URLSearchParams();
    if (limit) qp.set('limit', String(limit));
    const data = await call('GET', `/dwolla/events?${qp.toString()}`) as any;
    const events = data._embedded?.events || [];
    if (!events.length) return text('No events found.');
    const lines = events.map((e: any) => `- ${e.id} — ${e.topic}`);
    return text(`Events (${data.total}):\n${lines.join('\n')}`);
  });

  // ── 14. create_webhook_subscription
  server.tool('create_webhook_subscription', 'Create a webhook subscription', {
    url: z.string().describe('Webhook URL'),
    secret: z.string().describe('Webhook secret'),
  }, async ({ url, secret }) => {
    const data = await call('POST', '/dwolla/webhook-subscriptions', { url, secret }) as any;
    return text(`Webhook subscription ${data.id} created for ${data.url}`);
  });

  // ── 15. list_webhook_subscriptions
  server.tool('list_webhook_subscriptions', 'List webhook subscriptions', {}, async () => {
    const data = await call('GET', '/dwolla/webhook-subscriptions') as any;
    const subs = data._embedded?.['webhook-subscriptions'] || [];
    if (!subs.length) return text('No webhook subscriptions found.');
    const lines = subs.map((s: any) => `- ${s.id} — ${s.url} [paused=${s.paused}]`);
    return text(`Webhook subscriptions (${data.total}):\n${lines.join('\n')}`);
  });

  // ── 16. search_dwolla_documentation
  server.tool('search_dwolla_documentation', 'Search Dwolla documentation', {
    query: z.string().describe('Topic to search'),
  }, async ({ query }) => {
    return text(
      `Dwolla documentation search for "${query}":\n\n` +
      `This is a mock Mimic server. For real docs, visit https://developers.dwolla.com\n\n` +
      `ACH Payment Flow: Create Customer -> Add Funding Source -> Verify -> Transfer\n\n` +
      `API Resources:\n` +
      `- Customers: POST/GET /customers\n` +
      `- Funding Sources: POST/GET /funding-sources\n` +
      `- Transfers: POST/GET /transfers\n` +
      `- Mass Payments: POST/GET /mass-payments (up to 5000 items)\n` +
      `- Events: GET /events\n` +
      `- Webhooks: POST/GET /webhook-subscriptions\n`,
    );
  });
}

/**
 * Create a standalone Mimic MCP server for Dwolla.
 */
export function createDwollaMcpServer(
  baseUrl: string = 'http://localhost:4104',
): McpServer {
  const server = new McpServer({
    name: 'mimic-dwolla',
    version: '0.7.0',
    description:
      'Mimic MCP server for Dwolla — customers, funding sources, transfers, mass payments, events, webhooks against mock data',
  });
  registerDwollaTools(server, baseUrl);
  return server;
}

/**
 * Start the Dwolla MCP server on stdio transport.
 */
export async function startDwollaMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4104';
  const server = createDwollaMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic Dwolla MCP server running on stdio');
}
