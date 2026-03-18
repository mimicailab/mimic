# @mimicai/explorer

## 0.10.1

### Patch Changes

- [#139](https://github.com/mimicailab/mimic/pull/139) [`6f2d991`](https://github.com/mimicailab/mimic/commit/6f2d991d4def19db6b6b238620a081a7a694fd75) Thanks [@ajollie](https://github.com/ajollie)! - Fix `mimic explore` blocking terminal and crashing on port conflict; migrate MCP transport to Streamable HTTP
  - `mimic explore` now spawns a background daemon and returns immediately instead of blocking the terminal
  - Explorer server auto-discovers the next available port when the requested port is already in use
  - MCP server migrated from SSE (`GET /sse`) to Streamable HTTP (`POST /mcp`, `GET /mcp`, `DELETE /mcp`) per MCP spec 2025-03-26
  - Fix CLI entry point static imports so `run` is correctly resolved after tsup bundling

- Updated dependencies [[`6f2d991`](https://github.com/mimicailab/mimic/commit/6f2d991d4def19db6b6b238620a081a7a694fd75)]:
  - @mimicai/core@0.10.1

## 0.10.0

### Minor Changes

- [#29](https://github.com/mimicailab/mimic/pull/29) [`fc4208c`](https://github.com/mimicailab/mimic/commit/fc4208c667a7f8fd280f92e056397eecdb538199) Thanks [@ajollie](https://github.com/ajollie)! - Sync explorer version with all other packages in the fixed release group

### Patch Changes

- Updated dependencies []:
  - @mimicai/core@0.10.0

## 0.7.1

### Patch Changes

- [#24](https://github.com/mimicailab/mimic/pull/24) [`6ce4e0b`](https://github.com/mimicailab/mimic/commit/6ce4e0b8f331ee11866afe55be2bfb5c60a7981d) Thanks [@ajollie](https://github.com/ajollie)! - Fix adapter resolution in explorer for non-monorepo projects by resolving from `@mimicai/cli` package location and walking up from `process.argv[1]`.

- Updated dependencies [[`6ce4e0b`](https://github.com/mimicailab/mimic/commit/6ce4e0b8f331ee11866afe55be2bfb5c60a7981d), [`6ce4e0b`](https://github.com/mimicailab/mimic/commit/6ce4e0b8f331ee11866afe55be2bfb5c60a7981d)]:
  - @mimicai/core@0.9.0
