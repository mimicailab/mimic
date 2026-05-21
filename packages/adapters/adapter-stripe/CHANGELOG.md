# @mimicailab/adapter-stripe

## 0.13.1

### Patch Changes

- Updated dependencies [[`3064c42`](https://github.com/mimicailab/mimic/commit/3064c423efd339fe2aaa839832a69c02311e89f0)]:
  - @mimicai/core@0.14.0
  - @mimicai/adapter-sdk@0.14.0

## 0.13.0

### Minor Changes

- [`3179d34`](https://github.com/mimicailab/mimic/commit/3179d341db47d8c0587d7657729daa9596c1ff18) Thanks [@ada-raj](https://github.com/ada-raj)! - Stripe MCP `list_*` tools now auto-paginate across pages. Previously every `list_*` tool returned only the first page (10 records by default, max 100), with no `starting_after` cursor exposed — totals above the page cap were silently truncated, so eval scenarios asking the agent for accurate counts of subscriptions, invoices, payments, refunds, payouts, or disputes hit wrong-by-pagination failures.

  By default each `list_*` tool now walks pages of 100 internally until `has_more === false`, up to a 1000-record safety cap, and reports the true total in the response. Callers that genuinely want single-page semantics can opt in by passing `limit` or `starting_after` explicitly — those parameters are now exposed on every `list_*` tool and on the generic `fetch_stripe_resources` listing path. When auto-pagination hits the 1000-record cap, the response signals it (`(N+)` count, "pass starting_after to continue") so the agent can resume.

  Affected tools: `list_coupons`, `list_customers`, `list_disputes`, `list_invoices`, `list_payment_intents`, `list_prices`, `list_products`, `list_subscriptions`, `search_stripe_resources`, `fetch_stripe_resources`.

### Patch Changes

- Updated dependencies [[`014be6a`](https://github.com/mimicailab/mimic/commit/014be6a23ad9fb99de9845cbe6c32391ea51bdca)]:
  - @mimicai/core@0.13.0
  - @mimicai/adapter-sdk@0.13.0

## 0.12.1

### Patch Changes

- Updated dependencies [[`47ae6fe`](https://github.com/mimicailab/mimic/commit/47ae6fef913c8b7881038911434d2c1c01093519)]:
  - @mimicai/adapter-sdk@0.12.1
  - @mimicai/core@0.12.1

## 0.11.1

### Patch Changes

- Updated dependencies []:
  - @mimicai/core@0.11.1
  - @mimicai/adapter-sdk@0.11.1

## 0.11.0

### Patch Changes

- Updated dependencies [[`0615532`](https://github.com/mimicailab/mimic/commit/061553211702722945c9f52034736e6d9fd16247)]:
  - @mimicai/core@0.11.0
  - @mimicai/adapter-sdk@0.11.0

## 0.10.2

### Patch Changes

- Updated dependencies []:
  - @mimicai/core@0.10.2
  - @mimicai/adapter-sdk@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies [[`6f2d991`](https://github.com/mimicailab/mimic/commit/6f2d991d4def19db6b6b238620a081a7a694fd75)]:
  - @mimicai/core@0.10.1
  - @mimicai/adapter-sdk@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies []:
  - @mimicai/core@0.10.0
  - @mimicai/adapter-sdk@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [[`6ce4e0b`](https://github.com/mimicailab/mimic/commit/6ce4e0b8f331ee11866afe55be2bfb5c60a7981d), [`6ce4e0b`](https://github.com/mimicailab/mimic/commit/6ce4e0b8f331ee11866afe55be2bfb5c60a7981d)]:
  - @mimicai/core@0.9.0
  - @mimicai/adapter-sdk@0.9.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`e7e1160`](https://github.com/mimicailab/mimic/commit/e7e1160701e5925b9a8f3060477e8a02020aec74)]:
  - @mimicai/core@0.7.0
  - @mimicai/adapter-sdk@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies []:
  - @mimicai/core@0.6.0
  - @mimicai/adapter-sdk@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`528fa14`](https://github.com/mimicailab/mimic/commit/528fa14dd1696fd00c39e645c500d18096b70b7d)]:
  - @mimicai/core@0.5.0
  - @mimicai/adapter-sdk@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`2ee93d5`](https://github.com/mimicailab/mimic/commit/2ee93d546e4d71589a022332eaeed735aaea09dc)]:
  - @mimicai/core@0.4.0
  - @mimicai/adapter-sdk@0.4.0

## 0.3.1

### Patch Changes

- [#10](https://github.com/mimicailab/mimic/pull/10) [`7eb52cd`](https://github.com/mimicailab/mimic/commit/7eb52cd539f27fa21f07967e7dacdc85cc389b59) Thanks [@ajollie](https://github.com/ajollie)! - Add README.md to all packages and update documentation to match actual codebase.

- Updated dependencies [[`7eb52cd`](https://github.com/mimicailab/mimic/commit/7eb52cd539f27fa21f07967e7dacdc85cc389b59)]:
  - @mimicai/core@0.3.1
  - @mimicai/adapter-sdk@0.3.1

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
  - @mimicailab/adapter-sdk@0.3.0
