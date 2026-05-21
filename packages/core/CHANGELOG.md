# @mimicailab/core

## 0.14.0

### Minor Changes

- [#166](https://github.com/mimicailab/mimic/pull/166) [`3064c42`](https://github.com/mimicailab/mimic/commit/3064c423efd339fe2aaa839832a69c02311e89f0) Thanks [@ada-raj](https://github.com/ada-raj)! - Add a persona-conformance layer between LLM-driven generation and seeding. Five new pipeline phases work together to close the loop on narrative compliance — the persona's exact counts, amounts, dates, and enum constraints now flow as hard pins through generation, get validated against the schema before the run continues, and get checked against the seeded data after.
  - **persona-constraints**: pre-pass LLM call extracts pinned numerics/dates from the persona text as imperative `PERSONA-PINNED REQUIREMENTS` instructions, scoped per adapter+resource. Injected into each per-resource distribution prompt so the LLM cannot miss "£4,800 overdue" or "every row status=active". Substates are framed as non-additive ("22 of 618 in retry", not 618 + 22).
  - **mapping-derivation**: schema-mapping output extended with `copy | derive | constant` forms. Mirror flow applies derivations to compute destination values from API bodies (e.g. `users.plan` from `subscription.items.data[0].price.unit_amount`) instead of blind-copying values from a disjoint enum. Validator catches enum violations, unknown columns/resources, unresolved paths, and disjoint-enum copies; one retry with corrections injected before falling back.
  - **conformance-checker**: extracts testable assertions from the persona, evaluates them deterministically against expanded data, and writes a per-persona report (pass/fail with expected/actual). Assertion validation catches path/null-filter mistakes and retries once.
  - **envelope-splice** + **object-ref embed**: spec-driven phases that read Stripe-style list envelopes (`subscription.items.data`) and object-ref fields (`subscription_item.price`) from the existing `ResourceSpec` defaults and populate them from the matching sibling resources. No adapter changes — the spec already encoded the truth; the pipeline just respects it now. Both phases run BEFORE the mirror so derivations can read fully-formed nested data.
  - **prompt + validator hardening**: `PINNED VALUES` and ENUM compliance rules added to distribution prompts. `DataValidator` counts enum violations and re-dedups after `fillMissingRequiredColumns` so multi-column unique constraints survive the fill pass.

  On the cfo-agent-skills persona this lifts conformance from ~46% to ~69% pass on first run; the seeded Postgres landed 3,794 users exactly matching spec, all 4 plan/status enum values valid, all 8 billing platforms present.

## 0.13.0

### Minor Changes

- [`014be6a`](https://github.com/mimicailab/mimic/commit/014be6a23ad9fb99de9845cbe6c32391ea51bdca) Thanks [@ada-raj](https://github.com/ada-raj)! - Add `claude-skill` test exporter. `mimic test --export claude-skill` writes a `mimic-eval` Claude Skill (`SKILL.md`) under `.mimic/exports/skills/mimic-eval/` and installs a copy into the project's `skills/` directory so Claude Code picks it up automatically. The skill loads `mimic-scenarios.json`, fans out one sub-agent per scenario, scores responses with a hybrid (strict substring + LLM-judge paraphrase + numeric range) check, and prints a scored markdown report. Configure the target skill via the new `test.target_skill` field in `mimic.json`. Existing `skills/mimic-eval/SKILL.md` files are preserved by default; pass `--force-install-skill` to overwrite.

  The `claude-skill` exporter now also writes `mimic-scenarios.json` alongside the `SKILL.md` (previously this had to be generated separately via `--export mimic`, which made it easy for the scenario JSON to drift stale relative to the current fact manifest).

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

## 0.11.1

## 0.11.0

### Minor Changes

- [#145](https://github.com/mimicailab/mimic/pull/145) [`0615532`](https://github.com/mimicailab/mimic/commit/061553211702722945c9f52034736e6d9fd16247) Thanks [@ajollie](https://github.com/ajollie)! - Add `StateStore.serialize()` and `hydrate()` methods for cloud persistence

## 0.10.2

## 0.10.1

### Patch Changes

- [#139](https://github.com/mimicailab/mimic/pull/139) [`6f2d991`](https://github.com/mimicailab/mimic/commit/6f2d991d4def19db6b6b238620a081a7a694fd75) Thanks [@ajollie](https://github.com/ajollie)! - Fix `mimic explore` blocking terminal and crashing on port conflict; migrate MCP transport to Streamable HTTP
  - `mimic explore` now spawns a background daemon and returns immediately instead of blocking the terminal
  - Explorer server auto-discovers the next available port when the requested port is already in use
  - MCP server migrated from SSE (`GET /sse`) to Streamable HTTP (`POST /mcp`, `GET /mcp`, `DELETE /mcp`) per MCP spec 2025-03-26
  - Fix CLI entry point static imports so `run` is correctly resolved after tsup bundling

## 0.10.0

## 0.9.0

### Minor Changes

- [#24](https://github.com/mimicailab/mimic/pull/24) [`6ce4e0b`](https://github.com/mimicailab/mimic/commit/6ce4e0b8f331ee11866afe55be2bfb5c60a7981d) Thanks [@ajollie](https://github.com/ajollie)! - Generate facts post-expansion from actual data stats instead of regex-based enforcement. Facts are now LLM-generated from real expanded data (counts, distributions, aggregates), guaranteeing 100% accuracy by construction.

### Patch Changes

- [#24](https://github.com/mimicailab/mimic/pull/24) [`6ce4e0b`](https://github.com/mimicailab/mimic/commit/6ce4e0b8f331ee11866afe55be2bfb5c60a7981d) Thanks [@ajollie](https://github.com/ajollie)! - Fix `@updatedAt` fields incorrectly treated as having default values in Prisma schema parser.

## 0.7.0

### Minor Changes

- [#22](https://github.com/mimicailab/mimic/pull/22) [`e7e1160`](https://github.com/mimicailab/mimic/commit/e7e1160701e5925b9a8f3060477e8a02020aec74) Thanks [@ajollie](https://github.com/ajollie)! - feat: auto-scenario generation from fact manifest
  - Add fact manifest types (`Fact`, `FactManifest`, `MimicScenario`, `ScenarioTier`) and generate testable facts during blueprint creation
  - Add `ScenarioGenerator` that converts facts into test scenarios via a single batched LLM call
  - Add 6 exporters: mimic (native JSON), PromptFoo (YAML), Braintrust (JSONL + scorer), LangSmith (JSON + upload + evaluator), Inspect AI (Python task)
  - Add `--tier`, `--export`, and `--inspect` flags to `mimic test` CLI command
  - Add `auto_scenarios`, `scenario_tiers`, and `export` fields to test config schema
  - Write `.mimic/fact-manifest.json` during `mimic run` with aggregated facts from all personas
  - Add dedicated "Testing & Auto-Scenarios" documentation page with full pipeline guide

## 0.6.0

## 0.5.0

### Minor Changes

- [#18](https://github.com/mimicailab/mimic/pull/18) [`528fa14`](https://github.com/mimicailab/mimic/commit/528fa14dd1696fd00c39e645c500d18096b70b7d) Thanks [@ajollie](https://github.com/ajollie)! - ### feat(example): CFO agent with 8 billing platforms and chat UI

  End-to-end example demonstrating cross-surface data generation across 8 billing adapters (Stripe, Paddle, Chargebee, GoCardless, RevenueCat, Lemon Squeezy, Zuora, Recurly) and PostgreSQL.

  **Core changes:**
  - Enhanced blueprint expander with multi-surface data generation
  - Rewrote `mimic host` for multi-adapter MCP orchestration (per-adapter mock API + MCP SSE endpoints)
  - Implemented full RevenueCat mock API surface with tests

  **Example stack:**
  - LangGraph ReAct supervisor + 9 sub-agents via MCP (214 tools)
  - Next.js 16 chat UI with AI SDK v6 and GFM markdown rendering
  - Docker Compose PostgreSQL with Prisma migrations

## 0.4.0

### Minor Changes

- [#13](https://github.com/mimicailab/mimic/pull/13) [`2ee93d5`](https://github.com/mimicailab/mimic/commit/2ee93d546e4d71589a022332eaeed735aaea09dc) Thanks [@ajollie](https://github.com/ajollie)! - feat: add API mock adapter framework and unified MCP tool registration
  - Add `ApiMockAdapter` interface with optional `registerMcpTools()` method for
    exposing adapter tools through the unified MCP server
  - Add `registerExternalTools()` to `MimicMcpServer` allowing adapters to register
    tools alongside database tools in a single MCP connection
  - Support API-only mode in MimicMcpServer (optional schema/pool params)
  - Extend blueprint schema with `apiEntities` and `apiEntityArchetypes` for
    generating Stripe-compatible mock data (customers, subscriptions, invoices,
    payment intents, products, prices)
  - Add `@faker-js/faker` for realistic field generation in API entity expansion
  - Expand `BlueprintExpander` to handle API response generation from archetypes
    with support for recurring patterns, event-based generation, and field templates
  - Update LLM prompts to generate API entity definitions in blueprints

## 0.3.1

### Patch Changes

- [#10](https://github.com/mimicailab/mimic/pull/10) [`7eb52cd`](https://github.com/mimicailab/mimic/commit/7eb52cd539f27fa21f07967e7dacdc85cc389b59) Thanks [@ajollie](https://github.com/ajollie)! - Add README.md to all packages and update documentation to match actual codebase.

## 0.3.0

### Minor Changes

- [#4](https://github.com/mimicailab/mimic/pull/4) [`75cd325`](https://github.com/mimicailab/mimic/commit/75cd325329dfe1b032728f671e824e0ed4cacd98) Thanks [@ajollie](https://github.com/ajollie)! - Initial public release of Mimic — persona-driven synthetic data generation for AI agent testing.
  - Core engine with schema parsing (Prisma, SQL DDL, live PG), LLM-powered data generation, database seeding, MCP server, and test runner
  - CLI with init, run, seed, serve, test, inspect, and clean commands
  - Pre-built persona blueprints (young-professional, freelancer, college-student)
  - Adapter SDK for building custom API mock adapters
  - Database adapters: PostgreSQL, MySQL, MongoDB, SQLite
  - API mock adapters: Stripe, Plaid, Slack
