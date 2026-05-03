/**
 * Marshallers for Slack's identity entities + composite-keyed messages.
 *
 * Five marshallers, two interesting cases:
 *
 *   - `channel` registers `name` as its label so messages can resolve
 *     `channel_name` → channel id without the LLM ever emitting an id.
 *   - `message` is keyed by `${channel}:${ts}` (a single channel hosts many
 *     messages and `ts` alone collides across channels). The marshaller's
 *     wrap fn reads `body.channel_name`, looks up the registered channel
 *     id, and writes the resolved id to `wrapped.channel` before storing.
 *
 * The other three (user, team, file) are essentially identity wraps over
 * their default factories, declared as marshallers mainly so the auto-
 * seeder skips them for consistency.
 *
 * Replaces the previous `resourceKey` SDK hook (Slack was its only caller).
 */

import type { Body, Marshaller, MarshalContext } from '@mimicai/adapter-sdk';
import {
  defaultChannel,
  defaultMessage,
  defaultUser,
  defaultTeam,
  defaultFile,
} from '../generated/schemas.js';

const NS_CHANNELS = 'slack:channel';
const NS_MESSAGES = 'slack:message';
const NS_USERS = 'slack:user';
const NS_TEAMS = 'slack:team';
const NS_FILES = 'slack:file';

export function buildSlackMarshallers(): Marshaller[] {
  return [
    {
      kind: 'standalone',
      contentResource: 'channel',
      namespace: NS_CHANNELS,
      labelField: 'name',
      generateId: (body) => coerceId(body, 'C'),
      wrap: (body, id) => defaultChannel({ ...body, id }),
    },
    {
      kind: 'standalone',
      contentResource: 'user',
      namespace: NS_USERS,
      labelField: 'name',
      generateId: (body) => coerceId(body, 'U'),
      wrap: (body, id) => defaultUser({ ...body, id }),
    },
    {
      kind: 'standalone',
      contentResource: 'team',
      namespace: NS_TEAMS,
      generateId: (body) => coerceId(body, 'T'),
      wrap: (body, id) => defaultTeam({ ...body, id }),
    },
    {
      kind: 'standalone',
      contentResource: 'file',
      namespace: NS_FILES,
      generateId: (body) => coerceId(body, 'F'),
      wrap: (body, id) => defaultFile({ ...body, id }),
    },
    {
      kind: 'standalone',
      contentResource: 'message',
      namespace: NS_MESSAGES,
      // Messages don't own a top-level id — they're keyed by `${channel}:${ts}`.
      // The placeholder here is unused (storageKey overrides the default).
      generateId: () => 'composite',
      wrap: (body, _id, ctx) => wrapMessage(body, ctx),
      storageKey: (wrapped) => `${wrapped.channel as string}:${wrapped.ts as string}`,
    },
  ];
}

function wrapMessage(body: Body, ctx: MarshalContext): Body {
  const channelName = (body.channel_name as string) ?? '';
  // Prefer the registered channel id (label → id) when channel_name is set.
  // Fall back to body.channel if the LLM happened to emit the right id.
  const resolved = channelName ? ctx.lookupId('channel', channelName) : undefined;
  const channelId = resolved ?? (body.channel as string) ?? '';
  return defaultMessage({ ...body, channel: channelId });
}

function coerceId(body: Body, prefix: string): string {
  const id = body.id;
  if (typeof id === 'string' && id.length > 0) return id;
  return `${prefix}${randHex(10).toUpperCase()}`;
}

function randHex(n: number): string {
  let out = '';
  while (out.length < n) {
    out += Math.floor(Math.random() * 0x100000000).toString(16);
  }
  return out.slice(0, n);
}
