import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestServer } from '@mimicai/adapter-sdk';
import type { TestServer } from '@mimicai/adapter-sdk';
import { GmailAdapter } from '../gmail-adapter.js';

const BASE = '/gmail/v1/users/me';

describe('GmailAdapter', () => {
  let ts: TestServer;
  let adapter: GmailAdapter;

  // Use a fresh adapter+server per test so seeded labels and message state
  // don't leak between tests.
  beforeEach(async () => {
    adapter = new GmailAdapter();
    ts = await buildTestServer(adapter);
  });

  afterEach(async () => {
    await ts.close();
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  it('exposes correct identity and base path', () => {
    expect(adapter.id).toBe('gmail');
    expect(adapter.basePath).toBe('/gmail/v1');
    expect(adapter.versions).toEqual(['v1']);
  });

  it('returns endpoint definitions for every generated route', () => {
    const endpoints = adapter.getEndpoints();
    expect(endpoints.length).toBeGreaterThanOrEqual(30);
    for (const ep of endpoints) {
      expect(ep.method).toBeDefined();
      expect(ep.path).toBeDefined();
    }
  });

  // ── Profile ───────────────────────────────────────────────────────────────

  it('GET /profile returns a synthesised profile', async () => {
    const res = await ts.server.inject({ method: 'GET', url: `${BASE}/profile` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.emailAddress).toBe('user@example.com');
    expect(body.messagesTotal).toBe(0);
    expect(body.threadsTotal).toBe(0);
    expect(body.historyId).toBeDefined();
  });

  // ── Labels ────────────────────────────────────────────────────────────────

  it('GET /labels returns the eight Gmail system labels', async () => {
    const res = await ts.server.inject({ method: 'GET', url: `${BASE}/labels` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.labels).toBeDefined();
    const ids: string[] = body.labels.map((l: { id: string }) => l.id);
    for (const expected of ['INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM', 'STARRED', 'IMPORTANT', 'UNREAD']) {
      expect(ids).toContain(expected);
    }
  });

  it('creates and retrieves a user label', async () => {
    const created = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/labels`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Briefing/Northwind' }),
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    expect(id).toMatch(/^Label_/);

    const fetched = await ts.server.inject({ method: 'GET', url: `${BASE}/labels/${id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().name).toBe('Briefing/Northwind');
  });

  it('returns 404 when fetching an unknown label', async () => {
    const res = await ts.server.inject({ method: 'GET', url: `${BASE}/labels/Label_unknown` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.status).toBe('NOT_FOUND');
  });

  // ── Messages ──────────────────────────────────────────────────────────────

  it('messages.send creates a message and an associated thread', async () => {
    const send = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/messages/send`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ snippet: 'Hello Priya' }),
    });
    expect(send.statusCode).toBe(200);
    const message = send.json();
    expect(message.id).toBeDefined();
    expect(message.threadId).toBeDefined();
    expect(message.labelIds).toContain('SENT');

    // Round-trip: list returns it, get returns it, thread exists
    const list = await ts.server.inject({
      method: 'GET',
      url: `${BASE}/messages?includeSpamTrash=true`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().messages.length).toBe(1);

    const get = await ts.server.inject({ method: 'GET', url: `${BASE}/messages/${message.id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json().snippet).toBe('Hello Priya');

    const thread = await ts.server.inject({
      method: 'GET',
      url: `${BASE}/threads/${message.threadId}`,
    });
    expect(thread.statusCode).toBe(200);
  });

  it('messages.list filters by labelIds (every requested label must be present)', async () => {
    // Send three messages with different label combos
    const inboxOnly = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/messages/send`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ snippet: 'a', labelIds: ['INBOX'] }),
    });
    const inboxStarred = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/messages/send`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ snippet: 'b', labelIds: ['INBOX', 'STARRED'] }),
    });
    await ts.server.inject({
      method: 'POST',
      url: `${BASE}/messages/send`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ snippet: 'c', labelIds: ['SENT'] }),
    });
    expect(inboxOnly.statusCode).toBe(200);
    expect(inboxStarred.statusCode).toBe(200);

    const filtered = await ts.server.inject({
      method: 'GET',
      url: `${BASE}/messages?labelIds=INBOX,STARRED`,
    });
    expect(filtered.statusCode).toBe(200);
    const body = filtered.json();
    expect(body.messages.length).toBe(1);
    expect(body.messages[0].id).toBe(inboxStarred.json().id);
  });

  it('messages.modify adds and removes labels atomically', async () => {
    const sent = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/messages/send`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ snippet: 'mod me', labelIds: ['INBOX', 'UNREAD'] }),
    });
    const id = sent.json().id;

    const modified = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/messages/${id}/modify`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD'] }),
    });
    expect(modified.statusCode).toBe(200);
    const labels = modified.json().labelIds;
    expect(labels).toContain('STARRED');
    expect(labels).toContain('INBOX');
    expect(labels).not.toContain('UNREAD');
  });

  it('messages.trash adds TRASH and removes INBOX; untrash reverses it', async () => {
    const sent = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/messages/send`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ snippet: 'trash me', labelIds: ['INBOX'] }),
    });
    const id = sent.json().id;

    const trashed = await ts.server.inject({ method: 'POST', url: `${BASE}/messages/${id}/trash` });
    expect(trashed.statusCode).toBe(200);
    expect(trashed.json().labelIds).toContain('TRASH');
    expect(trashed.json().labelIds).not.toContain('INBOX');

    const untrashed = await ts.server.inject({ method: 'POST', url: `${BASE}/messages/${id}/untrash` });
    expect(untrashed.statusCode).toBe(200);
    expect(untrashed.json().labelIds).toContain('INBOX');
    expect(untrashed.json().labelIds).not.toContain('TRASH');
  });

  it('messages.list excludes SPAM/TRASH by default and includes them when asked', async () => {
    const sent = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/messages/send`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ snippet: 'spam', labelIds: ['SPAM'] }),
    });
    expect(sent.statusCode).toBe(200);

    const defaultList = await ts.server.inject({ method: 'GET', url: `${BASE}/messages` });
    expect(defaultList.statusCode).toBe(200);
    expect(defaultList.json().messages.length).toBe(0);

    const withSpam = await ts.server.inject({
      method: 'GET',
      url: `${BASE}/messages?includeSpamTrash=true`,
    });
    expect(withSpam.statusCode).toBe(200);
    expect(withSpam.json().messages.length).toBe(1);
  });

  it('messages.batchModify applies labels to all listed ids', async () => {
    const a = await ts.server.inject({
      method: 'POST', url: `${BASE}/messages/send`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ snippet: 'a' }),
    });
    const b = await ts.server.inject({
      method: 'POST', url: `${BASE}/messages/send`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ snippet: 'b' }),
    });
    const res = await ts.server.inject({
      method: 'POST', url: `${BASE}/messages/batchModify`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ ids: [a.json().id, b.json().id], addLabelIds: ['IMPORTANT'] }),
    });
    expect(res.statusCode).toBe(204);

    const fetched = await ts.server.inject({ method: 'GET', url: `${BASE}/messages/${a.json().id}` });
    expect(fetched.json().labelIds).toContain('IMPORTANT');
  });

  // ── Threads ───────────────────────────────────────────────────────────────

  it('threads.modify propagates label changes to all messages in the thread', async () => {
    const sent = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/messages/send`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ snippet: 'first' }),
    });
    const threadId = sent.json().threadId;

    const modified = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/threads/${threadId}/modify`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ addLabelIds: ['IMPORTANT'] }),
    });
    expect(modified.statusCode).toBe(200);

    // The underlying message should now also carry IMPORTANT
    const msg = await ts.server.inject({ method: 'GET', url: `${BASE}/messages/${sent.json().id}` });
    expect(msg.json().labelIds).toContain('IMPORTANT');
  });

  // ── Drafts ────────────────────────────────────────────────────────────────

  it('drafts.create + drafts.send promotes the draft to a sent message', async () => {
    const created = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/drafts`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ message: { snippet: 'draft body' } }),
    });
    expect(created.statusCode).toBe(200);
    const draftId = created.json().id;
    expect(draftId).toMatch(/^r_/);

    const sent = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/drafts/send`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ id: draftId }),
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().labelIds).toContain('SENT');

    // Draft should be gone
    const after = await ts.server.inject({ method: 'GET', url: `${BASE}/drafts/${draftId}` });
    expect(after.statusCode).toBe(404);
  });

  // ── History ───────────────────────────────────────────────────────────────

  it('history.list returns 400 without startHistoryId', async () => {
    const res = await ts.server.inject({ method: 'GET', url: `${BASE}/history` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.status).toBe('INVALID_ARGUMENT');
  });

  it('history.list returns messageAdded records for messages newer than startHistoryId', async () => {
    const sent = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/messages/send`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ snippet: 'history' }),
    });
    const messageHistoryId = sent.json().historyId;

    // Anything strictly less than the message's historyId should show it.
    const start = String(BigInt(messageHistoryId) - 1n);
    const res = await ts.server.inject({
      method: 'GET',
      url: `${BASE}/history?startHistoryId=${start}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.history.length).toBe(1);
    expect(body.history[0].messagesAdded[0].message.id).toBe(sent.json().id);
  });

  // ── Watch / Stop ──────────────────────────────────────────────────────────

  it('users.watch returns historyId + expiration; stop returns 204', async () => {
    const watch = await ts.server.inject({
      method: 'POST',
      url: `${BASE}/watch`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ topicName: 'projects/p/topics/t' }),
    });
    expect(watch.statusCode).toBe(200);
    expect(watch.json().historyId).toBeDefined();
    expect(watch.json().expiration).toBeDefined();

    const stop = await ts.server.inject({ method: 'POST', url: `${BASE}/stop` });
    expect(stop.statusCode).toBe(204);
  });
});
