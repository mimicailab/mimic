# @mimicailab/cli

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
