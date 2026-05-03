/**
 * Attio MCP tools.
 *
 * Designed for the Briefing Agent demo: the headline tool is
 * `find_attio_contact_by_email`, which the agent calls in step 1 of the
 * briefing skill (see private/briefing-agent.md). The remaining tools cover
 * deal lookup, activity timeline, and meeting/transcript retrieval — enough
 * to assemble a one-screen pre-call brief without write access.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import meta from './adapter-meta.js';

function makeCall(baseUrl: string) {
  return async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ) => {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  };
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

function json(payload: unknown) {
  return text(JSON.stringify(payload, null, 2));
}

export function registerAttioTools(server: McpServer, baseUrl: string): void {
  const call = makeCall(baseUrl);

  // ── 1. find_attio_contact_by_email ─────────────────────────────────────────
  server.tool(
    'find_attio_contact_by_email',
    "Find an Attio person record by email. Briefing-agent's step 1: maps a meeting attendee email to their CRM identity. Returns the matching record(s) with id, name, role, and linked company. Use this BEFORE any deal/note lookup so you have the record_id to scope subsequent calls.",
    {
      email: z.string().describe('Email address to search for, e.g. "priya@northwind.com"'),
      object: z.string().optional().default('people').describe('Attio object slug (default: "people"). Use "users" for internal directory lookups.'),
    },
    async ({ email, object }) => {
      const data = await call('POST', `/v2/objects/${object}/records/query`, {
        filter: { email_addresses: { contains: email } },
        limit: 5,
      });
      return json(data);
    },
  );

  // ── 2. get_attio_record ────────────────────────────────────────────────────
  server.tool(
    'get_attio_record',
    "Fetch a single Attio record by object slug and record_id. Use after `find_attio_contact_by_email` to pull the full attribute set (job title, seniority, last activity, etc.).",
    {
      object: z.string().describe('Object slug — "people", "companies", "deals", or any custom object'),
      record_id: z.string().describe('UUID of the record'),
    },
    async ({ object, record_id }) => {
      const data = await call('GET', `/v2/objects/${object}/records/${record_id}`);
      return json(data);
    },
  );

  // ── 3. query_attio_records ─────────────────────────────────────────────────
  server.tool(
    'query_attio_records',
    "Flexible record query with Attio's filter language. Supports eq/contains/in/$or operators on any attribute. Use for cross-attribute searches like 'all deals owned by X with stage Y'.",
    {
      object: z.string().describe('Object slug to search within'),
      filter: z.record(z.string(), z.unknown()).optional().describe('Filter object, e.g. { stage: { eq: "Procurement" } }'),
      sorts: z
        .array(
          z.object({
            attribute: z.string(),
            direction: z.enum(['asc', 'desc']).optional(),
          }),
        )
        .optional()
        .describe('Sort spec, e.g. [{ attribute: "created_at", direction: "desc" }]'),
      limit: z.number().int().min(1).max(500).optional().default(25),
      offset: z.number().int().min(0).optional().default(0),
    },
    async ({ object, filter, sorts, limit, offset }) => {
      const data = await call('POST', `/v2/objects/${object}/records/query`, { filter, sorts, limit, offset });
      return json(data);
    },
  );

  // ── 4. search_attio_records ────────────────────────────────────────────────
  server.tool(
    'search_attio_records',
    "Global free-text search across multiple object types. Returns matching records tagged with their `object` slug. Use for 'find anything mentioning Northwind'.",
    {
      query: z.string().describe('Search string'),
      objects: z.array(z.string()).optional().describe('Restrict search to specific object slugs (default: all)'),
      limit: z.number().int().min(1).max(100).optional().default(25),
    },
    async ({ query, objects, limit }) => {
      const data = await call('POST', '/v2/objects/records/search', { query, objects, limit });
      return json(data);
    },
  );

  // ── 5. list_attio_lists ────────────────────────────────────────────────────
  server.tool(
    'list_attio_lists',
    "List all Attio lists (pipelines, segments, custom collections). Each list tracks stage progression for the records assigned to it. Use to discover pipeline IDs before calling `list_attio_list_entries`.",
    {},
    async () => {
      const data = await call('GET', '/v2/lists');
      return json(data);
    },
  );

  // ── 6. list_attio_list_entries ─────────────────────────────────────────────
  server.tool(
    'list_attio_list_entries',
    "List entries (deals/items) in a specific Attio list. Each entry has a parent record and stage attribute — perfect for fetching deal pipeline state. Supports filtering by stage or parent record.",
    {
      list: z.string().describe('List slug or UUID'),
      filter: z.record(z.string(), z.unknown()).optional().describe('Filter on entry_values, e.g. { stage: { eq: "Procurement" } }'),
      limit: z.number().int().min(1).max(500).optional().default(25),
    },
    async ({ list, filter, limit }) => {
      const data = await call('POST', `/v2/lists/${list}/entries/query`, { filter, limit });
      return json(data);
    },
  );

  // ── 7. list_attio_notes_for_record ─────────────────────────────────────────
  server.tool(
    'list_attio_notes_for_record',
    "List notes attached to a specific record (person, company, or deal). Use for 'what was last said about this account' — newest first when sorted client-side.",
    {
      object: z.string().describe('Parent object slug, e.g. "deals"'),
      record_id: z.string().describe('Parent record UUID'),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ object, record_id, limit }) => {
      const data = await call(
        'GET',
        `/v2/notes?parent_object=${encodeURIComponent(object)}&parent_record_id=${encodeURIComponent(record_id)}&limit=${limit}`,
      );
      return json(data);
    },
  );

  // ── 8. list_attio_tasks_for_record ─────────────────────────────────────────
  server.tool(
    'list_attio_tasks_for_record',
    "List tasks linked to a record. Filter by completion state to find 'open follow-ups'. Use for the 'unresolved actions' part of a briefing.",
    {
      linked_object: z.string().describe('Linked record object slug'),
      linked_record_id: z.string().describe('Linked record UUID'),
      is_completed: z.boolean().optional().describe('Filter — true returns done tasks, false returns open. Omit for both.'),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ linked_object, linked_record_id, is_completed, limit }) => {
      const params = new URLSearchParams({
        linked_object,
        linked_record_id,
        limit: String(limit),
      });
      if (is_completed !== undefined) params.set('is_completed', String(is_completed));
      const data = await call('GET', `/v2/tasks?${params.toString()}`);
      return json(data);
    },
  );

  // ── 9. list_attio_meetings_for_record ──────────────────────────────────────
  server.tool(
    'list_attio_meetings_for_record',
    "List meetings linked to a record. Returns title, time, attendees, and any linked call recordings. Use to reconstruct the call timeline before a follow-up.",
    {
      linked_record_id: z.string().describe('Linked record UUID (deal or person)'),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ linked_record_id, limit }) => {
      const data = await call(
        'GET',
        `/v2/meetings?linked_record_id=${encodeURIComponent(linked_record_id)}&limit=${limit}`,
      );
      return json(data);
    },
  );

  // ── 10. get_attio_meeting_transcript ───────────────────────────────────────
  server.tool(
    'get_attio_meeting_transcript',
    "Fetch the transcript for a specific call recording on a meeting. Use after `list_attio_meetings_for_record` to read what was actually said. Returns raw transcript text.",
    {
      meeting_id: z.string().describe('Meeting UUID'),
      call_recording_id: z.string().describe('Call recording UUID'),
    },
    async ({ meeting_id, call_recording_id }) => {
      const data = await call(
        'GET',
        `/v2/meetings/${meeting_id}/call_recordings/${call_recording_id}/transcript`,
      );
      return json(data);
    },
  );

  // ── 11. list_attio_call_recordings ─────────────────────────────────────────
  server.tool(
    'list_attio_call_recordings',
    "List all call recordings for a meeting. Use as an intermediate step between `list_attio_meetings_for_record` and `get_attio_meeting_transcript`.",
    {
      meeting_id: z.string().describe('Meeting UUID'),
    },
    async ({ meeting_id }) => {
      const data = await call('GET', `/v2/meetings/${meeting_id}/call_recordings`);
      return json(data);
    },
  );

  // ── 12. list_attio_workspace_members ───────────────────────────────────────
  server.tool(
    'list_attio_workspace_members',
    "List workspace members (Attio's internal users — AEs, CSMs, admins). Use to resolve a deal's `owner` UUID to a name/email when synthesising a brief.",
    {},
    async () => {
      const data = await call('GET', '/v2/workspace_members');
      return json(data);
    },
  );

  // ── 13. get_attio_self ─────────────────────────────────────────────────────
  server.tool(
    'get_attio_self',
    "Identify the workspace + user behind the current access token. Returns workspace name, slug, scopes, and the active workspace member. Useful for grounding 'whose CRM am I reading'.",
    {},
    async () => {
      const data = await call('GET', '/v2/self');
      return json(data);
    },
  );
}

export function createAttioMcpServer(baseUrl = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
  });
  registerAttioTools(server, baseUrl);
  return server;
}

export async function startAttioMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL ?? 'http://localhost:4100';
  const server = createAttioMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
