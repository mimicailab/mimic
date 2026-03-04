# @mimicailab/core

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
