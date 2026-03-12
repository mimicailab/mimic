import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { recurlyNotFound, recurlyStateError } from '../recurly-errors.js';

const NS = 'recurly:invoices';

export function buildCollectHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { invoice_id } = req.params as { invoice_id: string };
    const existing = store.get<Record<string, unknown>>(NS, invoice_id);

    if (!existing) {
      return reply.code(404).send(recurlyNotFound('Invoice', invoice_id));
    }

    if (existing.state !== 'pending' && existing.state !== 'past_due') {
      return reply.code(422).send(
        recurlyStateError(`Invoice is ${existing.state}, cannot collect`),
      );
    }

    const updated = {
      ...existing,
      state: 'paid',
      closed_at: new Date().toISOString(),
    };
    store.set(NS, invoice_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildVoidHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { invoice_id } = req.params as { invoice_id: string };
    const existing = store.get<Record<string, unknown>>(NS, invoice_id);

    if (!existing) {
      return reply.code(404).send(recurlyNotFound('Invoice', invoice_id));
    }

    if (existing.state !== 'pending' && existing.state !== 'past_due') {
      return reply.code(422).send(
        recurlyStateError(`Invoice is ${existing.state}, cannot void`),
      );
    }

    const updated = {
      ...existing,
      state: 'voided',
      closed_at: new Date().toISOString(),
    };
    store.set(NS, invoice_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildMarkFailedHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { invoice_id } = req.params as { invoice_id: string };
    const existing = store.get<Record<string, unknown>>(NS, invoice_id);

    if (!existing) {
      return reply.code(404).send(recurlyNotFound('Invoice', invoice_id));
    }

    const updated = {
      ...existing,
      state: 'failed',
      closed_at: new Date().toISOString(),
    };
    store.set(NS, invoice_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildMarkSuccessfulHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { invoice_id } = req.params as { invoice_id: string };
    const existing = store.get<Record<string, unknown>>(NS, invoice_id);

    if (!existing) {
      return reply.code(404).send(recurlyNotFound('Invoice', invoice_id));
    }

    const updated = {
      ...existing,
      state: 'paid',
      closed_at: new Date().toISOString(),
    };
    store.set(NS, invoice_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildReopenHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { invoice_id } = req.params as { invoice_id: string };
    const existing = store.get<Record<string, unknown>>(NS, invoice_id);

    if (!existing) {
      return reply.code(404).send(recurlyNotFound('Invoice', invoice_id));
    }

    if (existing.state !== 'voided') {
      return reply.code(422).send(
        recurlyStateError(`Invoice is ${existing.state}, cannot reopen`),
      );
    }

    const updated = {
      ...existing,
      state: 'pending',
      closed_at: null,
    };
    store.set(NS, invoice_id, updated);
    return reply.code(200).send(updated);
  };
}
