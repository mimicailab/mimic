---
'@mimicai/core': minor
'@mimicai/cli': minor
---

Add a persona-conformance layer between LLM-driven generation and seeding. Five new pipeline phases work together to close the loop on narrative compliance — the persona's exact counts, amounts, dates, and enum constraints now flow as hard pins through generation, get validated against the schema before the run continues, and get checked against the seeded data after.

- **persona-constraints**: pre-pass LLM call extracts pinned numerics/dates from the persona text as imperative `PERSONA-PINNED REQUIREMENTS` instructions, scoped per adapter+resource. Injected into each per-resource distribution prompt so the LLM cannot miss "£4,800 overdue" or "every row status=active". Substates are framed as non-additive ("22 of 618 in retry", not 618 + 22).
- **mapping-derivation**: schema-mapping output extended with `copy | derive | constant` forms. Mirror flow applies derivations to compute destination values from API bodies (e.g. `users.plan` from `subscription.items.data[0].price.unit_amount`) instead of blind-copying values from a disjoint enum. Validator catches enum violations, unknown columns/resources, unresolved paths, and disjoint-enum copies; one retry with corrections injected before falling back.
- **conformance-checker**: extracts testable assertions from the persona, evaluates them deterministically against expanded data, and writes a per-persona report (pass/fail with expected/actual). Assertion validation catches path/null-filter mistakes and retries once.
- **envelope-splice** + **object-ref embed**: spec-driven phases that read Stripe-style list envelopes (`subscription.items.data`) and object-ref fields (`subscription_item.price`) from the existing `ResourceSpec` defaults and populate them from the matching sibling resources. No adapter changes — the spec already encoded the truth; the pipeline just respects it now. Both phases run BEFORE the mirror so derivations can read fully-formed nested data.
- **prompt + validator hardening**: `PINNED VALUES` and ENUM compliance rules added to distribution prompts. `DataValidator` counts enum violations and re-dedups after `fillMissingRequiredColumns` so multi-column unique constraints survive the fill pass.

On the cfo-agent-skills persona this lifts conformance from ~46% to ~69% pass on first run; the seeded Postgres landed 3,794 users exactly matching spec, all 4 plan/status enum values valid, all 8 billing platforms present.
