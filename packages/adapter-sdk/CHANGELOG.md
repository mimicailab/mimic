# @mimicailab/adapter-sdk

## 0.14.0

### Patch Changes

- Updated dependencies [[`3064c42`](https://github.com/mimicailab/mimic/commit/3064c423efd339fe2aaa839832a69c02311e89f0)]:
  - @mimicai/core@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [[`014be6a`](https://github.com/mimicailab/mimic/commit/014be6a23ad9fb99de9845cbe6c32391ea51bdca)]:
  - @mimicai/core@0.13.0

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
  - @mimicai/core@0.12.1

## 0.11.1

### Patch Changes

- Updated dependencies []:
  - @mimicai/core@0.11.1

## 0.11.0

### Patch Changes

- Updated dependencies [[`0615532`](https://github.com/mimicailab/mimic/commit/061553211702722945c9f52034736e6d9fd16247)]:
  - @mimicai/core@0.11.0

## 0.10.2

### Patch Changes

- Updated dependencies []:
  - @mimicai/core@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies [[`6f2d991`](https://github.com/mimicailab/mimic/commit/6f2d991d4def19db6b6b238620a081a7a694fd75)]:
  - @mimicai/core@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies []:
  - @mimicai/core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [[`6ce4e0b`](https://github.com/mimicailab/mimic/commit/6ce4e0b8f331ee11866afe55be2bfb5c60a7981d), [`6ce4e0b`](https://github.com/mimicailab/mimic/commit/6ce4e0b8f331ee11866afe55be2bfb5c60a7981d)]:
  - @mimicai/core@0.9.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`e7e1160`](https://github.com/mimicailab/mimic/commit/e7e1160701e5925b9a8f3060477e8a02020aec74)]:
  - @mimicai/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies []:
  - @mimicai/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`528fa14`](https://github.com/mimicailab/mimic/commit/528fa14dd1696fd00c39e645c500d18096b70b7d)]:
  - @mimicai/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`2ee93d5`](https://github.com/mimicailab/mimic/commit/2ee93d546e4d71589a022332eaeed735aaea09dc)]:
  - @mimicai/core@0.4.0

## 0.3.1

### Patch Changes

- [#10](https://github.com/mimicailab/mimic/pull/10) [`7eb52cd`](https://github.com/mimicailab/mimic/commit/7eb52cd539f27fa21f07967e7dacdc85cc389b59) Thanks [@ajollie](https://github.com/ajollie)! - Add README.md to all packages and update documentation to match actual codebase.

- Updated dependencies [[`7eb52cd`](https://github.com/mimicailab/mimic/commit/7eb52cd539f27fa21f07967e7dacdc85cc389b59)]:
  - @mimicai/core@0.3.1

## 0.3.0

### Minor Changes

- [#4](https://github.com/mimicailab/mimic/pull/4) [`75cd325`](https://github.com/mimicailab/mimic/commit/75cd325329dfe1b032728f671e824e0ed4cacd98) Thanks [@ajollie](https://github.com/ajollie)! - Initial public release of Mimic — persona-driven synthetic data generation for AI agent testing.
  - Core engine with schema parsing (Prisma, SQL DDL, live PG), LLM-powered data generation, database seeding, MCP server, and test runner
  - CLI with init, run, seed, serve, test, inspect, and clean commands
  - Pre-built persona blueprints (young-professional, freelancer, college-student)
  - Adapter SDK for building custom API mock adapters
  - Database adapters: PostgreSQL, MySQL, MongoDB, SQLite
  - API mock adapters: Stripe, Plaid, Slack

### Patch Changes

- Updated dependencies [[`75cd325`](https://github.com/mimicailab/mimic/commit/75cd325329dfe1b032728f671e824e0ed4cacd98)]:
  - @mimicailab/core@0.3.0
