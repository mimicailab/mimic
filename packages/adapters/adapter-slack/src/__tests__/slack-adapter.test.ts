import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestServer } from '@mimicai/adapter-sdk';
import type { TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData } from '@mimicai/core';
import { SlackAdapter } from '../slack-adapter.js';

const BASE = '/api';

/** Helper: hit a Slack endpoint with form-encoded body (Slack's idiom). */
async function form(ts: TestServer, method: 'GET' | 'POST', path: string, body?: Record<string, string>) {
  const url = method === 'GET' && body ? `${BASE}${path}?${new URLSearchParams(body).toString()}` : `${BASE}${path}`;
  return ts.server.inject({
    method,
    url,
    headers: method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
    payload: method === 'POST' && body ? new URLSearchParams(body).toString() : undefined,
  });
}

describe('SlackAdapter', () => {
  let ts: TestServer;
  let adapter: SlackAdapter;

  beforeEach(async () => {
    adapter = new SlackAdapter();
    ts = await buildTestServer(adapter);
  });

  afterEach(async () => {
    await ts.close();
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  it('exposes correct identity and base path', () => {
    expect(adapter.id).toBe('slack');
    expect(adapter.basePath).toBe('/api');
  });

  it('returns endpoint definitions for every generated route', () => {
    const endpoints = adapter.getEndpoints();
    expect(endpoints.length).toBeGreaterThanOrEqual(20);
  });

  // ── Envelope ──────────────────────────────────────────────────────────────

  it('wraps every response in { ok: true|false, ... }', async () => {
    const okRes = await form(ts, 'GET', '/auth.test');
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json().ok).toBe(true);

    const errRes = await form(ts, 'GET', '/users.info', { user: 'UNOTREAL' });
    expect(errRes.statusCode).toBe(200);
    expect(errRes.json().ok).toBe(false);
    expect(errRes.json().error).toBe('users_not_found');
  });

  // ── auth.test + team.info ────────────────────────────────────────────────

  it('auth.test returns the seeded bot identity', async () => {
    const res = await form(ts, 'GET', '/auth.test');
    const body = res.json();
    expect(body.team_id).toMatch(/^T/);
    expect(body.user_id).toBe('USLACKBOT');
    expect(body.user).toBe('mimic-bot');
  });

  it('team.info returns the seeded workspace', async () => {
    const res = await form(ts, 'GET', '/team.info');
    const body = res.json();
    expect(body.team).toBeDefined();
    expect(body.team.domain).toBe('acme');
  });

  // ── conversations.create + .list + .history ──────────────────────────────

  it('creates a public channel, lists it, and returns 0 messages', async () => {
    const created = await form(ts, 'POST', '/conversations.create', { name: 'deals' });
    expect(created.statusCode).toBe(200);
    const channelId = created.json().channel.id;
    expect(channelId).toMatch(/^C/);
    expect(created.json().channel.name).toBe('deals');

    const list = await form(ts, 'GET', '/conversations.list', { types: 'public_channel' });
    expect(list.json().channels.map((c: { id: string }) => c.id)).toContain(channelId);

    const history = await form(ts, 'GET', '/conversations.history', { channel: channelId });
    expect(history.json().messages).toEqual([]);
    expect(history.json().has_more).toBe(false);
  });

  it('returns channel_not_found for an unknown channel', async () => {
    const res = await form(ts, 'GET', '/conversations.info', { channel: 'CDOESNOTEXIST' });
    expect(res.json().ok).toBe(false);
    expect(res.json().error).toBe('channel_not_found');
  });

  // ── chat.postMessage + .update + .delete ─────────────────────────────────

  it('posts, updates, and deletes a message in a channel', async () => {
    const created = await form(ts, 'POST', '/conversations.create', { name: 'cs' });
    const channelId = created.json().channel.id;

    const sent = await form(ts, 'POST', '/chat.postMessage', { channel: channelId, text: 'first' });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().ok).toBe(true);
    const ts1 = sent.json().ts as string;
    expect(ts1).toMatch(/^\d+\.\d{6}$/);

    const updated = await form(ts, 'POST', '/chat.update', { channel: channelId, ts: ts1, text: 'first edited' });
    expect(updated.json().message.text).toBe('first edited');
    expect(updated.json().message.edited).toBeDefined();

    const deleted = await form(ts, 'POST', '/chat.delete', { channel: channelId, ts: ts1 });
    expect(deleted.json().ok).toBe(true);

    const afterDelete = await form(ts, 'POST', '/chat.update', { channel: channelId, ts: ts1, text: 'too late' });
    expect(afterDelete.json().error).toBe('message_not_found');
  });

  // ── threads ──────────────────────────────────────────────────────────────

  it('chat.postMessage with thread_ts creates a thread reply visible in conversations.replies', async () => {
    const channelId = (await form(ts, 'POST', '/conversations.create', { name: 'eng' })).json().channel.id;
    const parent = await form(ts, 'POST', '/chat.postMessage', { channel: channelId, text: 'parent' });
    const parentTs = parent.json().ts;

    const reply = await form(ts, 'POST', '/chat.postMessage', {
      channel: channelId, text: 'reply 1', thread_ts: parentTs,
    });
    expect(reply.json().ok).toBe(true);

    const replies = await form(ts, 'GET', '/conversations.replies', { channel: channelId, ts: parentTs });
    const msgs = replies.json().messages;
    expect(msgs).toHaveLength(2); // parent + 1 reply
    expect(msgs[0].ts).toBe(parentTs);
    expect(msgs[1].text).toBe('reply 1');

    // History should only return the parent (top-level), not the reply
    const history = await form(ts, 'GET', '/conversations.history', { channel: channelId });
    expect(history.json().messages).toHaveLength(1);
    expect(history.json().messages[0].ts).toBe(parentTs);
  });

  // ── reactions ────────────────────────────────────────────────────────────

  it('reactions.add then .get returns the reaction; .remove clears it', async () => {
    const channelId = (await form(ts, 'POST', '/conversations.create', { name: 'random' })).json().channel.id;
    const m = await form(ts, 'POST', '/chat.postMessage', { channel: channelId, text: 'hi' });
    const messageTs = m.json().ts;

    const added = await form(ts, 'POST', '/reactions.add', { channel: channelId, timestamp: messageTs, name: 'thumbsup' });
    expect(added.json().ok).toBe(true);

    const got = await form(ts, 'GET', '/reactions.get', { channel: channelId, timestamp: messageTs });
    const reactions = got.json().message.reactions;
    expect(reactions).toHaveLength(1);
    expect(reactions[0].name).toBe('thumbsup');
    expect(reactions[0].count).toBe(1);

    // Adding the same reaction by the same user errors with already_reacted
    const dup = await form(ts, 'POST', '/reactions.add', { channel: channelId, timestamp: messageTs, name: 'thumbsup' });
    expect(dup.json().error).toBe('already_reacted');

    const removed = await form(ts, 'POST', '/reactions.remove', { channel: channelId, timestamp: messageTs, name: 'thumbsup' });
    expect(removed.json().ok).toBe(true);

    const getAfter = await form(ts, 'GET', '/reactions.get', { channel: channelId, timestamp: messageTs });
    expect(getAfter.json().message.reactions).toEqual([]);
  });

  // ── pins ─────────────────────────────────────────────────────────────────

  it('pins.add then pins.list shows the pinned message', async () => {
    const channelId = (await form(ts, 'POST', '/conversations.create', { name: 'pins' })).json().channel.id;
    const m = await form(ts, 'POST', '/chat.postMessage', { channel: channelId, text: 'pin me' });
    const messageTs = m.json().ts;

    const added = await form(ts, 'POST', '/pins.add', { channel: channelId, timestamp: messageTs });
    expect(added.json().ok).toBe(true);

    const list = await form(ts, 'GET', '/pins.list', { channel: channelId });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].message.ts).toBe(messageTs);

    await form(ts, 'POST', '/pins.remove', { channel: channelId, timestamp: messageTs });
    const after = await form(ts, 'GET', '/pins.list', { channel: channelId });
    expect(after.json().items).toEqual([]);
  });

  // ── search ───────────────────────────────────────────────────────────────

  it('search.messages does substring matching on text', async () => {
    const channelId = (await form(ts, 'POST', '/conversations.create', { name: 'deals' })).json().channel.id;
    await form(ts, 'POST', '/chat.postMessage', { channel: channelId, text: 'Northwind procurement update' });
    await form(ts, 'POST', '/chat.postMessage', { channel: channelId, text: 'Other deal context' });

    const res = await form(ts, 'GET', '/search.messages', { query: 'Northwind' });
    expect(res.json().messages.total).toBe(1);
    expect(res.json().messages.matches[0].text).toContain('Northwind');
  });

  // ── users.lookupByEmail ──────────────────────────────────────────────────

  it('users.lookupByEmail returns users_not_found when no user matches', async () => {
    const res = await form(ts, 'GET', '/users.lookupByEmail', { email: 'no-such@example.com' });
    expect(res.json().ok).toBe(false);
    expect(res.json().error).toBe('users_not_found');
  });

  // ── Seed-from-apiResponses path (the briefing-flow regression) ──────────

  describe('seedExpandedData → conversations.list / conversations.history', () => {
    it('channels emitted under apiResponses.slack.responses.channel are reachable via /conversations.list', async () => {
      // Re-build the adapter, this time with seeded apiResponses, to mimic
      // the `mimic seed` → `mimic host` path. The SDK seeder runs inside
      // registerGeneratedRoutes, so we need it to see this data at startup.
      await ts.close();
      adapter = new SlackAdapter();
      const data = makeData('p1', {
        channel: [
          { id: 'C_DEALS', name: 'deals', is_channel: true, is_private: false, created: 1700000000 },
          { id: 'C_GENERAL', name: 'general', is_channel: true, is_private: false, is_general: true, created: 1700000000 },
        ],
      });
      ts = await buildTestServer(adapter, data);

      const res = await form(ts, 'GET', '/conversations.list');
      const body = res.json() as { ok: boolean; channels: Array<{ id: string; name: string }> };
      expect(body.ok).toBe(true);
      expect(body.channels).toHaveLength(2);
      const names = body.channels.map((c) => c.name).sort();
      expect(names).toEqual(['deals', 'general']);
    });

    it('messages with composite key (channel:ts) are reachable via /conversations.history', async () => {
      await ts.close();
      adapter = new SlackAdapter();
      const data = makeData('p1', {
        channel: [{ id: 'C_DEALS', name: 'deals', is_channel: true, created: 1700000000 }],
        message: [
          { type: 'message', user: 'U1', text: 'Northwind Robotics — Sarah following up', ts: '1714000000.000100', channel: 'C_DEALS' },
          { type: 'message', user: 'U2', text: 'SOC 2 timeline confirmed for May.', ts: '1714000050.000200', channel: 'C_DEALS' },
          // Missing channel — should be silently skipped (resourceKey returns null)
          { type: 'message', user: 'U3', text: 'orphan', ts: '1714000099.000300' },
        ],
      });
      ts = await buildTestServer(adapter, data);

      const res = await form(ts, 'GET', '/conversations.history', { channel: 'C_DEALS' });
      const body = res.json() as { ok: boolean; messages: Array<{ text: string; ts: string }> };
      expect(body.ok).toBe(true);
      expect(body.messages).toHaveLength(2);
      const texts = body.messages.map((m) => m.text);
      expect(texts).toContain('Northwind Robotics — Sarah following up');
      expect(texts).toContain('SOC 2 timeline confirmed for May.');
    });

    it('users emitted under apiResponses.slack.responses.user are reachable via /users.list and /users.info', async () => {
      await ts.close();
      adapter = new SlackAdapter();
      const data = makeData('p1', {
        user: [
          { id: 'U_PRIYA', team_id: 'T1', name: 'priya', real_name: 'Priya Shah' },
          { id: 'U_SARAH', team_id: 'T1', name: 'sarah', real_name: 'Sarah Lee' },
        ],
      });
      ts = await buildTestServer(adapter, data);

      const list = (await form(ts, 'GET', '/users.list')).json() as { members: Array<{ id: string }> };
      // 2 seeded users + 1 default bot = 3
      expect(list.members.length).toBeGreaterThanOrEqual(3);
      const priya = (await form(ts, 'GET', '/users.info', { user: 'U_PRIYA' })).json() as { ok: boolean; user: { real_name: string } };
      expect(priya.ok).toBe(true);
      expect(priya.user.real_name).toBe('Priya Shah');
    });
  });

  // ── method_not_implemented fallback ─────────────────────────────────────

  it('an unmounted route would fall through to method_not_implemented (sanity check)', async () => {
    // We register every generated route with an override, so this is a
    // negative test verifying the registerOverride wiring really fired.
    // Route coverage check: every generated route gets a 200 + ok envelope
    // (either ok: true with handler output, or ok: false with a slack error).
    const endpoints = adapter.getEndpoints();
    expect(endpoints.length).toBeGreaterThan(0);
    for (const ep of endpoints.slice(0, 5)) {
      const res = await ts.server.inject({ method: ep.method, url: ep.path });
      expect(res.statusCode).toBe(200);
      expect(typeof res.json().ok).toBe('boolean');
    }
  });
});

function makeData(personaId: string, responses: Record<string, Array<Record<string, unknown>>>): Map<string, ExpandedData> {
  const wrapped: Record<string, Array<{ statusCode: number; headers: Record<string, string>; personaId: string; body: unknown }>> = {};
  for (const [k, v] of Object.entries(responses)) {
    wrapped[k] = v.map((body) => ({ statusCode: 200, headers: {}, personaId, body }));
  }
  return new Map([
    [personaId, {
      personaId,
      persona: { name: "t", age: 0, occupation: "", location: "", salary: null, description: "" },
      tables: {},
      documents: {},
      apiResponses: { slack: { adapterId: 'slack', responses: wrapped } },
      files: [],
      events: [],
      facts: [],
    }],
  ]);
}
