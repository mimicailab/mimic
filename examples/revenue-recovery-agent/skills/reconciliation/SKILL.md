---
name: reconciliation
description: Compares every customer present in both Postgres and Stripe and surfaces drift — status mismatches, mrr_cents disagreements, orphans, and refunds in Stripe not reflected in payments. Sub-step inside revenue-recovery.
---

# Reconciliation

The goal is **find the cases where Postgres and Stripe disagree, and tell the operator which is right.** This is the skill that surfaces the bug nobody noticed — the customer who cancelled in Stripe 9 days ago and is still showing as active MRR in the founder's dashboard.

Stripe is the source of truth for billing state. Postgres is the source of truth for everything operational (CSM relationships, support history). When they disagree on billing, Stripe wins.

## Step 1: List both sides

In parallel:

- Postgres: `get_customers` for every customer with a non-null `stripe_customer_id`. Capture id, name, status, mrr_cents, plan, stripe_customer_id.
- Stripe: `list_customers` to enumerate everyone in Stripe. Capture id, email, metadata, current subscription state (call `list_subscriptions` per customer or in batch if the adapter supports it).

## Step 2: Detect each drift class

Run all four checks. Each yields its own findings list — emit them separately so the orchestrator can render them grouped.

### A. Status mismatch

For every customer matched on `stripe_customer_id`, compare:

- Postgres `customers.status = 'active'` AND Stripe subscription `status in ('canceled', 'incomplete_expired')`
- Postgres `subscriptions.status = 'active'` AND Stripe subscription cancelled

Either is a drift. Stripe is correct; Postgres lagged. Note the days-since-cancellation in Stripe — that's the "ghost MRR" duration.

### B. Amount mismatch

For each matched customer, compute Stripe's active-subscription MRR (sum of monthly-equivalent amounts) and compare to Postgres `customers.mrr_cents`. If they differ by more than $1 (rounding tolerance), flag it. This usually means a plan change happened in Stripe (upgrade or downgrade) and Postgres didn't update.

### C. Orphans

- **Stripe orphans**: a `stripe_customer_id` exists in Stripe but no matching Postgres customer row. These are ghosts — likely from a botched import or a Stripe-direct signup that never got synced.
- **Postgres orphans**: a Postgres customer with `stripe_customer_id != null` whose Stripe customer no longer exists (deleted in Stripe). Rare but possible.

Both are findings; orphans are usually a reconciliation write rather than a recovery action.

### D. Refund drift

For each refund visible in Stripe (via `list_invoices` with refunded status, or whatever refund-listing the adapter exposes), check that a matching Postgres `payments` row exists with `status = 'refunded'`. If not, the operator's reporting is overstating revenue.

## Step 3: Recommend the reconciliation action per finding

Per row:

- **A. Status mismatch**: `reconcile` — propose updating Postgres `customers.status` to match Stripe, set `subscriptions.canceled_at` and `status = 'canceled'`, recompute `mrr_cents`. **This is a Postgres write only — Stripe is already correct.** Risk tier: medium (it's a reporting fix, not a money movement).
- **B. Amount mismatch**: `reconcile` — propose updating Postgres `mrr_cents` and the `subscriptions.amount_cents` to match Stripe's active subscription. Medium risk.
- **C. Stripe orphan**: `investigate` — do not auto-create a Postgres row. The operator needs to decide whether the customer should be in Postgres at all. High risk.
- **D. Refund drift**: `reconcile` — propose adding a Postgres `payments` row with `status = 'refunded'`, matching the Stripe refund amount and timestamp. Medium risk.

## Step 4: Compute the reporting impact

Sum the "ghost MRR" — Postgres-says-active-but-Stripe-cancelled customers' `mrr_cents`. This is the dashboard correction the operator will care about most. Surface as a single headline number.

## Output shape

All amounts in **cents** in structured fields. Comply with the orchestrator's "Output format conventions".

```
status_mismatches:
  - customer_id: 41
    name: Larkspur Inc
    postgres_status: active
    postgres_mrr_cents: 9900
    stripe_status: canceled
    stripe_canceled_at: 2026-04-27
    days_drift: 9
    revenue_at_risk_cents: 9900
    recommended_action: reconcile (Postgres write)
    risk_tier: medium

amount_mismatches:
  - customer_id: 18
    name: Brightpath Studios
    postgres_mrr_cents: 49900
    stripe_mrr_cents:    9900
    delta_cents:       -40000
    cause: downgraded in Stripe, Postgres not updated
    recommended_action: reconcile (Postgres write)
    risk_tier: medium

orphans:
  stripe_only:
    - stripe_customer_id: cus_abc123
      email: someone@orphan.example
      created_at: 2026-04-08
      recommended_action: investigate
      risk_tier: high
  postgres_only: []

refund_drift: []

reporting_impact_cents:
  ghost_mrr_cents: 9900            # postgres-active-stripe-cancelled total
  ghost_mrr_count: 1
  unrecorded_downgrade_cents: 40000
  unrecorded_downgrade_count: 1
  total_dashboard_correction_cents: 49900
```

## Pagination

`list_customers`, `list_subscriptions`, `list_invoices` on the Stripe side cap at **100 records per call**. Reconciliation must enumerate the full universe on both sides — paginate to completion before computing drift counts. A reconciliation built on the first page only will report a fraction of the actual drift.

For Postgres, prefer `get_customers_summary` and `get_subscriptions_summary` for headline counts; use the row-level tools for the per-customer enumeration.

## Rules

- **Read-only when discovering, write-proposing in output.** This skill never executes the reconcile actions itself — the orchestrator does, in Phase 2, after approval.
- **All `*_cents` fields are integer cents.** $99 = `9900`, not `99`. Authoritative section is in the orchestrator skill.
- **Stripe is the source of truth.** When in doubt, propose the Postgres update, not the reverse.
- Never propose creating a Postgres row from a Stripe orphan automatically. Orphans need investigation, not auto-sync.
- If the reconciliation action is a Postgres-only write (no Stripe state change), label it as such — the orchestrator's risk tiering treats it as medium, not high, even though it's still a write.
- **Tolerance for amount mismatches is 100 cents ($1).** Below that, treat as rounding.
