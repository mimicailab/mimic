/**
 * Custom seeder for Granola notes + transcript entries.
 *
 * Granola's wire shapes contain polymorphic objects — `note.owner` (user
 * shape), `note.calendar_event` (event shape with attendee list), and each
 * transcript entry's `speaker` (user shape). The persona generator can't fill
 * these without slug guidance, so the codegen declares two pseudo-resources
 * — `note_content` and `transcript_entry_content` — with explicit flat
 * fields (owner_email, meeting_title, speaker_name, ...) the LLM populates.
 *
 * This seeder:
 *   1. Wraps each `note_content` into Granola's note envelope (id, owner
 *      object, calendar_event with invitees, folder_id resolved by name).
 *   2. Groups `transcript_entry_content` by `note_id` and pushes each as a
 *      Granola-shape transcript entry onto the parent note's `transcript`
 *      array.
 *
 * Without this step, generated note content lands in unused namespaces and
 * /v1/notes returns either nothing or empty-shell notes.
 */

import type { ExpandedData, StateStore } from '@mimicai/core';
import { defaultNote } from '../generated/schemas.js';
import { NS } from './_shared.js';

type Body = Record<string, unknown>;

interface FolderRow {
  id: string;
  name: string;
}

export function seedGranolaNotes(
  data: Map<string, ExpandedData>,
  store: StateStore,
): void {
  // Build a folder name → id map so notes can resolve their folder by name.
  const folders = store.list<FolderRow>(NS.folders);
  const folderByName = new Map<string, string>();
  for (const f of folders) folderByName.set(f.name.toLowerCase(), f.id);
  const defaultFolderId = folders[0]?.id ?? null;

  // Pass 1: wrap note_content entries into Granola's note envelope.
  for (const [, expanded] of data) {
    const responses = expanded.apiResponses?.granola?.responses;
    const notes = responses?.note_content;
    if (!notes) continue;

    for (const resp of notes) {
      const body = (resp.body ?? {}) as Body;
      const id = (body.id as string) ?? '';
      if (!id) continue;

      const note = defaultNote({
        id,
        title: (body.title as string) ?? null,
        summary: (body.summary as string) ?? null,
        owner: buildOwner(body),
        calendar_event: buildCalendarEvent(body),
        folder_id: resolveFolderId(body, folderByName, defaultFolderId),
        created_at: (body.created_at as string) ?? new Date().toISOString(),
        updated_at: (body.created_at as string) ?? new Date().toISOString(),
        transcript: [],
      });
      // Stash body_markdown on the note so retrieve handlers can return the
      // fuller content if persona produced it. Granola's real API doesn't
      // surface this field, but it's harmless to carry.
      if (body.body_markdown) (note as Body).body_markdown = body.body_markdown;
      store.set(NS.notes, id, note);
    }
  }

  // Pass 2: attach transcript entries to their parent notes.
  for (const [, expanded] of data) {
    const responses = expanded.apiResponses?.granola?.responses;
    const entries = responses?.transcript_entry_content;
    if (!entries) continue;

    // Group entries by note_id so we can sort + assign in one pass per note.
    const byNote = new Map<string, Body[]>();
    for (const resp of entries) {
      const body = (resp.body ?? {}) as Body;
      const noteId = (body.note_id as string) ?? '';
      if (!noteId) continue;
      const list = byNote.get(noteId) ?? [];
      list.push(body);
      byNote.set(noteId, list);
    }

    for (const [noteId, items] of byNote) {
      const note = store.get<Body>(NS.notes, noteId);
      if (!note) continue;
      // Sort by start_time so transcripts read in chronological order.
      items.sort((a, b) => String(a.start_time ?? '').localeCompare(String(b.start_time ?? '')));
      const transcript = (note.transcript as unknown[]) ?? [];
      for (const item of items) {
        transcript.push({
          speaker: buildSpeaker(item),
          text: (item.text as string) ?? '',
          start_time: (item.start_time as string) ?? '',
          end_time: (item.end_time as string) ?? '',
        });
      }
      store.set(NS.notes, noteId, { ...note, transcript });
    }
  }
}

function buildOwner(b: Body): Record<string, string> | null {
  const name = (b.owner_name as string) ?? '';
  const email = (b.owner_email as string) ?? '';
  if (!name && !email) return null;
  return {
    id: email ? `usr_${slug(email)}` : `usr_${slug(name)}`,
    name,
    email,
  };
}

function buildCalendarEvent(b: Body): Record<string, unknown> | null {
  const title = (b.meeting_title as string) ?? '';
  const start = (b.meeting_start_time as string) ?? '';
  const end = (b.meeting_end_time as string) ?? '';
  if (!title && !start && !end) return null;
  return {
    title,
    start_time: start,
    end_time: end,
    invitees: parseInvitees((b.attendee_emails as string) ?? ''),
  };
}

/**
 * Parse a free-form attendee list into Granola's `{ name, email }` invitee
 * shape. Accepts comma- or semicolon-separated tokens, with optional name in
 * parens or angle brackets:
 *   "priya@northwind.com, sarah@us.example"
 *   "Priya Shah <priya@northwind.com>; Sarah Lee <sarah@us.example>"
 *   "priya@northwind.com (Priya Shah)"
 */
function parseInvitees(s: string): Array<{ name: string; email: string }> {
  if (!s) return [];
  return s
    .split(/[,;]+/)
    .map((tok) => tok.trim())
    .filter(Boolean)
    .map(parseInviteeToken)
    .filter((i) => i.email);
}

function parseInviteeToken(tok: string): { name: string; email: string } {
  // "Name <email>"
  const angle = tok.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (angle) return { name: (angle[1] ?? '').trim(), email: (angle[2] ?? '').trim() };
  // "email (Name)"
  const paren = tok.match(/^([^\s(]+)\s*\(([^)]+)\)\s*$/);
  if (paren) return { name: (paren[2] ?? '').trim(), email: (paren[1] ?? '').trim() };
  // Bare email
  if (/@/.test(tok)) return { name: '', email: tok };
  // Bare name (no email) — drop, Granola invitees are email-keyed.
  return { name: tok, email: '' };
}

function buildSpeaker(b: Body): Record<string, string> {
  const name = (b.speaker_name as string) ?? '';
  const email = (b.speaker_email as string) ?? '';
  return {
    id: email ? `usr_${slug(email)}` : `usr_${slug(name)}`,
    name,
    email,
    // `source` is Granola's speaker-origin tag (microphone | speaker | system).
    // Persona content doesn't distinguish, so default to microphone.
    source: 'microphone',
  };
}

function resolveFolderId(
  b: Body,
  folderByName: Map<string, string>,
  fallback: string | null,
): string | null {
  const name = ((b.folder_name as string) ?? '').toLowerCase();
  if (name && folderByName.has(name)) return folderByName.get(name)!;
  return fallback;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16) || 'unknown';
}
