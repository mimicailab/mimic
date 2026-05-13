---
name: recurly-platform
description: Recurly specialist — legacy long-term subscribers migrated from an old billing platform for Verida Analytics. 47 subscribers, low growth, stable revenue. Sub-step inside cfo-briefing. Read-only.
---

# Recurly platform

**What this platform owns:** Verida's legacy subscribers — 47 long-term customers migrated from an old billing platform years ago and never moved to Stripe. Stable, low-churn, low-growth tail. Important to surface because they pay reliably but are easy to forget.

Sub-step inside `cfo-briefing`. Always include even when small — silent omission of a platform is worse than a small line item.

## Step 1 — Pull active subscriptions

Use Recurly's `list_subscriptions` filtered to `state: active`. Should fit in a single page.

Capture per subscription:

- `account.email` + company name if present
- `unit_amount` in **pence** (Recurly minor units, GBP)
- `interval_unit` + `interval_length`
- `current_period_started_at` / `current_period_ends_at`
- `activated_at` (often years ago — legacy)

## Step 2 — Compute MRR

Sum monthly-equivalent of active subscriptions. Annualised plans contribute `unit_amount / 12`.

## Step 3 — Surface findings relevant to the question

- **MRR / revenue** → `mrr_pence` + subscriber count.
- **Churn / tenure** → average `activated_at` age (these are long-tenure customers). Surface any cancellation in the last 90 days as notable — Recurly churn is rare.
- **Plan / pricing drift** → legacy customers often pay grandfathered rates. If `unit_amount` is materially below the current Stripe equivalent, flag as `legacy_rate`.

## Output shape

```
platform: recurly
mrr_pence: 210000
paying_customer_count: 47
median_tenure_years: 4.8
churn_90d: 0
notes:
  - 12 customers on grandfathered pricing below current Stripe equivalent.
  - Zero cancellations in last 90 days.
```

## Rules

- **Read-only.** No write tools.
- **`unit_amount` is pence.** Don't divide.
- **Always include the platform in the answer** even though small — operator awareness of the legacy tail matters.
- Annualised legacy plans contribute monthly-equivalent (`unit_amount / 12`).
