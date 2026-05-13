---
name: stripe-platform
description: Stripe specialist — core web subscriptions for Verida Analytics (~£77k MRR, ~61% of total). Sub-step inside cfo-briefing. Returns active subscription count, MRR (in pence), plan mix, and any flags relevant to the operator's question. Read-only.
---

# Stripe platform

**What this platform owns:** Verida Analytics' core web subscriptions — starter (£29/mo), pro (£79/mo), enterprise (£499/mo). Roughly 1,200 paying customers, ~£77k MRR, ~61% of total company MRR. The bulk of the business.

Sub-step inside `cfo-briefing`. Do not invoke standalone unless the operator explicitly asks "what's Stripe doing".

## Step 1 — Pull active subscriptions

Use `list_subscriptions` filtered to `status: active`. Paginate with `starting_after` until `has_more=false` — 1,200 customers comfortably exceeds the 100-row page cap.

For each subscription, capture:

- `customer` (Stripe customer ID + email if expanded)
- `amount` (subscription amount in **pence** — Stripe returns minor units)
- `interval` (`month` / `year`) — annual subscriptions contribute `amount / 12` to MRR
- `created` / `current_period_end`
- `metadata.plan` if set (`starter` / `pro` / `enterprise`)

## Step 2 — Compute MRR

Sum every active subscription's monthly-equivalent amount:

- `month` interval → `amount` as-is
- `year` interval → `amount / 12` (round to nearest pence)

Report the total as `mrr_pence`. Also break down by plan tier (`starter` / `pro` / `enterprise`) if the operator's question is about plan mix or upgrades.

## Step 3 — Surface findings relevant to the question

- **MRR / revenue question** → headline `mrr_pence` + customer count + plan mix.
- **Growth question** → compare current active-subscription MRR to the same query 30 days ago via `list_subscriptions` with the timestamp filter (or use `list_invoices` paid in the prior period). Compute `mom_pct`.
- **Churn question** → `list_subscriptions` with `status: canceled` in the last 30 days. Return count + lost MRR (sum of prior amounts).
- **Failed payments** → `list_payment_intents` with `status: requires_payment_method` in the last 7 days. Surface count + `total_at_risk_pence`.

## Output shape

All monetary fields in **pence** (integer). Prose conversion to pounds is the orchestrator's job.

```
platform: stripe
mrr_pence: 7720000
paying_customer_count: 1204
plan_breakdown:
  starter:    { customers: 612, mrr_pence: 1774800 }
  pro:        { customers: 489, mrr_pence: 3863100 }
  enterprise: { customers: 103, mrr_pence: 5139700 }   # note: total ≠ sum (illustrative)
mom_pct: 8.4
notes:
  - 3 enterprise subs renewed this week
  - 2 pro→enterprise upgrades
```

If the operator's question doesn't apply ("what about iOS subs?"), say so briefly and return the headline `mrr_pence` + customer count so the orchestrator can still aggregate.

## Rules

- **Read-only.** Never call `create_payment_intent`, `cancel_subscription`, `create_refund`, or any write tool. The CFO briefing is reporting only.
- **Paginate before reporting totals.** 1,200 customers is 13+ pages. A first-page total is wrong.
- **All `_pence` fields are integer pence.** £79.00 = `7900`, not `79`. Stripe already returns minor units — don't divide.
- **Annualised subs contribute monthly-equivalent.** A £948/year subscription is `7900` pence/month MRR, not `94800`.
- If `list_subscriptions` returns subs without an `amount` (free trials, $0 plans), exclude them from MRR but count them separately if the operator asked about trials.
