---
"@mimicai/adapter-granola": minor
---

feat(adapter): add Granola meeting-notes mock adapter

Read-only mock for the Granola public API (`https://public-api.granola.ai/v1`)
covering all 3 spec endpoints: list notes with date filters and cursor
pagination, retrieve a note (with optional `?include=transcript`), and list
workspace folders alphabetically.

Implements Granola's response idioms: list envelope `{ notes|folders,
hasMore, cursor }`, flat single-note shape (no `data` wrapper), `not_*` /
`fol_*` ID prefixes, ISO 8601 timestamps, and the transcript-inclusion
toggle that returns 404 when a meeting wasn't transcribed.

5 MCP tools designed for the Briefing Agent's Step 3 (conversation history)
— `find_granola_notes_by_attendee` plus separate `get_granola_note` (cheap,
no transcript) and `get_granola_note_transcript` (heavy, with speaker
turns). 15 tests covering envelope shape, date filtering, cursor
pagination, transcript include/exclude semantics, 404s, and the
briefing-agent end-to-end flow.
