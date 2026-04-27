/**
 * Granola MCP tools.
 *
 * Designed for the Briefing Agent's Step 3 (conversation history): the agent
 * calls `find_granola_notes_by_attendee` to surface meetings with the
 * upcoming-call attendee, then pulls the most recent transcript via
 * `get_granola_note_transcript`. `list_granola_notes` and `list_granola_folders`
 * round out the surface for general-purpose access.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import meta from './adapter-meta.js';

function makeCall(baseUrl: string) {
  return async (path: string) => {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { accept: 'application/json' },
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

export function registerGranolaTools(server: McpServer, baseUrl: string): void {
  const call = makeCall(baseUrl);

  // ── 1. list_granola_notes ─────────────────────────────────────────────────
  server.tool(
    'list_granola_notes',
    "List Granola meeting notes, newest first. Supports ISO 8601 date filters (`created_after`, `created_before`, `updated_after`) and folder scoping. Transcripts are NOT included in list responses — call `get_granola_note_transcript` for any specific note. Use as the entry point for 'recent meetings with X'.",
    {
      created_after: z.string().optional().describe("Only return notes created after this ISO 8601 datetime, e.g. '2026-04-01T00:00:00Z'"),
      created_before: z.string().optional().describe('Only return notes created before this ISO 8601 datetime'),
      updated_after: z.string().optional().describe('Only return notes updated after this ISO 8601 datetime'),
      folder_id: z.string().optional().describe('Restrict to a specific workspace folder (e.g. "fol_engteam0000")'),
      cursor: z.string().optional().describe('Pagination cursor from a previous response'),
      page_size: z.number().int().min(1).max(100).optional().default(20),
    },
    async (params) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) qs.set(k, String(v));
      }
      const query = qs.toString();
      const data = await call(`/v1/notes${query ? `?${query}` : ''}`);
      return json(data);
    },
  );

  // ── 2. get_granola_note ──────────────────────────────────────────────────
  server.tool(
    'get_granola_note',
    "Retrieve a single Granola meeting note by id (without the transcript). Returns title, summary, attendees, owner, calendar event, and folder. Use after `list_granola_notes` to inspect a specific meeting cheaply.",
    {
      note_id: z.string().describe('Note id (format: `not_<14-char>`)'),
    },
    async ({ note_id }) => {
      const data = await call(`/v1/notes/${encodeURIComponent(note_id)}`);
      return json(data);
    },
  );

  // ── 3. get_granola_note_transcript ────────────────────────────────────────
  server.tool(
    'get_granola_note_transcript',
    "Retrieve a Granola meeting note WITH its full transcript array (speaker turns + timestamps). Use this to read what was actually said in a call — Step 3 of the briefing-agent flow ('LAST CALL highlights'). Note: returns 404 if the meeting wasn't transcribed.",
    {
      note_id: z.string().describe('Note id (format: `not_<14-char>`)'),
    },
    async ({ note_id }) => {
      const data = await call(`/v1/notes/${encodeURIComponent(note_id)}?include=transcript`);
      return json(data);
    },
  );

  // ── 4. find_granola_notes_by_attendee ─────────────────────────────────────
  server.tool(
    'find_granola_notes_by_attendee',
    "Find Granola meeting notes that include a specific attendee email in the calendar event. Internally calls `list_granola_notes` and filters by `calendar_event.invitees[].email`. Use for 'recent meetings with priya@northwind.com' — the bread-and-butter briefing-agent lookup.",
    {
      email: z.string().describe('Attendee email to match'),
      created_after: z.string().optional().describe('Limit to meetings after this ISO 8601 datetime'),
      limit: z.number().int().min(1).max(100).optional().default(10),
    },
    async ({ email, created_after, limit }) => {
      const qs = new URLSearchParams({ page_size: String(Math.min(limit * 5, 100)) });
      if (created_after) qs.set('created_after', created_after);
      const data = (await call(`/v1/notes?${qs.toString()}`)) as { notes?: Array<Record<string, unknown>> };
      const notes = data.notes ?? [];
      const matches = notes.filter((n) => {
        const ev = n.calendar_event as Record<string, unknown> | null | undefined;
        if (!ev) return false;
        const invitees = (ev.invitees as Array<Record<string, unknown>> | undefined) ?? [];
        return invitees.some((inv) => String(inv.email ?? '').toLowerCase() === email.toLowerCase());
      });
      return json({ notes: matches.slice(0, limit), matched: matches.length });
    },
  );

  // ── 5. list_granola_folders ───────────────────────────────────────────────
  server.tool(
    'list_granola_folders',
    "List Granola workspace folders alphabetically. Folders organise notes; use `parent_folder_id` to walk the hierarchy. Useful before scoping `list_granola_notes` with a `folder_id`.",
    {
      cursor: z.string().optional().describe('Pagination cursor'),
      page_size: z.number().int().min(1).max(100).optional().default(50),
    },
    async ({ cursor, page_size }) => {
      const qs = new URLSearchParams();
      if (cursor) qs.set('cursor', cursor);
      qs.set('page_size', String(page_size));
      const data = await call(`/v1/folders?${qs.toString()}`);
      return json(data);
    },
  );
}

export function createGranolaMcpServer(baseUrl = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
  });
  registerGranolaTools(server, baseUrl);
  return server;
}

export async function startGranolaMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL ?? 'http://localhost:4100';
  const server = createGranolaMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
