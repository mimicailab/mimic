---
name: gocardless-platform
description: GoCardless specialist — UK SMB direct-debit collections for Verida Analytics (~£2-3k MRR). 2-day bank settlement lag — money collected on Monday clears Thursday. Sub-step inside cfo-briefing. Read-only.
---

# GoCardless platform

**What this platform owns:** Verida's UK SMB direct-debit collections via Bacs. ~71 customers, small share of MRR but the only platform with a **settlement lag**: payments collected from customers' bank accounts take ~2 working days to land in Verida's account. Money "collected on Monday" is `pending` until Thursday.

Sub-step inside `cfo-briefing`. The settlement-lag nuance is the differentiator — always distinguish `pending` from `confirmed` when reporting cash position.

## Step 1 — Pull mandates + payments

Use GoCardless `list_mandates` filtered to `status: active`. In parallel, `list_payments` for the operator's window (default 14 days to catch the full settlement cycle).

Capture per mandate:

- `customer_id` + company name
- `scheme` (`bacs` for UK)
- `mandate_status`

Capture per payment:

- `amount` in **pence**
- `status` (`pending_customer_approval` / `pending_submission` / `submitted` / `confirmed` / `paid_out` / `failed`)
- `charge_date`
- `payout_date` (when it actually lands — null for non-settled)

## Step 2 — Compute MRR + cash position

MRR: sum monthly-equivalent of active recurring payments.

Cash position split:

- `confirmed_pence` — payments with `status ∈ {confirmed, paid_out}` in the window
- `pending_settlement_pence` — `status = submitted` (collected but not yet cleared)
- `failed_pence` — `status = failed` in the window (bank rejected — needs follow-up)

## Step 3 — Surface findings relevant to the question

- **MRR / revenue** → `mrr_pence` + customer count.
- **Cash / collections / "what's pending"** → confirmed vs pending breakdown. Surface `pending_settlement_pence` with the expected clearance date.
- **Failed collections** → list of failed payments in the window with the bank reason if exposed.

## Output shape

```
platform: gocardless
mrr_pence: 240000
paying_customer_count: 71
cash_position_14d:
  confirmed_pence:         684000
  pending_settlement_pence: 840000   # £8,400 collected Mon, clears Thu
  failed_pence:              12400
pending_settlement:
  - charge_date: 2026-05-04   pence: 840000   expected_payout: 2026-05-07
failed_payments:
  - customer: Holloway & Sons   pence: 12400   reason: insufficient_funds   charge_date: 2026-05-02
notes:
  - £8,400 collected Monday — clears Thursday (2-day Bacs settlement)
```

## Rules

- **Read-only.** No `create_payment`, no `cancel_mandate`, no write tools.
- **`amount` is pence** in GoCardless's response. £8,400 = `840000`.
- **Always distinguish `confirmed` from `pending_settlement`** in any cash-position answer. Reporting pending as confirmed inflates the cash figure.
- **Bacs settlement is 2 working days** — a Monday `submitted` payment is expected `paid_out` on the following Thursday (skip weekends).
- **Paginate** — small customer count but payment volume across 14 days exceeds the page cap easily.
