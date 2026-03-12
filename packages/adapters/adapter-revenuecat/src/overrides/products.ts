import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { rcNotFound } from '../revenuecat-errors.js';

const NS = 'revenuecat:products';

export function buildArchiveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { product_id } = req.params as { product_id: string };
    const existing = store.get<Record<string, unknown>>(NS, product_id);

    if (!existing) {
      return reply.code(404).send(rcNotFound('product', product_id));
    }

    const updated = { ...existing, state: 'inactive' };
    store.set(NS, product_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildUnarchiveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { product_id } = req.params as { product_id: string };
    const existing = store.get<Record<string, unknown>>(NS, product_id);

    if (!existing) {
      return reply.code(404).send(rcNotFound('product', product_id));
    }

    const updated = { ...existing, state: 'active' };
    store.set(NS, product_id, updated);
    return reply.code(200).send(updated);
  };
}
