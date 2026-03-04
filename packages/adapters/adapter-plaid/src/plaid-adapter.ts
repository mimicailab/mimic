import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, AdapterContext } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import {
  BaseApiMockAdapter,
  generateId,
  filterByDate,
  unixNow,
} from '@mimicai/adapter-sdk';
import { PlaidConfigSchema, type PlaidConfig } from './config.js';
import { plaidError } from './plaid-errors.js';
import { formatPlaidAccount, formatPlaidTransaction } from './formatters.js';
import { registerPlaidTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  accounts: 'plaid_accounts',
  transactions: 'plaid_transactions',
  tokens: 'plaid_tokens',
  personas: 'plaid_personas',
} as const;

/**
 * Plaid API mock adapter.
 *
 * All Plaid API endpoints are POST. Persona resolution is done via
 * access_token in the request body.
 */
export class PlaidAdapter extends BaseApiMockAdapter<PlaidConfig> {
  readonly id = 'plaid';
  readonly name = 'Plaid API';
  readonly basePath = '/plaid';
  readonly versions = ['2020-09-14'];

  async init(config: PlaidConfig, context: AdapterContext): Promise<void> {
    await super.init(config, context);
    this.config = PlaidConfigSchema.parse(config);
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerPlaidTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body) return null;

    const accessToken = body.access_token;
    if (typeof accessToken !== 'string') return null;

    const match = accessToken.match(/^access-([a-z0-9-]+)-/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // ── Seed StateStore from apiResponses ────────────────────────────
    this.seedFromApiResponses(data, store);

    // ── 1. Link token create ──────────────────────────────────────────
    server.post('/plaid/link/token/create', async (_req, reply) => {
      return reply.send({
        link_token: generateId('link-sandbox', 24),
        expiration: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        request_id: generateId('req', 16),
      });
    });

    // ── 2. Token exchange ─────────────────────────────────────────────
    server.post('/plaid/item/public_token/exchange', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const publicToken = String(body?.public_token ?? '');

      const personaMatch = publicToken.match(/public-sandbox-([a-z0-9-]+)/);
      const personaId = personaMatch ? personaMatch[1] : 'default';

      const accessToken = `access-${personaId}-${generateId('tok', 12)}`;
      const itemId = generateId('item', 16);

      store.set(NS.tokens, accessToken, { personaId, itemId });

      return reply.send({
        access_token: accessToken,
        item_id: itemId,
        request_id: generateId('req', 16),
      });
    });

    // ── 3. Get accounts ───────────────────────────────────────────────
    server.post('/plaid/accounts/get', async (req, reply) => {
      const personaId = this.resolvePersona(req);
      if (!personaId) {
        return reply.code(400).send(plaidError('INVALID_ACCESS_TOKEN'));
      }

      const accounts = this.getPersonaAccounts(store, personaId);

      return reply.send({
        accounts,
        item: { item_id: generateId('item', 16), institution_id: 'ins_1' },
        request_id: generateId('req', 16),
      });
    });

    // ── 4. Get transactions ───────────────────────────────────────────
    server.post('/plaid/transactions/get', async (req, reply) => {
      const personaId = this.resolvePersona(req);
      if (!personaId) {
        return reply.code(400).send(plaidError('INVALID_ACCESS_TOKEN'));
      }

      const body = req.body as Record<string, unknown>;
      const startDate = body.start_date as string | undefined;
      const endDate = body.end_date as string | undefined;
      const offset = Number(body.offset ?? 0);
      const count = Number(body.count ?? 100);

      let transactions = this.getPersonaTransactions(store, personaId);
      if (startDate || endDate) {
        transactions = filterByDate(transactions, 'date', startDate, endDate);
      }

      const totalTransactions = transactions.length;
      const paged = transactions.slice(offset, offset + count);
      const formatted = paged.map((tx) => formatPlaidTransaction(tx, this.config));
      const accounts = this.getPersonaAccounts(store, personaId);

      return reply.send({
        accounts,
        transactions: formatted,
        total_transactions: totalTransactions,
        request_id: generateId('req', 16),
      });
    });

    // ── 5. Transactions sync ──────────────────────────────────────────
    server.post('/plaid/transactions/sync', async (req, reply) => {
      const personaId = this.resolvePersona(req);
      if (!personaId) {
        return reply.code(400).send(plaidError('INVALID_ACCESS_TOKEN'));
      }

      const transactions = this.getPersonaTransactions(store, personaId)
        .map((tx) => formatPlaidTransaction(tx, this.config));

      return reply.send({
        added: transactions,
        modified: [],
        removed: [],
        next_cursor: generateId('cursor', 24),
        has_more: false,
        request_id: generateId('req', 16),
      });
    });

    // ── 6. Auth get ───────────────────────────────────────────────────
    server.post('/plaid/auth/get', async (req, reply) => {
      const personaId = this.resolvePersona(req);
      if (!personaId) {
        return reply.code(400).send(plaidError('INVALID_ACCESS_TOKEN'));
      }

      const accounts = this.getPersonaAccounts(store, personaId);
      const numbers = {
        ach: accounts.map((acct) => ({
          account_id: acct.account_id,
          account: acct.mask,
          routing: '011401533',
          wire_routing: '021000021',
        })),
        eft: [],
        international: [],
        bacs: [],
      };

      return reply.send({
        accounts,
        numbers,
        item: { item_id: generateId('item', 16), institution_id: 'ins_1' },
        request_id: generateId('req', 16),
      });
    });

    // ── 7. Identity get ───────────────────────────────────────────────
    server.post('/plaid/identity/get', async (req, reply) => {
      const personaId = this.resolvePersona(req);
      if (!personaId) {
        return reply.code(400).send(plaidError('INVALID_ACCESS_TOKEN'));
      }

      const personaInfo = store.get<{ name?: string; location?: string }>(NS.personas, personaId);
      const personaName = personaInfo?.name ?? personaId;
      const location = personaInfo?.location ?? 'Unknown';

      const accounts = this.getPersonaAccounts(store, personaId).map((acct) => ({
        ...acct,
        owners: [
          {
            names: [personaName],
            emails: [{ data: `${personaName.toLowerCase().replace(/\s+/g, '.')}@example.com`, primary: true, type: 'primary' }],
            phone_numbers: [{ data: '+15551234567', primary: true, type: 'mobile' }],
            addresses: [{
              data: {
                street: '123 Main St',
                city: location.split(',')[0]?.trim() ?? 'Austin',
                region: location.split(',')[1]?.trim() ?? 'TX',
                postal_code: '78701',
                country: 'US',
              },
              primary: true,
            }],
          },
        ],
      }));

      return reply.send({
        accounts,
        item: { item_id: generateId('item', 16), institution_id: 'ins_1' },
        request_id: generateId('req', 16),
      });
    });

    // ── 8. Balance get ────────────────────────────────────────────────
    server.post('/plaid/accounts/balance/get', async (req, reply) => {
      const personaId = this.resolvePersona(req);
      if (!personaId) {
        return reply.code(400).send(plaidError('INVALID_ACCESS_TOKEN'));
      }

      return reply.send({
        accounts: this.getPersonaAccounts(store, personaId),
        item: { item_id: generateId('item', 16), institution_id: 'ins_1' },
        request_id: generateId('req', 16),
      });
    });

    // ── 9. Investments holdings get ───────────────────────────────────
    server.post('/plaid/investments/holdings/get', async (req, reply) => {
      const personaId = this.resolvePersona(req);
      if (!personaId) {
        return reply.code(400).send(plaidError('INVALID_ACCESS_TOKEN'));
      }

      return reply.send({
        accounts: this.getPersonaAccounts(store, personaId),
        holdings: [],
        securities: [],
        item: { item_id: generateId('item', 16), institution_id: 'ins_1' },
        request_id: generateId('req', 16),
      });
    });

    // ── 10. Liabilities get ───────────────────────────────────────────
    server.post('/plaid/liabilities/get', async (req, reply) => {
      const personaId = this.resolvePersona(req);
      if (!personaId) {
        return reply.code(400).send(plaidError('INVALID_ACCESS_TOKEN'));
      }

      return reply.send({
        accounts: this.getPersonaAccounts(store, personaId),
        liabilities: { credit: [], mortgage: [], student: [] },
        item: { item_id: generateId('item', 16), institution_id: 'ins_1' },
        request_id: generateId('req', 16),
      });
    });
  }

  // ── Cross-surface seeding ──────────────────────────────────────────────

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [personaId, expanded] of data) {
      const plaidData = expanded.apiResponses?.plaid;
      if (!plaidData) continue;

      // Store persona info for identity endpoint
      const persona = expanded.blueprint?.persona as unknown as Record<string, unknown> | undefined;
      if (persona) {
        store.set(NS.personas, personaId, { name: persona.name, location: persona.location });
      }

      // Seed accounts
      for (const response of plaidData.responses?.accounts ?? []) {
        const body = response.body as Record<string, unknown>;
        const formatted = formatPlaidAccount(body);
        store.set(NS.accounts, `${personaId}:${formatted.account_id}`, formatted);
      }

      // Seed transactions
      for (const response of plaidData.responses?.transactions ?? []) {
        const body = response.body as Record<string, unknown>;
        const txId = String(body.id ?? generateId('txn', 12));
        store.set(NS.transactions, `${personaId}:${txId}`, body);
      }

      // Register a default access token for this persona
      const defaultToken = `access-${personaId}-token`;
      store.set(NS.tokens, defaultToken, { personaId, itemId: generateId('item', 16) });
    }
  }

  private getPersonaAccounts(
    store: StateStore,
    personaId: string,
  ): ReturnType<typeof formatPlaidAccount>[] {
    return store.filter<ReturnType<typeof formatPlaidAccount>>(
      NS.accounts,
      (_item, key) => key.startsWith(`${personaId}:`),
    );
  }

  private getPersonaTransactions(
    store: StateStore,
    personaId: string,
  ): Record<string, unknown>[] {
    return store.filter<Record<string, unknown>>(
      NS.transactions,
      (_item, key) => key.startsWith(`${personaId}:`),
    );
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      { method: 'POST', path: '/plaid/link/token/create', description: 'Create a link token' },
      { method: 'POST', path: '/plaid/item/public_token/exchange', description: 'Exchange public token for access token' },
      { method: 'POST', path: '/plaid/accounts/get', description: 'Get accounts' },
      { method: 'POST', path: '/plaid/transactions/get', description: 'Get transactions with date range and pagination' },
      { method: 'POST', path: '/plaid/transactions/sync', description: 'Sync transactions (incremental)' },
      { method: 'POST', path: '/plaid/auth/get', description: 'Get account and routing numbers' },
      { method: 'POST', path: '/plaid/identity/get', description: 'Get account owner identity' },
      { method: 'POST', path: '/plaid/accounts/balance/get', description: 'Get real-time balances' },
      { method: 'POST', path: '/plaid/investments/holdings/get', description: 'Get investment holdings' },
      { method: 'POST', path: '/plaid/liabilities/get', description: 'Get liabilities' },
    ];
  }
}
