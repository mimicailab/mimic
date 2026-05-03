import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { NS } from './_shared.js';

/**
 * GET /v2/self — Identify the workspace + user behind the access token.
 *
 * Attio's spec uses `anyOf` here to discriminate between active and revoked
 * tokens. We always return the active branch for mocked traffic.
 */
export function buildSelfHandler(store: StateStore): OverrideHandler {
  return async (_req, reply) => {
    const self = store.get<Record<string, unknown>>(NS.self, 'self');
    if (!self) {
      return reply.code(200).send({ active: false });
    }
    // Self response is *not* wrapped in `{ data: ... }` — it lives at the top
    // level. The preSerialization hook keeps it that way because the payload
    // already has `active`, not `data`.
    return reply.code(200).send(self);
  };
}
