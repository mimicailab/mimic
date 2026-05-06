# @mimicai/adapter-hubspot

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

- [#155](https://github.com/mimicailab/mimic/pull/155) [`95da585`](https://github.com/mimicailab/mimic/commit/95da585d0d986dc005eb2275dd0187bd3d1f83cc) Thanks [@ada-raj](https://github.com/ada-raj)! - feat(adapter): add HubSpot mock adapter (full coverage, 1054 routes)

  Multi-spec adapter that merges all 105 product specs from the
  [HubSpot public API spec collection](https://github.com/HubSpot/HubSpot-public-api-spec-collection)
  into a unified route table — the largest API mock in the Mimic suite.
  Spans CRM (537 routes across 60+ products), CMS (220), Marketing (111),
  Conversations (32), Webhooks (35), Automation (30), Files (18), Settings,
  Events, Account, Auth, Communication Preferences, Data Studio, Scheduler,
  Meta and Business Units. Latest-stable version per product (`2026-03`
  where available, fallback to v4/v3/v1).

  Implements HubSpot's universal idioms once at the adapter level:
  `{ results, paging.next.after }` list envelope, `?limit&after` cursor
  pagination, deep-merging PATCH semantics on the `properties` bag,
  soft-delete via DELETE → 204 with `archived: true`, and the standard
  error envelope `{ status, message, correlationId, category, errors? }`.

  Generic search and batch overrides are auto-registered for every spec
  route matching the well-known shapes (`*/search` and `*/batch/<verb>`).
  The unified CRM Objects API and the per-type typed APIs (Contacts,
  Deals, Tickets, etc.) both route through the same set of handlers,
  which extract the object type from `:objectType` path params or by URL
  parsing — keeping per-type StateStore namespacing isolated.

  Specific overrides for: OAuth token exchange (authorization_code +
  refresh_token grants returning `pat-na1-*` Bearer tokens), `/account-info`
  flat envelope, and CRM Pipelines (codegen mis-classifies the trailing
  `{objectType}` as retrieve — the override returns the correct
  filtered list).

  13 MCP tools designed for the Briefing Agent's flow plus general-purpose
  HubSpot lookups: `find_hubspot_contact_by_email` is Step 1 (paired with
  the Attio version), then deal/notes/tasks/calls/meetings/emails search
  for steps 2-4, plus pipelines/owners/properties/account-info. 25 tests
  covering CRUD, filterGroups search with CONTAINS_TOKEN/sorts, batch
  create/read/upsert with idProperty matching, OAuth grants, error
  envelopes, pipelines stages, and the end-to-end briefing-agent flow.
