---
"@mimicai/explorer": patch
---

Fix adapter resolution in explorer for non-monorepo projects by resolving from `@mimicai/cli` package location and walking up from `process.argv[1]`.
