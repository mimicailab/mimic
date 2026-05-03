/**
 * Marshallers for Granola notes + transcript entries.
 *
 * Granola's wire shapes contain polymorphic objects — `note.owner` (user
 * shape), `note.calendar_event` (event with attendees), and each
 * transcript entry's `speaker` (user). The persona generator can't fill
 * these without slug guidance, so the codegen declares two pseudo-resources:
 *
 *   - `note_content`            (standalone) — flat note + meeting fields.
 *   - `transcript_entry_content` (embedded)  — flat speaker + text fields,
 *                                              cross-references its parent
 *                                              note via `note_label`.
 *
 * Cross-resource references go via labels, not ids. Transcript entries
 * carry `note_label` matching the parent note's `label`; the SDK resolves
 * label → assigned id during marshalling. See marshall.md.
 */

import type { Body, Marshaller, StandaloneMarshaller } from '@mimicai/adapter-sdk';
import type { StateStore } from '@mimicai/core';
import { defaultNote } from '../generated/schemas.js';
import { NS } from './_shared.js';

interface FolderRow {
  id: string;
  name: string;
}

export function buildGranolaMarshallers(): Marshaller[] {
  const noteMarshaller: StandaloneMarshaller = {
    kind: 'standalone',
    contentResource: 'note_content',
    namespace: NS.notes,
    labelField: 'label',
    generateId: (body) => {
      const label = (body.label as string) || '';
      const slug = slugify(label) || randomSuffix();
      return `not_${slug}`.slice(0, 24);
    },
    wrap: (body, id, ctx) => wrapNote(body, id, ctx.store),
  };

  const transcriptMarshaller: Marshaller = {
    kind: 'embedded',
    contentResource: 'transcript_entry_content',
    parentResource: 'note_content',
    parentLabelField: 'note_label',
    arrayField: 'transcript',
    wrap: (body) => wrapTranscriptEntry(body),
  };

  return [noteMarshaller, transcriptMarshaller];
}

function wrapNote(body: Body, id: string, store: Pick<StateStore, 'get' | 'list'>): Body {
  const folders = store.list<FolderRow>(NS.folders);
  const folderByName = new Map<string, string>();
  for (const f of folders) folderByName.set(f.name.toLowerCase(), f.id);
  const defaultFolderId = folders[0]?.id ?? null;

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
  return note;
}

function wrapTranscriptEntry(b: Body): Body {
  return {
    speaker: buildSpeaker(b),
    text: (b.text as string) ?? '',
    start_time: (b.start_time as string) ?? '',
    end_time: (b.end_time as string) ?? '',
  };
}

function buildOwner(b: Body): Record<string, string> | null {
  const name = (b.owner_name as string) ?? '';
  const email = (b.owner_email as string) ?? '';
  if (!name && !email) return null;
  return {
    id: email ? `usr_${slugify(email)}` : `usr_${slugify(name)}`,
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

function buildSpeaker(b: Body): Record<string, string> {
  const name = (b.speaker_name as string) ?? '';
  const email = (b.speaker_email as string) ?? '';
  return {
    id: email ? `usr_${slugify(email)}` : `usr_${slugify(name)}`,
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

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
