---
name: revenue-recovery
description: Use when the operator asks why MRR dropped, who's affected, or what to do about failed payments and churn. Investigates Postgres + Stripe in parallel, produces a recovery plan, and on explicit approval executes payment retries, refunds, and subscription changes against Stripe. Two-phase contract — never auto-executes writes.
---

# Revenue recovery

Two-phase contract. **Phase 1 is investigation (read-only).** **Phase 2 is execution (write, on approval).** Do not call any write tool in Phase 1, even if the path to the answer seems obvious. The operator must see the plan and approve it before any Stripe state changes.

Trigger: the operator asks something like "Why did MRR drop?", "What happened this week?", "Who's failing to pay?", or pastes a numeric drop and asks for a recovery plan.

---

## Phase 1 — Investigation

Default window is the last 7 days. If the operator names a different window ("this month", "since Monday"), use that.

### Step 1: Quantify the drop

Invoke the `mrr-diagnosis` skill. It returns the MRR delta for the window and a five-bucket decomposition: involuntary churn, voluntary churn, downgrades, refunds, expansion offset. The numbers must reconcile to the headline delta — if they don't, surface the discrepancy and stop.

### Step 2: Identify affected customers (in parallel)

Run these four sub-skills in parallel — they don't depend on each other and waiting serially wastes the operator's time:

- `churn-investigation` — named list of customers who cancelled or downgraded in the window, with prior MRR, current MRR, delta, and any `cancellation_reason` from Stripe or `support_notes` from Postgres.
- `payment-failures` — failed `payment_intents` from Stripe in the window, ranked by retry-success probability based on decline reason. Surfaces patterns (BIN clusters, expiry waves, single-bank declines).
- `reconciliation` — every Postgres↔Stripe drift: status mismatches, mrr_cents disagreements, orphans, refunds in Stripe not reflected in `payments`.
- `risk-signals` — `risk_flags` and `support_notes` correlated with the customers surfaced by the other three skills. Promotes any flagged customer up one risk tier in the plan even if the proposed action is otherwise routine.

### Step 3: Build the recovery plan

For every affected customer, produce one row with:

| Field | Values |
|---|---|
| Customer | name + amount at risk |
| Root cause | `card_declined` / `card_expired` / `subscription_cancelled` / `downgrade` / `refund_issued` / `drift` |
| Recommended action | `retry_payment` / `send_dunning` / `escalate_csm` / `refund` / `cancel` / `reconcile` / `no_action` |
| Risk tier | `low` / `medium` / `high` (drives the approval requirement in Phase 2) |
| Stripe tool | the exact tool that would execute it (`create_payment_intent`, `create_refund`, etc.) |

Risk tier rules:

- **Low**: retry on `insufficient_funds` or generic `card_declined`. Send dunning for `expired_card`. These can be batched.
- **Medium**: refund < $1,000. Escalation to CSM. Reconciliation writes that update Postgres to match Stripe. Each is executed individually with logging.
- **High**: refund ≥ $1,000. Subscription cancellation. Any action where a `risk-signals` correlation suggests the customer is already considering churn. Each requires a second per-action confirmation in Phase 2.

If `risk-signals` flagged a customer, promote them up one tier from whatever the routine action would suggest.

### Step 4: Present the plan and STOP

Output the plan in the format below. Then ask the operator a single question:

> "Approve all, approve a subset, or reject?"

**Do not call any write tool. Do not infer approval from anything other than an explicit answer to that question.** "Looks good", "yes", "go ahead" all count as approval; anything ambiguous ("maybe just the easy ones?") requires a follow-up question, not an inference.

#### Plan format

```
RECOVERY PLAN — week of <date range>
─────────────────────────────────────────────
MRR DELTA: <delta>
  Involuntary churn:  <amount>  (<count> failed charges)
  Voluntary churn:    <amount>  (<count> cancellations)
  Downgrades:         <amount>  (<count> customers)
  Refunds:            <amount>  (<count> issued)
  Expansion offset:   <amount>

AFFECTED CUSTOMERS (<count>):

LOW RISK — <action> (<count> customers, <total amount>)
  • <Customer name>   <amount>  <root cause + decline reason>
  ...

MEDIUM RISK — <action> (<count>, <total>)
  • ...

HIGH RISK — <action>, do not auto-act (<count>, <total>)
  ⚠ <Customer name>   <amount>  <root cause + risk_flag context>
  ...

REFUND (<count>, <total>)
  • ...

DRIFT FINDING (<count>)
  • <Customer name>   Postgres status='active', Stripe cancelled <N> days ago
                       Lost MRR: <amount> not reflected in your dashboard

PROJECTED RECOVERY: <recoverable amount> of <delta> (<percentage>)

Approve all, approve a subset, or reject?
```

---

## Phase 2 — Execution (only after explicit approval)

Enter Phase 2 only after the operator has explicitly approved. If they approved a subset, drop the unapproved rows from the plan and proceed with the remainder.

### Step 5: Execute by risk tier

Order matters. Run low-risk first (cheap and parallelisable), then medium, then high. Don't fan out across tiers.

- **Low-risk batch**: call the relevant write tool (`create_payment_intent` for retries, the dunning path for expired cards) for all low-risk rows in parallel. Log every result.
- **Medium-risk sequence**: execute one at a time. After each write, append a single line to the run log: `✓ <customer> — <action> — <result>` or `✗ <customer> — <action> — <reason>`.
- **High-risk single-step**: for each high-risk row, ask the operator one more time before calling the tool — quote the action and the amount. Only proceed on a clear yes per row.

### Step 6: Reconcile the writes back to Postgres

After every successful Stripe write, update the corresponding Postgres row to reflect the new state — refunds add a `payments` row with status `refunded`, cancellations set `subscriptions.canceled_at` and `subscriptions.status = 'canceled'`, plus update `customers.status` and `customers.mrr_cents` accordingly.

If the Stripe write succeeded but the Postgres update fails, **do not retry silently**. Surface the discrepancy in the run log so the operator knows Stripe has changed but Postgres hasn't caught up — that's the same drift class the `reconciliation` skill detects.

### Step 7: Return the run log

Final output format:

```
EXECUTION COMPLETE — <elapsed>
─────────────────────────────────────────────
✓ <count> retries:   <succeeded> succeeded (<recovered amount>),
                     <failed> failed (<reasons>)
✓ <count> dunning:   sent (cards collected via Stripe)
✓ <count> refunds:   <total> issued
✓ <count> reconcile: status updated in Postgres

NET RECOVERY: <recovered> of <projected> projected
NEXT: <one-line next step for any item that needs follow-up>
```

---

## Output format conventions

These rules apply to **every** structured output emitted by this skill or its sub-skills, including the recovery plan, the run log, and any per-row fact returned to the operator.

### Numeric amounts: cents in fields, dollars in prose

- **Any field whose name ends in `_cents`** (e.g. `revenue_at_risk_cents`, `total_mrr_delta_cents`, `total_refund_amount_cents`, `amount_cents`) **MUST be an integer count of cents**. A $99.00 charge is `9900`, not `99`. A -$4,820 MRR delta is `-482000`, not `-4820`. Multiply dollars by 100 when populating these fields.
- **Any field whose name does NOT end in `_cents` but contains a monetary amount** — default to cents anyway and make the unit explicit in a sibling field (`{ amount: 9900, currency: "usd" }`). Cents is the structural source of truth.
- **Human-readable prose uses dollars** formatted as `$X.XX` (e.g. `$99.00`, `-$4,820.00`). The recovery-plan operator output, the run-log lines, and any narrative summaries display dollars. Never put a dollar-formatted string into a `_cents` field.

The most common slip is emitting `revenue_at_risk_cents: 99` when the amount is $99 — that's $0.99 in cents. Always × 100 when the source value is dollars.

### Required structured fields per question type

When the operator's question maps to one of these categories, include the named fields in the structured response in addition to any prose summary:

| Question shape | Required fields |
|---|---|
| MRR delta / movement | `total_mrr_delta_cents`, `bucket_breakdown_cents` (object with bucket → cents), `affected_customer_count` |
| Failed payments / retries | `failed_count`, `total_at_risk_cents`, `retry_candidate_count`, `do_not_retry_count` |
| Refunds (totals or proposals) | `total_refund_amount_cents`, `refund_count`, `customer_ids[]` |
| Disputes | `open_dispute_count`, `total_dispute_amount_cents` (include closed-won amounts unless the operator scopes to "open only") |
| Drift / reconciliation | `drift_count`, `revenue_at_risk_cents`, `affected_customer_ids[]` |
| Risk-flag correlation | `correlated_count`, `total_correlated_at_risk_cents`, `customer_ids[]` |

If the question doesn't fit a category cleanly, still include `total_*_cents` for any aggregate amount you mention in the prose. Never report an amount only in dollars when the eval may be looking for cents.

## Pagination

Stripe MCP `list_*` tools cap at **100 records per call**. For any total, ranking, or count that depends on covering the full result set, iterate using the `starting_after` cursor until the response's `has_more` field is `false`. Specifically:

- **Refunds, payment intents, charges, invoices, balance transactions** — most easily exceed 100 in a 7-day or month window. Always paginate to compute totals.
- **`get_*_summary` tools (Postgres MCP) prefer aggregates** — when a question asks for a count or sum across an entire table, the summary tool is one round-trip and authoritative. Use it before enumerating rows.

If you genuinely cannot paginate (tool error, no cursor returned), say so explicitly: report the partial total and flag that the answer is bounded by the page limit. Never imply a partial total is the full total.

### Resource types not covered by a list_* tool

The Stripe MCP exposes dedicated `list_*` tools for the common resources (customers, subscriptions, invoices, payment_intents, charges, disputes, refunds, products, prices, coupons) — but not every Stripe resource. **Payouts, webhook_endpoints, transfers, balance_transactions, credit_notes, mandates, files** and others have no dedicated list tool.

For these, use `fetch_stripe_resources` — it accepts ANY Stripe resource type and maps directly to `GET /v1/<type>`:

- **List all of a type:** `fetch_stripe_resources({ resource_type: "payouts" })` → all payouts.
- **Fetch one by ID:** `fetch_stripe_resources({ resource_type: "webhook_endpoints", resource_id: "we_…" })`.
- **Search across one or more types:** `search_stripe_resources({ query: "…", resource: "transfers" })`.

"No dedicated list_* tool" ≠ "no data". Always reach for the generic fetcher before reporting that a resource is unavailable.

---

## Critical rules

- **Phase 1 is read-only by policy.** Never call `create_payment_intent`, `create_refund`, `cancel_subscription`, or any write tool while building the plan. Step 4 is a hard stop.
- **Never auto-approve.** No matter how routine the action looks, the operator's explicit answer to "Approve all, approve a subset, or reject?" is required to enter Phase 2.
- **High-risk actions are one-by-one, even after approval.** A blanket "approve all" approves the *plan*; high-risk rows still require a second confirmation per row inside Phase 2.
- **Refunds are irreversible.** If the operator's instructions are ambiguous ("refund the obvious ones"), ask which specifically. Never guess on refunds.
- **Stripe is the source of truth after a write.** If a Stripe write succeeded but Postgres lags, prefer Stripe and flag the drift — don't auto-retry the Postgres update, don't reverse the Stripe write.
- **Idempotency.** If the operator runs the recovery again, detect that Phase 2 actions already succeeded (Stripe shows the retry succeeded, Postgres shows the refund) and exclude them from the new plan. Don't double-charge.
- **Tone is operator-grade.** No hedging, no apologies. Numbers, named customers, concrete actions. The operator is approving real money movement — they need clarity, not chat.
