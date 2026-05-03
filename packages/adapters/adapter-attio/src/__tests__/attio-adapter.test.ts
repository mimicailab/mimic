import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildTestServer } from '@mimicai/adapter-sdk';
import type { TestServer } from '@mimicai/adapter-sdk';
import { AttioAdapter } from '../attio-adapter.js';
import { DEFAULT_WORKSPACE_ID } from '../generated/schemas.js';

describe('AttioAdapter', () => {
  let ts: TestServer;
  const adapter = new AttioAdapter();

  beforeAll(async () => {
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // Reset record/list/note/task state between tests so they don't leak.
  beforeEach(() => {
    for (const ns of [
      'attio:records:people',
      'attio:records:companies',
      'attio:records:deals',
      'attio:list_entries:northwind-eval',
      'attio:lists',
      'attio:notes',
      'attio:tasks',
      'attio:threads',
      'attio:comments',
      'attio:meetings',
      'attio:webhooks',
      'attio:files',
      'attio:scim_users',
      'attio:scim_groups',
    ]) {
      for (const item of ts.stateStore.list<Record<string, unknown>>(ns)) {
        // best-effort: keys live on `id.<resource>_id` in our mock; for stores
        // keyed by simple ids (lists/notes), pull from the value map.
        const id = item.id as Record<string, string> | string | undefined;
        const key = typeof id === 'string'
          ? id
          : id?.entry_id ?? id?.note_id ?? id?.task_id ?? id?.thread_id ?? id?.comment_id ?? id?.meeting_id ?? id?.webhook_id ?? id?.file_id ?? id?.list_id ?? id?.record_id;
        if (key) ts.stateStore.delete(ns, key);
      }
    }
    // Re-add a deals list for state-transition tests.
    ts.stateStore.set('attio:lists', 'northwind-eval', {
      id: { workspace_id: DEFAULT_WORKSPACE_ID, list_id: 'northwind-eval' },
      api_slug: 'northwind-eval',
      name: 'Northwind Eval',
      parent_object: ['deals'],
      created_at: '2026-03-01T00:00:00Z',
    });
  });

  // ── Metadata ────────────────────────────────────────────────────────────────

  it('has the expected metadata', () => {
    expect(adapter.id).toBe('attio');
    expect(adapter.basePath).toBe('');
    expect(adapter.versions).toEqual(['v2']);
  });

  it('exposes endpoint definitions for every generated route', () => {
    const endpoints = adapter.getEndpoints();
    expect(endpoints.length).toBeGreaterThanOrEqual(80);
    for (const ep of endpoints) {
      expect(ep.method).toMatch(/^(GET|POST|PUT|PATCH|DELETE)$/);
      expect(ep.path).toMatch(/^\//);
    }
  });

  // ── /v2/self ────────────────────────────────────────────────────────────────

  it('GET /v2/self returns workspace identity (flat envelope, no `data` wrap)', async () => {
    const res = await ts.server.inject({ method: 'GET', url: '/v2/self' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.active).toBe(true);
    expect(body.workspace_id).toBe(DEFAULT_WORKSPACE_ID);
    expect(body.workspace_name).toBeDefined();
    expect(body.token_type).toBe('Bearer');
    // Crucially NOT wrapped in `{ data: ... }`
    expect(body.data).toBeUndefined();
  });

  // ── Objects ────────────────────────────────────────────────────────────────

  it('GET /v2/objects lists the seeded standard objects', async () => {
    const res = await ts.server.inject({ method: 'GET', url: '/v2/objects' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    const slugs = body.data.map((o: Record<string, unknown>) => o.api_slug);
    expect(slugs).toEqual(expect.arrayContaining(['people', 'companies', 'deals']));
  });

  it('GET /v2/objects/people retrieves the people object', async () => {
    const res = await ts.server.inject({ method: 'GET', url: '/v2/objects/people' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.api_slug).toBe('people');
    expect(body.data.singular_noun).toBe('person');
  });

  it('GET /v2/objects/unknown returns 404 with Attio flat error envelope', async () => {
    const res = await ts.server.inject({ method: 'GET', url: '/v2/objects/nonexistent' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.status_code).toBe(404);
    expect(body.type).toBe('not_found_error');
    expect(body.code).toBe('not_found');
    expect(body.message).toContain('nonexistent');
    expect(body.error).toBeUndefined(); // no nested `error: { ... }`
  });

  // ── Records — the heart of Attio ────────────────────────────────────────────

  describe('records', () => {
    it('creates a person record via POST /v2/objects/people/records', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/v2/objects/people/records',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: {
            values: {
              email_addresses: [{ email_address: 'priya@northwind.com' }],
              name: [{ full_name: 'Priya Shah' }],
            },
          },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.id.workspace_id).toBe(DEFAULT_WORKSPACE_ID);
      expect(body.data.id.record_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.data.values.email_addresses[0].email_address).toBe('priya@northwind.com');
    });

    it('finds a contact by email via POST /v2/objects/people/records/query (briefing-agent step 1)', async () => {
      // Seed two records, one matching.
      await ts.server.inject({
        method: 'POST',
        url: '/v2/objects/people/records',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: {
            values: {
              email_addresses: [{ email_address: 'priya@northwind.com' }],
              name: [{ full_name: 'Priya Shah' }],
            },
          },
        }),
      });
      await ts.server.inject({
        method: 'POST',
        url: '/v2/objects/people/records',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: {
            values: {
              email_addresses: [{ email_address: 'someone@else.com' }],
            },
          },
        }),
      });

      const res = await ts.server.inject({
        method: 'POST',
        url: '/v2/objects/people/records/query',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          filter: { email_addresses: { eq: 'priya@northwind.com' } },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].values.email_addresses[0].email_address).toBe('priya@northwind.com');
    });

    it('PATCH appends multiselect values, PUT overwrites them', async () => {
      const create = await ts.server.inject({
        method: 'POST',
        url: '/v2/objects/people/records',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: { values: { email_addresses: [{ email_address: 'a@x.com' }] } },
        }),
      });
      const recordId = (create.json() as { data: { id: { record_id: string } } }).data.id.record_id;

      const patch = await ts.server.inject({
        method: 'PATCH',
        url: `/v2/objects/people/records/${recordId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: { values: { email_addresses: [{ email_address: 'b@x.com' }] } },
        }),
      });
      expect(patch.statusCode).toBe(200);
      expect((patch.json() as { data: { values: { email_addresses: unknown[] } } }).data.values.email_addresses).toHaveLength(2);

      const put = await ts.server.inject({
        method: 'PUT',
        url: `/v2/objects/people/records/${recordId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: { values: { email_addresses: [{ email_address: 'c@x.com' }] } },
        }),
      });
      expect(put.statusCode).toBe(200);
      const putBody = put.json() as { data: { values: { email_addresses: Array<{ email_address: string }> } } };
      expect(putBody.data.values.email_addresses).toHaveLength(1);
      expect(putBody.data.values.email_addresses[0]!.email_address).toBe('c@x.com');
    });

    it('PUT /v2/objects/people/records (assert) upserts by matching attribute', async () => {
      // First call creates.
      const first = await ts.server.inject({
        method: 'PUT',
        url: '/v2/objects/people/records',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: { values: { email_addresses: [{ email_address: 'asserted@x.com' }] } },
          matching_attribute: 'email_addresses',
        }),
      });
      const firstId = (first.json() as { data: { id: { record_id: string } } }).data.id.record_id;

      // Second call with same email upserts (no new record).
      const second = await ts.server.inject({
        method: 'PUT',
        url: '/v2/objects/people/records',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: { values: { email_addresses: [{ email_address: 'asserted@x.com' }], name: [{ full_name: 'Asserted Person' }] } },
          matching_attribute: 'email_addresses',
        }),
      });
      const secondId = (second.json() as { data: { id: { record_id: string } } }).data.id.record_id;
      expect(secondId).toBe(firstId);
    });

    it('DELETE removes the record and a follow-up GET returns 404', async () => {
      const create = await ts.server.inject({
        method: 'POST',
        url: '/v2/objects/people/records',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ data: { values: {} } }),
      });
      const recordId = (create.json() as { data: { id: { record_id: string } } }).data.id.record_id;

      const del = await ts.server.inject({
        method: 'DELETE',
        url: `/v2/objects/people/records/${recordId}`,
      });
      expect(del.statusCode).toBe(200);

      const get = await ts.server.inject({
        method: 'GET',
        url: `/v2/objects/people/records/${recordId}`,
      });
      expect(get.statusCode).toBe(404);
      const body = get.json();
      expect(body.status_code).toBe(404);
      expect(body.code).toBe('not_found');
    });

    it('POST /v2/objects/records/search performs cross-object free-text match', async () => {
      await ts.server.inject({
        method: 'POST',
        url: '/v2/objects/people/records',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ data: { values: { name: [{ full_name: 'Northwind Priya' }] } } }),
      });
      await ts.server.inject({
        method: 'POST',
        url: '/v2/objects/companies/records',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ data: { values: { name: [{ value: 'Northwind Inc' }] } } }),
      });

      const res = await ts.server.inject({
        method: 'POST',
        url: '/v2/objects/records/search',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ query: 'Northwind', objects: ['people', 'companies'] }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      const slugs = body.data.map((r: Record<string, unknown>) => r.object).sort();
      expect(slugs).toContain('people');
      expect(slugs).toContain('companies');
    });
  });

  // ── List entries (deals in pipeline) ────────────────────────────────────────

  it('list entries: create, query by stage filter, retrieve, delete', async () => {
    // Create a deals record first to link.
    const dealCreate = await ts.server.inject({
      method: 'POST',
      url: '/v2/objects/deals/records',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ data: { values: { name: [{ value: 'Northwind' }] } } }),
    });
    const dealId = (dealCreate.json() as { data: { id: { record_id: string } } }).data.id.record_id;

    // Add to list.
    const create = await ts.server.inject({
      method: 'POST',
      url: '/v2/lists/northwind-eval/entries',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        data: {
          parent_object: 'deals',
          parent_record_id: dealId,
          entry_values: { stage: [{ status: 'Procurement' }] },
        },
      }),
    });
    expect(create.statusCode).toBe(200);
    const entryId = (create.json() as { data: { id: { entry_id: string } } }).data.id.entry_id;

    const query = await ts.server.inject({
      method: 'POST',
      url: '/v2/lists/northwind-eval/entries/query',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(query.statusCode).toBe(200);
    expect((query.json() as { data: unknown[] }).data).toHaveLength(1);

    const retrieve = await ts.server.inject({
      method: 'GET',
      url: `/v2/lists/northwind-eval/entries/${entryId}`,
    });
    expect(retrieve.statusCode).toBe(200);
    expect((retrieve.json() as { data: { parent_record_id: string } }).data.parent_record_id).toBe(dealId);

    const del = await ts.server.inject({
      method: 'DELETE',
      url: `/v2/lists/northwind-eval/entries/${entryId}`,
    });
    expect(del.statusCode).toBe(200);
  });

  // ── Notes / tasks / meetings ────────────────────────────────────────────────

  it('notes: create + list filtered by parent_record_id', async () => {
    await ts.server.inject({
      method: 'POST',
      url: '/v2/notes',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        data: {
          parent_object: 'deals',
          parent_record_id: 'deal-1',
          title: 'Discovery call notes',
          content_plaintext: 'SOC 2 raised',
        },
      }),
    });
    await ts.server.inject({
      method: 'POST',
      url: '/v2/notes',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        data: { parent_object: 'deals', parent_record_id: 'deal-2', title: 'Other' },
      }),
    });

    const list = await ts.server.inject({
      method: 'GET',
      url: '/v2/notes?parent_object=deals&parent_record_id=deal-1',
    });
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { data: Array<Record<string, unknown>> }).data;
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('Discovery call notes');
  });

  it('tasks: create, mark completed via PATCH, filter by completion state', async () => {
    const create = await ts.server.inject({
      method: 'POST',
      url: '/v2/tasks',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        data: { content_plaintext: 'Follow up with Priya', is_completed: false },
      }),
    });
    const taskId = (create.json() as { data: { id: { task_id: string } } }).data.id.task_id;

    const patch = await ts.server.inject({
      method: 'PATCH',
      url: `/v2/tasks/${taskId}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ data: { is_completed: true } }),
    });
    expect((patch.json() as { data: { is_completed: boolean } }).data.is_completed).toBe(true);

    const open = await ts.server.inject({
      method: 'GET',
      url: '/v2/tasks?is_completed=false',
    });
    expect((open.json() as { data: unknown[] }).data).toHaveLength(0);

    const done = await ts.server.inject({
      method: 'GET',
      url: '/v2/tasks?is_completed=true',
    });
    expect((done.json() as { data: unknown[] }).data).toHaveLength(1);
  });

  it('meetings + call recordings + transcript form a chain', async () => {
    const meetingRes = await ts.server.inject({
      method: 'POST',
      url: '/v2/meetings',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        data: { title: 'Northwind discovery', start_time: '2026-04-20T15:00:00Z' },
      }),
    });
    const meetingId = (meetingRes.json() as { data: { id: { meeting_id: string } } }).data.id.meeting_id;

    const recRes = await ts.server.inject({
      method: 'POST',
      url: `/v2/meetings/${meetingId}/call_recordings`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        data: {
          url: 'https://recording.example/abc',
          transcript: 'Priya: SOC 2 is the blocker.',
          duration_seconds: 1800,
        },
      }),
    });
    const recId = (recRes.json() as { data: { id: { call_recording_id: string } } }).data.id.call_recording_id;

    const transcriptRes = await ts.server.inject({
      method: 'GET',
      url: `/v2/meetings/${meetingId}/call_recordings/${recId}/transcript`,
    });
    expect(transcriptRes.statusCode).toBe(200);
    const t = transcriptRes.json() as { data: { transcript: string } };
    expect(t.data.transcript).toContain('SOC 2');
  });

  // ── Comments + threads ──────────────────────────────────────────────────────

  it('comment creation auto-creates a thread when none provided', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: '/v2/comments',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        data: { content_plaintext: 'Mike: Priya is the deciding vote' },
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { thread_id: string; content_plaintext: string } };
    expect(body.data.thread_id).toBeDefined();
    expect(body.data.content_plaintext).toContain('Priya');

    // Thread should now exist with the comment attached.
    const thread = await ts.server.inject({
      method: 'GET',
      url: `/v2/threads/${body.data.thread_id}`,
    });
    expect(thread.statusCode).toBe(200);
    expect((thread.json() as { data: { comments: unknown[] } }).data.comments).toHaveLength(1);
  });

  // ── Webhooks (basic CRUD) ───────────────────────────────────────────────────

  it('webhooks CRUD round-trip', async () => {
    const create = await ts.server.inject({
      method: 'POST',
      url: '/v2/webhooks',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        data: { target_url: 'https://hooks.example/x', subscriptions: ['note.created'] },
      }),
    });
    const id = (create.json() as { data: { id: { webhook_id: string } } }).data.id.webhook_id;

    const patch = await ts.server.inject({
      method: 'PATCH',
      url: `/v2/webhooks/${id}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ data: { status: 'paused' } }),
    });
    expect((patch.json() as { data: { status: string } }).data.status).toBe('paused');

    const del = await ts.server.inject({
      method: 'DELETE',
      url: `/v2/webhooks/${id}`,
    });
    expect(del.statusCode).toBe(200);
  });

  // ── SCIM ────────────────────────────────────────────────────────────────────

  it('SCIM Users endpoints use SCIM envelope, not `data` wrapping', async () => {
    const list = await ts.server.inject({ method: 'GET', url: '/scim/v2/Users' });
    expect(list.statusCode).toBe(200);
    const listBody = list.json();
    expect(listBody.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    expect(listBody.totalResults).toBeDefined();
    expect(listBody.Resources).toBeInstanceOf(Array);
    expect(listBody.data).toBeUndefined(); // not v2-wrapped

    const create = await ts.server.inject({
      method: 'POST',
      url: '/scim/v2/Users',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        userName: 'priya',
        name: { givenName: 'Priya', familyName: 'Shah' },
        emails: [{ value: 'priya@northwind.com', primary: true }],
        active: true,
      }),
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().userName).toBe('priya');

    const id = create.json().id;
    const get = await ts.server.inject({ method: 'GET', url: `/scim/v2/Users/${id}` });
    expect(get.statusCode).toBe(200);

    const del = await ts.server.inject({ method: 'DELETE', url: `/scim/v2/Users/${id}` });
    expect(del.statusCode).toBe(204);
  });

  it('SCIM Schemas list returns the static schemas', async () => {
    const res = await ts.server.inject({ method: 'GET', url: '/scim/v2/Schemas' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalResults).toBe(2);
    const ids = body.Resources.map((s: Record<string, unknown>) => s.id);
    expect(ids).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
    expect(ids).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
  });

  // ── Persona resolution ─────────────────────────────────────────────────────

  it('resolvePersona extracts persona from `Bearer test_<persona>_<rest>`', () => {
    const fakeReq = {
      headers: { authorization: 'Bearer test_northwind-priya_aaaaaaaa' },
    } as unknown as Parameters<AttioAdapter['resolvePersona']>[0];
    expect(adapter.resolvePersona(fakeReq)).toBe('northwind-priya');
  });

  it('resolvePersona returns null without auth header', () => {
    const fakeReq = { headers: {} } as unknown as Parameters<AttioAdapter['resolvePersona']>[0];
    expect(adapter.resolvePersona(fakeReq)).toBeNull();
  });

  // ── Workspace members ───────────────────────────────────────────────────────

  it('GET /v2/workspace_members lists seeded members', async () => {
    const res = await ts.server.inject({ method: 'GET', url: '/v2/workspace_members' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });
});
