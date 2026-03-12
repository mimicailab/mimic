import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { unixNow, generateId } from '@mimicai/adapter-sdk';
import { chargebeeNotFound, chargebeeStateError } from '../chargebee-errors.js';
import { SCHEMA_DEFAULTS } from '../generated/schemas.js';

const NS = 'chargebee:invoices';

export function buildCreateInvoiceHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const factory = SCHEMA_DEFAULTS['invoice']!;
    const id = (body.id as string) || generateId('', 14);
    const now = unixNow();
    const obj = factory({
      id,
      created_at: now,
      updated_at: now,
      resource_version: now * 1000,
      ...body,
    });
    store.set(NS, id, obj);
    return reply.code(200).send(obj);
  };
}

export function buildVoidHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = (req.params as Record<string, string>)['invoice_id'];
    const existing = store.get<Record<string, unknown>>(NS, id!);

    if (!existing) {
      return reply.code(404).send(chargebeeNotFound('invoices', id!));
    }

    const status = existing.status as string;
    if (status !== 'payment_due' && status !== 'not_paid') {
      return reply.code(400).send(chargebeeStateError(
        `Invoice ${id} is ${status}, cannot void`,
      ));
    }

    const now = unixNow();
    const updated: Record<string, unknown> = {
      ...existing,
      status: 'voided',
      voided_at: now,
      updated_at: now,
      resource_version: now * 1000,
    };

    store.set(NS, id!, updated);
    return reply.code(200).send(updated);
  };
}

export function buildWriteOffHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = (req.params as Record<string, string>)['invoice_id'];
    const existing = store.get<Record<string, unknown>>(NS, id!);

    if (!existing) {
      return reply.code(404).send(chargebeeNotFound('invoices', id!));
    }

    const status = existing.status as string;
    if (status !== 'payment_due' && status !== 'not_paid') {
      return reply.code(400).send(chargebeeStateError(
        `Invoice ${id} is ${status}, cannot write off`,
      ));
    }

    const now = unixNow();
    const updated: Record<string, unknown> = {
      ...existing,
      status: 'pending',
      write_off_amount: existing.amount_due ?? 0,
      updated_at: now,
      resource_version: now * 1000,
    };

    store.set(NS, id!, updated);
    return reply.code(200).send(updated);
  };
}

export function buildRecordPaymentHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = (req.params as Record<string, string>)['invoice_id'];
    const existing = store.get<Record<string, unknown>>(NS, id!);

    if (!existing) {
      return reply.code(404).send(chargebeeNotFound('invoices', id!));
    }

    const status = existing.status as string;
    if (status !== 'payment_due' && status !== 'not_paid') {
      return reply.code(400).send(chargebeeStateError(
        `Invoice ${id} is ${status}, cannot record payment`,
      ));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const now = unixNow();
    const updated: Record<string, unknown> = {
      ...existing,
      status: 'paid',
      paid_at: now,
      amount_paid: body.amount ?? existing.total ?? existing.amount_due ?? 0,
      amount_due: 0,
      updated_at: now,
      resource_version: now * 1000,
    };

    store.set(NS, id!, updated);
    return reply.code(200).send(updated);
  };
}
