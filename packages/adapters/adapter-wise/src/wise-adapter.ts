import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { WiseConfig } from './config.js';
import { wiseError } from './wise-errors.js';
import { registerWiseTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  profiles: 'wise_profiles',
  quotes: 'wise_quotes',
  recipients: 'wise_recipients',
  transfers: 'wise_transfers',
  balances: 'wise_balances',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a Wise-style integer ID */
function wiseIntId(): number {
  return Math.floor(100_000_000 + Math.random() * 900_000_000);
}

/** Generate a UUID v4 */
function wiseUuid(): string {
  return generateId('', 32).replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    '$1-$2-$3-$4-$5',
  );
}

/** Deterministic-ish mock exchange rates for common pairs */
function getMockRate(source: string, target: string): number {
  const toUsd: Record<string, number> = {
    USD: 1.0, GBP: 1.27, EUR: 1.09, CAD: 0.74, AUD: 0.66,
    JPY: 0.0067, INR: 0.012, SGD: 0.75, HKD: 0.128, PLN: 0.25,
    CHF: 1.13, SEK: 0.096, NOK: 0.094, DKK: 0.146, NZD: 0.61,
    BRL: 0.20, MXN: 0.058, ZAR: 0.055, TRY: 0.031, THB: 0.028,
  };
  const srcUsd = toUsd[source] || 1.0;
  const tgtUsd = toUsd[target] || 1.0;
  return +(srcUsd / tgtUsd).toFixed(6);
}

// ---------------------------------------------------------------------------
// Wise Adapter
// ---------------------------------------------------------------------------

export class WiseAdapter extends BaseApiMockAdapter<WiseConfig> {
  readonly id = 'wise';
  readonly name = 'Wise API';
  readonly basePath = '/wise';
  readonly versions = ['v4', 'v3', 'v2', 'v1'];

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerWiseTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const token = auth.replace('Bearer ', '');
    const match = token.match(/^wise_([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // ── Seed from expanded apiResponses ──────────────────────────────────
    this.seedFromApiResponses(data, store);

    // ══════════════════════════════════════════════════════════════════════
    //  PROFILES
    // ══════════════════════════════════════════════════════════════════════

    server.get('/wise/v2/profiles', async (_req, reply) => {
      const profiles = store.list<any>(NS.profiles);
      if (profiles.length === 0) {
        const personal = {
          id: wiseIntId(),
          type: 'personal',
          fullName: 'Test User',
          details: {
            firstName: 'Test',
            lastName: 'User',
            dateOfBirth: '1990-01-01',
            phoneNumber: '+1234567890',
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        store.set(NS.profiles, String(personal.id), personal);
        return reply.send([personal]);
      }
      return reply.send(profiles);
    });

    server.get('/wise/v2/profiles/:profileId', async (req, reply) => {
      const { profileId } = req.params as any;
      const profile = store.get<any>(NS.profiles, String(profileId));
      if (!profile) {
        return reply
          .status(404)
          .send(wiseError('PROFILE_NOT_FOUND', `Profile ${profileId} not found`));
      }
      return reply.send(profile);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  QUOTES
    // ══════════════════════════════════════════════════════════════════════

    server.post('/wise/v3/profiles/:profileId/quotes', async (req, reply) => {
      const { profileId } = req.params as any;
      const body = req.body as any;
      const profile = store.get<any>(NS.profiles, String(profileId));
      if (!profile) {
        return reply
          .status(404)
          .send(wiseError('PROFILE_NOT_FOUND', `Profile ${profileId} not found`));
      }

      const sourceCurrency = body.sourceCurrency || 'GBP';
      const targetCurrency = body.targetCurrency || 'EUR';
      const sourceAmount = body.sourceAmount || null;
      const targetAmount = body.targetAmount || null;
      const rate = getMockRate(sourceCurrency, targetCurrency);
      const fee = sourceAmount ? +(sourceAmount * 0.0045).toFixed(2) : 2.50;

      const computedSourceAmount = sourceAmount
        || (targetAmount ? +(targetAmount / rate + fee).toFixed(2) : 100.00);
      const computedTargetAmount = targetAmount
        || +((computedSourceAmount - fee) * rate).toFixed(2);

      const quote = {
        id: wiseUuid(),
        sourceCurrency,
        targetCurrency,
        sourceAmount: computedSourceAmount,
        targetAmount: computedTargetAmount,
        type: body.targetAmount ? 'FIXED_TARGET' : 'FIXED_SOURCE',
        rate,
        createdTime: new Date().toISOString(),
        user: Number(profileId),
        profile: Number(profileId),
        rateType: 'FIXED',
        deliveryEstimate: new Date(Date.now() + 86400_000).toISOString(),
        fee,
        feeDetails: {
          transferwise: fee,
          payIn: 0,
          discount: 0,
          total: fee,
        },
        allowedPairCodes: null,
        status: 'PENDING',
        expirationTime: new Date(Date.now() + 1800_000).toISOString(),
        paymentOptions: [
          {
            payInProduct: 'BALANCE',
            disabled: false,
            estimatedDelivery: new Date(Date.now() + 86400_000).toISOString(),
            fee: { transferwise: fee, payIn: 0, discount: 0, total: fee },
          },
          {
            payInProduct: 'BANK_TRANSFER',
            disabled: false,
            estimatedDelivery: new Date(Date.now() + 2 * 86400_000).toISOString(),
            fee: { transferwise: fee, payIn: 0.50, discount: 0, total: fee + 0.50 },
          },
        ],
      };
      store.set(NS.quotes, quote.id, quote);
      return reply.status(200).send(quote);
    });

    server.get('/wise/v3/profiles/:profileId/quotes/:quoteId', async (req, reply) => {
      const { quoteId } = req.params as any;
      const quote = store.get<any>(NS.quotes, quoteId);
      if (!quote) {
        return reply
          .status(404)
          .send(wiseError('QUOTE_NOT_FOUND', `Quote ${quoteId} not found`));
      }
      return reply.send(quote);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  RECIPIENTS (Accounts)
    // ══════════════════════════════════════════════════════════════════════

    server.post('/wise/v1/accounts', async (req, reply) => {
      const body = req.body as any;
      const recipient = {
        id: wiseIntId(),
        profile: body.profile,
        accountHolderName: body.accountHolderName || 'Recipient Name',
        type: body.type || 'sort_code',
        currency: body.currency || 'GBP',
        country: body.country || 'GB',
        details: body.details || {},
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.set(NS.recipients, String(recipient.id), recipient);
      return reply.status(200).send(recipient);
    });

    server.get('/wise/v1/accounts/:accountId', async (req, reply) => {
      const { accountId } = req.params as any;
      const recipient = store.get<any>(NS.recipients, String(accountId));
      if (!recipient) {
        return reply
          .status(404)
          .send(wiseError('RECIPIENT_NOT_FOUND', `Recipient ${accountId} not found`));
      }
      return reply.send(recipient);
    });

    server.get('/wise/v1/accounts', async (req, reply) => {
      const query = req.query as any;
      let recipients = store.list<any>(NS.recipients);
      if (query.profile) {
        recipients = recipients.filter(
          (r: any) => String(r.profile) === String(query.profile),
        );
      }
      if (query.currency) {
        recipients = recipients.filter((r: any) => r.currency === query.currency);
      }
      return reply.send(recipients.filter((r: any) => r.isActive));
    });

    server.delete('/wise/v1/accounts/:accountId', async (req, reply) => {
      const { accountId } = req.params as any;
      const recipient = store.get<any>(NS.recipients, String(accountId));
      if (!recipient) {
        return reply
          .status(404)
          .send(wiseError('RECIPIENT_NOT_FOUND', `Recipient ${accountId} not found`));
      }
      store.update(NS.recipients, String(accountId), { isActive: false });
      return reply.status(200).send({ ...recipient, isActive: false });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  TRANSFERS
    // ══════════════════════════════════════════════════════════════════════

    server.post('/wise/v1/transfers', async (req, reply) => {
      const body = req.body as any;
      const quote = body.quoteUuid
        ? store.get<any>(NS.quotes, body.quoteUuid)
        : null;

      const transfer = {
        id: wiseIntId(),
        user: quote?.user || body.profile,
        targetAccount: body.targetAccount,
        quoteUuid: body.quoteUuid,
        customerTransactionId: body.customerTransactionId || wiseUuid(),
        status: 'incoming_payment_waiting',
        rate: quote?.rate || 1.0,
        created: new Date().toISOString(),
        sourceCurrency: quote?.sourceCurrency || 'GBP',
        sourceValue: quote?.sourceAmount || 0,
        targetCurrency: quote?.targetCurrency || 'EUR',
        targetValue: quote?.targetAmount || 0,
        business: null,
        details: {
          reference: body.details?.reference || 'Transfer',
          transferPurpose: body.details?.transferPurpose || null,
          sourceOfFunds: body.details?.sourceOfFunds || null,
        },
        hasActiveIssues: false,
        estimatedDeliveryDate: new Date(Date.now() + 86400_000).toISOString(),
      };
      store.set(NS.transfers, String(transfer.id), transfer);
      return reply.status(200).send(transfer);
    });

    server.get('/wise/v1/transfers/:transferId', async (req, reply) => {
      const { transferId } = req.params as any;
      const transfer = store.get<any>(NS.transfers, String(transferId));
      if (!transfer) {
        return reply
          .status(404)
          .send(wiseError('TRANSFER_NOT_FOUND', `Transfer ${transferId} not found`));
      }
      return reply.send(transfer);
    });

    server.get('/wise/v1/transfers', async (req, reply) => {
      const query = req.query as any;
      let transfers = store.list<any>(NS.transfers);
      if (query.profile) {
        transfers = transfers.filter(
          (t: any) => String(t.user) === String(query.profile),
        );
      }
      if (query.status) {
        transfers = transfers.filter((t: any) => t.status === query.status);
      }
      if (query.sourceCurrency) {
        transfers = transfers.filter(
          (t: any) => t.sourceCurrency === query.sourceCurrency,
        );
      }
      if (query.targetCurrency) {
        transfers = transfers.filter(
          (t: any) => t.targetCurrency === query.targetCurrency,
        );
      }
      const offset = parseInt(query.offset || '0', 10);
      const limit = parseInt(query.limit || '10', 10);
      return reply.send(transfers.slice(offset, offset + limit));
    });

    server.put('/wise/v1/transfers/:transferId/cancel', async (req, reply) => {
      const { transferId } = req.params as any;
      const transfer = store.get<any>(NS.transfers, String(transferId));
      if (!transfer) {
        return reply
          .status(404)
          .send(wiseError('TRANSFER_NOT_FOUND', `Transfer ${transferId} not found`));
      }

      const cancellable = ['incoming_payment_waiting', 'processing'];
      if (!cancellable.includes(transfer.status)) {
        return reply
          .status(422)
          .send(
            wiseError(
              'TRANSFER_NOT_CANCELLABLE',
              `Transfer in status ${transfer.status} cannot be cancelled`,
            ),
          );
      }
      store.update(NS.transfers, String(transferId), { status: 'cancelled' });
      return reply.send({ ...transfer, status: 'cancelled' });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  FUND TRANSFER
    // ══════════════════════════════════════════════════════════════════════

    server.post(
      '/wise/v3/profiles/:profileId/transfers/:transferId/payments',
      async (req, reply) => {
        const { transferId } = req.params as any;
        const body = req.body as any;
        const transfer = store.get<any>(NS.transfers, String(transferId));
        if (!transfer) {
          return reply
            .status(404)
            .send(wiseError('TRANSFER_NOT_FOUND', `Transfer ${transferId} not found`));
        }

        if (transfer.status !== 'incoming_payment_waiting') {
          return reply
            .status(422)
            .send(
              wiseError(
                'TRANSFER_NOT_FUNDABLE',
                `Transfer in status ${transfer.status} cannot be funded`,
              ),
            );
        }

        store.update(NS.transfers, String(transferId), { status: 'processing' });

        const payment = {
          type: body.type || 'BALANCE',
          status: 'COMPLETED',
          errorCode: null,
        };

        // Simulate async progression: processing -> funds_converted -> outgoing_payment_sent
        setTimeout(() => {
          store.update(NS.transfers, String(transferId), {
            status: 'funds_converted',
          });
          setTimeout(() => {
            store.update(NS.transfers, String(transferId), {
              status: 'outgoing_payment_sent',
            });
          }, 100);
        }, 100);

        return reply.status(201).send(payment);
      },
    );

    // ══════════════════════════════════════════════════════════════════════
    //  BALANCES
    // ══════════════════════════════════════════════════════════════════════

    server.get('/wise/v4/profiles/:profileId/balances', async (req, reply) => {
      const { profileId } = req.params as any;
      const query = req.query as any;
      const profile = store.get<any>(NS.profiles, String(profileId));
      if (!profile) {
        return reply
          .status(404)
          .send(wiseError('PROFILE_NOT_FOUND', `Profile ${profileId} not found`));
      }

      let balances = store.list<any>(NS.balances);
      if (balances.length === 0) {
        const defaults = [
          {
            id: wiseIntId(),
            currency: 'GBP',
            amount: { value: 1250.75, currency: 'GBP' },
            reservedAmount: { value: 0, currency: 'GBP' },
            type: 'STANDARD',
            name: 'GBP',
            icon: { type: 'currency_flag' },
            bankDetails: null,
            creationTime: new Date().toISOString(),
            modificationTime: new Date().toISOString(),
          },
          {
            id: wiseIntId(),
            currency: 'EUR',
            amount: { value: 830.20, currency: 'EUR' },
            reservedAmount: { value: 0, currency: 'EUR' },
            type: 'STANDARD',
            name: 'EUR',
            icon: { type: 'currency_flag' },
            bankDetails: null,
            creationTime: new Date().toISOString(),
            modificationTime: new Date().toISOString(),
          },
          {
            id: wiseIntId(),
            currency: 'USD',
            amount: { value: 2100.00, currency: 'USD' },
            reservedAmount: { value: 0, currency: 'USD' },
            type: 'STANDARD',
            name: 'USD',
            icon: { type: 'currency_flag' },
            bankDetails: null,
            creationTime: new Date().toISOString(),
            modificationTime: new Date().toISOString(),
          },
        ];
        defaults.forEach((b) => store.set(NS.balances, String(b.id), b));
        balances = defaults;
      }

      if (query.types) {
        const types = query.types.split(',');
        balances = balances.filter((b: any) => types.includes(b.type));
      }

      return reply.send(balances);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  EXCHANGE RATES
    // ══════════════════════════════════════════════════════════════════════

    server.get('/wise/v1/rates', async (req, reply) => {
      const query = req.query as any;
      const source = query.source || 'GBP';
      const target = query.target || 'EUR';
      const rate = getMockRate(source, target);

      return reply.send([
        {
          rate,
          source,
          target,
          time: new Date().toISOString(),
        },
      ]);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  CURRENCIES
    // ══════════════════════════════════════════════════════════════════════

    server.get('/wise/v1/currencies', async (_req, reply) => {
      return reply.send([
        { code: 'GBP', name: 'British Pound', symbol: '\u00a3', decimalDigits: 2, countryKeywords: ['uk', 'united kingdom', 'great britain'] },
        { code: 'EUR', name: 'Euro', symbol: '\u20ac', decimalDigits: 2, countryKeywords: ['eu', 'europe', 'germany', 'france'] },
        { code: 'USD', name: 'US Dollar', symbol: '$', decimalDigits: 2, countryKeywords: ['us', 'usa', 'united states'] },
        { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', decimalDigits: 2, countryKeywords: ['canada'] },
        { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimalDigits: 2, countryKeywords: ['australia'] },
        { code: 'JPY', name: 'Japanese Yen', symbol: '\u00a5', decimalDigits: 0, countryKeywords: ['japan'] },
        { code: 'INR', name: 'Indian Rupee', symbol: '\u20b9', decimalDigits: 2, countryKeywords: ['india'] },
        { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimalDigits: 2, countryKeywords: ['singapore'] },
        { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', decimalDigits: 2, countryKeywords: ['hong kong'] },
        { code: 'PLN', name: 'Polish Zloty', symbol: 'z\u0142', decimalDigits: 2, countryKeywords: ['poland'] },
        { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', decimalDigits: 2, countryKeywords: ['switzerland'] },
        { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', decimalDigits: 2, countryKeywords: ['sweden'] },
        { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', decimalDigits: 2, countryKeywords: ['norway'] },
        { code: 'DKK', name: 'Danish Krone', symbol: 'kr', decimalDigits: 2, countryKeywords: ['denmark'] },
        { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', decimalDigits: 2, countryKeywords: ['new zealand'] },
        { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', decimalDigits: 2, countryKeywords: ['brazil'] },
        { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', decimalDigits: 2, countryKeywords: ['mexico'] },
        { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimalDigits: 2, countryKeywords: ['south africa'] },
        { code: 'TRY', name: 'Turkish Lira', symbol: '\u20ba', decimalDigits: 2, countryKeywords: ['turkey'] },
        { code: 'THB', name: 'Thai Baht', symbol: '\u0e3f', decimalDigits: 2, countryKeywords: ['thailand'] },
      ]);
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      { method: 'GET', path: '/wise/v2/profiles', description: 'List profiles' },
      { method: 'GET', path: '/wise/v2/profiles/:profileId', description: 'Get profile' },
      { method: 'POST', path: '/wise/v3/profiles/:profileId/quotes', description: 'Create quote' },
      { method: 'GET', path: '/wise/v3/profiles/:profileId/quotes/:quoteId', description: 'Get quote' },
      { method: 'POST', path: '/wise/v1/accounts', description: 'Create recipient' },
      { method: 'GET', path: '/wise/v1/accounts/:accountId', description: 'Get recipient' },
      { method: 'GET', path: '/wise/v1/accounts', description: 'List recipients' },
      { method: 'DELETE', path: '/wise/v1/accounts/:accountId', description: 'Delete recipient' },
      { method: 'POST', path: '/wise/v1/transfers', description: 'Create transfer' },
      { method: 'GET', path: '/wise/v1/transfers/:transferId', description: 'Get transfer' },
      { method: 'GET', path: '/wise/v1/transfers', description: 'List transfers' },
      { method: 'PUT', path: '/wise/v1/transfers/:transferId/cancel', description: 'Cancel transfer' },
      { method: 'POST', path: '/wise/v3/profiles/:profileId/transfers/:transferId/payments', description: 'Fund transfer' },
      { method: 'GET', path: '/wise/v4/profiles/:profileId/balances', description: 'List balances' },
      { method: 'GET', path: '/wise/v1/rates', description: 'Get exchange rates' },
      { method: 'GET', path: '/wise/v1/currencies', description: 'List currencies' },
    ];
  }

  // ── Cross-surface seeding ──────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    profiles: NS.profiles,
    quotes: NS.quotes,
    recipients: NS.recipients,
    transfers: NS.transfers,
    balances: NS.balances,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const wiseData = expanded.apiResponses?.wise;
      if (!wiseData) continue;

      for (const [resourceType, responses] of Object.entries(wiseData.responses)) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          const key = (body.id as string);
          if (!key) continue;

          store.set(namespace, String(key), body);
        }
      }
    }
  }
}
