# @mimicai/adapter-gocardless

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

- [#18](https://github.com/mimicailab/mimic/pull/18) [`68de6c1`](https://github.com/mimicailab/mimic/commit/68de6c1a59938daa6e4d96277055703a9b5dae85) Thanks [@ajollie](https://github.com/ajollie)! - ### feat: add 6 billing platform mock adapters

  New API mock adapters for multi-platform billing scenarios:
  - **Paddle** — EU/international billing with 83 MCP tools, localisation support
  - **Chargebee** — Enterprise invoicing and contract management (55 endpoints)
  - **GoCardless** — UK direct debit with settlement lag simulation (45 endpoints)
  - **Lemon Squeezy** — Indie developer licenses and one-time purchases (50 endpoints)
  - **Zuora** — Enterprise usage-based billing contracts (54 endpoints)
  - **Recurly** — Legacy subscriber management and migration (47 endpoints)

  Each adapter includes full mock API routes, MCP tool registration, persona-aware data generation, and version-specific response formatting.

### Patch Changes

- Updated dependencies [[`528fa14`](https://github.com/mimicailab/mimic/commit/528fa14dd1696fd00c39e645c500d18096b70b7d)]:
  - @mimicai/core@0.5.0
  - @mimicai/adapter-sdk@0.5.0
