---
"@mimicai/cli": patch
---

fix(cli): always use HTTP transport for `mimic host` so it can run in the background

- `mimic host` now uses Streamable HTTP transport for all server counts instead of falling back to stdio for single-server setups, which blocked on stdin
- Use `workspace:*` protocol for example dependencies to avoid referencing unpublished versions
- Document `mimic explore` command in CLI reference
