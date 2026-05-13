---
name: chargebee-platform
description: Chargebee specialist — enterprise invoicing and contract management for Verida Analytics (~£6k MRR, ~5% of total). Owns overdue AR — 3 invoices currently overdue totalling £12,400, oldest is 34 days. Sub-step inside cfo-briefing. Read-only.
---

# Chargebee platform

**What this platform owns:** Verida's enterprise invoicing and contract management — net-30 / net-60 invoices, multi-year contracts, manual renewals. ~28 enterprise customers, ~£6k MRR, ~5% of total. **The overdue invoices live here.** Currently 3 overdue totalling £12,400; oldest is 34 days past due.

Sub-step inside `cfo-briefing`. Always surface overdue-AR findings when the operator's question touches revenue, AR, or "what should I worry about".

## Step 1 — Pull active subscriptions + invoices

Use Chargebee's `list_subscriptions` filtered to `status: active`. In parallel, `list_invoices` for the operator's window (default 90 days).

Capture per subscription:

- `customer_id` + company name
- `plan_amount` in **pence**
- `billing_period_unit` (`month` / `year`)
- `next_billing_at`

Capture per invoice:

- `amount_due` and `amount_paid` in **pence**
- `due_date` and `status` (`paid` / `payment_due` / `not_paid` / `voided`)
- `days_overdue` = today − `due_date` if `status` ∈ `{payment_due, not_paid}`

## Step 2 — Compute MRR + AR position

MRR: sum active subscription monthly-equivalents.

Overdue AR: filter invoices to those with `status ∈ {payment_due, not_paid}` AND `due_date < today`. For each, record customer + amount_due_pence + days_overdue.

## Step 3 — Surface findings relevant to the question

- **MRR / revenue** → `mrr_pence` + customer count.
- **AR / overdue / "what should I worry about"** → `overdue_invoice_count`, `overdue_total_pence`, `oldest_overdue_days`, named list of overdue customers.
- **Renewals** → subscriptions with `next_billing_at` in the next 30 days, ordered by amount.

## Output shape

```
platform: chargebee
mrr_pence: 610000
paying_customer_count: 28
overdue:
  overdue_invoice_count: 3
  overdue_total_pence: 1240000
  oldest_overdue_days: 34
  invoices:
    - customer: Acme Holdings        amount_pence: 480000  days_overdue: 34
    - customer: Westwood Industries  amount_pence: 510000  days_overdue: 18
    - customer: Briar Logistics      amount_pence: 250000  days_overdue:  7
upcoming_renewals_30d: { count: 4, total_pence: 1980000 }
notes:
  - Oldest overdue (£4,800, 34 days) — escalation candidate
```

## Rules

- **Read-only.** No `create_invoice`, no `void_invoice`, no `send_dunning`.
- **`plan_amount` and `amount_due` are pence** in Chargebee's response. £4,800 = `480000`.
- **Paginate** — even 28 customers can produce 50+ invoices across 90 days.
- **Always surface overdue invoices** when the operator's question touches revenue health, even if they didn't ask explicitly. AR is the most actionable finding on this platform.
- An invoice is overdue only if `due_date < today` AND `status` is not `paid`/`voided`. Don't flag invoices that are merely awaiting payment within terms.
