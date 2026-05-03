/**
 * GET /v1/notes        — List notes with date filters + cursor pagination
 * GET /v1/notes/:note_id — Retrieve single note (with optional ?include=transcript)
 *
 * Granola's response shapes:
 *   - List:    `{ notes: [...], hasMore: boolean, cursor: string | null }`
 *   - Single:  flat note object (no `data` wrapper)
 *
 * `include=transcript` toggles whether the heavy `transcript` array is
 * included in the single-note response. For list calls, transcripts are
 * always omitted (Granola's behaviour).
 */

import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { getParam, getQuery, NS, paginateByCursor, parseIsoDate, send400, send404 } from './_shared.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

interface Note {
  id: string;
  object: string;
  title: string | null;
  owner: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  web_url: string;
  calendar_event: Record<string, unknown> | null;
  summary: string | null;
  transcript: unknown[];
  folder_id: string | null;
  [key: string]: unknown;
}

function withoutTranscript(note: Note): Omit<Note, 'transcript'> {
  const { transcript: _t, ...rest } = note;
  void _t;
  return rest;
}

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = getQuery(req);

    // Validate date filters before doing work.
    for (const k of ['created_before', 'created_after', 'updated_after']) {
      if (q[k] !== undefined && parseIsoDate(q[k]) === null) {
        return send400(reply, `Invalid ISO 8601 datetime for ${k}: "${q[k]}"`, 'invalid_date');
      }
    }

    let items = store.list<Note>(NS.notes);

    const createdBefore = parseIsoDate(q.created_before);
    const createdAfter = parseIsoDate(q.created_after);
    const updatedAfter = parseIsoDate(q.updated_after);

    if (createdBefore) items = items.filter((n) => new Date(n.created_at) < createdBefore);
    if (createdAfter) items = items.filter((n) => new Date(n.created_at) > createdAfter);
    if (updatedAfter) items = items.filter((n) => new Date(n.updated_at) > updatedAfter);

    if (q.folder_id) items = items.filter((n) => n.folder_id === q.folder_id);

    // Stable order: most recent first.
    items.sort((a, b) => (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : 0));

    const pageSize = Math.min(parseInt(q.page_size ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const { page, hasMore, nextCursor } = paginateByCursor(items, q.cursor, pageSize);

    // Notes in list responses never include the full transcript.
    const stripped = page.map(withoutTranscript);

    return reply.code(200).send({
      notes: stripped,
      hasMore,
      cursor: nextCursor,
    });
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'note_id');
    const q = getQuery(req);
    const note = store.get<Note>(NS.notes, id);
    if (!note) return send404(reply, 'Note', id);

    // Granola's docs note: 404 for notes without summaries/transcripts.
    // We mimic that for transcript inclusion specifically.
    const includeTranscript = (q.include ?? '').split(',').includes('transcript');
    if (includeTranscript && (!note.transcript || note.transcript.length === 0)) {
      return send404(reply, 'Transcript for note', id);
    }

    return reply.code(200).send(includeTranscript ? note : withoutTranscript(note));
  };
}
