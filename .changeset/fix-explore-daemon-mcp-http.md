---
"@mimicai/cli": patch
"@mimicai/core": patch
"@mimicai/explorer": patch
---

Fix `mimic explore` blocking terminal and crashing on port conflict; migrate MCP transport to Streamable HTTP

- `mimic explore` now spawns a background daemon and returns immediately instead of blocking the terminal
- Explorer server auto-discovers the next available port when the requested port is already in use
- MCP server migrated from SSE (`GET /sse`) to Streamable HTTP (`POST /mcp`, `GET /mcp`, `DELETE /mcp`) per MCP spec 2025-03-26
- Fix CLI entry point static imports so `run` is correctly resolved after tsup bundling
