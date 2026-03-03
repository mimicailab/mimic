import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData, Blueprint } from '@mimicai/core';
import { SlackAdapter } from '../slack-adapter.js';

describe('SlackAdapter', () => {
  let ts: TestServer;

  beforeAll(async () => {
    const adapter = new SlackAdapter();
    await adapter.init({ teamId: 'T01MIMIC', teamName: 'Mimic Workspace', botUserId: 'U01MIMICBOT' }, {
      config: {} as any,
      blueprints: new Map(),
      logger: console,
    });
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ─────────────────────────────────────────────────
  it('should have correct adapter metadata', () => {
    const adapter = new SlackAdapter();
    expect(adapter.id).toBe('slack');
    expect(adapter.name).toBe('Slack API');
    expect(adapter.type).toBe('api-mock');
    expect(adapter.basePath).toBe('/slack/api');
  });

  // ── 2. Default channels seeded ──────────────────────────────────────────
  it('should seed 5 default channels', async () => {
    const res = await ts.server.inject({ method: 'GET', url: '/slack/api/conversations.list' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.channels).toHaveLength(5);
    const names = body.channels.map((ch: any) => ch.name).sort();
    expect(names).toEqual(['engineering', 'general', 'product', 'random', 'support']);
  });

  // ── 3. Default users seeded ─────────────────────────────────────────────
  it('should seed 4 default users', async () => {
    const res = await ts.server.inject({ method: 'GET', url: '/slack/api/users.list' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.members).toHaveLength(4);
    const names = body.members.map((u: any) => u.name).sort();
    expect(names).toEqual(['alice', 'bob', 'carol', 'mimic-bot']);
  });

  // ── 4. Auth test returns workspace info ─────────────────────────────────
  it('should return workspace info from auth.test', async () => {
    const res = await ts.server.inject({ method: 'GET', url: '/slack/api/auth.test' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.team_id).toBe('T01MIMIC');
    expect(body.team).toBe('Mimic Workspace');
    expect(body.user_id).toBe('U01MIMICBOT');
  });

  // ── 5. Post message → retrieve in history ───────────────────────────────
  it('should post a message and retrieve it in conversations.history', async () => {
    const postRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/chat.postMessage',
      payload: { channel: 'C01GENERAL', text: 'Hello from test' },
    });
    expect(postRes.statusCode).toBe(200);
    const postBody = postRes.json();
    expect(postBody.ok).toBe(true);
    expect(postBody.ts).toBeDefined();
    expect(postBody.channel).toBe('C01GENERAL');

    const historyRes = await ts.server.inject({
      method: 'GET',
      url: '/slack/api/conversations.history?channel=C01GENERAL',
    });
    const historyBody = historyRes.json();
    expect(historyBody.ok).toBe(true);
    expect(historyBody.messages.some((m: any) => m.text === 'Hello from test')).toBe(true);
  });

  // ── 6. Update message → verify edited field ────────────────────────────
  it('should update a message and add edited field', async () => {
    const postRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/chat.postMessage',
      payload: { channel: 'C01GENERAL', text: 'Original text' },
    });
    const { ts: msgTs } = postRes.json();

    const updateRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/chat.update',
      payload: { channel: 'C01GENERAL', ts: msgTs, text: 'Updated text' },
    });
    const updateBody = updateRes.json();
    expect(updateBody.ok).toBe(true);
    expect(updateBody.message.text).toBe('Updated text');
    expect(updateBody.message.edited).toBeDefined();
    expect(updateBody.message.edited.user).toBe('U01MIMICBOT');
  });

  // ── 7. Delete message → no longer in history ───────────────────────────
  it('should delete a message so it no longer appears in history', async () => {
    const postRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/chat.postMessage',
      payload: { channel: 'C02RANDOM', text: 'Delete me' },
    });
    const { ts: msgTs } = postRes.json();

    const delRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/chat.delete',
      payload: { channel: 'C02RANDOM', ts: msgTs },
    });
    expect(delRes.json().ok).toBe(true);

    const historyRes = await ts.server.inject({
      method: 'GET',
      url: '/slack/api/conversations.history?channel=C02RANDOM',
    });
    const msgs = historyRes.json().messages;
    expect(msgs.some((m: any) => m.ts === msgTs)).toBe(false);
  });

  // ── 8. Thread: post with thread_ts → get via conversations.replies ─────
  it('should support threaded replies', async () => {
    // Post parent message
    const parentRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/chat.postMessage',
      payload: { channel: 'C03ENGINEERING', text: 'Parent message' },
    });
    const parentTs = parentRes.json().ts;

    // Post reply in thread
    const replyRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/chat.postMessage',
      payload: { channel: 'C03ENGINEERING', text: 'Thread reply', thread_ts: parentTs },
    });
    expect(replyRes.json().ok).toBe(true);

    // Retrieve replies
    const repliesRes = await ts.server.inject({
      method: 'GET',
      url: `/slack/api/conversations.replies?channel=C03ENGINEERING&ts=${parentTs}`,
    });
    const repliesBody = repliesRes.json();
    expect(repliesBody.ok).toBe(true);
    expect(repliesBody.messages).toHaveLength(2);
    expect(repliesBody.messages[0].text).toBe('Parent message');
    expect(repliesBody.messages[1].text).toBe('Thread reply');
  });

  // ── 9. Create channel → verify in list ──────────────────────────────────
  it('should create a new channel', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/conversations.create',
      payload: { name: 'new-channel' },
    });
    const createBody = createRes.json();
    expect(createBody.ok).toBe(true);
    expect(createBody.channel.name).toBe('new-channel');

    const listRes = await ts.server.inject({ method: 'GET', url: '/slack/api/conversations.list' });
    const channels = listRes.json().channels;
    expect(channels.some((ch: any) => ch.name === 'new-channel')).toBe(true);
  });

  // ── 10. Archive channel → excluded with exclude_archived ────────────────
  it('should archive a channel and exclude it when exclude_archived=true', async () => {
    // Create a channel to archive
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/conversations.create',
      payload: { name: 'archive-me' },
    });
    const channelId = createRes.json().channel.id;

    // Archive it
    const archiveRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/conversations.archive',
      payload: { channel: channelId },
    });
    expect(archiveRes.json().ok).toBe(true);

    // Should be excluded when exclude_archived=true
    const listRes = await ts.server.inject({
      method: 'GET',
      url: '/slack/api/conversations.list?exclude_archived=true',
    });
    const channels = listRes.json().channels;
    expect(channels.some((ch: any) => ch.id === channelId)).toBe(false);
  });

  // ── 11. Reactions: add → verify → remove → verify gone ─────────────────
  it('should add and remove reactions on a message', async () => {
    // Post a message
    const postRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/chat.postMessage',
      payload: { channel: 'C01GENERAL', text: 'React to me' },
    });
    const msgTs = postRes.json().ts;

    // Add reaction
    const addRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/reactions.add',
      payload: { channel: 'C01GENERAL', timestamp: msgTs, name: 'thumbsup' },
    });
    expect(addRes.json().ok).toBe(true);

    // Verify reaction is on the message (via history)
    const historyRes = await ts.server.inject({
      method: 'GET',
      url: '/slack/api/conversations.history?channel=C01GENERAL',
    });
    const msgWithReaction = historyRes.json().messages.find((m: any) => m.ts === msgTs);
    expect(msgWithReaction.reactions).toHaveLength(1);
    expect(msgWithReaction.reactions[0].name).toBe('thumbsup');
    expect(msgWithReaction.reactions[0].count).toBe(1);

    // Remove reaction
    const removeRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/reactions.remove',
      payload: { channel: 'C01GENERAL', timestamp: msgTs, name: 'thumbsup' },
    });
    expect(removeRes.json().ok).toBe(true);

    // Verify reaction is gone
    const historyRes2 = await ts.server.inject({
      method: 'GET',
      url: '/slack/api/conversations.history?channel=C01GENERAL',
    });
    const msgAfterRemove = historyRes2.json().messages.find((m: any) => m.ts === msgTs);
    expect(msgAfterRemove.reactions).toHaveLength(0);
  });

  // ── 12. File upload 2-step flow ─────────────────────────────────────────
  it('should complete the 2-step file upload flow', async () => {
    // Step 1: Get upload URL
    const urlRes = await ts.server.inject({
      method: 'GET',
      url: '/slack/api/files.getUploadURLExternal?filename=test.txt&length=1024',
    });
    const urlBody = urlRes.json();
    expect(urlBody.ok).toBe(true);
    expect(urlBody.upload_url).toBeDefined();
    expect(urlBody.file_id).toBeDefined();

    // Step 1.5: Mock upload (PUT)
    const uploadRes = await ts.server.inject({
      method: 'PUT',
      url: urlBody.upload_url,
      headers: { 'content-type': 'application/octet-stream' },
      payload: 'file content here',
    });
    expect(uploadRes.statusCode).toBe(200);

    // Step 2: Complete upload
    const completeRes = await ts.server.inject({
      method: 'POST',
      url: '/slack/api/files.completeUploadExternal',
      payload: { files: [{ id: urlBody.file_id, title: 'test.txt' }] },
    });
    const completeBody = completeRes.json();
    expect(completeBody.ok).toBe(true);
    expect(completeBody.files).toHaveLength(1);
    expect(completeBody.files[0].id).toBe(urlBody.file_id);

    // Verify in files.list
    const listRes = await ts.server.inject({ method: 'GET', url: '/slack/api/files.list' });
    const files = listRes.json().files;
    expect(files.some((f: any) => f.id === urlBody.file_id)).toBe(true);
  });

  // ── 13. Search messages by query ────────────────────────────────────────
  it('should search messages by query text', async () => {
    // Post a distinctive message
    await ts.server.inject({
      method: 'POST',
      url: '/slack/api/chat.postMessage',
      payload: { channel: 'C01GENERAL', text: 'UniqueSearchTerm42 is here' },
    });

    const searchRes = await ts.server.inject({
      method: 'GET',
      url: '/slack/api/search.messages?query=UniqueSearchTerm42',
    });
    const searchBody = searchRes.json();
    expect(searchBody.ok).toBe(true);
    expect(searchBody.messages.total).toBeGreaterThanOrEqual(1);
    expect(searchBody.messages.matches.some((m: any) => m.text.includes('UniqueSearchTerm42'))).toBe(true);
  });

  // ── 14. conversations.info returns channel details ──────────────────────
  it('should return channel details from conversations.info', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/slack/api/conversations.info?channel=C01GENERAL',
    });
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.channel.id).toBe('C01GENERAL');
    expect(body.channel.name).toBe('general');
    expect(body.channel.is_channel).toBe(true);
  });

  // ── 15. users.info returns user details ─────────────────────────────────
  it('should return user details from users.info', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/slack/api/users.info?user=U01ALICE',
    });
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.user.id).toBe('U01ALICE');
    expect(body.user.name).toBe('alice');
    expect(body.user.real_name).toBe('Alice Chen');
  });

  // ── 16. team.info returns workspace ─────────────────────────────────────
  it('should return team info from team.info', async () => {
    const res = await ts.server.inject({ method: 'GET', url: '/slack/api/team.info' });
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.team.id).toBe('T01MIMIC');
    expect(body.team.name).toBe('Mimic Workspace');
    expect(body.team.domain).toBe('mimic-workspace');
  });
});

// ── Cross-surface seeding ────────────────────────────────────────────────

describe('SlackAdapter with seed data', () => {
  let seededTs: TestServer;

  beforeAll(async () => {
    const adapter = new SlackAdapter();
    await adapter.init(
      { teamId: 'T01MIMIC', teamName: 'Mimic Workspace', botUserId: 'U01MIMICBOT' },
      { config: {} as any, blueprints: new Map(), logger: console },
    );

    const seedData = new Map<string, ExpandedData>([
      ['test-persona', {
        personaId: 'test-persona',
        blueprint: {} as Blueprint,
        tables: {},
        documents: {},
        apiResponses: {
          slack: {
            adapterId: 'slack',
            responses: {
              channels: [
                {
                  statusCode: 200,
                  headers: {},
                  body: { id: 'C_BILLING', name: 'billing-alerts', purpose: 'Payment notifications' },
                  personaId: 'test-persona',
                  stateKey: 'slack_channels',
                },
                {
                  statusCode: 200,
                  headers: {},
                  body: { id: 'C_ONCALL', name: 'oncall', is_private: true },
                  personaId: 'test-persona',
                  stateKey: 'slack_channels',
                },
              ],
              users: [
                {
                  statusCode: 200,
                  headers: {},
                  body: { id: 'U_SARAH', name: 'sarah.chen', real_name: 'Sarah Chen' },
                  personaId: 'test-persona',
                  stateKey: 'slack_users',
                },
              ],
            },
          },
        },
        files: [],
        events: [],
      }],
    ]);

    seededTs = await buildTestServer(adapter, seedData);
  });

  afterAll(async () => {
    await seededTs.close();
  });

  it('should list seeded channels instead of defaults', async () => {
    const res = await seededTs.server.inject({ method: 'GET', url: '/slack/api/conversations.list' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    const names = body.channels.map((ch: any) => ch.name).sort();
    expect(names).toContain('billing-alerts');
    expect(names).toContain('oncall');
    // Should NOT have default channels since seed data was provided
    expect(names).not.toContain('general');
  });

  it('should include seeded users plus the bot', async () => {
    const res = await seededTs.server.inject({ method: 'GET', url: '/slack/api/users.list' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const names = body.members.map((u: any) => u.name).sort();
    expect(names).toContain('sarah.chen');
    expect(names).toContain('mimic-bot'); // always present
  });

  it('should retrieve seeded channel details', async () => {
    const res = await seededTs.server.inject({
      method: 'GET',
      url: '/slack/api/conversations.info?channel=C_BILLING',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.channel.name).toBe('billing-alerts');
    expect(body.channel.purpose.value).toBe('Payment notifications');
  });

  it('should support private channels from seed data', async () => {
    const res = await seededTs.server.inject({
      method: 'GET',
      url: '/slack/api/conversations.info?channel=C_ONCALL',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().channel.is_private).toBe(true);
  });
});
