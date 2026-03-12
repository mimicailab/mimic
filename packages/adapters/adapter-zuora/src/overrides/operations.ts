import { generateId } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { notFound } from '../zuora-errors.js';
import { defaultInvoice, defaultPayment, defaultCreditMemo } from '../generated/schemas.js';

const NS_INVOICES = 'zuora:invoices';
const NS_PAYMENTS = 'zuora:payments';
const NS_CREDIT_MEMOS = 'zuora:credit-memos';

function zuoraId(): string {
  return generateId('', 32);
}

function isoNow(): string {
  return new Date().toISOString();
}

/** POST /operations/invoice-collect — create invoice + payment atomically */
export function buildInvoiceCollectHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const now = isoNow();
    const invId = zuoraId();
    const invoice = defaultInvoice({
      id: invId,
      accountId: body.accountId ?? null,
      status: 'Posted',
      amount: body.invoiceAmount ?? 0,
      balance: 0,
      invoiceDate: now.split('T')[0],
      dueDate: now.split('T')[0],
      createdDate: now,
      updatedDate: now,
    });
    store.set(NS_INVOICES, invId, invoice);

    const pmtId = zuoraId();
    const payment = defaultPayment({
      id: pmtId,
      accountId: body.accountId ?? null,
      amount: body.invoiceAmount ?? 0,
      status: 'Processed',
      invoiceId: invId,
      effectiveDate: now.split('T')[0],
      createdDate: now,
      updatedDate: now,
    });
    store.set(NS_PAYMENTS, pmtId, payment);

    return reply.code(200).send({ invoiceId: invId, paymentId: pmtId });
  };
}

/** PUT /credit-memos/:creditMemoKey/apply — apply credit memo */
export function buildApplyCreditMemoHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { creditMemoKey } = req.params as { creditMemoKey: string };
    const existing = store.get<Record<string, unknown>>(NS_CREDIT_MEMOS, creditMemoKey);
    if (!existing) return reply.code(404).send(notFound('Credit memo', creditMemoKey));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = { ...existing, ...body, status: 'Posted', updatedDate: isoNow() };
    store.set(NS_CREDIT_MEMOS, creditMemoKey, updated);
    return reply.code(200).send({ id: creditMemoKey });
  };
}

/** POST /credit-memos/invoice/:invoiceKey — create credit memo from invoice */
export function buildCreditMemoFromInvoiceHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { invoiceKey } = req.params as { invoiceKey: string };
    const invoice = store.get<Record<string, unknown>>(NS_INVOICES, invoiceKey);
    if (!invoice) return reply.code(404).send(notFound('Invoice', invoiceKey));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = zuoraId();
    const memo = defaultCreditMemo({
      id,
      accountId: invoice.accountId,
      invoiceId: invoiceKey,
      amount: body.amount ?? invoice.amount ?? 0,
      currency: (invoice.currency as string) ?? 'USD',
      reasonCode: body.reasonCode ?? null,
      comment: body.comment ?? null,
      ...body,
    });
    store.set(NS_CREDIT_MEMOS, id, memo);
    return reply.code(201).send({ id: memo.id, memoNumber: memo.memoNumber });
  };
}

/** GET /orders/subscription/:subscriptionNumber — list orders by subscription */
export function buildOrdersBySubscriptionHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscriptionNumber } = req.params as { subscriptionNumber: string };
    const query = req.query as Record<string, string>;
    const orders = store.list<Record<string, unknown>>('zuora:orders').filter(o => {
      const subs = o.subscriptions as Record<string, unknown>[] | undefined;
      return subs?.some(s => s.subscriptionNumber === subscriptionNumber);
    });
    const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
    const page = query.page ? parseInt(query.page, 10) : 1;
    const offset = (page - 1) * pageSize;
    const data = orders.slice(offset, offset + pageSize);
    return reply.code(200).send({
      data,
      nextPage: offset + pageSize < orders.length ? page + 1 : null,
    });
  };
}

/** GET /products/:productKey/product-rate-plans — list rate plans for product */
export function buildRatePlansByProductHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { productKey } = req.params as { productKey: string };
    const query = req.query as Record<string, string>;
    const plans = store.list<Record<string, unknown>>('zuora:product-rate-plans').filter(
      p => p.ProductId === productKey || p.productId === productKey,
    );
    const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
    const page = query.page ? parseInt(query.page, 10) : 1;
    const offset = (page - 1) * pageSize;
    const data = plans.slice(offset, offset + pageSize);
    return reply.code(200).send({
      data,
      nextPage: offset + pageSize < plans.length ? page + 1 : null,
    });
  };
}

/** GET /usage/accounts/:accountKey — list usage records by account */
export function buildUsageByAccountHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { accountKey } = req.params as { accountKey: string };
    const query = req.query as Record<string, string>;
    const usages = store.list<Record<string, unknown>>('zuora:usage').filter(
      u => u.accountId === accountKey || u.AccountId === accountKey,
    );
    const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
    const page = query.page ? parseInt(query.page, 10) : 1;
    const offset = (page - 1) * pageSize;
    const data = usages.slice(offset, offset + pageSize);
    return reply.code(200).send({
      data,
      nextPage: offset + pageSize < usages.length ? page + 1 : null,
    });
  };
}
