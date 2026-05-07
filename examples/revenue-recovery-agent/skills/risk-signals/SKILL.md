---
name: risk-signals
description: Correlates affected customers (from churn-investigation, payment-failures, reconciliation) with internal risk_flags and support_notes to surface "we knew this was coming" findings. Promotes any customer with a relevant prior signal up one risk tier in the recovery plan.
---

# Risk signals

The goal is **find the cases where the cancellation or failed payment was already predicted by the team and ignored.** This is the skill that turns the recovery plan from "here's a list of write tools to call" into a finding the operator actually wants to know about — *we had three CSMs flag these accounts a month ago and nobody acted*.

This skill receives a candidate customer list from the orchestrator (the union of customers surfaced by `churn-investigation`, `payment-failures`, and `reconciliation`). For each, it looks up internal signals and decides whether to escalate the recovery action.

## Step 1: Pull risk_flags for the candidates

For each candidate `customer_id`, query Postgres `risk_flags`:

```
flag_type, severity, set_by, set_at, resolved_at, note
WHERE customer_id IN (...) AND set_at >= window_start - INTERVAL '60 days'
```

Match by lookback up to 60 days — risk flags set 4-8 weeks before a cancellation are exactly the "we knew" cases.

For each match, classify by `flag_type`:

- `billing_dispute` — strong correlation with voluntary churn or refund requests
- `churn_risk` — the CSM's general "this account is shaky" signal
- `support_escalation` — unresolved high-severity ticket
- `contract_concern` — pricing or terms concern raised
- `competitor_mentioned` — the AE or CSM logged a competitive threat

A flag that is `resolved_at != null` is *not* a current signal — note it but don't escalate on it.

## Step 2: Pull support_notes for the candidates

For each candidate `customer_id`, query Postgres `support_notes`:

```
author, body, tags, created_at
WHERE customer_id IN (...) AND created_at >= window_start - INTERVAL '30 days'
ORDER BY created_at DESC
```

Look for notes that match these themes:

- Billing complaints (price too high, unexpected charge, dispute)
- Downgrade requested or considered
- Competitor mentioned ("looking at X", "considering switching")
- Cancellation discussed
- Repeated failed payment / dunning frustration

For each matching note, take a one-sentence quote — verbatim if short enough, paraphrased if not.

## Step 3: Decide the escalation

For each candidate, the rule is simple:

- **Active risk_flag (any type, severity ≥ medium, not resolved) within 60 days of the affected event** → promote risk tier up one level. A routine `retry_payment` (low) becomes a `retry_payment + escalate_csm note` (medium); a routine `escalate_csm` (medium) becomes high (do-not-auto-act).
- **Relevant support_note within 30 days** → same: promote one level. Even without a structured flag, a support note saying "considering competitor" is the signal.
- **Both** → promote one level (don't double-promote — the signal is the same human concern in two forms).

If neither exists, no change to the candidate's risk tier.

## Step 4: Emit the correlation

For every promoted candidate, emit a short evidence block. The orchestrator uses this verbatim in the recovery plan to explain the high-risk row.

```
correlations:
  - customer_id: 22
    name: Inkwell Co
    base_action: escalate_csm
    base_tier: medium
    promoted_to: high
    evidence:
      - risk_flag: billing_dispute (severity high) set 2026-04-18 by sarah@cumulus.io
        note: "April invoice questioned — feels overcharged after the renewal uplift."
      - support_note (2026-04-20, csm-mike): "Spoke to ops lead, said they're escalating internally before paying."
    summary: "Flagged 18 days ago, no resolution. Cancellation was predictable."

  - customer_id: 84
    name: Junction Audio
    base_action: escalate_csm
    base_tier: medium
    promoted_to: high
    evidence:
      - support_note (2026-04-15, csm-alex): "Considering competitor — said pricing was the deciding factor."
    summary: "Competitor mention 21 days before cancellation."

uncorrelated:
  - customer_ids: [12, 18, 47, 51]
    note: "No risk_flag or support_note in the lookback window."

totals:
  correlated_count: 2
  total_correlated_at_risk_cents: 99800   # sum of prior_mrr_cents for promoted customers
  uncorrelated_count: 4
```

## Rules

- **Read-only.** This skill only reads `risk_flags` and `support_notes`.
- **`total_correlated_at_risk_cents` is integer cents.** Each promoted customer contributes their `prior_mrr_cents` (the MRR they were paying before the affected event). Two enterprise customers at $499/mo each = `99800`, not `998`.
- **A resolved flag is not an active signal.** Mention it in the evidence for completeness but don't promote on it.
- **Don't fabricate a correlation.** If the only signal is "the customer has had support tickets" with no thematic match (billing/churn/competitor), that's not a correlation — emit them as uncorrelated.
- **Keep evidence quotes short.** One sentence per quote, verbatim where possible. The orchestrator may render this directly to the operator.
- The promoted tier is a *recommendation* — the orchestrator decides final tier. If the orchestrator's other inputs already place the customer at high risk, this skill's promotion is a no-op; the evidence still surfaces.
