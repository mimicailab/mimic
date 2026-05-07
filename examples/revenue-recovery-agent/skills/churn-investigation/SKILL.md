---
name: churn-investigation
description: Identifies cancelled and downgraded customers in the window, with prior MRR, current MRR, delta, and reasons pulled from Stripe cancellation_details and Postgres support_notes. Sub-step inside revenue-recovery.
---

# Churn investigation

The goal is **a named list of customers who left or shrank, with the human reason where one exists**. Numbers are the floor; reasons are what make the recovery plan actionable.

## Step 1: Pull the cancellations

From Postgres: `subscriptions` rows where `canceled_at` is in the window and `status = 'canceled'`. Join to `customers` for name, email, prior plan, prior `mrr_cents`.

In parallel from Stripe: `list_subscriptions` filtered by `status = 'canceled'` with `canceled_at` in the window. Capture `cancellation_details.reason` if present (Stripe values: `cancellation_requested`, `payment_disputed`, `payment_failed`, `customer_service`, `low_quality`, `missing_features`, `switched_service`, `too_complex`, `too_expensive`, `unused`).

Match the two lists by `stripe_subscription_id`. If a row exists in only one source, treat it as a `reconciliation` finding and pass it through — don't drop it.

## Step 2: Pull the downgrades

From Postgres: pairs of `subscriptions` rows for the same `customer_id` where the older row was cancelled in the window and the newer row was created in the window at a lower `amount_cents`. The downgrade amount is `prior_amount − new_amount`.

If `customers.plan` has changed but no matching `subscriptions` history exists, treat it as approximate and note it.

## Step 3: Enrich with internal context

For every cancelled or downgraded customer, query `support_notes` for that `customer_id` in the last 30 days (not just the window — the conversation that led to the cancellation usually pre-dates it). Look for:

- Notes tagged `billing` (price complaints)
- Notes tagged `downgrade` or `churn-risk`
- Notes mentioning a competitor name or "considering"
- The most recent CSM check-in note, regardless of tag

Quote the most informative note verbatim — one sentence is enough. The orchestrator will surface this on the plan row.

## Step 4: Tag each customer with a recovery action

Per row, recommend one of:

- `escalate_csm` — voluntary cancellation, especially with a `risk-signals` correlation. The agent shouldn't try to win them back via tooling; a human conversation is the action.
- `no_action` — clean voluntary cancellation with `cancellation_requested`, no internal flags. Recovery isn't realistic.
- `downgrade_review` — for downgrades only. Note the old/new plan and amount. Operator may want to follow up with the CSM.
- `cancel` — only if the cancellation needs to be propagated to Stripe (i.e. Postgres cancelled but Stripe still active). This is a write proposal, not a recovery.

## Output shape

All amounts in **cents** in structured fields. Comply with the orchestrator's "Output format conventions".

```
cancellations:
  - customer_id: 22
    name: Inkwell Co
    prior_plan: enterprise
    prior_mrr_cents: 49900
    canceled_at: 2026-05-02
    stripe_reason: customer_service
    support_note (2026-04-14): "Billing dispute over April invoice — feels overcharged."
    recommended_action: escalate_csm
    risk_tier: high
  - customer_id: 84
    name: Junction Audio
    prior_plan: enterprise
    prior_mrr_cents: 49900
    canceled_at: 2026-05-04
    stripe_reason: switched_service
    support_note (2026-04-15): "Considering competitor — said pricing was the deciding factor."
    recommended_action: escalate_csm
    risk_tier: high

downgrades:
  - customer_id: 9
    name: Stoneworks LLC
    prior_plan: enterprise → pro
    prior_mrr_cents: 49900
    new_mrr_cents:    9900
    delta_cents:    -40000
    detected_at: 2026-05-01
    support_note: none in window
    recommended_action: downgrade_review
    risk_tier: medium

totals:
  cancellation_count: 2
  total_cancelled_mrr_cents: 99800
  downgrade_count: 1
  total_downgrade_delta_cents: -40000
```

## Rules

- **Read-only.** Never call cancel/refund/update tools.
- **All `*_cents` fields are integer cents.** $499 = `49900`, not `499`. The orchestrator's output-format section is authoritative.
- If both Stripe and Postgres show the cancellation, use Stripe's `cancellation_reason` as more recent. If only Postgres has it, use Postgres.
- If a customer is in both this skill's output and `payment-failures` (cancelled because of repeated failed charges), let the orchestrator de-duplicate — emit them in both.
- Don't infer reasons. If `cancellation_reason` is null and there's no relevant `support_note`, emit `reason: unknown`. Better than guessing.
