---
"@mimicai/cli": minor
---

Add `mimic info` command for bug reports and fix dynamic version display

- New `mimic info` command prints OS, Node, package manager, installed @mimicai/* package versions, and config status
- Supports `--json` flag for machine-readable output
- `mimic --version` now reads from package.json instead of hardcoded value
