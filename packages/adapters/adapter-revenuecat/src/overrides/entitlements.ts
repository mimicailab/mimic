import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { rcNotFound } from '../revenuecat-errors.js';

const NS = 'revenuecat:entitlements';

export function buildArchiveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { entitlement_id } = req.params as { entitlement_id: string };
    const existing = store.get<Record<string, unknown>>(NS, entitlement_id);

    if (!existing) {
      return reply.code(404).send(rcNotFound('entitlement', entitlement_id));
    }

    const updated = { ...existing, state: 'inactive' };
    store.set(NS, entitlement_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildUnarchiveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { entitlement_id } = req.params as { entitlement_id: string };
    const existing = store.get<Record<string, unknown>>(NS, entitlement_id);

    if (!existing) {
      return reply.code(404).send(rcNotFound('entitlement', entitlement_id));
    }

    const updated = { ...existing, state: 'active' };
    store.set(NS, entitlement_id, updated);
    return reply.code(200).send(updated);
  };
}
