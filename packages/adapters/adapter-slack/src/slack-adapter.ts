import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EndpointDefinition, ExpandedData } from '@mimicailab/core';
import type { StateStore } from '@mimicailab/core';
import {
  BaseApiMockAdapter,
  generateId,
  unixNow,
} from '@mimicailab/adapter-sdk';
import { SlackConfigSchema, type SlackConfig } from './config.js';
import type { AdapterContext } from '@mimicailab/core';

// ── Namespace constants ─────────────────────────────────────────────────────
const NS_CHANNELS = 'slack_channels';
const NS_USERS = 'slack_users';
const NS_MESSAGES = 'slack_messages';
const NS_FILES = 'slack_files';
const NS_PENDING_UPLOADS = 'slack_pending_uploads';
const NS_SCHEDULED = 'slack_scheduled';

// ── Types ───────────────────────────────────────────────────────────────────
interface SlackChannel {
  id: string;
  name: string;
  is_channel: boolean;
  is_archived: boolean;
  is_private: boolean;
  created: number;
  num_members: number;
  topic?: { value: string; creator: string; last_set: number };
  purpose?: { value: string; creator: string; last_set: number };
}

interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  is_bot: boolean;
  profile: { display_name: string; real_name: string };
}

interface SlackMessage {
  channel: string;
  ts: string;
  text?: string;
  blocks?: unknown[];
  user?: string;
  thread_ts?: string;
  reactions?: { name: string; count: number; users: string[] }[];
  edited?: { user: string; ts: string };
}

interface SlackFile {
  id: string;
  name: string;
  size: number;
  created: number;
  channels?: string[];
}

export class SlackAdapter extends BaseApiMockAdapter<SlackConfig> {
  readonly id = 'slack';
  readonly name = 'Slack API';
  readonly basePath = '/slack/api';
  readonly versions = ['web'];

  private tsCounter = Date.now() / 1000;

  private nextTs(): string {
    this.tsCounter += 0.000001;
    return this.tsCounter.toFixed(6);
  }

  async init(config: SlackConfig, context: AdapterContext): Promise<void> {
    await super.init(config, context);
    this.config = SlackConfigSchema.parse(config);
  }

  resolvePersona(_req: FastifyRequest): string | null {
    return null;
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      { method: 'GET', path: '/slack/api/auth.test', description: 'Test authentication' },
      { method: 'POST', path: '/slack/api/chat.postMessage', description: 'Post a message' },
      { method: 'POST', path: '/slack/api/chat.update', description: 'Update a message' },
      { method: 'POST', path: '/slack/api/chat.delete', description: 'Delete a message' },
      { method: 'POST', path: '/slack/api/chat.postEphemeral', description: 'Post ephemeral message' },
      { method: 'POST', path: '/slack/api/chat.scheduleMessage', description: 'Schedule a message' },
      { method: 'GET', path: '/slack/api/conversations.list', description: 'List channels' },
      { method: 'GET', path: '/slack/api/conversations.history', description: 'Get channel history' },
      { method: 'GET', path: '/slack/api/conversations.replies', description: 'Get thread replies' },
      { method: 'GET', path: '/slack/api/conversations.info', description: 'Get channel info' },
      { method: 'GET', path: '/slack/api/conversations.members', description: 'List channel members' },
      { method: 'POST', path: '/slack/api/conversations.create', description: 'Create a channel' },
      { method: 'POST', path: '/slack/api/conversations.invite', description: 'Invite to channel' },
      { method: 'POST', path: '/slack/api/conversations.join', description: 'Join a channel' },
      { method: 'POST', path: '/slack/api/conversations.leave', description: 'Leave a channel' },
      { method: 'POST', path: '/slack/api/conversations.archive', description: 'Archive a channel' },
      { method: 'POST', path: '/slack/api/conversations.setTopic', description: 'Set channel topic' },
      { method: 'POST', path: '/slack/api/conversations.setPurpose', description: 'Set channel purpose' },
      { method: 'POST', path: '/slack/api/reactions.add', description: 'Add a reaction' },
      { method: 'POST', path: '/slack/api/reactions.remove', description: 'Remove a reaction' },
      { method: 'GET', path: '/slack/api/users.list', description: 'List users' },
      { method: 'GET', path: '/slack/api/users.info', description: 'Get user info' },
      { method: 'GET', path: '/slack/api/files.getUploadURLExternal', description: 'Get file upload URL' },
      { method: 'PUT', path: '/slack/api/_upload/:fileId', description: 'Upload file data' },
      { method: 'POST', path: '/slack/api/files.completeUploadExternal', description: 'Complete file upload' },
      { method: 'GET', path: '/slack/api/files.list', description: 'List files' },
      { method: 'GET', path: '/slack/api/search.messages', description: 'Search messages' },
      { method: 'GET', path: '/slack/api/team.info', description: 'Get team info' },
    ];
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    stateStore: StateStore,
  ): Promise<void> {
    const config = this.config;

    // ── Register content-type parser for file uploads (accepts any body) ──
    server.addContentTypeParser('application/octet-stream', (_req, payload, done) => {
      let rawData = '';
      payload.on('data', (chunk: Buffer) => { rawData += chunk.toString(); });
      payload.on('end', () => { done(null, rawData); });
    });

    // ── Seed from expanded apiResponses (cross-surface consistency) ─────
    let seededFromData = false;
    for (const [, expanded] of data) {
      const slackData = expanded.apiResponses?.slack;
      if (!slackData) continue;
      seededFromData = true;

      for (const [resourceType, responses] of Object.entries(slackData.responses)) {
        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          switch (resourceType) {
            case 'channels': {
              const id = String(body.id ?? generateId('C', 8).toUpperCase());
              stateStore.set(NS_CHANNELS, id, {
                id,
                name: String(body.name ?? 'unnamed'),
                is_channel: true,
                is_archived: false,
                is_private: Boolean(body.is_private ?? false),
                created: unixNow(),
                num_members: Number(body.num_members ?? 10),
                purpose: body.purpose ? { value: String(body.purpose), creator: '', last_set: 0 } : undefined,
              } satisfies SlackChannel);
              break;
            }
            case 'users': {
              const id = String(body.id ?? generateId('U', 8).toUpperCase());
              stateStore.set(NS_USERS, id, {
                id,
                name: String(body.name ?? 'unknown'),
                real_name: String(body.real_name ?? body.name ?? 'Unknown'),
                is_bot: Boolean(body.is_bot ?? false),
                profile: {
                  display_name: String(body.name ?? 'unknown'),
                  real_name: String(body.real_name ?? body.name ?? 'Unknown'),
                },
              } satisfies SlackUser);
              break;
            }
          }
        }
      }
    }

    // ── Seed defaults (only when no data was provided) ─────────────────
    if (!seededFromData) {
      const defaultChannels: SlackChannel[] = [
        { id: 'C01GENERAL', name: 'general', is_channel: true, is_archived: false, is_private: false, created: unixNow(), num_members: Math.floor(Math.random() * 50) + 10 },
        { id: 'C02RANDOM', name: 'random', is_channel: true, is_archived: false, is_private: false, created: unixNow(), num_members: Math.floor(Math.random() * 50) + 10 },
        { id: 'C03ENGINEERING', name: 'engineering', is_channel: true, is_archived: false, is_private: false, created: unixNow(), num_members: Math.floor(Math.random() * 30) + 5 },
        { id: 'C04SUPPORT', name: 'support', is_channel: true, is_archived: false, is_private: false, created: unixNow(), num_members: Math.floor(Math.random() * 20) + 5 },
        { id: 'C05PRODUCT', name: 'product', is_channel: true, is_archived: false, is_private: false, created: unixNow(), num_members: Math.floor(Math.random() * 20) + 5 },
      ];
      for (const ch of defaultChannels) {
        stateStore.set(NS_CHANNELS, ch.id, ch);
      }

      const defaultUsers: SlackUser[] = [
        { id: 'U01ALICE', name: 'alice', real_name: 'Alice Chen', is_bot: false, profile: { display_name: 'alice', real_name: 'Alice Chen' } },
        { id: 'U02BOB', name: 'bob', real_name: 'Bob Martinez', is_bot: false, profile: { display_name: 'bob', real_name: 'Bob Martinez' } },
        { id: 'U03CAROL', name: 'carol', real_name: 'Carol Park', is_bot: false, profile: { display_name: 'carol', real_name: 'Carol Park' } },
      ];
      for (const user of defaultUsers) {
        stateStore.set(NS_USERS, user.id, user);
      }
    }

    // Always ensure the bot user exists
    stateStore.set(NS_USERS, config.botUserId, {
      id: config.botUserId, name: 'mimic-bot', real_name: 'Mimic Bot', is_bot: true,
      profile: { display_name: 'mimic-bot', real_name: 'Mimic Bot' },
    });

    // ── Auth ──────────────────────────────────────────────────────────────
    server.get('/slack/api/auth.test', async (_req, reply) => {
      return reply.send({
        ok: true,
        url: `https://${config.teamName.toLowerCase().replace(/\s+/g, '-')}.slack.com/`,
        team: config.teamName,
        user: 'mimic-bot',
        team_id: config.teamId,
        user_id: config.botUserId,
      });
    });

    // ── Chat ──────────────────────────────────────────────────────────────
    server.post('/slack/api/chat.postMessage', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const channel = body.channel as string | undefined;
      const text = body.text as string | undefined;
      const blocks = body.blocks as unknown[] | undefined;
      const threadTs = body.thread_ts as string | undefined;

      if (!channel) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }
      if (!text && !blocks) {
        return reply.send({ ok: false, error: 'no_text' });
      }

      const ts = this.nextTs();
      const message: SlackMessage = {
        channel,
        ts,
        text: text ?? '',
        blocks,
        user: config.botUserId,
        thread_ts: threadTs,
      };

      stateStore.set(NS_MESSAGES, `${channel}_${ts}`, message);

      return reply.send({
        ok: true,
        channel,
        ts,
        message,
      });
    });

    server.post('/slack/api/chat.update', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const channel = body.channel as string | undefined;
      const ts = body.ts as string | undefined;
      const text = body.text as string | undefined;
      const blocks = body.blocks as unknown[] | undefined;

      if (!channel || !ts) {
        return reply.send({ ok: false, error: 'message_not_found' });
      }

      const key = `${channel}_${ts}`;
      const existing = stateStore.get<SlackMessage>(NS_MESSAGES, key);
      if (!existing) {
        return reply.send({ ok: false, error: 'message_not_found' });
      }

      const updated: SlackMessage = {
        ...existing,
        text: text ?? existing.text,
        blocks: blocks ?? existing.blocks,
        edited: { user: config.botUserId, ts: this.nextTs() },
      };
      stateStore.set(NS_MESSAGES, key, updated);

      return reply.send({ ok: true, channel, ts, message: updated });
    });

    server.post('/slack/api/chat.delete', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const channel = body.channel as string | undefined;
      const ts = body.ts as string | undefined;

      if (!channel || !ts) {
        return reply.send({ ok: false, error: 'message_not_found' });
      }

      const key = `${channel}_${ts}`;
      const deleted = stateStore.delete(NS_MESSAGES, key);
      if (!deleted) {
        return reply.send({ ok: false, error: 'message_not_found' });
      }

      return reply.send({ ok: true, channel, ts });
    });

    server.post('/slack/api/chat.postEphemeral', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const channel = body.channel as string | undefined;
      const text = body.text as string | undefined;

      if (!channel || !text) {
        return reply.send({ ok: false, error: 'invalid_arguments' });
      }

      return reply.send({ ok: true, message_ts: this.nextTs() });
    });

    server.post('/slack/api/chat.scheduleMessage', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const channel = body.channel as string | undefined;
      const text = body.text as string | undefined;
      const postAt = body.post_at as number | undefined;

      if (!channel || !text) {
        return reply.send({ ok: false, error: 'invalid_arguments' });
      }

      const scheduledId = generateId('Q', 10);
      const ts = this.nextTs();
      const scheduled = {
        id: scheduledId,
        channel,
        text,
        post_at: postAt ?? unixNow() + 3600,
        ts,
      };

      stateStore.set(NS_SCHEDULED, scheduledId, scheduled);

      return reply.send({
        ok: true,
        channel,
        scheduled_message_id: scheduledId,
        post_at: scheduled.post_at,
      });
    });

    // ── Conversations ─────────────────────────────────────────────────────
    server.get('/slack/api/conversations.list', async (req, reply) => {
      const query = req.query as Record<string, string>;
      const excludeArchived = query.exclude_archived === 'true';
      const types = query.types?.split(',') ?? [];

      let channels = stateStore.list<SlackChannel>(NS_CHANNELS);

      if (excludeArchived) {
        channels = channels.filter((ch) => !ch.is_archived);
      }

      if (types.length > 0) {
        channels = channels.filter((ch) => {
          if (types.includes('public_channel') && ch.is_channel && !ch.is_private) return true;
          if (types.includes('private_channel') && ch.is_private) return true;
          return false;
        });
      }

      return reply.send({ ok: true, channels });
    });

    server.get('/slack/api/conversations.history', async (req, reply) => {
      const query = req.query as Record<string, string>;
      const channel = query.channel;
      const limit = parseInt(query.limit ?? '100', 10);

      if (!channel) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      const messages = stateStore
        .filter<SlackMessage>(NS_MESSAGES, (msg) => msg.channel === channel && !msg.thread_ts)
        .sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts))
        .slice(0, limit);

      return reply.send({ ok: true, messages, has_more: false });
    });

    server.get('/slack/api/conversations.replies', async (req, reply) => {
      const query = req.query as Record<string, string>;
      const channel = query.channel;
      const ts = query.ts;

      if (!channel || !ts) {
        return reply.send({ ok: false, error: 'missing_arguments' });
      }

      // Parent message
      const parent = stateStore.get<SlackMessage>(NS_MESSAGES, `${channel}_${ts}`);
      if (!parent) {
        return reply.send({ ok: false, error: 'thread_not_found' });
      }

      // Replies: messages in this channel whose thread_ts matches the parent ts
      const replies = stateStore
        .filter<SlackMessage>(NS_MESSAGES, (msg) => msg.channel === channel && msg.thread_ts === ts)
        .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

      return reply.send({ ok: true, messages: [parent, ...replies] });
    });

    server.get('/slack/api/conversations.info', async (req, reply) => {
      const query = req.query as Record<string, string>;
      const channelId = query.channel;

      if (!channelId) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      const channel = stateStore.get<SlackChannel>(NS_CHANNELS, channelId);
      if (!channel) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      return reply.send({ ok: true, channel });
    });

    server.get('/slack/api/conversations.members', async (_req, reply) => {
      const users = stateStore.list<SlackUser>(NS_USERS);
      const members = users.map((u) => u.id);
      return reply.send({ ok: true, members });
    });

    server.post('/slack/api/conversations.create', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const name = body.name as string | undefined;
      const isPrivate = body.is_private === true;

      if (!name) {
        return reply.send({ ok: false, error: 'invalid_name' });
      }

      const id = generateId('C', 8).toUpperCase();
      const channel: SlackChannel = {
        id,
        name,
        is_channel: true,
        is_archived: false,
        is_private: isPrivate,
        created: unixNow(),
        num_members: 1,
      };

      stateStore.set(NS_CHANNELS, id, channel);
      return reply.send({ ok: true, channel });
    });

    server.post('/slack/api/conversations.invite', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const channelId = body.channel as string | undefined;

      if (!channelId) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      const channel = stateStore.get<SlackChannel>(NS_CHANNELS, channelId);
      if (!channel) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      stateStore.update(NS_CHANNELS, channelId, { num_members: channel.num_members + 1 });
      return reply.send({ ok: true, channel: { ...channel, num_members: channel.num_members + 1 } });
    });

    server.post('/slack/api/conversations.join', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const channelId = body.channel as string | undefined;

      if (!channelId) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      const channel = stateStore.get<SlackChannel>(NS_CHANNELS, channelId);
      if (!channel) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      return reply.send({ ok: true, channel });
    });

    server.post('/slack/api/conversations.leave', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const channelId = body.channel as string | undefined;

      if (!channelId) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      return reply.send({ ok: true });
    });

    server.post('/slack/api/conversations.archive', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const channelId = body.channel as string | undefined;

      if (!channelId) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      const channel = stateStore.get<SlackChannel>(NS_CHANNELS, channelId);
      if (!channel) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      stateStore.update(NS_CHANNELS, channelId, { is_archived: true });
      return reply.send({ ok: true });
    });

    server.post('/slack/api/conversations.setTopic', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const channelId = body.channel as string | undefined;
      const topic = body.topic as string | undefined;

      if (!channelId) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      const channel = stateStore.get<SlackChannel>(NS_CHANNELS, channelId);
      if (!channel) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      const topicObj = { value: topic ?? '', creator: config.botUserId, last_set: unixNow() };
      stateStore.update(NS_CHANNELS, channelId, { topic: topicObj });

      return reply.send({ ok: true, topic: topicObj });
    });

    server.post('/slack/api/conversations.setPurpose', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const channelId = body.channel as string | undefined;
      const purpose = body.purpose as string | undefined;

      if (!channelId) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      const channel = stateStore.get<SlackChannel>(NS_CHANNELS, channelId);
      if (!channel) {
        return reply.send({ ok: false, error: 'channel_not_found' });
      }

      const purposeObj = { value: purpose ?? '', creator: config.botUserId, last_set: unixNow() };
      stateStore.update(NS_CHANNELS, channelId, { purpose: purposeObj });

      return reply.send({ ok: true, purpose: purposeObj });
    });

    // ── Reactions ─────────────────────────────────────────────────────────
    server.post('/slack/api/reactions.add', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const channel = body.channel as string | undefined;
      const timestamp = body.timestamp as string | undefined;
      const reactionName = body.name as string | undefined;

      if (!channel || !timestamp || !reactionName) {
        return reply.send({ ok: false, error: 'invalid_arguments' });
      }

      const key = `${channel}_${timestamp}`;
      const message = stateStore.get<SlackMessage>(NS_MESSAGES, key);
      if (!message) {
        return reply.send({ ok: false, error: 'message_not_found' });
      }

      const reactions = message.reactions ?? [];
      const existing = reactions.find((r) => r.name === reactionName);
      if (existing) {
        existing.count += 1;
        existing.users.push(config.botUserId);
      } else {
        reactions.push({ name: reactionName, count: 1, users: [config.botUserId] });
      }

      stateStore.set(NS_MESSAGES, key, { ...message, reactions });
      return reply.send({ ok: true });
    });

    server.post('/slack/api/reactions.remove', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const channel = body.channel as string | undefined;
      const timestamp = body.timestamp as string | undefined;
      const reactionName = body.name as string | undefined;

      if (!channel || !timestamp || !reactionName) {
        return reply.send({ ok: false, error: 'invalid_arguments' });
      }

      const key = `${channel}_${timestamp}`;
      const message = stateStore.get<SlackMessage>(NS_MESSAGES, key);
      if (!message) {
        return reply.send({ ok: false, error: 'message_not_found' });
      }

      const reactions = (message.reactions ?? []).filter((r) => r.name !== reactionName);
      stateStore.set(NS_MESSAGES, key, { ...message, reactions });

      return reply.send({ ok: true });
    });

    // ── Users ─────────────────────────────────────────────────────────────
    server.get('/slack/api/users.list', async (_req, reply) => {
      const members = stateStore.list<SlackUser>(NS_USERS);
      return reply.send({ ok: true, members });
    });

    server.get('/slack/api/users.info', async (req, reply) => {
      const query = req.query as Record<string, string>;
      const userId = query.user;

      if (!userId) {
        return reply.send({ ok: false, error: 'user_not_found' });
      }

      const user = stateStore.get<SlackUser>(NS_USERS, userId);
      if (!user) {
        return reply.send({ ok: false, error: 'user_not_found' });
      }

      return reply.send({ ok: true, user });
    });

    // ── Files (2-step upload) ─────────────────────────────────────────────
    server.get('/slack/api/files.getUploadURLExternal', async (req, reply) => {
      const query = req.query as Record<string, string>;
      const filename = query.filename;
      const length = query.length;

      if (!filename || !length) {
        return reply.send({ ok: false, error: 'invalid_arguments' });
      }

      const fileId = generateId('F', 10);
      const pending = {
        id: fileId,
        name: filename,
        size: parseInt(length, 10),
        created: unixNow(),
      };

      stateStore.set(NS_PENDING_UPLOADS, fileId, pending);

      return reply.send({
        ok: true,
        upload_url: `/slack/api/_upload/${fileId}`,
        file_id: fileId,
      });
    });

    server.put('/slack/api/_upload/:fileId', async (_req, reply) => {
      return reply.status(200).send();
    });

    server.post('/slack/api/files.completeUploadExternal', async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const files = body.files as Array<{ id: string; title?: string }> | undefined;

      if (!files || files.length === 0) {
        return reply.send({ ok: false, error: 'invalid_arguments' });
      }

      const completedFiles: SlackFile[] = [];

      for (const f of files) {
        const pending = stateStore.get<SlackFile>(NS_PENDING_UPLOADS, f.id);
        if (!pending) continue;

        const completed: SlackFile = {
          ...pending,
          name: f.title ?? pending.name,
          channels: (body.channel_id ? [body.channel_id as string] : undefined),
        };

        stateStore.set(NS_FILES, f.id, completed);
        stateStore.delete(NS_PENDING_UPLOADS, f.id);
        completedFiles.push(completed);
      }

      return reply.send({ ok: true, files: completedFiles });
    });

    server.get('/slack/api/files.list', async (_req, reply) => {
      const files = stateStore.list<SlackFile>(NS_FILES);
      return reply.send({ ok: true, files });
    });

    // ── Search ────────────────────────────────────────────────────────────
    server.get('/slack/api/search.messages', async (req, reply) => {
      const query = req.query as Record<string, string>;
      const searchQuery = query.query;

      if (!searchQuery) {
        return reply.send({ ok: false, error: 'invalid_arguments' });
      }

      const lowerQuery = searchQuery.toLowerCase();
      const matches = stateStore.filter<SlackMessage>(
        NS_MESSAGES,
        (msg) => (msg.text ?? '').toLowerCase().includes(lowerQuery),
      );

      return reply.send({
        ok: true,
        messages: {
          total: matches.length,
          matches,
        },
      });
    });

    // ── Team ──────────────────────────────────────────────────────────────
    server.get('/slack/api/team.info', async (_req, reply) => {
      return reply.send({
        ok: true,
        team: {
          id: config.teamId,
          name: config.teamName,
          domain: config.teamName.toLowerCase().replace(/\s+/g, '-'),
        },
      });
    });
  }
}
