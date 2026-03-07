---
"@mimicai/core": minor
"@mimicai/cli": minor
"@mimicai/docs": minor
---

feat: auto-scenario generation from fact manifest

- Add fact manifest types (`Fact`, `FactManifest`, `MimicScenario`, `ScenarioTier`) and generate testable facts during blueprint creation
- Add `ScenarioGenerator` that converts facts into test scenarios via a single batched LLM call
- Add 6 exporters: mimic (native JSON), PromptFoo (YAML), Braintrust (JSONL + scorer), LangSmith (JSON + upload + evaluator), Inspect AI (Python task)
- Add `--tier`, `--export`, and `--inspect` flags to `mimic test` CLI command
- Add `auto_scenarios`, `scenario_tiers`, and `export` fields to test config schema
- Write `.mimic/fact-manifest.json` during `mimic run` with aggregated facts from all personas
- Add dedicated "Testing & Auto-Scenarios" documentation page with full pipeline guide
