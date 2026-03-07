# @mimicai/adapter-revenuecat

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
  - @mimicai/adapter-sdk@0.5.0
