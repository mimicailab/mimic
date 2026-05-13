---
name: lemonsqueezy-platform
description: Lemon Squeezy specialist — individual developer and indie licenses for Verida Analytics. 534 license holders. Sub-step inside cfo-briefing. Read-only.
---

# Lemon Squeezy platform

**What this platform owns:** Verida's indie / individual-developer license sales — one-off and low-tier recurring licenses. ~534 license holders. Smaller per-seat ARPU than Stripe but high volume. Owns the long tail of self-serve revenue.

Sub-step inside `cfo-briefing`. Do not invoke standalone unless the operator names Lemon Squeezy or asks about indie/developer revenue.

## Step 1 — Pull licenses + orders

Use Lemon Squeezy's `list_subscriptions` (recurring) and `list_orders` (one-off). Paginate both until exhausted.

For subscriptions:
- `attributes.user_email`
- `attributes.subtotal` in **pence** (Lemon Squeezy uses minor units)
- `attributes.billing_anchor` / interval
- `attributes.status` (`active` / `cancelled` / `expired` / `paused`)

For orders (one-off purchases in the operator's window):
- `attributes.subtotal` in pence
- `attributes.created_at`

## Step 2 — Compute MRR + recent order volume

MRR: sum monthly-equivalent of `active` subscriptions.

Recent revenue: sum `subtotal` of orders in the last 30 days. This isn't MRR — it's bookings — so report it as `one_off_revenue_30d_pence`, not folded into the MRR figure.

## Step 3 — Surface findings relevant to the question

- **MRR / revenue** → `mrr_pence` (recurring) + `one_off_revenue_30d_pence` (bookings) + license-holder count.
- **License growth** → new active subscriptions in the last 30 days vs prior 30.
- **Churn** → `cancelled` + `expired` subscriptions in the window.

## Output shape

```
platform: lemonsqueezy
mrr_pence: 420000
paying_customer_count: 534
one_off_revenue_30d_pence: 184000
churn_30d:
  cancelled: 12
  expired:    7
notes:
  - Indie segment — separate from main paid plans; revenue reports often exclude these.
```

## Rules

- **Read-only.** No write tools.
- **`subtotal` is in pence** (Lemon Squeezy minor units). £4.99 = `499`.
- **Don't fold one-off orders into MRR** — bookings ≠ MRR. Keep `one_off_revenue_30d_pence` separate.
- **Paginate** — 534 licenses is 6+ pages.
- Annualised subscriptions contribute monthly-equivalent (`subtotal / 12`).
