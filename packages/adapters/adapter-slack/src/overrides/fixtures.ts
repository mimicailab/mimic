import type { StateStore } from '@mimicai/core';
import { defaultTeam, defaultUser } from '../generated/schemas.js';

const NS_TEAM = 'slack:team';
const NS_USERS = 'slack:user';
const NS_BOT = 'slack:bot';

/**
 * Bootstrap a workspace's worth of state for an unseeded adapter — one team,
 * one bot user (so `auth.test` returns a coherent identity). Persona seeding
 * later overlays additional users/channels/messages on top.
 */
export function seedDefaultFixtures(store: StateStore): void {
  if (store.list(NS_TEAM).length === 0) {
    const team = defaultTeam();
    store.set(NS_TEAM, team.id as string, team);

    const bot = defaultUser({
      id: 'USLACKBOT',
      name: 'mimic-bot',
      real_name: 'Mimic Bot',
      is_bot: true,
      team_id: team.id,
      profile: {
        real_name: 'Mimic Bot',
        display_name: 'mimic-bot',
        email: 'bot@mimic.local',
      },
    });
    store.set(NS_USERS, bot.id as string, bot);
    store.set(NS_BOT, 'self', { user_id: bot.id, team_id: team.id, bot_id: 'B0MIMIC' });
  }
}

export function getActiveTeam(store: StateStore): Record<string, unknown> {
  const teams = store.list<Record<string, unknown>>(NS_TEAM);
  return teams[0] ?? defaultTeam();
}

export function getBotIdentity(store: StateStore): Record<string, unknown> | undefined {
  return store.get<Record<string, unknown>>(NS_BOT, 'self');
}
