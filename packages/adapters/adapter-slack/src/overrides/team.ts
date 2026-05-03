import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { getActiveTeam } from './fixtures.js';

export function buildTeamInfoHandler(store: StateStore): OverrideHandler {
  return async (_req, reply) => {
    const team = getActiveTeam(store);
    return reply.code(200).send({ team });
  };
}
