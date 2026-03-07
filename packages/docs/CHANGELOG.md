# @mimicai/docs

## 0.3.0

### Minor Changes

- [#22](https://github.com/mimicailab/mimic/pull/22) [`e7e1160`](https://github.com/mimicailab/mimic/commit/e7e1160701e5925b9a8f3060477e8a02020aec74) Thanks [@ajollie](https://github.com/ajollie)! - feat: auto-scenario generation from fact manifest
  - Add fact manifest types (`Fact`, `FactManifest`, `MimicScenario`, `ScenarioTier`) and generate testable facts during blueprint creation
  - Add `ScenarioGenerator` that converts facts into test scenarios via a single batched LLM call
  - Add 6 exporters: mimic (native JSON), PromptFoo (YAML), Braintrust (JSONL + scorer), LangSmith (JSON + upload + evaluator), Inspect AI (Python task)
  - Add `--tier`, `--export`, and `--inspect` flags to `mimic test` CLI command
  - Add `auto_scenarios`, `scenario_tiers`, and `export` fields to test config schema
  - Write `.mimic/fact-manifest.json` during `mimic run` with aggregated facts from all personas
  - Add dedicated "Testing & Auto-Scenarios" documentation page with full pipeline guide
