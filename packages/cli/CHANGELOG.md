# @mimicailab/cli

## 0.10.0

### Patch Changes

- Updated dependencies []:
  - @mimicai/core@0.10.0
  - @mimicai/blueprints@0.10.0
  - @mimicai/adapter-postgres@0.10.0
  - @mimicai/adapter-mysql@0.10.0
  - @mimicai/adapter-mongodb@0.10.0
  - @mimicai/adapter-sqlite@0.10.0

## 0.9.0

### Minor Changes

- [#24](https://github.com/mimicailab/mimic/pull/24) [`6ce4e0b`](https://github.com/mimicailab/mimic/commit/6ce4e0b8f331ee11866afe55be2bfb5c60a7981d) Thanks [@ajollie](https://github.com/ajollie)! - Generate facts post-expansion from actual data stats instead of regex-based enforcement. Facts are now LLM-generated from real expanded data (counts, distributions, aggregates), guaranteeing 100% accuracy by construction.

### Patch Changes

- Updated dependencies [[`6ce4e0b`](https://github.com/mimicailab/mimic/commit/6ce4e0b8f331ee11866afe55be2bfb5c60a7981d), [`6ce4e0b`](https://github.com/mimicailab/mimic/commit/6ce4e0b8f331ee11866afe55be2bfb5c60a7981d)]:
  - @mimicai/core@0.9.0
  - @mimicai/adapter-mongodb@0.9.0
  - @mimicai/adapter-mysql@0.9.0
  - @mimicai/adapter-postgres@0.9.0
  - @mimicai/adapter-sqlite@0.9.0
  - @mimicai/blueprints@0.9.0

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

### Patch Changes

- Updated dependencies [[`e7e1160`](https://github.com/mimicailab/mimic/commit/e7e1160701e5925b9a8f3060477e8a02020aec74)]:
  - @mimicai/core@0.7.0
  - @mimicai/adapter-mongodb@0.7.0
  - @mimicai/adapter-mysql@0.7.0
  - @mimicai/adapter-postgres@0.7.0
  - @mimicai/adapter-sqlite@0.7.0
  - @mimicai/blueprints@0.7.0

## 0.6.0

### Minor Changes

- [#20](https://github.com/mimicailab/mimic/pull/20) [`c2b95f3`](https://github.com/mimicailab/mimic/commit/c2b95f3b0a32a7bd6f7a852cc8dddc1d901ce685) Thanks [@ajollie](https://github.com/ajollie)! - Add `mimic info` command for bug reports and fix dynamic version display
  - New `mimic info` command prints OS, Node, package manager, installed @mimicai/\* package versions, and config status
  - Supports `--json` flag for machine-readable output
  - `mimic --version` now reads from package.json instead of hardcoded value

### Patch Changes

- Updated dependencies []:
  - @mimicai/core@0.6.0
  - @mimicai/blueprints@0.6.0
  - @mimicai/adapter-postgres@0.6.0
  - @mimicai/adapter-mysql@0.6.0
  - @mimicai/adapter-mongodb@0.6.0
  - @mimicai/adapter-sqlite@0.6.0

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

### Patch Changes

- Updated dependencies [[`528fa14`](https://github.com/mimicailab/mimic/commit/528fa14dd1696fd00c39e645c500d18096b70b7d)]:
  - @mimicai/core@0.5.0
  - @mimicai/adapter-mongodb@0.5.0
  - @mimicai/adapter-mysql@0.5.0
  - @mimicai/adapter-postgres@0.5.0
  - @mimicai/adapter-sqlite@0.5.0
  - @mimicai/blueprints@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`2ee93d5`](https://github.com/mimicailab/mimic/commit/2ee93d546e4d71589a022332eaeed735aaea09dc)]:
  - @mimicai/core@0.4.0
  - @mimicai/adapter-mongodb@0.4.0
  - @mimicai/adapter-mysql@0.4.0
  - @mimicai/adapter-postgres@0.4.0
  - @mimicai/adapter-sqlite@0.4.0
  - @mimicai/blueprints@0.4.0

## 0.3.1

### Patch Changes

- [#10](https://github.com/mimicailab/mimic/pull/10) [`7eb52cd`](https://github.com/mimicailab/mimic/commit/7eb52cd539f27fa21f07967e7dacdc85cc389b59) Thanks [@ajollie](https://github.com/ajollie)! - Add README.md to all packages and update documentation to match actual codebase.

- Updated dependencies [[`7eb52cd`](https://github.com/mimicailab/mimic/commit/7eb52cd539f27fa21f07967e7dacdc85cc389b59)]:
  - @mimicai/core@0.3.1
  - @mimicai/blueprints@0.3.1
  - @mimicai/adapter-postgres@0.3.1
  - @mimicai/adapter-mysql@0.3.1
  - @mimicai/adapter-mongodb@0.3.1
  - @mimicai/adapter-sqlite@0.3.1

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
  - @mimicailab/blueprints@0.3.0
  - @mimicailab/adapter-postgres@0.3.0
  - @mimicailab/adapter-mysql@0.3.0
  - @mimicailab/adapter-mongodb@0.3.0
  - @mimicailab/adapter-sqlite@0.3.0
