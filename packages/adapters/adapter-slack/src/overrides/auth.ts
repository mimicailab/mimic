import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { getActiveTeam, getBotIdentity } from './fixtures.js';

/**
 * `auth.test` — minimum-viable identity check. Returns the active team + bot
 * identity. Real Slack also returns `enterprise_id`, `bot_id`, and the bot's
 * `is_enterprise_install`; we include the most-used fields and skip the rest.
 */
export function buildAuthTestHandler(store: StateStore): OverrideHandler {
  return async (_req, reply) => {
    const team = getActiveTeam(store);
    const bot = getBotIdentity(store);
    return reply.code(200).send({
      url: `https://${team.domain}.slack.com/`,
      team: team.name,
      team_id: team.id,
      user: 'mimic-bot',
      user_id: bot?.user_id ?? 'USLACKBOT',
      bot_id: bot?.bot_id ?? 'B0MIMIC',
    });
  };
}
