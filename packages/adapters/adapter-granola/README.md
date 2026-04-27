# `@mimicai/adapter-granola`

Mimic mock adapter for the [Granola API](https://docs.granola.ai/introduction)
v1 — read-only meeting notes, transcripts, and workspace folders.

Built primarily to power **Step 3 of the Briefing Agent's flow** (conversation
history): given an upcoming-call attendee, find recent Granola meetings and
read what was said. See `private/briefing-agent.md`.

## Install

```bash
npm install @mimicai/adapter-granola
```

## Coverage

Granola's public API is intentionally minimal. **All 3 spec endpoints** are
implemented — there is no curation/trimming because there's nothing to trim.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/notes` | List meeting notes (newest first); filter by `created_after`/`created_before`/`updated_after`; cursor pagination via `cursor`/`page_size` |
| `GET` | `/v1/notes/{note_id}` | Retrieve a single note; `?include=transcript` bundles the speaker-turn transcript array |
| `GET` | `/v1/folders` | List workspace folders alphabetically with cursor pagination |

Spec source: `https://docs.granola.ai/api-reference/openapi.json` (OpenAPI 3.1).

## Granola idioms the adapter implements

| Idiom | How |
|-------|-----|
| **List envelope** | `{ notes: [...], hasMore: boolean, cursor: string \| null }` (folders use `{ folders, hasMore, cursor }`) — distinct from a `data`-wrapped envelope |
| **Single note** | Flat object — no `data` wrapper |
| **Cursor pagination** | Cursor is the id of the last item on the previous page; `hasMore` indicates more items exist; `nextCursor` is null on the final page |
| **Transcript inclusion** | `?include=transcript` toggles the transcript array on single-note responses; list responses never include transcripts (Granola behaviour); 404 if the note has no transcript |
| **ID prefixes** | Notes are `not_<14-char>`, folders are `fol_<14-char>` |
| **Timestamps** | ISO 8601 with UTC (`2026-04-20T15:00:00Z`) for `created_at`, `updated_at`, transcript `start_time`/`end_time`, and date filter params |
| **Error envelope** | `{ error: { type, code, message } }` — Granola's docs only describe natural-language status codes; we pick a sensible JSON shape compatible with most SDKs |

## Auth

Granola tokens are formatted `grn_<key>`. For Mimic test traffic, encode the
persona id between underscores:

```bash
curl http://localhost:4100/v1/notes \
  -H "Authorization: Bearer grn_northwind-priya_aaaaaaaaaaaa"
```

The mock accepts any Bearer token (real Granola enforces validity); persona
extraction matches the `grn_<persona-id>_*` pattern.

## MCP tools (5)

Designed for the Briefing Agent's pre-call synthesis flow:

1. **`list_granola_notes`** — Newest-first list with date filters; transcripts excluded (call `get_granola_note_transcript` per note).
2. **`get_granola_note`** — Cheap fetch (no transcript) — title, summary, attendees, calendar event, folder.
3. **`get_granola_note_transcript`** — Full transcript with speaker turns; **Step 3 of the briefing-agent flow** ("LAST CALL highlights"). Returns 404 if the meeting wasn't transcribed.
4. **`find_granola_notes_by_attendee`** — Convenience filter for "recent meetings with `priya@northwind.com`" — the bread-and-butter briefing lookup.
5. **`list_granola_folders`** — Alphabetical workspace folders for scoping `list_granola_notes` with `folder_id`.

## Running

### Standalone

```bash
pnpm --filter @mimicai/adapter-granola build
node dist/bin/mcp.js
```

### With `mimic host`

```yaml
# mimic.json
apis:
  granola:
    enabled: true
    mcp: true
```

## Regeneration

The OpenAPI spec is gitignored. To regenerate after a Granola spec update:

```bash
curl -fsSL https://docs.granola.ai/api-reference/openapi.json \
  -o packages/adapters/adapter-granola/granola-spec.json

pnpm --filter @mimicai/adapter-granola generate
pnpm --filter @mimicai/adapter-granola test
```

## Why so small?

Granola's public API is genuinely 3 endpoints. The Mimic adapter quality bar
typically asks for ≥8 routes; Granola is a deliberate exception because the
upstream surface is what it is. Padding with fake endpoints would damage the
"swap the URL, not the code" promise. If/when Granola expands their API, the
codegen will pick up new paths automatically.
