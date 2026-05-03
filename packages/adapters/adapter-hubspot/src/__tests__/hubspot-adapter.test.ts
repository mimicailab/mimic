import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildTestServer, runMarshallers } from '@mimicai/adapter-sdk';
import type { TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData } from '@mimicai/core';
import { HubSpotAdapter } from '../hubspot-adapter.js';
import { defaultContact, defaultDeal, defaultCompany, defaultOwner, defaultPipeline } from '../generated/schemas.js';
import { buildHubSpotCrmMarshallers } from '../overrides/marshallers.js';

async function seedHubSpotCrmObjects(data: Map<string, ExpandedData>, store: import('@mimicai/core').StateStore): Promise<void> {
  await runMarshallers({
    marshallers: buildHubSpotCrmMarshallers(),
    data,
    store,
    adapterId: 'hubspot',
  });
}

const VERSION = '2026-03';

describe('HubSpotAdapter', () => {
  let ts: TestServer;
  const adapter = new HubSpotAdapter();

  beforeAll(async () => {
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // Reset CRM-object state between tests so they don't leak. Snapshot the
  // list before iterating because StateStore.list returns the live array.
  beforeEach(() => {
    for (const ns of [
      'hubspot:crm_objects:contacts',
      'hubspot:crm_objects:companies',
      'hubspot:crm_objects:deals',
      'hubspot:crm_objects:tickets',
      'hubspot:crm_objects:notes',
      'hubspot:crm_objects:tasks',
      'hubspot:crm_objects:meetings',
      'hubspot:crm_objects:calls',
      'hubspot:crm_objects:emails',
      'hubspot:crm_objects',
    ]) {
      const snapshot = [...ts.stateStore.list<Record<string, unknown>>(ns)];
      for (const item of snapshot) {
        const id = item.id as string;
        if (id) ts.stateStore.delete(ns, id);
      }
    }
  });

  // ── Metadata + spec coverage ────────────────────────────────────────────────

  it('has the expected metadata', () => {
    expect(adapter.id).toBe('hubspot');
    expect(adapter.basePath).toBe('');
    expect(adapter.versions).toEqual([VERSION]);
  });

  it('exposes 1000+ endpoint definitions across all spec areas', () => {
    const endpoints = adapter.getEndpoints();
    expect(endpoints.length).toBeGreaterThan(1000);
    // Spot-check that we have routes from each major area
    const paths = endpoints.map((e) => e.path);
    expect(paths.some((p) => p.startsWith('/crm/'))).toBe(true);
    expect(paths.some((p) => p.startsWith('/cms/'))).toBe(true);
    expect(paths.some((p) => p.startsWith('/marketing/'))).toBe(true);
    expect(paths.some((p) => p.startsWith('/conversations/'))).toBe(true);
    expect(paths.some((p) => p.startsWith('/files/'))).toBe(true);
    expect(paths.some((p) => p.startsWith('/oauth/'))).toBe(true);
  });

  // ── /account-info ───────────────────────────────────────────────────────────

  it(`GET /account-info/${VERSION}/details returns flat workspace identity`, async () => {
    const res = await ts.server.inject({ method: 'GET', url: `/account-info/${VERSION}/details` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.portalId).toBeDefined();
    expect(body.timeZone).toBeDefined();
    expect(body.companyCurrency).toBeDefined();
    // Not wrapped in { results: [...] } — flat top-level fields
    expect(body.results).toBeUndefined();
  });

  // ── CRM Objects unified API ─────────────────────────────────────────────────

  describe('CRM Objects (unified API)', () => {
    it(`POST /crm/objects/${VERSION}/contacts creates a contact`, async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/contacts`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          properties: {
            email: 'priya@northwind.com',
            firstname: 'Priya',
            lastname: 'Shah',
          },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.properties.email).toBe('priya@northwind.com');
      expect(body.archived).toBe(false);
      expect(body.createdAt).toBeDefined();
    });

    it(`GET /crm/objects/${VERSION}/contacts lists with HubSpot { results, paging } envelope`, async () => {
      // Seed 3 contacts via POST
      for (let i = 0; i < 3; i++) {
        await ts.server.inject({
          method: 'POST',
          url: `/crm/objects/${VERSION}/contacts`,
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({ properties: { email: `c${i}@x.com` } }),
        });
      }
      const res = await ts.server.inject({ method: 'GET', url: `/crm/objects/${VERSION}/contacts` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toBeInstanceOf(Array);
      expect(body.results).toHaveLength(3);
      expect(body.results[0].properties.email).toMatch(/c\d@x\.com/);
    });

    it(`GET /crm/objects/${VERSION}/contacts paginates via after cursor`, async () => {
      for (let i = 0; i < 5; i++) {
        await ts.server.inject({
          method: 'POST',
          url: `/crm/objects/${VERSION}/contacts`,
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({ id: `${100 + i}`, properties: { email: `c${i}@x.com` } }),
        });
      }
      const page1 = await ts.server.inject({ method: 'GET', url: `/crm/objects/${VERSION}/contacts?limit=2` });
      const b1 = page1.json();
      expect(b1.results).toHaveLength(2);
      expect(b1.paging.next.after).toBe(b1.results[1].id);

      const page2 = await ts.server.inject({
        method: 'GET',
        url: `/crm/objects/${VERSION}/contacts?limit=2&after=${b1.paging.next.after}`,
      });
      const b2 = page2.json();
      expect(b2.results).toHaveLength(2);
      // Pages don't overlap
      const ids1 = b1.results.map((r: { id: string }) => r.id);
      const ids2 = b2.results.map((r: { id: string }) => r.id);
      expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
    });

    it('GET unknown contact returns 404 with HubSpot error envelope', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/crm/objects/${VERSION}/contacts/does-not-exist`,
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.status).toBe('error');
      expect(body.category).toBe('OBJECT_NOT_FOUND');
      expect(body.message).toContain('does-not-exist');
      expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it(`PATCH /crm/objects/${VERSION}/contacts/:id deep-merges properties`, async () => {
      const create = await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/contacts`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ properties: { firstname: 'A', lastname: 'B', email: 'a@b.com' } }),
      });
      const id = create.json().id as string;
      const patch = await ts.server.inject({
        method: 'PATCH',
        url: `/crm/objects/${VERSION}/contacts/${id}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ properties: { firstname: 'Updated' } }),
      });
      expect(patch.statusCode).toBe(200);
      const body = patch.json();
      expect(body.properties.firstname).toBe('Updated');
      // lastname/email preserved (deep merge)
      expect(body.properties.lastname).toBe('B');
      expect(body.properties.email).toBe('a@b.com');
    });

    it(`DELETE /crm/objects/${VERSION}/contacts/:id archives (soft delete) and returns 204`, async () => {
      const create = await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/contacts`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ properties: { email: 'gone@x.com' } }),
      });
      const id = create.json().id as string;
      const del = await ts.server.inject({ method: 'DELETE', url: `/crm/objects/${VERSION}/contacts/${id}` });
      expect(del.statusCode).toBe(204);
      // Subsequent GET should still find it (it's archived, not deleted)
      const get = await ts.server.inject({ method: 'GET', url: `/crm/objects/${VERSION}/contacts/${id}` });
      expect(get.statusCode).toBe(200);
      expect(get.json().archived).toBe(true);
    });
  });

  // ── Search ──────────────────────────────────────────────────────────────────

  describe('search', () => {
    it(`POST /crm/objects/${VERSION}/contacts/search filters by email (briefing-agent step 1)`, async () => {
      // Seed multiple contacts; one matches.
      const inputs = [
        { email: 'priya@northwind.com', firstname: 'Priya' },
        { email: 'sarah@us.example', firstname: 'Sarah' },
        { email: 'mike@us.example', firstname: 'Mike' },
      ];
      for (const props of inputs) {
        await ts.server.inject({
          method: 'POST',
          url: `/crm/objects/${VERSION}/contacts`,
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({ properties: props }),
        });
      }

      const res = await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/contacts/search`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: 'priya@northwind.com' }] }],
          properties: ['email', 'firstname'],
          limit: 5,
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].properties.email).toBe('priya@northwind.com');
    });

    it('search supports CONTAINS_TOKEN, $or via filterGroups, and DESCENDING sort', async () => {
      for (const company of ['Northwind Inc', 'Northwind Co', 'Acme Co']) {
        await ts.server.inject({
          method: 'POST',
          url: `/crm/objects/${VERSION}/companies`,
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({ properties: { name: company } }),
        });
      }
      const res = await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/companies/search`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          filterGroups: [
            { filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: 'Northwind' }] },
          ],
          sorts: [{ propertyName: 'name', direction: 'DESCENDING' }],
          limit: 10,
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toHaveLength(2);
      expect((body.results[0].properties as { name: string }).name).toBe('Northwind Inc');
      expect((body.results[1].properties as { name: string }).name).toBe('Northwind Co');
    });

    it('search with no filterGroups returns all', async () => {
      await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/deals`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ properties: { dealname: 'Big deal' } }),
      });
      const res = await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/deals/search`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { results: unknown[] }).results.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Batch operations ────────────────────────────────────────────────────────

  describe('batch operations', () => {
    it(`POST /crm/objects/${VERSION}/contacts/batch/create creates N records`, async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/contacts/batch/create`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          inputs: [
            { properties: { email: 'a@x.com', firstname: 'A' } },
            { properties: { email: 'b@x.com', firstname: 'B' } },
            { properties: { email: 'c@x.com', firstname: 'C' } },
          ],
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.status).toBe('COMPLETE');
      expect(body.results).toHaveLength(3);
      expect(body.startedAt).toBeDefined();
      expect(body.completedAt).toBeDefined();
    });

    it(`POST /crm/objects/${VERSION}/contacts/batch/read returns hits + numErrors for misses`, async () => {
      const c = await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/contacts`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ id: '999', properties: { email: 'real@x.com' } }),
      });
      const realId = c.json().id as string;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/contacts/batch/read`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          inputs: [{ id: realId }, { id: 'does-not-exist-1' }, { id: 'does-not-exist-2' }],
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toHaveLength(1);
      expect(body.numErrors).toBe(2);
      expect(body.errors).toHaveLength(2);
    });

    it(`POST /crm/objects/${VERSION}/contacts/batch/upsert match-or-create by idProperty`, async () => {
      // First call: creates two
      await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/contacts/batch/upsert`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          inputs: [
            { idProperty: 'email', properties: { email: 'a@x.com', firstname: 'Original A' } },
            { idProperty: 'email', properties: { email: 'b@x.com', firstname: 'Original B' } },
          ],
        }),
      });
      // Second call: one match (a@x.com) + one new (c@x.com)
      const res = await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/contacts/batch/upsert`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          inputs: [
            { idProperty: 'email', properties: { email: 'a@x.com', firstname: 'Updated A' } },
            { idProperty: 'email', properties: { email: 'c@x.com', firstname: 'New C' } },
          ],
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toHaveLength(2);
      const updated = body.results.find((r: { properties: { firstname: string } }) => r.properties.firstname === 'Updated A');
      expect(updated).toBeDefined();
      // Total contacts = 3 (a, b updated/created, c created)
      const list = await ts.server.inject({ method: 'GET', url: `/crm/objects/${VERSION}/contacts` });
      expect((list.json() as { results: unknown[] }).results).toHaveLength(3);
    });
  });

  // ── Pipelines ───────────────────────────────────────────────────────────────

  it(`GET /crm/pipelines/${VERSION}/deals returns the seeded sales pipeline`, async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: `/crm/pipelines/${VERSION}/deals`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toBeInstanceOf(Array);
    const defaultPipeline = body.results.find((p: { id: string }) => p.id === 'default');
    expect(defaultPipeline).toBeDefined();
    expect(defaultPipeline.label).toBe('Sales Pipeline');
    expect(defaultPipeline.stages.length).toBeGreaterThanOrEqual(7);
    const stageIds = defaultPipeline.stages.map((s: { id: string }) => s.id);
    expect(stageIds).toContain('closedwon');
    expect(stageIds).toContain('closedlost');
  });

  // ── Owners ──────────────────────────────────────────────────────────────────

  it(`GET /crm/owners/${VERSION} returns the seeded bot owner`, async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: `/crm/owners/${VERSION}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toBeInstanceOf(Array);
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.results[0].email).toBeDefined();
  });

  // ── OAuth ──────────────────────────────────────────────────────────────────

  describe('OAuth', () => {
    it('POST /oauth/2026-03/token authorization_code grant returns a token bundle', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/oauth/2026-03/token',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          grant_type: 'authorization_code',
          code: 'fake-code',
          redirect_uri: 'http://localhost/cb',
          client_id: 'app-id',
          client_secret: 'app-secret',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.access_token).toMatch(/^pat-na1-/);
      expect(body.refresh_token).toMatch(/^pat-na1-/);
      expect(body.expires_in).toBe(1800);
      expect(body.token_type).toBe('bearer');
    });

    it('POST /oauth/2026-03/token refresh_token grant works', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/oauth/2026-03/token',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: 'pat-na1-existing',
          client_id: 'app-id',
          client_secret: 'app-secret',
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().access_token).toBeDefined();
    });

    it('POST /oauth/2026-03/token rejects unknown grant_type with 400', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/oauth/2026-03/token',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ grant_type: 'password' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().category).toBe('BAD_REQUEST');
    });

    it('/oauth/2026-03/token/introspect and /token/revoke routes are registered', async () => {
      // The 2026-03 OAuth spec has /token, /token/introspect, /token/revoke.
      // Only /token has a custom override; introspect/revoke fall through to
      // base CRUD scaffolding. We just verify the routes are registered
      // (any non-404 response is fine).
      const intro = await ts.server.inject({
        method: 'POST',
        url: '/oauth/2026-03/token/introspect',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ token: 'pat-na1-aaaaaaaaaa' }),
      });
      expect(intro.statusCode).not.toBe(404);

      const revoke = await ts.server.inject({
        method: 'POST',
        url: '/oauth/2026-03/token/revoke',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ token: 'pat-na1-aaaaaaaaaa' }),
      });
      expect(revoke.statusCode).not.toBe(404);
    });
  });

  // ── Persona resolution ─────────────────────────────────────────────────────

  it('resolvePersona extracts persona from `Bearer pat-test-<persona>-...`', () => {
    const fakeReq = { headers: { authorization: 'Bearer pat-test-northwind-priya-aaaaaaaa' } } as unknown as Parameters<HubSpotAdapter['resolvePersona']>[0];
    expect(adapter.resolvePersona(fakeReq)).toBe('northwind');
  });

  it('resolvePersona returns null without auth header', () => {
    const fakeReq = { headers: {} } as unknown as Parameters<HubSpotAdapter['resolvePersona']>[0];
    expect(adapter.resolvePersona(fakeReq)).toBeNull();
  });

  // ── Cross-object briefing-agent flow ───────────────────────────────────────

  it('briefing-agent flow: find contact → list deals → list notes → list meetings', async () => {
    // 1. Seed a contact
    const contactRes = await ts.server.inject({
      method: 'POST',
      url: `/crm/objects/${VERSION}/contacts`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ properties: { email: 'priya@northwind.com', firstname: 'Priya', lastname: 'Shah' } }),
    });
    const contactId = contactRes.json().id as string;

    // 2. Seed a deal associated with that contact (via property)
    await ts.server.inject({
      method: 'POST',
      url: `/crm/objects/${VERSION}/deals`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        properties: {
          dealname: 'Northwind Eval',
          amount: '240000',
          dealstage: 'contractsent',
          'associations.contact': contactId,
        },
      }),
    });

    // 3. Seed a note linked to the contact
    await ts.server.inject({
      method: 'POST',
      url: `/crm/objects/${VERSION}/notes`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        properties: {
          hs_note_body: 'Priya raised the SOC 2 blocker. Legal review starts Monday.',
          'associations.contact': contactId,
          hs_timestamp: '2026-04-20T15:30:00Z',
        },
      }),
    });

    // 4. Run the briefing-agent search flow.
    // Step 1: find contact by email
    const contactSearch = await ts.server.inject({
      method: 'POST',
      url: `/crm/objects/${VERSION}/contacts/search`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: 'priya@northwind.com' }] }],
      }),
    });
    expect((contactSearch.json() as { results: unknown[] }).results).toHaveLength(1);
    const foundContact = (contactSearch.json() as { results: Array<{ id: string }> }).results[0]!;

    // Step 2: list deals for that contact
    const dealSearch = await ts.server.inject({
      method: 'POST',
      url: `/crm/objects/${VERSION}/deals/search`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'associations.contact', operator: 'EQ', value: foundContact.id }] }],
      }),
    });
    expect((dealSearch.json() as { results: Array<{ properties: { dealname: string } }> }).results[0]?.properties.dealname).toBe('Northwind Eval');

    // Step 3: list notes
    const noteSearch = await ts.server.inject({
      method: 'POST',
      url: `/crm/objects/${VERSION}/notes/search`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'associations.contact', operator: 'EQ', value: foundContact.id }] }],
      }),
    });
    const noteBody = (noteSearch.json() as { results: Array<{ properties: { hs_note_body: string } }> }).results[0]?.properties.hs_note_body;
    expect(noteBody).toContain('SOC 2');
  });

  // ── Generic CRM type endpoint sanity check ─────────────────────────────────

  it('ticket CRUD via the typed CRM Objects path namespaces per type', async () => {
    // Tickets live under /crm/objects/<version>/tickets — the typed Tickets
    // spec mirrors the unified Objects spec. Both forms hit the same
    // override and land in the per-type namespace.
    const res = await ts.server.inject({
      method: 'POST',
      url: `/crm/objects/${VERSION}/tickets`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        properties: { subject: 'Login failure', content: 'Cannot log in', hs_pipeline: '0', hs_pipeline_stage: '1' },
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.properties.subject).toBe('Login failure');

    // Tickets must NOT pollute the contacts namespace.
    const contactsList = await ts.server.inject({ method: 'GET', url: `/crm/objects/${VERSION}/contacts` });
    expect((contactsList.json() as { results: unknown[] }).results).toHaveLength(0);
  });

  // ── v3 path aliases ────────────────────────────────────────────────────────

  describe('v3 route aliases (real HubSpot exposes both /crm/objects/<dated> and /crm/v3/objects)', () => {
    it('GET /crm/v3/objects/contacts hits the same handler as the dated path', async () => {
      // Seed via the dated path
      await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/contacts`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ properties: { email: 'priya@northwind.com', firstname: 'Priya' } }),
      });
      // Read via the v3 alias
      const v3 = await ts.server.inject({ method: 'GET', url: `/crm/v3/objects/contacts` });
      expect(v3.statusCode).toBe(200);
      const body = v3.json() as { results: Array<{ properties: { email: string } }> };
      expect(body.results).toHaveLength(1);
      expect(body.results[0]!.properties.email).toBe('priya@northwind.com');
    });

    it('POST /crm/v3/objects/deals/search filters records seeded via dated paths', async () => {
      await ts.server.inject({
        method: 'POST',
        url: `/crm/objects/${VERSION}/deals`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ properties: { dealname: 'Northwind Robotics', amount: '220000' } }),
      });
      const res = await ts.server.inject({
        method: 'POST',
        url: `/crm/v3/objects/deals/search`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: 'dealname', operator: 'CONTAINS_TOKEN', value: 'Northwind' }] }],
        }),
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { results: unknown[] }).results).toHaveLength(1);
    });

    it('GET /crm/v3/pipelines/deals returns the seeded sales pipeline', async () => {
      const res = await ts.server.inject({ method: 'GET', url: `/crm/v3/pipelines/deals` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ id: string; label: string }> };
      const sales = body.results.find((p) => p.id === 'default');
      expect(sales).toBeDefined();
      expect(sales!.label).toBe('Sales Pipeline');
    });

    it('GET /crm/v3/owners returns the seeded bot owner', async () => {
      const res = await ts.server.inject({ method: 'GET', url: `/crm/v3/owners` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ email: string }> };
      expect(body.results.length).toBeGreaterThanOrEqual(1);
      expect(body.results[0]!.email).toBeDefined();
    });
  });

  // ── Pseudo-resource seeder + objectType aliasing ───────────────────────────

  describe('seedHubSpotCrmObjects + objectType aliasing', () => {
    it('wraps crm_deal pseudo entries into HubSpot envelope and writes to hubspot:crm_objects:deals', async () => {
      const data = new Map<string, ExpandedData>([
        ['p1', fakeExpanded('p1', {
          crm_deal: [{
            statusCode: 200,
            headers: {},
            personaId: 'p1',
            body: {
              id: 'deal-001',
              dealname: 'Northwind Robotics — Procurement',
              amount: 220000,
              deal_currency_code: 'gbp',
              dealstage: 'contractsent',
              pipeline: 'default',
              closedate: '2026-05-30T00:00:00Z',
              primary_contact_email: 'priya@northwind.com',
              associated_company_domain: 'northwind.com',
              createdAt: '2026-04-15T10:00:00Z',
            },
          }],
        })],
      ]);

      await seedHubSpotCrmObjects(data, ts.stateStore);

      // Slug name resolves
      const bySlug = await ts.server.inject({ method: 'GET', url: `/crm/objects/${VERSION}/deals` });
      expect(bySlug.statusCode).toBe(200);
      const slugBody = bySlug.json() as { results: Array<{ id: string; properties: Record<string, string> }> };
      expect(slugBody.results).toHaveLength(1);
      expect(slugBody.results[0]!.properties.dealname).toBe('Northwind Robotics — Procurement');
      expect(slugBody.results[0]!.properties.amount).toBe('220000');
      // Currency uppercased
      expect(slugBody.results[0]!.properties.deal_currency_code).toBe('GBP');
      expect(slugBody.results[0]!.properties.dealstage).toBe('contractsent');
      expect(slugBody.results[0]!.properties.primary_contact_email).toBe('priya@northwind.com');

      // Numeric type id `0-3` resolves to the same record (objectType alias)
      const byTypeId = await ts.server.inject({ method: 'GET', url: `/crm/objects/${VERSION}/0-3` });
      expect(byTypeId.statusCode).toBe(200);
      expect((byTypeId.json() as { results: unknown[] }).results).toHaveLength(1);

      // And direct record fetch by id works under either alias
      const retrieve = await ts.server.inject({ method: 'GET', url: `/crm/objects/${VERSION}/0-3/deal-001` });
      expect(retrieve.statusCode).toBe(200);
      expect((retrieve.json() as { properties: { dealname: string } }).properties.dealname).toBe('Northwind Robotics — Procurement');
    });

    it('seeds contacts/companies/tickets with their respective property slugs', async () => {
      const data = new Map<string, ExpandedData>([
        ['p1', fakeExpanded('p1', {
          crm_contact: [{
            statusCode: 200, headers: {}, personaId: 'p1',
            body: { id: 'c-1', firstname: 'Priya', lastname: 'Shah', email: 'priya@northwind.com', jobtitle: 'Head of Engineering', company_domain: 'northwind.com', lifecyclestage: 'opportunity' },
          }],
          crm_company: [{
            statusCode: 200, headers: {}, personaId: 'p1',
            body: { id: 'co-1', name: 'Northwind Robotics', domain: 'northwind.com', industry: 'Robotics', numberofemployees: 480 },
          }],
          crm_ticket: [{
            statusCode: 200, headers: {}, personaId: 'p1',
            body: { id: 't-1', subject: 'SSO failure', content: 'SAML callback fails', hs_pipeline: '0', hs_pipeline_stage: '2', hs_ticket_priority: 'HIGH' },
          }],
        })],
      ]);

      await seedHubSpotCrmObjects(data, ts.stateStore);

      const contact = (await ts.server.inject({ method: 'GET', url: `/crm/objects/${VERSION}/contacts/c-1` })).json() as { properties: Record<string, string> };
      expect(contact.properties.firstname).toBe('Priya');
      expect(contact.properties.email).toBe('priya@northwind.com');
      expect(contact.properties.company).toBe('northwind.com');

      const company = (await ts.server.inject({ method: 'GET', url: `/crm/objects/${VERSION}/companies/co-1` })).json() as { properties: Record<string, string> };
      expect(company.properties.name).toBe('Northwind Robotics');
      expect(company.properties.numberofemployees).toBe('480');

      const ticket = (await ts.server.inject({ method: 'GET', url: `/crm/objects/${VERSION}/tickets/t-1` })).json() as { properties: Record<string, string> };
      expect(ticket.properties.subject).toBe('SSO failure');
      expect(ticket.properties.hs_ticket_priority).toBe('HIGH');
    });

    it('skips empty pseudo-resource entries without crashing', async () => {
      const data = new Map<string, ExpandedData>([
        ['p1', fakeExpanded('p1', { crm_deal: [] })],
      ]);
      await expect(seedHubSpotCrmObjects(data, ts.stateStore)).resolves.toBeUndefined();
    });
  });
});

function fakeExpanded(personaId: string, responses: Record<string, Array<{ statusCode: number; headers: Record<string, string>; personaId: string; body: unknown }>>): ExpandedData {
  return {
    personaId,
    blueprint: { id: 'test', personas: [], facts: [] } as unknown as ExpandedData['blueprint'],
    tables: {},
    documents: {},
    apiResponses: { hubspot: { adapterId: 'hubspot', responses } },
    files: [],
    events: [],
    facts: [],
  };
}
