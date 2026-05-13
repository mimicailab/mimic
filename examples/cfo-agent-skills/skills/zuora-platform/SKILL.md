---
name: zuora-platform
description: Zuora specialist — large enterprise usage-based contracts for Verida Analytics. 3 active contracts, usage-based billing. Sub-step inside cfo-briefing. Read-only.
---

# Zuora platform

**What this platform owns:** Verida's largest enterprise contracts — usage-based billing on multi-year deals. Only **3 active contracts** but each is materially larger than any Stripe customer. Billing is consumption-priced (per-API-call or per-seat-tier) rather than flat monthly.

Sub-step inside `cfo-briefing`. Small contract count but high concentration risk — surface customer names when relevant.

## Step 1 — Pull active contracts + usage

Use Zuora's `list_subscriptions` (or `get_subscription` per known account). For each, capture:

- Account name (the enterprise customer)
- `term_start_date` / `term_end_date`
- Rate plan and pricing model — usage-based or tiered
- Current period's billed amount in **pence**

In parallel, `list_invoices` for the trailing 90 days to compute average monthly bookings per account.

## Step 2 — Compute trailing MRR

Usage-based MRR is **trailing**, not contracted:

- For each account, compute `mean(invoiced_amount_pence)` over the last 3 months. That's the steady-state MRR contribution.
- Sum across all 3 accounts → `mrr_pence`.

If a contract has only billed once (e.g. new this quarter), use the one billed amount and flag it as `single_period` in notes.

## Step 3 — Surface findings relevant to the question

- **MRR / revenue** → trailing `mrr_pence` + named contract list.
- **Concentration risk** → because there are only 3 contracts, the platform is concentrated. Always include named accounts.
- **Renewal exposure** → contracts with `term_end_date` in the next 90 days.

## Output shape

```
platform: zuora
mrr_pence: 380000
paying_customer_count: 3
contracts:
  - account: Northwind Enterprise   trailing_mrr_pence: 220000   model: usage   term_end: 2027-02-01
  - account: Pinecrest Group        trailing_mrr_pence: 110000   model: tiered  term_end: 2026-11-15
  - account: Marlowe Holdings       trailing_mrr_pence:  50000   model: usage   term_end: 2026-08-30
notes:
  - 3 contracts only — concentration risk. Largest (Northwind) is ~58% of platform MRR.
  - Marlowe term ends 2026-08-30 — renewal in 90d.
```

## Rules

- **Read-only.** No write tools.
- **`invoiced_amount` is pence** in Zuora's response.
- **Usage MRR is trailing, not contracted.** Use the 3-month rolling mean. A contracted ceiling is not realised MRR until billed.
- **Always name accounts.** With only 3 contracts, anonymised totals are useless to the operator.
- **Paginate invoices** — 90 days of invoices on 3 high-volume accounts can exceed the page cap.
