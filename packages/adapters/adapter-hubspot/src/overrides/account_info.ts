/**
 * /account-info/<version>/details — Returns the seeded portal info as a
 * flat top-level object (not wrapped in `{ results: [...] }`).
 */

import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { nsFor } from './_shared.js';

export function buildDetailsHandler(store: StateStore): OverrideHandler {
  return async (_req, reply) => {
    const info = store.get<Record<string, unknown>>(nsFor('account_info'), 'self');
    if (!info) return reply.code(200).send({});
    return reply.code(200).send(info);
  };
}
