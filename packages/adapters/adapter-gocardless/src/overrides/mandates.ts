import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { gcNotFound, gcStateError } from '../gocardless-errors.js';

const NS = 'gocardless:mandates';

export function buildCancelHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { mandate_id } = req.params as { mandate_id: string };
    const existing = store.get<Record<string, unknown>>(NS, mandate_id);

    if (!existing) {
      return reply.code(404).send(gcNotFound('mandate', mandate_id));
    }

    if (existing.status === 'cancelled') {
      return reply.code(409).send(gcStateError(`Mandate ${mandate_id} is already cancelled`));
    }

    const updated = { ...existing, status: 'cancelled' };
    store.set(NS, mandate_id, updated);
    return reply.code(200).send({ mandates: updated });
  };
}

export function buildReinstateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { mandate_id } = req.params as { mandate_id: string };
    const existing = store.get<Record<string, unknown>>(NS, mandate_id);

    if (!existing) {
      return reply.code(404).send(gcNotFound('mandate', mandate_id));
    }

    if (existing.status !== 'cancelled') {
      return reply.code(409).send(gcStateError(`Mandate ${mandate_id} must be cancelled to reinstate, current: ${existing.status}`));
    }

    const updated = { ...existing, status: 'active' };
    store.set(NS, mandate_id, updated);
    return reply.code(200).send({ mandates: updated });
  };
}
