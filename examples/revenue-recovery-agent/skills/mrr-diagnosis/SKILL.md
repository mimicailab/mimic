---
name: mrr-diagnosis
description: Quantifies the MRR delta for a window and decomposes it into involuntary churn, voluntary churn, downgrades, refunds, and expansion offset. Sub-step inside revenue-recovery — do not invoke standalone unless the operator explicitly asks for the diagnosis only.
---

# MRR diagnosis

The goal is **one headline number plus the five buckets that explain it**. Every other skill builds on the named customers in these buckets, so accuracy here matters more than narrative.

## Step 1: Establish the window

Default to the last 7 days. Use the operator's window if they specified one. Capture both as ISO dates so the rest of the pipeline can filter consistently:

- `window_start` = today − 7 days at 00:00 UTC
- `window_end` = today at 23:59 UTC

## Step 2: Compute the headline delta

Two sources, cross-checked:

- Postgres: sum of `customers.mrr_cents` where `status = 'active'`, computed as of `window_end` minus the same as of `window_start`. Use `get_subscriptions_summary` and `get_customers_summary` for the totals.
- Stripe: sum of active subscription amounts at both timestamps, via `list_subscriptions` filtered by status.

If the two diverge by more than 1%, the reconciliation skill will pick up the cause; for this skill, prefer the Postgres delta as the headline (that's what the operator's dashboard shows) and note the Stripe number alongside.

## Step 3: Decompose into five buckets

Each bucket must name customers, not just amounts. The orchestrator will hand the named lists to the next skills.

### Involuntary churn

Failed `payment_intents` in the window where the underlying subscription is still active in Stripe (not cancelled). Use Stripe's `list_payment_intents` filtered by status `requires_payment_method` or `canceled` with a failure code. Cross-reference with `get_payments` in Postgres for `status = 'failed'`.

Sum the at-risk MRR — for each failed charge, the customer's monthly subscription value, not the failed charge amount itself (a $99 monthly subscription that failed contributes $99 to the bucket regardless of whether the failed charge was monthly, annual, or partial).

### Voluntary churn

Customers who cancelled in the window. Two queries:

- Postgres: `subscriptions` rows where `canceled_at` is in the window and `status = 'canceled'`.
- Stripe: `list_subscriptions` filtered by `canceled_at` in the window.

The amount is the prior MRR — what these customers were paying before they cancelled.

### Downgrades

Customers whose plan changed to a cheaper tier in the window. Detect via subscription history — a `subscriptions` row with `status = 'canceled'` whose customer has a newer `subscriptions` row at a lower `amount_cents`, both within the window. The amount is `prior_amount − new_amount`.

If no subscription history table exists, fall back to `customers.plan` having changed to a cheaper tier, but flag this as approximate.

### Refunds

Refunds issued in the window. Use Stripe's refund records (visible via `list_invoices` with refunded status, or whatever refund-listing tool the adapter exposes). The amount is the refunded sum.

### Expansion offset

Anyone who upgraded to a more expensive plan, or new customers added in the window. Subtract this from the gross drop to get the net delta. Use `get_subscriptions_summary` filtered by `created_at` in the window for new subscriptions, and detect upgrades the same way as downgrades but in reverse.

## Step 4: Reconcile

The five buckets must sum to the headline delta within rounding. If they don't:

- The miss is usually downgrades (subscription history is the trickiest to query) or expansion (easy to forget). Re-check.
- If the miss is > 1% after re-checking, surface it: `unexplained delta: $XXX — investigation incomplete`. Better to flag than to fudge.

## Output shape

All amounts in **cents** in structured fields. The orchestrator's "Output format conventions" section is authoritative — follow it strictly.

```
window: 2026-04-29 → 2026-05-06 (7d)
total_mrr_delta_cents: -482000
delta_postgres_cents: -482000
delta_stripe_cents:   -482000
reconciled: true
bucket_breakdown_cents:
  involuntary_churn: -194000
  voluntary_churn:   -118000
  downgrades:        -150000
  refunds:            -20000
  expansion:               0
affected_customers:
  involuntary_churn: { count: 8, ids: [12, 34, 47, 51, 58, 63, 71, 89] }
  voluntary_churn:   { count: 2, ids: [22, 84] }
  downgrades:        { count: 3, ids: [9, 18, 41] }
  refunds:           { count: 1, ids: [55] }
  expansion:         { count: 0, ids: [] }
sum_check_cents: -482000   # must equal total_mrr_delta_cents
```

For any operator-facing prose summary that accompanies this structured output, format the same numbers in dollars (e.g. "MRR delta: -$4,820 across 14 customers"). Prose is dollars; structured fields are cents — never the other way around.

## Pagination

When totalling across `list_subscriptions`, `list_invoices`, `list_payment_intents`, `list_charges`, or any other Stripe list tool, **paginate to completion** (`starting_after` until `has_more=false`) before computing bucket cents. A 100-row first-page total is wrong for any persona with more activity than that.

For Postgres, prefer `get_*_summary` over `get_*` row enumeration when computing totals — the summary tool returns the aggregate in one call and is authoritative.

## Rules

- **Read-only.** This skill never writes.
- Always emit customer IDs alongside the bucket — downstream skills need them.
- **All numeric amounts internally and in structured output are in cents (integer).** Convert to dollars only for prose. `-$4,820` is `-482000` in any `*_cents` field. Multiply dollars by 100; never divide cents by 100 inside a `_cents` field.
- If the Postgres↔Stripe headline disagreement is > 1%, do not silently pick one — emit both `delta_postgres_cents` and `delta_stripe_cents` and let `reconciliation` figure out why.
- If the buckets don't sum to the headline, say so explicitly. Never round it away. The `sum_check_cents` field must equal `total_mrr_delta_cents` exactly, or the response must include `unexplained_delta_cents: <amount>` with the residual.
