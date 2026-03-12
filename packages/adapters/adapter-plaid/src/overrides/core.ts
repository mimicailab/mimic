/**
 * Core Plaid override handlers — Item, Accounts, Auth, Identity, Balance, Transactions.
 *
 * Plaid is RPC-style (all POST, no path params). Resources are identified
 * by access_token in the request body, not by URL path parameters.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { StateStore } from '@mimicai/core';
import { generateId } from '@mimicai/adapter-sdk';
import {
  plaidResponse,
  plaidInvalidRequest,
  plaidItemError,
  plaidNotFound,
} from '../plaid-errors.js';
import { defaultItem, defaultAccount, defaultTransaction } from '../generated/schemas.js';

// ---------------------------------------------------------------------------
// Namespace helpers
// ---------------------------------------------------------------------------

const NS_ITEMS = 'plaid:items';
const NS_ACCOUNTS = 'plaid:accounts';
const NS_TRANSACTIONS = 'plaid:transactions';
const NS_ACCESS_TOKENS = 'plaid:access_tokens';
const NS_LINK_TOKENS = 'plaid:link_tokens';
const NS_INSTITUTIONS = 'plaid:institutions';
const NS_HOLDINGS = 'plaid:holdings';
const NS_SECURITIES = 'plaid:securities';
const NS_INVESTMENT_TRANSACTIONS = 'plaid:investment_transactions';

type Body = Record<string, unknown>;

function parseBody(req: FastifyRequest): Body {
  return (req.body ?? {}) as Body;
}

/**
 * Resolve an access_token to an item. Returns [item, null] on success or
 * [null, errorReply] on failure.
 */
function resolveItem(
  store: StateStore,
  accessToken: unknown,
  reply: FastifyReply,
): [Record<string, unknown> | null, boolean] {
  if (!accessToken || typeof accessToken !== 'string') {
    reply.code(400).send(plaidInvalidRequest('MISSING_FIELDS', 'access_token is required'));
    return [null, true];
  }

  const tokenEntry = store.get<{ item_id: string }>(NS_ACCESS_TOKENS, accessToken);
  if (!tokenEntry) {
    reply.code(400).send(plaidItemError('INVALID_ACCESS_TOKEN', `Invalid access_token: ${accessToken}`));
    return [null, true];
  }

  const item = store.get<Record<string, unknown>>(NS_ITEMS, tokenEntry.item_id);
  if (!item) {
    reply.code(400).send(plaidItemError('ITEM_NOT_FOUND', `Item not found for access_token`));
    return [null, true];
  }

  return [item, false];
}

/**
 * Get accounts for an item, optionally filtered by account_ids.
 */
function getAccountsForItem(store: StateStore, itemId: string, accountIds?: string[]): Record<string, unknown>[] {
  const allAccounts = store.list<Record<string, unknown>>(NS_ACCOUNTS);
  let accounts = allAccounts.filter(a => a.item_id === itemId);
  if (accountIds && accountIds.length > 0) {
    const idSet = new Set(accountIds);
    accounts = accounts.filter(a => idSet.has(a.account_id as string));
  }
  return accounts;
}

// ---------------------------------------------------------------------------
// Link Token
// ---------------------------------------------------------------------------

export function buildLinkTokenCreateHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const linkToken = 'link-sandbox-' + generateId('', 20);
    const expiration = new Date(Date.now() + 4 * 3600_000).toISOString();

    const tokenData = {
      link_token: linkToken,
      expiration,
      created_at: new Date().toISOString(),
      metadata: body,
    };
    store.set(NS_LINK_TOKENS, linkToken, tokenData);

    return reply.code(200).send(plaidResponse({
      link_token: linkToken,
      expiration,
      request_id: generateId('', 5),
    }));
  };
}

// ---------------------------------------------------------------------------
// Sandbox — Public Token Create + Exchange
// ---------------------------------------------------------------------------

export function buildSandboxPublicTokenCreateHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const institutionId = body.institution_id as string ?? 'ins_109508';
    const initialProducts = body.initial_products as string[] ?? ['transactions'];

    // Create a new item
    const item = defaultItem({
      institution_id: institutionId,
      available_products: ['assets', 'auth', 'balance', 'identity', 'investments', 'liabilities'],
      billed_products: initialProducts,
      products: initialProducts,
    });
    const itemId = item.item_id as string;
    store.set(NS_ITEMS, itemId, item);

    // Create default accounts for this item
    const checkingAccount = defaultAccount({
      item_id: itemId,
      name: 'Plaid Checking',
      official_name: 'Plaid Gold Standard 0% Interest Checking',
      type: 'depository',
      subtype: 'checking',
      mask: '0000',
      balances: { available: 100, current: 110, limit: null, iso_currency_code: 'USD', unofficial_currency_code: null },
    });
    const savingsAccount = defaultAccount({
      item_id: itemId,
      name: 'Plaid Saving',
      official_name: 'Plaid Silver Standard 0.1% Interest Saving',
      type: 'depository',
      subtype: 'savings',
      mask: '1111',
      balances: { available: 200, current: 210, limit: null, iso_currency_code: 'USD', unofficial_currency_code: null },
    });
    const creditAccount = defaultAccount({
      item_id: itemId,
      name: 'Plaid Credit Card',
      official_name: 'Plaid Diamond 12.5% APR Interest Credit Card',
      type: 'credit',
      subtype: 'credit card',
      mask: '3333',
      balances: { available: 2000, current: 410, limit: 2500, iso_currency_code: 'USD', unofficial_currency_code: null },
    });

    store.set(NS_ACCOUNTS, checkingAccount.account_id as string, checkingAccount);
    store.set(NS_ACCOUNTS, savingsAccount.account_id as string, savingsAccount);
    store.set(NS_ACCOUNTS, creditAccount.account_id as string, creditAccount);

    // Generate some sample transactions
    const now = new Date();
    const sampleTransactions = [
      { name: 'United Airlines', amount: -500, category: ['Travel', 'Airlines and Aviation Services'] },
      { name: 'McDonald\'s', amount: -12.50, category: ['Food and Drink', 'Restaurants', 'Fast Food'] },
      { name: 'Starbucks', amount: -4.33, category: ['Food and Drink', 'Restaurants', 'Coffee Shop'] },
      { name: 'SparkFun', amount: -89.40, category: ['Shops', 'Computers and Electronics'] },
      { name: 'AUTOMATIC PAYMENT - THANK', amount: 2078.50, category: ['Payment', 'Credit Card'] },
      { name: 'KFC', amount: -6.33, category: ['Food and Drink', 'Restaurants'] },
      { name: 'Madison Bicycle Shop', amount: -500, category: ['Shops', 'Sporting Goods'] },
      { name: 'Uber', amount: -5.40, category: ['Travel', 'Taxi'] },
    ];

    for (let i = 0; i < sampleTransactions.length; i++) {
      const sample = sampleTransactions[i]!;
      const txnDate = new Date(now.getTime() - (i + 1) * 86400_000);
      const txn = defaultTransaction({
        account_id: checkingAccount.account_id,
        item_id: itemId,
        amount: sample.amount,
        name: sample.name,
        merchant_name: sample.name.split(' ')[0],
        category: sample.category,
        category_id: '22001000',
        date: txnDate.toISOString().split('T')[0],
        authorized_date: txnDate.toISOString().split('T')[0],
        pending: false,
        payment_channel: 'in store',
        transaction_type: 'place',
      });
      store.set(NS_TRANSACTIONS, txn.transaction_id as string, txn);
    }

    // Create a public token
    const publicToken = 'public-sandbox-' + generateId('', 20);

    // Store mapping from public token to item
    store.set('plaid:public_tokens', publicToken, { item_id: itemId });

    return reply.code(200).send(plaidResponse({ public_token: publicToken }));
  };
}

export function buildItemPublicTokenExchangeHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const publicToken = body.public_token as string;

    if (!publicToken) {
      return reply.code(400).send(plaidInvalidRequest('MISSING_FIELDS', 'public_token is required'));
    }

    const tokenEntry = store.get<{ item_id: string }>('plaid:public_tokens', publicToken);
    if (!tokenEntry) {
      return reply.code(400).send(plaidInvalidRequest('INVALID_PUBLIC_TOKEN', `Invalid public_token: ${publicToken}`));
    }

    // Generate an access token
    const accessToken = 'access-sandbox-' + generateId('', 20);
    store.set(NS_ACCESS_TOKENS, accessToken, { item_id: tokenEntry.item_id });

    // Remove used public token
    store.delete('plaid:public_tokens', publicToken);

    return reply.code(200).send(plaidResponse({
      access_token: accessToken,
      item_id: tokenEntry.item_id,
    }));
  };
}

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

export function buildItemGetHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const [item, errored] = resolveItem(store, body.access_token, reply);
    if (errored) return;

    return reply.code(200).send(plaidResponse({
      item: item!,
      status: {
        investments: null,
        transactions: { last_successful_update: new Date().toISOString(), last_failed_update: null },
        last_webhook: null,
      },
    }));
  };
}

export function buildItemRemoveHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const [item, errored] = resolveItem(store, body.access_token, reply);
    if (errored) return;

    const itemId = item!.item_id as string;

    // Remove item and associated data
    store.delete(NS_ITEMS, itemId);
    store.delete(NS_ACCESS_TOKENS, body.access_token as string);

    // Remove associated accounts and transactions
    const accounts = store.list<Record<string, unknown>>(NS_ACCOUNTS)
      .filter(a => a.item_id === itemId);
    for (const account of accounts) {
      store.delete(NS_ACCOUNTS, account.account_id as string);
    }
    const transactions = store.list<Record<string, unknown>>(NS_TRANSACTIONS)
      .filter(t => (t as Body).item_id === itemId);
    for (const txn of transactions) {
      store.delete(NS_TRANSACTIONS, txn.transaction_id as string);
    }

    return reply.code(200).send(plaidResponse({ removed: true }));
  };
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export function buildAccountsGetHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const [item, errored] = resolveItem(store, body.access_token, reply);
    if (errored) return;

    const options = body.options as Body | undefined;
    const accountIds = options?.account_ids as string[] | undefined;
    const accounts = getAccountsForItem(store, item!.item_id as string, accountIds);

    return reply.code(200).send(plaidResponse({
      accounts,
      item: item!,
    }));
  };
}

export function buildAccountsBalanceGetHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const [item, errored] = resolveItem(store, body.access_token, reply);
    if (errored) return;

    const options = body.options as Body | undefined;
    const accountIds = options?.account_ids as string[] | undefined;
    const accounts = getAccountsForItem(store, item!.item_id as string, accountIds);

    return reply.code(200).send(plaidResponse({
      accounts,
      item: item!,
    }));
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function buildAuthGetHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const [item, errored] = resolveItem(store, body.access_token, reply);
    if (errored) return;

    const options = body.options as Body | undefined;
    const accountIds = options?.account_ids as string[] | undefined;
    const accounts = getAccountsForItem(store, item!.item_id as string, accountIds);

    // Generate ACH numbers for depository accounts
    const achNumbers = accounts
      .filter(a => a.type === 'depository')
      .map(a => ({
        account_id: a.account_id,
        account: (a.mask as string ?? '0000').padStart(9, '1'),
        routing: '011401533',
        wire_routing: '021000021',
      }));

    return reply.code(200).send(plaidResponse({
      accounts,
      numbers: {
        ach: achNumbers,
        eft: [],
        international: [],
        bacs: [],
      },
      item: item!,
    }));
  };
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export function buildTransactionsGetHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const [item, errored] = resolveItem(store, body.access_token, reply);
    if (errored) return;

    const startDate = body.start_date as string ?? '1970-01-01';
    const endDate = body.end_date as string ?? '2099-12-31';
    const options = body.options as Body | undefined;
    const accountIds = options?.account_ids as string[] | undefined;
    const count = (options?.count as number) ?? 100;
    const offset = (options?.offset as number) ?? 0;

    const itemId = item!.item_id as string;
    const accounts = getAccountsForItem(store, itemId, accountIds);
    const accountIdSet = new Set(accounts.map(a => a.account_id as string));

    let transactions = store.list<Record<string, unknown>>(NS_TRANSACTIONS)
      .filter(t => accountIdSet.has(t.account_id as string))
      .filter(t => {
        const date = t.date as string;
        return date >= startDate && date <= endDate;
      })
      .sort((a, b) => (b.date as string).localeCompare(a.date as string));

    const totalTransactions = transactions.length;
    transactions = transactions.slice(offset, offset + count);

    return reply.code(200).send(plaidResponse({
      accounts,
      transactions,
      total_transactions: totalTransactions,
      item: item!,
    }));
  };
}

export function buildTransactionsSyncHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const [item, errored] = resolveItem(store, body.access_token, reply);
    if (errored) return;

    const itemId = item!.item_id as string;
    const accounts = getAccountsForItem(store, itemId);
    const accountIdSet = new Set(accounts.map(a => a.account_id as string));

    // For simplicity, return all transactions as "added" when no cursor,
    // or empty when cursor is provided (simulating "caught up")
    const cursor = body.cursor as string | undefined;

    if (cursor) {
      return reply.code(200).send(plaidResponse({
        added: [],
        modified: [],
        removed: [],
        next_cursor: cursor,
        has_more: false,
      }));
    }

    const transactions = store.list<Record<string, unknown>>(NS_TRANSACTIONS)
      .filter(t => accountIdSet.has(t.account_id as string))
      .sort((a, b) => (b.date as string).localeCompare(a.date as string));

    const nextCursor = 'cursor-' + generateId('', 10);

    return reply.code(200).send(plaidResponse({
      added: transactions,
      modified: [],
      removed: [],
      next_cursor: nextCursor,
      has_more: false,
    }));
  };
}

export function buildTransactionsRefreshHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const [, errored] = resolveItem(store, body.access_token, reply);
    if (errored) return;

    return reply.code(200).send(plaidResponse({}));
  };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function buildIdentityGetHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const [item, errored] = resolveItem(store, body.access_token, reply);
    if (errored) return;

    const options = body.options as Body | undefined;
    const accountIds = options?.account_ids as string[] | undefined;
    const accounts = getAccountsForItem(store, item!.item_id as string, accountIds);

    // Enrich accounts with identity data
    const identityAccounts = accounts.map(account => ({
      ...account,
      owners: [{
        names: ['Alberta Bobbeth Charleson'],
        phone_numbers: [{ data: '1112223333', primary: true, type: 'home' }],
        emails: [{ data: 'accountholder0@example.com', primary: true, type: 'primary' }],
        addresses: [{
          data: {
            street: '2992 Cameron Road',
            city: 'Malvern',
            region: 'PA',
            postal_code: '19355',
            country: 'US',
          },
          primary: true,
        }],
        document_id: null,
      }],
    }));

    return reply.code(200).send(plaidResponse({
      accounts: identityAccounts,
      item: item!,
    }));
  };
}

// ---------------------------------------------------------------------------
// Institutions
// ---------------------------------------------------------------------------

export function buildInstitutionsGetHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const count = (body.count as number) ?? 20;
    const offset = (body.offset as number) ?? 0;

    let institutions = store.list<Record<string, unknown>>(NS_INSTITUTIONS);

    // Seed default institutions if empty
    if (institutions.length === 0) {
      seedDefaultInstitutions(store);
      institutions = store.list<Record<string, unknown>>(NS_INSTITUTIONS);
    }

    const total = institutions.length;
    const page = institutions.slice(offset, offset + count);

    return reply.code(200).send(plaidResponse({
      institutions: page,
      total,
    }));
  };
}

export function buildInstitutionsGetByIdHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const institutionId = body.institution_id as string;

    if (!institutionId) {
      return reply.code(400).send(plaidInvalidRequest('MISSING_FIELDS', 'institution_id is required'));
    }

    let institution = store.get<Record<string, unknown>>(NS_INSTITUTIONS, institutionId);
    if (!institution) {
      seedDefaultInstitutions(store);
      institution = store.get<Record<string, unknown>>(NS_INSTITUTIONS, institutionId);
    }
    if (!institution) {
      return reply.code(400).send(plaidNotFound('institution', institutionId));
    }

    return reply.code(200).send(plaidResponse({ institution }));
  };
}

export function buildInstitutionsSearchHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const query = ((body.query as string) ?? '').toLowerCase();

    let institutions = store.list<Record<string, unknown>>(NS_INSTITUTIONS);
    if (institutions.length === 0) {
      seedDefaultInstitutions(store);
      institutions = store.list<Record<string, unknown>>(NS_INSTITUTIONS);
    }

    const filtered = query
      ? institutions.filter(i => (i.name as string).toLowerCase().includes(query))
      : institutions;

    return reply.code(200).send(plaidResponse({ institutions: filtered }));
  };
}

function seedDefaultInstitutions(store: StateStore): void {
  const defaults = [
    { institution_id: 'ins_109508', name: 'First Platypus Bank', products: ['assets', 'auth', 'balance', 'transactions', 'identity', 'investments'], country_codes: ['US'], url: 'https://firstplatypus.com', primary_color: '#1f1f1f', logo: null, routing_numbers: ['011401533'] },
    { institution_id: 'ins_109509', name: 'First Gingham Credit Union', products: ['assets', 'auth', 'balance', 'transactions', 'identity'], country_codes: ['US'], url: 'https://firstgingham.com', primary_color: '#166b43', logo: null, routing_numbers: ['021000021'] },
    { institution_id: 'ins_109510', name: 'Tattersall Federal Credit Union', products: ['assets', 'auth', 'balance', 'transactions'], country_codes: ['US'], url: 'https://tattersall.com', primary_color: '#518aca', logo: null, routing_numbers: ['021200339'] },
    { institution_id: 'ins_109511', name: 'Tartan Bank', products: ['assets', 'auth', 'balance', 'transactions', 'identity'], country_codes: ['US'], url: 'https://tartanbank.com', primary_color: '#cb001a', logo: null, routing_numbers: ['011000015'] },
    { institution_id: 'ins_109512', name: 'Houndstooth Bank', products: ['assets', 'auth', 'balance', 'transactions'], country_codes: ['US'], url: 'https://houndstoothbank.com', primary_color: '#004966', logo: null, routing_numbers: ['021000089'] },
  ];

  for (const inst of defaults) {
    store.set(NS_INSTITUTIONS, inst.institution_id, inst);
  }
}

// ---------------------------------------------------------------------------
// Investments
// ---------------------------------------------------------------------------

export function buildInvestmentsHoldingsGetHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const [item, errored] = resolveItem(store, body.access_token, reply);
    if (errored) return;

    const itemId = item!.item_id as string;
    const accounts = getAccountsForItem(store, itemId)
      .filter(a => a.type === 'investment');
    const accountIdSet = new Set(accounts.map(a => a.account_id as string));

    const holdings = store.list<Record<string, unknown>>(NS_HOLDINGS)
      .filter(h => accountIdSet.has(h.account_id as string));

    const securityIds = new Set(holdings.map(h => h.security_id as string));
    const securities = store.list<Record<string, unknown>>(NS_SECURITIES)
      .filter(s => securityIds.has(s.security_id as string));

    return reply.code(200).send(plaidResponse({
      accounts,
      holdings,
      securities,
      item: item!,
    }));
  };
}

export function buildInvestmentsTransactionsGetHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const [item, errored] = resolveItem(store, body.access_token, reply);
    if (errored) return;

    const startDate = body.start_date as string ?? '1970-01-01';
    const endDate = body.end_date as string ?? '2099-12-31';
    const itemId = item!.item_id as string;
    const accounts = getAccountsForItem(store, itemId)
      .filter(a => a.type === 'investment');
    const accountIdSet = new Set(accounts.map(a => a.account_id as string));

    const investmentTransactions = store.list<Record<string, unknown>>(NS_INVESTMENT_TRANSACTIONS)
      .filter(t => accountIdSet.has(t.account_id as string))
      .filter(t => {
        const date = t.date as string;
        return date >= startDate && date <= endDate;
      });

    const securityIds = new Set(investmentTransactions.map(t => t.security_id as string));
    const securities = store.list<Record<string, unknown>>(NS_SECURITIES)
      .filter(s => securityIds.has(s.security_id as string));

    return reply.code(200).send(plaidResponse({
      accounts,
      investment_transactions: investmentTransactions,
      total_investment_transactions: investmentTransactions.length,
      securities,
      item: item!,
    }));
  };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function buildCategoriesGetHandler() {
  return async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(plaidResponse({
      categories: [
        { category_id: '10000000', group: 'special', hierarchy: ['Bank Fees'] },
        { category_id: '10001000', group: 'special', hierarchy: ['Bank Fees', 'Overdraft'] },
        { category_id: '12001000', group: 'place', hierarchy: ['Community', 'Animal Shelter'] },
        { category_id: '13001000', group: 'place', hierarchy: ['Food and Drink', 'Bar'] },
        { category_id: '13005000', group: 'place', hierarchy: ['Food and Drink', 'Restaurants'] },
        { category_id: '13005001', group: 'place', hierarchy: ['Food and Drink', 'Restaurants', 'Coffee Shop'] },
        { category_id: '13005002', group: 'place', hierarchy: ['Food and Drink', 'Restaurants', 'Fast Food'] },
        { category_id: '16001000', group: 'place', hierarchy: ['Payment', 'Credit Card'] },
        { category_id: '18006000', group: 'place', hierarchy: ['Shops', 'Computers and Electronics'] },
        { category_id: '18045000', group: 'place', hierarchy: ['Shops', 'Sporting Goods'] },
        { category_id: '22001000', group: 'place', hierarchy: ['Travel', 'Airlines and Aviation Services'] },
        { category_id: '22016000', group: 'place', hierarchy: ['Travel', 'Taxi'] },
      ],
    }));
  };
}

// ---------------------------------------------------------------------------
// Sandbox Helpers
// ---------------------------------------------------------------------------

export function buildSandboxItemResetLoginHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(req);
    const [item, errored] = resolveItem(store, body.access_token, reply);
    if (errored) return;

    // Set item error to ITEM_LOGIN_REQUIRED
    const updated = {
      ...item!,
      error: {
        error_type: 'ITEM_ERROR',
        error_code: 'ITEM_LOGIN_REQUIRED',
        error_message: 'the login details of this item have changed',
        display_message: 'The login details of this item have changed. Please update your credentials.',
        status: 400,
      },
    };
    store.set(NS_ITEMS, item!.item_id as string, updated);

    return reply.code(200).send(plaidResponse({ reset_login: true }));
  };
}
