---
name: payment-failures
description: Pulls failed payment_intents from Stripe in the window, ranks retry candidates by success probability based on decline reason, and surfaces patterns (BIN clusters, expiry waves, single-bank declines). Sub-step inside revenue-recovery.
---

# Payment failures

The goal is **a ranked list of failed charges and a clear answer to "which of these will retry successfully?"** — plus any cross-customer pattern that's a finding in itself.

## Step 1: Pull failed payment intents

From Stripe: `list_payment_intents` filtered to status `requires_payment_method` (the charge failed and Stripe is waiting for a new method) plus `canceled` payment intents with a `last_payment_error` set, restricted to the window.

In parallel from Postgres: `get_payments` filtered by `status = 'failed'` and `created_at` in the window. Cross-reference by `stripe_payment_intent_id`.

For each failed charge capture:

- Customer ID and name
- Amount (cents)
- Decline reason — Stripe's `last_payment_error.decline_code` is the reliable field; `last_payment_error.code` is the wrapping error type
- Card metadata if exposed: brand, last4, exp_month, exp_year, BIN (first 6 digits)
- Original timestamp

## Step 2: Rank by retry-success probability

This is the skill's headline output. Use these decline-reason buckets:

| Decline reason | Retry probability | Recommended action |
|---|---|---|
| `insufficient_funds` | high (60-70%) | retry_payment after 24h |
| `card_declined` (generic) | medium (30-50%) | retry_payment with smart-retry |
| `processing_error` | high (70-80%) | retry_payment immediately |
| `expired_card` | none — won't retry | send_dunning to collect new card |
| `incorrect_cvc` | none — won't retry | send_dunning |
| `lost_card` | none — DO NOT retry | escalate_csm — possible fraud signal |
| `stolen_card` | none — DO NOT retry | escalate_csm — fraud signal |
| `fraudulent` | none — DO NOT retry | escalate_csm |
| `pickup_card` | none — DO NOT retry | escalate_csm |

Rank the retryable rows by `amount × probability` so the operator sees the highest-recovery opportunities first.

## Step 3: Detect cross-customer patterns

After ranking individually, look for clusters that change the recommendation:

### BIN concentration

Group failed charges by card BIN (first 6 digits). If 3+ failed charges in the window share a BIN with a generic `card_declined` reason, it's likely a single-bank decline event — retrying immediately is the wrong call. Note the BIN and recommend `retry_payment after 24-48h` instead, on the assumption the bank's transient block will lift.

### Expiry waves

Group by `exp_month` + `exp_year`. If 4+ cards expired in the same calendar month and you're seeing `expired_card` declines, that's a dunning campaign opportunity, not individual retries.

### Single-customer repeats

If one customer has 2+ failed charges in the window with the same decline reason, retrying again is unlikely to work — flag as `escalate_csm`.

## Step 4: Tag each row with a recovery action and risk tier

Per row:

- `retry_payment` (low risk) — retryable decline reasons with no concerning pattern.
- `send_dunning` (medium risk) — `expired_card` or `incorrect_cvc`. Triggers Stripe's dunning flow which collects a new card via hosted checkout.
- `escalate_csm` (high risk) — fraud signals, or repeat failures from the same customer.

If the customer also appears in `risk-signals` with a billing-related flag, promote them up one tier.

## Pagination

`list_payment_intents` caps at **100 records per call**. A high-failure week (holiday weekend, BIN-block event) can easily exceed this. Iterate with `starting_after` until `has_more` is `false` before computing `total_at_risk_cents` or producing rankings — a ranked list built from the first page only will silently undercount. Same applies to `list_charges` if you reach for it.

If pagination genuinely fails, report the partial total and flag it explicitly: `total_at_risk_cents: 194000 (partial — page 1 of N+, paginate to confirm)`.

## Output shape

All amounts in **cents** in structured fields. Dollar formatting (`$X.XX`) is for prose only — see the orchestrator's "Output format conventions" section.

```
total_failed: 8
total_at_risk_cents: 194000

ranked_for_retry:
  - customer: Acme Logistics (id 12)
    amount_cents: 40000
    decline: insufficient_funds
    retry_probability: high
    recommended: retry_payment
    risk_tier: low
  - customer: Coral Outfitters (id 47)
    amount: $499
    decline: insufficient_funds
    retry_probability: high
    recommended: retry_payment
    risk_tier: low
  ...

dunning_required:
  - customer: Fabric & Stone (id 51)
    amount_cents: 9900
    decline: expired_card
    card: visa **** 4242 exp 04/26
    recommended: send_dunning
    risk_tier: medium
  ...

patterns:
  expiry_wave: 3 cards expired April 2026 — dunning batch eligible
  bin_concentration: none

do_not_retry:
  - customer: <name>
    decline: lost_card
    recommended: escalate_csm
    risk_tier: high
```

## Rules

- **Read-only.** Never call `create_payment_intent`, `confirm_payment_intent`, or any write tool here. The orchestrator handles execution if approved.
- Never recommend retrying a `lost_card` / `stolen_card` / `fraudulent` decline. These are operational signals, not transient failures.
- Decline reasons are the most important field — if Stripe doesn't expose `decline_code` for a row, fall back to `last_payment_error.message` and pattern-match conservatively.
- **All `*_cents` fields are integer cents.** $99 = `9900`, not `99`. The orchestrator's "Output format conventions" section is authoritative; this skill must comply.
- **Paginate before reporting totals.** A `total_at_risk_cents` computed from one page of 100 results when `has_more=true` is wrong. Either iterate, or label the value as partial.
