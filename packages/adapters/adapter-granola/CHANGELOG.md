# @mimicai/adapter-granola

## 0.13.1

### Patch Changes

- Updated dependencies [[`3064c42`](https://github.com/mimicailab/mimic/commit/3064c423efd339fe2aaa839832a69c02311e89f0)]:
  - @mimicai/core@0.14.0
  - @mimicai/adapter-sdk@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [[`014be6a`](https://github.com/mimicailab/mimic/commit/014be6a23ad9fb99de9845cbe6c32391ea51bdca)]:
  - @mimicai/core@0.13.0
  - @mimicai/adapter-sdk@0.13.0

## 0.12.1

### Patch Changes

- [#160](https://github.com/mimicailab/mimic/pull/160) [`47ae6fe`](https://github.com/mimicailab/mimic/commit/47ae6fef913c8b7881038911434d2c1c01093519) Thanks [@ada-raj](https://github.com/ada-raj)! - fix: data-integrity bugs surfaced by briefing-agent eval

  Four framework fixes from a `/mimic-eval` audit that traced low pass rates
  to silent upstream data-integrity bugs rather than agent / skill issues.

  **adapter-sdk** — `OpenApiMockAdapter.buildListHandler` was treating every
  `route.queryFilters` key as a structural property filter unless it appeared
  in a hardcoded skip list. The skip list covered Stripe pagination
  (`limit`, `starting_after`, …) but not Google APIs' `maxResults` /
  `pageToken` or common cursor / offset / after conventions, so MCP calls
  like `list_gmail_drafts` (which always pass `maxResults: 50`) ran
  `items.filter(i => i.maxResults === '50')` and returned empty. Hoisted
  the skip list to a `PAGINATION_QUERY_KEYS` module constant and added
  the missing keys.

  **core** — `DataValidator.repairApiResponses` silently collapsed duplicate
  `body.id` values within a resource collection (`new Set()` deduped without
  warning). At seed time the second record overwrote the first in the
  StateStore, losing data. Now detects, renames duplicates via a fresh
  suffixed id (`<original>_2`, …), warns, and increments `idsRepaired`.
  Cascade-fixes adapter FK repair when the LLM emits colliding ids: the
  existing `repairForeignKeys` couldn't distribute children across distinct
  parents when the parent index had collapsed to one entry.

  **adapter-attio** — comments seeded at boot were never attached to their
  parent threads. The `POST /v2/comments` create handler runs the
  parent-attach logic on writes, but the auto-seeder skips it. Added
  `hydrateThreadComments(store)` in `overrides/comments.ts`, called from
  `registerRoutes` after `registerGeneratedRoutes`. Walks every seeded
  comment, looks up its parent thread by `thread_id`, appends to the
  thread's `comments` array. Idempotent against both flat-string ids
  (seeded shape) and compound ids (marshalled shape).

  **adapter-hubspot** — engagement and inventory CRM objects (`call`,
  `meeting`, `email`, `note`, `task`, `line_item`, `product`) had no
  marshaller, so they fell through to the generic auto-seeder which stored
  them at `hubspot:<singular>`. The unified list endpoint at
  `/crm/objects/<v>/{calls|meetings|line_items|...}` reads from
  `hubspot:crm_objects:<plural>` — namespaces never matched and list
  responses were always empty. Added a `passthroughCrmObject(contentResource,
plural)` marshaller helper and seven entries that route the wire-shaped
  bodies to the correct namespace.

- Updated dependencies [[`47ae6fe`](https://github.com/mimicailab/mimic/commit/47ae6fef913c8b7881038911434d2c1c01093519)]:
  - @mimicai/adapter-sdk@0.12.1
  - @mimicai/core@0.12.1

## 0.12.0

### Minor Changes

- [#155](https://github.com/mimicailab/mimic/pull/155) [`76235fd`](https://github.com/mimicailab/mimic/commit/76235fd1b71d4af5246d5cfd801de84336a78a64) Thanks [@ada-raj](https://github.com/ada-raj)! - feat(adapter): add Granola meeting-notes mock adapter

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
