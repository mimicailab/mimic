import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { paddleError, paddleStateError } from '../paddle-errors.js';

const NS = 'paddle:transactions';

export function buildReviseHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { transaction_id } = req.params as { transaction_id: string };
    const existing = store.get<Record<string, unknown>>(NS, transaction_id);

    if (!existing) {
      return reply.code(404).send(paddleError('not_found', `Transaction ${transaction_id} not found`));
    }

    if (existing.status !== 'billed' && existing.status !== 'completed') {
      return reply.code(409).send(
        paddleStateError(`Transaction ${transaction_id} must be billed or completed to revise, current status: ${existing.status}`),
      );
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = {
      ...existing,
      ...body,
      revised_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.set(NS, transaction_id, updated);
    return reply.code(200).send(updated);
  };
}
