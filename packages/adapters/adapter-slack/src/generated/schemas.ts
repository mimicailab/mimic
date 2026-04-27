// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-slack generate
import { generateId } from '@mimicai/adapter-sdk';
import type { DefaultFactory } from '@mimicai/adapter-sdk';

/**
 * Hand-tuned default factories. Codegen rewrites this file but the factory
 * bodies are preserved across regeneration (templates live in scripts/slack-codegen.ts).
 */

export function defaultChannel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId('C', 9).toUpperCase(),
    name: 'general',
    is_channel: true,
    is_group: false,
    is_im: false,
    is_mpim: false,
    is_private: false,
    is_archived: false,
    is_general: false,
    is_member: true,
    created: Math.floor(Date.now() / 1000),
    creator: '',
    num_members: 0,
    topic: { value: '', creator: '', last_set: 0 },
    purpose: { value: '', creator: '', last_set: 0 },
    ...overrides,
  };
}

export function defaultMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const ts = (Date.now() / 1000).toFixed(6);
  return {
    type: 'message',
    user: '',
    text: '',
    ts,
    team: '',
    blocks: [],
    ...overrides,
  };
}

export function defaultUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId('U', 9).toUpperCase(),
    team_id: '',
    name: 'unknown',
    real_name: 'Unknown User',
    deleted: false,
    is_admin: false,
    is_owner: false,
    is_bot: false,
    tz: 'America/Los_Angeles',
    profile: {
      real_name: 'Unknown User',
      display_name: 'unknown',
      email: 'unknown@example.com',
      image_24: 'https://placeholder.example/u24.png',
      image_72: 'https://placeholder.example/u72.png',
    },
    ...overrides,
  };
}

export function defaultTeam(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId('T', 9).toUpperCase(),
    name: 'Acme Workspace',
    domain: 'acme',
    email_domain: 'acme.example',
    icon: {
      image_default: true,
      image_34: 'https://placeholder.example/t34.png',
      image_44: 'https://placeholder.example/t44.png',
      image_68: 'https://placeholder.example/t68.png',
    },
    ...overrides,
  };
}

export function defaultFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: generateId('F', 9).toUpperCase(),
    created: now,
    timestamp: now,
    name: 'untitled',
    title: '',
    mimetype: 'application/octet-stream',
    filetype: 'binary',
    pretty_type: 'Binary',
    size: 0,
    user: '',
    channels: [],
    groups: [],
    ims: [],
    is_external: false,
    is_public: false,
    has_rich_preview: false,
    ...overrides,
  };
}

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
  "channel": defaultChannel,
  "channels": defaultChannel,
  "message": defaultMessage,
  "messages": defaultMessage,
  "user": defaultUser,
  "users": defaultUser,
  "team": defaultTeam,
  "teams": defaultTeam,
  "file": defaultFile,
  "files": defaultFile,
};
