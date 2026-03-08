import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { BraintreeConfig } from './config.js';
import { btError } from './braintree-errors.js';
import { registerBraintreeTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  transactions: 'bt_txns',
  customers: 'bt_customers',
  paymentMethods: 'bt_pms',
  subscriptions: 'bt_subs',
  plans: 'bt_plans',
  disputes: 'bt_disputes',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a Braintree-style 6-8 char alphanumeric ID */
function btId(): string {
  return generateId('', 8).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
}

/**
 * Determine processor response from amount (sandbox testing pattern).
 */
function resolveProcessorOutcome(amount: string): {
  status: string;
  processorResponseCode: string;
  processorResponseText: string;
  gatewayRejectionReason?: string;
} {
  if (amount === '2000.00') {
    return {
      status: 'processor_declined',
      processorResponseCode: '2000',
      processorResponseText: 'Do Not Honor',
    };
  }
  if (amount === '2010.10') {
    return {
      status: 'processor_declined',
      processorResponseCode: '2010',
      processorResponseText: 'Card Invalid',
    };
  }
  if (amount === '2046.00') {
    return {
      status: 'processor_declined',
      processorResponseCode: '2046',
      processorResponseText: 'Declined',
    };
  }
  if (amount === '3000.00') {
    return {
      status: 'gateway_rejected',
      processorResponseCode: '3000',
      processorResponseText: 'Gateway Rejected',
      gatewayRejectionReason: 'fraud',
    };
  }
  // Default: approved
  return {
    status: 'authorized',
    processorResponseCode: '1000',
    processorResponseText: 'Approved',
  };
}

// ---------------------------------------------------------------------------
// Braintree Adapter
// ---------------------------------------------------------------------------

export class BraintreeAdapter extends BaseApiMockAdapter<BraintreeConfig> {
  readonly id = 'braintree';
  readonly name = 'Braintree API';
  readonly basePath = '/braintree';
  readonly versions = ['rest', 'graphql'];

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerBraintreeTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
    const match = decoded.match(/^([a-z0-9-]+):/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // ── Seed from expanded apiResponses ──────────────────────────────────
    this.seedFromApiResponses(data, store);

    const merchantId = this.config?.merchantId || 'test_merchant';
    const mp = `/braintree/merchants/${merchantId}`;

    // ══════════════════════════════════════════════════════════════════════
    //  CLIENT TOKEN
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${mp}/client_token`, async (_req, reply) => {
      return reply.status(201).send({
        clientToken: Buffer.from(
          JSON.stringify({ authorizationFingerprint: generateId('', 64) }),
        ).toString('base64'),
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  TRANSACTIONS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Transaction ───────────────────────────────────────────────
    server.post(`${mp}/transactions`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!body.amount) {
        return reply.status(422).send(btError('Amount is required.', 'amount', '81502'));
      }

      const amount = String(body.amount);
      const outcome = resolveProcessorOutcome(amount);
      const submitForSettlement = (body.options as any)?.submitForSettlement === true;

      const txn: Record<string, unknown> = {
        id: btId(),
        type: body.type || 'sale',
        amount,
        status: submitForSettlement && outcome.status === 'authorized'
          ? 'submitted_for_settlement'
          : outcome.status,
        creditCard: {
          bin: '411111',
          last4: '1111',
          cardType: 'Visa',
          expirationMonth: '12',
          expirationYear: '2028',
        },
        processorResponseCode: outcome.processorResponseCode,
        processorResponseText: outcome.processorResponseText,
        customer: body.customerId
          ? store.get(NS.customers, body.customerId as string) || null
          : null,
        orderId: body.orderId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (outcome.gatewayRejectionReason) {
        txn.gatewayRejectionReason = outcome.gatewayRejectionReason;
      }

      store.set(NS.transactions, txn.id as string, txn);
      return reply.status(201).send({ transaction: txn });
    });

    // ── Get Transaction ──────────────────────────────────────────────────
    server.get(`${mp}/transactions/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const txn = store.get(NS.transactions, id);
      if (!txn) return reply.status(404).send(btError('Transaction not found'));
      return reply.send({ transaction: txn });
    });

    // ── Search Transactions ──────────────────────────────────────────────
    server.post(`${mp}/transactions/search`, async (_req, reply) => {
      const txns = store.list(NS.transactions);
      return reply.send({ transactions: txns, totalItems: txns.length });
    });

    // ── Submit for Settlement ────────────────────────────────────────────
    server.put(`${mp}/transactions/:id/submit_for_settlement`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const txn = store.get<Record<string, unknown>>(NS.transactions, id);
      if (!txn) return reply.status(404).send(btError('Transaction not found'));

      if (txn.status !== 'authorized') {
        return reply.status(422).send(btError(
          `Cannot submit transaction for settlement, status is ${txn.status}`,
        ));
      }

      store.update(NS.transactions, id, {
        status: 'submitted_for_settlement',
        updatedAt: new Date().toISOString(),
      });
      return reply.send({ transaction: store.get(NS.transactions, id) });
    });

    // ── Partial Settlement ───────────────────────────────────────────────
    server.put(`${mp}/transactions/:id/partial_settlement`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const txn = store.get<Record<string, unknown>>(NS.transactions, id);
      if (!txn) return reply.status(404).send(btError('Transaction not found'));

      if (txn.status !== 'authorized') {
        return reply.status(422).send(btError(
          `Cannot partially settle transaction, status is ${txn.status}`,
        ));
      }

      const partialTxn: Record<string, unknown> = {
        id: btId(),
        type: 'sale',
        amount: body.amount || txn.amount,
        status: 'submitted_for_settlement',
        creditCard: txn.creditCard,
        processorResponseCode: '1000',
        processorResponseText: 'Approved',
        parentTransactionId: id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.set(NS.transactions, partialTxn.id as string, partialTxn);
      return reply.status(201).send({ transaction: partialTxn });
    });

    // ── Void Transaction ─────────────────────────────────────────────────
    server.put(`${mp}/transactions/:id/void`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const txn = store.get<Record<string, unknown>>(NS.transactions, id);
      if (!txn) return reply.status(404).send(btError('Transaction not found'));

      const terminalStatuses = ['voided', 'settled', 'refunded', 'processor_declined', 'gateway_rejected'];
      if (terminalStatuses.includes(txn.status as string)) {
        return reply.status(422).send(btError(
          `Cannot void transaction, status is ${txn.status}`,
        ));
      }

      store.update(NS.transactions, id, {
        status: 'voided',
        updatedAt: new Date().toISOString(),
      });
      return reply.send({ transaction: store.get(NS.transactions, id) });
    });

    // ── Refund Transaction ───────────────────────────────────────────────
    server.post(`${mp}/transactions/:id/refund`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const orig = store.get<Record<string, unknown>>(NS.transactions, id);
      if (!orig) return reply.status(404).send(btError('Transaction not found'));

      const settledStatuses = ['settled', 'settling', 'submitted_for_settlement'];
      if (!settledStatuses.includes(orig.status as string)) {
        return reply.status(422).send(btError(
          `Cannot refund transaction, status is ${orig.status}`,
        ));
      }

      const refundAmount = body.amount ? String(body.amount) : (orig.amount as string);
      const isPartial = refundAmount !== orig.amount;

      const refund: Record<string, unknown> = {
        id: btId(),
        type: 'credit',
        amount: refundAmount,
        status: 'submitted_for_settlement',
        refundedTransactionId: id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.set(NS.transactions, refund.id as string, refund);

      // Update original status
      store.update(NS.transactions, id, {
        status: isPartial ? 'partially_refunded' : 'refunded',
        updatedAt: new Date().toISOString(),
      });

      return reply.status(201).send({ transaction: refund });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  CUSTOMERS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Customer ──────────────────────────────────────────────────
    server.post(`${mp}/customers`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const cust: Record<string, unknown> = {
        id: (body.id as string) || btId(),
        firstName: body.firstName || null,
        lastName: body.lastName || null,
        email: body.email || null,
        phone: body.phone || null,
        company: body.company || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.set(NS.customers, cust.id as string, cust);
      return reply.status(201).send({ customer: cust });
    });

    // ── Get Customer ─────────────────────────────────────────────────────
    server.get(`${mp}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const cust = store.get(NS.customers, id);
      if (!cust) return reply.status(404).send(btError('Customer not found'));
      return reply.send({ customer: cust });
    });

    // ── Update Customer ──────────────────────────────────────────────────
    server.put(`${mp}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const cust = store.get(NS.customers, id);
      if (!cust) return reply.status(404).send(btError('Customer not found'));

      store.update(NS.customers, id, {
        ...(req.body as any),
        updatedAt: new Date().toISOString(),
      });
      return reply.send({ customer: store.get(NS.customers, id) });
    });

    // ── Delete Customer ──────────────────────────────────────────────────
    server.delete(`${mp}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const cust = store.get(NS.customers, id);
      if (!cust) return reply.status(404).send(btError('Customer not found'));
      store.delete(NS.customers, id);
      return reply.status(204).send();
    });

    // ── Search Customers ─────────────────────────────────────────────────
    server.post(`${mp}/customers/search`, async (_req, reply) => {
      const customers = store.list(NS.customers);
      return reply.send({ customers, totalItems: customers.length });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PAYMENT METHODS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Payment Method ────────────────────────────────────────────
    server.post(`${mp}/payment_methods`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const pm: Record<string, unknown> = {
        token: (body.token as string) || btId(),
        customerId: body.customerId || null,
        cardType: 'Visa',
        bin: '411111',
        last4: '1111',
        expirationMonth: '12',
        expirationYear: '2028',
        default: body.default ?? false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.set(NS.paymentMethods, pm.token as string, pm);
      return reply.status(201).send({ paymentMethod: pm });
    });

    // ── Get Payment Method ───────────────────────────────────────────────
    server.get(`${mp}/payment_methods/:token`, async (req, reply) => {
      const { token } = req.params as { token: string };
      const pm = store.get(NS.paymentMethods, token);
      if (!pm) return reply.status(404).send(btError('Payment method not found'));
      return reply.send({ paymentMethod: pm });
    });

    // ── Update Payment Method ────────────────────────────────────────────
    server.put(`${mp}/payment_methods/:token`, async (req, reply) => {
      const { token } = req.params as { token: string };
      const pm = store.get(NS.paymentMethods, token);
      if (!pm) return reply.status(404).send(btError('Payment method not found'));

      store.update(NS.paymentMethods, token, {
        ...(req.body as any),
        updatedAt: new Date().toISOString(),
      });
      return reply.send({ paymentMethod: store.get(NS.paymentMethods, token) });
    });

    // ── Delete Payment Method ────────────────────────────────────────────
    server.delete(`${mp}/payment_methods/:token`, async (req, reply) => {
      const { token } = req.params as { token: string };
      const pm = store.get(NS.paymentMethods, token);
      if (!pm) return reply.status(404).send(btError('Payment method not found'));
      store.delete(NS.paymentMethods, token);
      return reply.status(204).send();
    });

    // ══════════════════════════════════════════════════════════════════════
    //  SUBSCRIPTIONS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Subscription ──────────────────────────────────────────────
    server.post(`${mp}/subscriptions`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sub: Record<string, unknown> = {
        id: btId(),
        planId: body.planId || null,
        status: 'Active',
        paymentMethodToken: body.paymentMethodToken || null,
        price: body.price || null,
        firstBillingDate: new Date().toISOString().split('T')[0],
        nextBillingDate: new Date(Date.now() + 30 * 86400_000).toISOString().split('T')[0],
        currentBillingCycle: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.set(NS.subscriptions, sub.id as string, sub);
      return reply.status(201).send({ subscription: sub });
    });

    // ── Get Subscription ─────────────────────────────────────────────────
    server.get(`${mp}/subscriptions/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get(NS.subscriptions, id);
      if (!sub) return reply.status(404).send(btError('Subscription not found'));
      return reply.send({ subscription: sub });
    });

    // ── Cancel Subscription ──────────────────────────────────────────────
    server.put(`${mp}/subscriptions/:id/cancel`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get(NS.subscriptions, id);
      if (!sub) return reply.status(404).send(btError('Subscription not found'));
      store.update(NS.subscriptions, id, {
        status: 'Canceled',
        updatedAt: new Date().toISOString(),
      });
      return reply.send({ subscription: store.get(NS.subscriptions, id) });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PLANS
    // ══════════════════════════════════════════════════════════════════════

    server.get(`${mp}/plans`, async (_req, reply) => {
      const plans = store.list(NS.plans);
      return reply.send({ plans });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  DISPUTES
    // ══════════════════════════════════════════════════════════════════════

    // ── Search Disputes ──────────────────────────────────────────────────
    server.post(`${mp}/disputes/search`, async (_req, reply) => {
      const disputes = store.list<Record<string, unknown>>(NS.disputes);
      if (disputes.length === 0) {
        // Generate sample disputes
        const samples = Array.from({ length: 2 }, (_, i) => ({
          id: btId(),
          kind: i === 0 ? 'chargeback' : 'retrieval',
          status: i === 0 ? 'open' : 'won',
          reason: i === 0 ? 'fraud' : 'not_recognized',
          amount: `${(50 + i * 25).toFixed(2)}`,
          currencyIsoCode: 'USD',
          receivedDate: new Date(Date.now() - i * 7 * 86400_000).toISOString().split('T')[0],
          replyByDate: new Date(Date.now() + 14 * 86400_000).toISOString().split('T')[0],
          createdAt: new Date(Date.now() - i * 7 * 86400_000).toISOString(),
          updatedAt: new Date().toISOString(),
        }));
        samples.forEach((d) => store.set(NS.disputes, d.id, d));
        return reply.send({ disputes: samples, totalItems: samples.length });
      }
      return reply.send({ disputes, totalItems: disputes.length });
    });

    // ── Get Dispute ──────────────────────────────────────────────────────
    server.get(`${mp}/disputes/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const dispute = store.get(NS.disputes, id);
      if (!dispute) return reply.status(404).send(btError('Dispute not found'));
      return reply.send({ dispute });
    });

    // ── Accept Dispute ───────────────────────────────────────────────────
    server.put(`${mp}/disputes/:id/accept`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const dispute = store.get(NS.disputes, id);
      if (!dispute) return reply.status(404).send(btError('Dispute not found'));
      store.update(NS.disputes, id, {
        status: 'accepted',
        updatedAt: new Date().toISOString(),
      });
      return reply.send({ dispute: store.get(NS.disputes, id) });
    });

    // ── Add Dispute Evidence ─────────────────────────────────────────────
    server.post(`${mp}/disputes/:id/evidence`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const dispute = store.get(NS.disputes, id);
      if (!dispute) return reply.status(404).send(btError('Dispute not found'));

      const evidence = {
        id: btId(),
        disputeId: id,
        comment: body.comment || body.content || '',
        createdAt: new Date().toISOString(),
      };
      store.update(NS.disputes, id, {
        status: 'under_review',
        updatedAt: new Date().toISOString(),
      });
      return reply.status(201).send({ evidence });
    });
  }

  getEndpoints(): EndpointDefinition[] {
    const mp = '/braintree/merchants/:merchantId';
    return [
      // Client Token
      { method: 'POST', path: `${mp}/client_token`, description: 'Generate client token' },
      // Transactions
      { method: 'POST', path: `${mp}/transactions`, description: 'Create transaction' },
      { method: 'GET', path: `${mp}/transactions/:id`, description: 'Get transaction' },
      { method: 'POST', path: `${mp}/transactions/search`, description: 'Search transactions' },
      { method: 'PUT', path: `${mp}/transactions/:id/submit_for_settlement`, description: 'Submit for settlement' },
      { method: 'PUT', path: `${mp}/transactions/:id/partial_settlement`, description: 'Partial settlement' },
      { method: 'PUT', path: `${mp}/transactions/:id/void`, description: 'Void transaction' },
      { method: 'POST', path: `${mp}/transactions/:id/refund`, description: 'Refund transaction' },
      // Customers
      { method: 'POST', path: `${mp}/customers`, description: 'Create customer' },
      { method: 'GET', path: `${mp}/customers/:id`, description: 'Get customer' },
      { method: 'PUT', path: `${mp}/customers/:id`, description: 'Update customer' },
      { method: 'DELETE', path: `${mp}/customers/:id`, description: 'Delete customer' },
      { method: 'POST', path: `${mp}/customers/search`, description: 'Search customers' },
      // Payment Methods
      { method: 'POST', path: `${mp}/payment_methods`, description: 'Create payment method' },
      { method: 'GET', path: `${mp}/payment_methods/:token`, description: 'Get payment method' },
      { method: 'PUT', path: `${mp}/payment_methods/:token`, description: 'Update payment method' },
      { method: 'DELETE', path: `${mp}/payment_methods/:token`, description: 'Delete payment method' },
      // Subscriptions
      { method: 'POST', path: `${mp}/subscriptions`, description: 'Create subscription' },
      { method: 'GET', path: `${mp}/subscriptions/:id`, description: 'Get subscription' },
      { method: 'PUT', path: `${mp}/subscriptions/:id/cancel`, description: 'Cancel subscription' },
      // Plans
      { method: 'GET', path: `${mp}/plans`, description: 'List plans' },
      // Disputes
      { method: 'POST', path: `${mp}/disputes/search`, description: 'Search disputes' },
      { method: 'GET', path: `${mp}/disputes/:id`, description: 'Get dispute' },
      { method: 'PUT', path: `${mp}/disputes/:id/accept`, description: 'Accept dispute' },
      { method: 'POST', path: `${mp}/disputes/:id/evidence`, description: 'Add dispute evidence' },
    ];
  }

  // ── Cross-surface seeding ──────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    transactions: NS.transactions,
    customers: NS.customers,
    paymentMethods: NS.paymentMethods,
    payment_methods: NS.paymentMethods,
    subscriptions: NS.subscriptions,
    plans: NS.plans,
    disputes: NS.disputes,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const btData = expanded.apiResponses?.braintree;
      if (!btData) continue;

      for (const [resourceType, responses] of Object.entries(btData.responses)) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          const key =
            (body.id as string) ??
            (body.token as string);
          if (!key) continue;

          store.set(namespace, String(key), body);
        }
      }
    }
  }
}
