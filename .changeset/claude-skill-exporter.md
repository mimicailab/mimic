---
'@mimicai/core': minor
'@mimicai/cli': minor
---

Add `claude-skill` test exporter. `mimic test --export claude-skill` writes a `mimic-eval` Claude Skill (`SKILL.md`) under `.mimic/exports/skills/mimic-eval/` and installs a copy into the project's `skills/` directory so Claude Code picks it up automatically. The skill loads `mimic-scenarios.json`, fans out one sub-agent per scenario, scores responses with a hybrid (strict substring + LLM-judge paraphrase + numeric range) check, and prints a scored markdown report. Configure the target skill via the new `test.target_skill` field in `mimic.json`. Existing `skills/mimic-eval/SKILL.md` files are preserved by default; pass `--force-install-skill` to overwrite.
