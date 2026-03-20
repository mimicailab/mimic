# @mimicailab/core

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
