---
name: paddle-platform
description: Paddle specialist — EU and international subscriptions for Verida Analytics (~£28k MRR, ~22% of total). Strong German localisation, +31% MoM EU growth. Sub-step inside cfo-briefing. Read-only.
---

# Paddle platform

**What this platform owns:** Verida's EU and international web subscriptions. ~412 customers, ~£28k MRR, ~22% of total. Strong DE/EU presence — Paddle handles VAT MOSS so the bulk of European billing flows through it. Currently +31% MoM in the EU segment.

Sub-step inside `cfo-briefing`. Do not invoke standalone unless the operator names Paddle.

## Step 1 — Pull active subscriptions

Use Paddle's `list_subscriptions` (or equivalent — `list_*` tools mirror Paddle's resources). Filter to `status: active`. Paginate until `has_more=false`.

Capture per subscription:

- Customer email + country (Paddle's `address.country_code` is the segmentation field)
- `unit_price.amount` in **pence** (Paddle returns minor units, GBP base for this account)
- `billing_cycle.interval` (`month` / `year`)
- `next_billed_at`

## Step 2 — Compute MRR + EU breakdown

Sum active monthly-equivalents into `mrr_pence`. Then break down by country bucket:

- `germany` — `country_code = "DE"`
- `eu_other` — any other EU member state
- `uk` — `country_code = "GB"`
- `intl` — everything else

The German bucket is the growth driver and the operator usually wants it called out.

## Step 3 — Surface findings relevant to the question

- **MRR / revenue** → `mrr_pence` + customer count + country breakdown.
- **Growth** → `mom_pct` from comparing this month's active MRR to last month's. Surface the +31% EU figure if it materialises in the data.
- **VAT / tax** → Paddle is the merchant of record for EU sales; if the operator asks about VAT exposure, return the EU subscription total in pence and a customer count.
- **Refunds / chargebacks** → `list_adjustments` (Paddle's refund-equivalent) in the last 30 days.

## Output shape

```
platform: paddle
mrr_pence: 2810000
paying_customer_count: 412
country_breakdown:
  germany:  { customers: 187, mrr_pence: 1283000 }
  eu_other: { customers: 156, mrr_pence:  984000 }
  uk:       { customers:  42, mrr_pence:  298000 }
  intl:     { customers:  27, mrr_pence:  245000 }
mom_pct: 31.2          # EU segment specifically — note in prose
notes:
  - German segment +31% MoM (driver of overall Paddle growth)
```

## Rules

- **Read-only.** No write tools on this skill.
- **Paddle returns minor units in `unit_price.amount`.** £79.00 = `7900`. Don't double-convert.
- **Paginate** — 412 customers is 5 pages.
- **Annualised plans** contribute monthly-equivalent to MRR (`amount / 12`).
- If the operator asks for a metric Paddle doesn't expose (e.g. fine-grained churn cohorts), say so briefly rather than fabricating.
