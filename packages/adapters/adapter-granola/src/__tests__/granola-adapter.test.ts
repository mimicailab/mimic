import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildTestServer } from '@mimicai/adapter-sdk';
import type { TestServer } from '@mimicai/adapter-sdk';
import { GranolaAdapter } from '../granola-adapter.js';
import { defaultNote, defaultFolder } from '../generated/schemas.js';

describe('GranolaAdapter', () => {
  let ts: TestServer;
  const adapter = new GranolaAdapter();

  beforeAll(async () => {
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // Reset notes/folders state between tests; re-add the seeded default folder.
  beforeEach(() => {
    for (const ns of ['granola:notes', 'granola:folders']) {
      for (const item of ts.stateStore.list<Record<string, unknown>>(ns)) {
        const id = item.id as string;
        if (id) ts.stateStore.delete(ns, id);
      }
    }
    // Re-seed default folder.
    ts.stateStore.set(
      'granola:folders',
      'fol_default00000',
      defaultFolder({
        id: 'fol_default00000',
        name: 'My notes',
        parent_folder_id: null,
        created_at: '2026-01-01T00:00:00Z',
      }),
    );
  });

  // ── Metadata ────────────────────────────────────────────────────────────────

  it('has the expected metadata', () => {
    expect(adapter.id).toBe('granola');
    expect(adapter.basePath).toBe('');
    expect(adapter.versions).toEqual(['v1']);
  });

  it('exposes 3 endpoint definitions matching the spec', () => {
    const endpoints = adapter.getEndpoints();
    expect(endpoints).toHaveLength(3);
    const paths = endpoints.map((e) => `${e.method} ${e.path}`).sort();
    expect(paths).toEqual([
      'GET /v1/folders',
      'GET /v1/notes',
      'GET /v1/notes/:note_id',
    ]);
  });

  // ── Notes — list ────────────────────────────────────────────────────────────

  it('GET /v1/notes returns Granola list envelope `{ notes, hasMore, cursor }`', async () => {
    ts.stateStore.set(
      'granola:notes',
      'not_a',
      defaultNote({
        id: 'not_a',
        title: 'Northwind discovery',
        created_at: '2026-04-20T15:00:00Z',
      }),
    );
    const res = await ts.server.inject({ method: 'GET', url: '/v1/notes' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notes).toBeInstanceOf(Array);
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].id).toBe('not_a');
    expect(body.hasMore).toBe(false);
    expect(body.cursor).toBeNull();
    // List responses must NOT include transcripts
    expect(body.notes[0].transcript).toBeUndefined();
  });

  it('GET /v1/notes filters by created_after / created_before', async () => {
    ts.stateStore.set('granola:notes', 'not_old', defaultNote({ id: 'not_old', created_at: '2026-01-15T10:00:00Z' }));
    ts.stateStore.set('granola:notes', 'not_mid', defaultNote({ id: 'not_mid', created_at: '2026-03-15T10:00:00Z' }));
    ts.stateStore.set('granola:notes', 'not_new', defaultNote({ id: 'not_new', created_at: '2026-04-20T10:00:00Z' }));

    const res = await ts.server.inject({
      method: 'GET',
      url: '/v1/notes?created_after=2026-02-01T00:00:00Z&created_before=2026-04-01T00:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].id).toBe('not_mid');
  });

  it('GET /v1/notes returns 400 with `invalid_date` for malformed ISO datetime', async () => {
    const res = await ts.server.inject({ method: 'GET', url: '/v1/notes?created_after=not-a-date' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.code).toBe('invalid_date');
    expect(body.error.message).toContain('created_after');
  });

  it('GET /v1/notes paginates via cursor (page_size + cursor + hasMore)', async () => {
    // Seed 5 notes with strictly-decreasing created_at so sort is stable.
    for (let i = 0; i < 5; i++) {
      const id = `not_${String(i).padStart(13, '0')}_x`;
      ts.stateStore.set(
        'granola:notes',
        id,
        defaultNote({
          id,
          title: `Note ${i}`,
          created_at: new Date(2026, 0, 5 - i, 0, 0, 0).toISOString(),
        }),
      );
    }

    const page1 = await ts.server.inject({ method: 'GET', url: '/v1/notes?page_size=2' });
    const body1 = page1.json();
    expect(body1.notes).toHaveLength(2);
    expect(body1.hasMore).toBe(true);
    expect(body1.cursor).toBe(body1.notes[1].id);

    const page2 = await ts.server.inject({
      method: 'GET',
      url: `/v1/notes?page_size=2&cursor=${encodeURIComponent(body1.cursor)}`,
    });
    const body2 = page2.json();
    expect(body2.notes).toHaveLength(2);
    expect(body2.hasMore).toBe(true);
    // Pages don't overlap
    const ids1 = body1.notes.map((n: { id: string }) => n.id);
    const ids2 = body2.notes.map((n: { id: string }) => n.id);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);

    const page3 = await ts.server.inject({
      method: 'GET',
      url: `/v1/notes?page_size=2&cursor=${encodeURIComponent(body2.cursor)}`,
    });
    const body3 = page3.json();
    expect(body3.notes).toHaveLength(1);
    expect(body3.hasMore).toBe(false);
    expect(body3.cursor).toBeNull();
  });

  // ── Notes — retrieve ────────────────────────────────────────────────────────

  it('GET /v1/notes/:id returns the note flat (no `data` wrapper) without transcript by default', async () => {
    ts.stateStore.set(
      'granola:notes',
      'not_specific',
      defaultNote({
        id: 'not_specific',
        title: 'SOC 2 deep-dive',
        summary: 'Priya raised the SOC 2 blocker.',
        transcript: [
          {
            speaker: { source: 'microphone', diarization_label: 'Speaker A' },
            text: 'Hi Priya.',
            start_time: '2026-04-20T15:00:00Z',
            end_time: '2026-04-20T15:00:03Z',
          },
        ],
      }),
    );

    const res = await ts.server.inject({ method: 'GET', url: '/v1/notes/not_specific' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Flat shape — no `data` wrapper
    expect(body.data).toBeUndefined();
    expect(body.id).toBe('not_specific');
    expect(body.summary).toBe('Priya raised the SOC 2 blocker.');
    // Transcript is omitted by default
    expect(body.transcript).toBeUndefined();
  });

  it('GET /v1/notes/:id?include=transcript bundles the transcript array', async () => {
    ts.stateStore.set(
      'granola:notes',
      'not_with_t',
      defaultNote({
        id: 'not_with_t',
        transcript: [
          { speaker: { source: 'microphone' }, text: 'Hello', start_time: '2026-04-20T15:00:00Z', end_time: '2026-04-20T15:00:01Z' },
          { speaker: { source: 'speaker' }, text: 'Hi', start_time: '2026-04-20T15:00:02Z', end_time: '2026-04-20T15:00:03Z' },
        ],
      }),
    );

    const res = await ts.server.inject({
      method: 'GET',
      url: '/v1/notes/not_with_t?include=transcript',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.transcript).toBeInstanceOf(Array);
    expect(body.transcript).toHaveLength(2);
    expect(body.transcript[0].text).toBe('Hello');
  });

  it('GET /v1/notes/:id?include=transcript returns 404 when the note has no transcript', async () => {
    ts.stateStore.set(
      'granola:notes',
      'not_no_t',
      defaultNote({ id: 'not_no_t', transcript: [] }),
    );
    const res = await ts.server.inject({
      method: 'GET',
      url: '/v1/notes/not_no_t?include=transcript',
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('not_found');
  });

  it('GET /v1/notes/:id returns 404 for unknown id', async () => {
    const res = await ts.server.inject({ method: 'GET', url: '/v1/notes/not_does_not_exist' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.type).toBe('not_found_error');
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain('not_does_not_exist');
  });

  // ── Folders ─────────────────────────────────────────────────────────────────

  it('GET /v1/folders returns alphabetically-sorted list with cursor envelope', async () => {
    ts.stateStore.set('granola:folders', 'fol_z', defaultFolder({ id: 'fol_z', name: 'Zeta team' }));
    ts.stateStore.set('granola:folders', 'fol_a', defaultFolder({ id: 'fol_a', name: 'Alpha team' }));
    ts.stateStore.set('granola:folders', 'fol_b', defaultFolder({ id: 'fol_b', name: 'Bravo team' }));

    const res = await ts.server.inject({ method: 'GET', url: '/v1/folders' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.folders).toBeInstanceOf(Array);
    // 4 folders total: 3 added + 1 seeded default ("My notes")
    expect(body.folders).toHaveLength(4);
    const names = body.folders.map((f: { name: string }) => f.name);
    expect(names).toEqual([...names].sort()); // alphabetical
    expect(body.hasMore).toBe(false);
    expect(body.cursor).toBeNull();
  });

  it('GET /v1/folders supports cursor pagination', async () => {
    // Seed enough folders to paginate (default folder + 4 = 5).
    for (const letter of ['a', 'b', 'c', 'd']) {
      const id = `fol_${letter}`;
      ts.stateStore.set('granola:folders', id, defaultFolder({ id, name: `Folder ${letter.toUpperCase()}` }));
    }
    const page1 = await ts.server.inject({ method: 'GET', url: '/v1/folders?page_size=2' });
    const b1 = page1.json();
    expect(b1.folders).toHaveLength(2);
    expect(b1.hasMore).toBe(true);
    expect(b1.cursor).toBe(b1.folders[1].id);

    const page2 = await ts.server.inject({
      method: 'GET',
      url: `/v1/folders?page_size=2&cursor=${encodeURIComponent(b1.cursor)}`,
    });
    const b2 = page2.json();
    expect(b2.folders).toHaveLength(2);
    expect(b2.hasMore).toBe(true);
  });

  // ── Persona resolution ─────────────────────────────────────────────────────

  it('resolvePersona extracts persona from `Bearer grn_<persona>_<rest>`', () => {
    const fakeReq = {
      headers: { authorization: 'Bearer grn_northwind-priya_aaaaaaaa' },
    } as unknown as Parameters<GranolaAdapter['resolvePersona']>[0];
    expect(adapter.resolvePersona(fakeReq)).toBe('northwind-priya');
  });

  it('resolvePersona returns null without auth header', () => {
    const fakeReq = { headers: {} } as unknown as Parameters<GranolaAdapter['resolvePersona']>[0];
    expect(adapter.resolvePersona(fakeReq)).toBeNull();
  });

  // ── Briefing-agent flow integration ────────────────────────────────────────

  it('briefing-agent flow: list-by-attendee → get-with-transcript', async () => {
    // Two meetings — only one has Priya as an invitee.
    ts.stateStore.set(
      'granola:notes',
      'not_priya',
      defaultNote({
        id: 'not_priya',
        title: 'Priya x SOC 2',
        created_at: '2026-04-20T15:00:00Z',
        calendar_event: {
          title: 'Priya x SOC 2',
          start_time: '2026-04-20T15:00:00Z',
          end_time: '2026-04-20T15:30:00Z',
          invitees: [
            { name: 'Priya Shah', email: 'priya@northwind.com' },
            { name: 'Sarah Lee', email: 'sarah@us.example' },
          ],
        },
        transcript: [
          { speaker: { source: 'microphone' }, text: 'SOC 2 is the blocker.', start_time: '2026-04-20T15:00:00Z', end_time: '2026-04-20T15:00:05Z' },
        ],
      }),
    );
    ts.stateStore.set(
      'granola:notes',
      'not_other',
      defaultNote({
        id: 'not_other',
        title: 'Internal sync',
        created_at: '2026-04-19T15:00:00Z',
        calendar_event: {
          start_time: '2026-04-19T15:00:00Z',
          end_time: '2026-04-19T15:30:00Z',
          invitees: [{ name: 'Bob', email: 'bob@us.example' }],
        },
      }),
    );

    // 1. list to find candidate meetings
    const listRes = await ts.server.inject({ method: 'GET', url: '/v1/notes' });
    const list = listRes.json();
    const priyaMatches = list.notes.filter((n: { calendar_event: { invitees: Array<{ email: string }> } | null }) =>
      n.calendar_event?.invitees?.some((i) => i.email === 'priya@northwind.com'),
    );
    expect(priyaMatches).toHaveLength(1);
    expect(priyaMatches[0].id).toBe('not_priya');

    // 2. fetch transcript for that meeting
    const tRes = await ts.server.inject({
      method: 'GET',
      url: `/v1/notes/${priyaMatches[0].id}?include=transcript`,
    });
    expect(tRes.statusCode).toBe(200);
    const t = tRes.json();
    expect(t.transcript[0].text).toContain('SOC 2');
  });
});
