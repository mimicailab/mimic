---
name: postgres-product
description: Internal PostgreSQL specialist — users, events, usage_metrics, feature_flags. The product source of truth. Surfaces free-tier conversion candidates, churn-risk paid users (no login 30d+), and paid-flag/billing-platform orphans. Sub-step inside cfo-briefing. Read-only.
---

# Postgres (product) platform

**What this owns:** Verida's internal product database — the product-side source of truth, distinct from the 8 billing platforms.

Tables:
- `users` — id, email, plan (`free` / `starter` / `pro` / `enterprise`), status (`active` / `churned` / `suspended` / `trialing`), billing_platform, external_id, mrr_cents (GBP pence), country, last_login_at, trial_ends_at
- `events` — login, api_call, feature_used, limit_hit, upgrade_clicked, export, invite_sent
- `usage_metrics` — monthly api_calls, seats_used, storage_gb, exports per user
- `feature_flags` — per-user feature grants

Sub-step inside `cfo-briefing`. The unique value of this skill is **cross-cutting findings** — things billing platforms can't see because they're product-side.

## Step 1 — Pull totals

Prefer the summary tools (`get_users_summary`, `get_events_summary`, etc.) for whole-table aggregates — one round-trip and authoritative.

Capture:

- Paid users: `count(users WHERE plan != 'free' AND status = 'active')`
- Free users: `count(users WHERE plan = 'free' AND status = 'active')`
- Trialing: `count(users WHERE status = 'trialing')`
- Total internal MRR: `sum(mrr_cents WHERE status = 'active')` — pence

## Step 2 — Cross-platform integrity finding (always run)

This is the platform-distinct finding the orchestrator depends on. Two queries:

1. **Paid users with no billing record:** `users WHERE plan != 'free' AND billing_platform IS NULL` — these are claiming a paid plan but aren't in any billing platform. Data integrity issue.
2. **Billing-flagged users with mismatched plan/status:** `users WHERE billing_platform IS NOT NULL AND (status = 'churned' OR plan = 'free')` — billing thinks they're paying but the product flagged them as churned/downgraded.

Return both as named lists (email + plan + billing_platform).

## Step 3 — Engagement / conversion findings

- **Churn-risk paid users:** `users WHERE plan IN ('pro', 'enterprise') AND status = 'active' AND last_login_at < (now - 30 days)`. Surface count and named list. Pro users with no login in 30+ days are the highest-signal churn candidates.
- **Conversion-candidate free users:** join `users` (plan = 'free') with `events` (event_type IN ('limit_hit', 'upgrade_clicked')) in last 30 days. Free users repeatedly hitting limits or clicking upgrade are the conversion opportunity.

## Step 4 — Surface findings relevant to the question

- **MRR / revenue** → internal `total_paid_mrr_pence` (from the `mrr_cents` column) + paid customer count + free-tier count. Note: this is the product's view, which may drift from the billing platforms' sum. The drift is itself useful information for the operator.
- **Customer count** → paid vs free vs trialing.
- **Churn risk** → 30d-no-login Pro list with count.
- **Conversion** → limit-hit / upgrade-click free users in last 30 days.
- **Data integrity** → orphan list (paid-flag but no billing record).
- **Cross-platform check** → for any user with `billing_platform` set, presence of a matching record on that platform is the responsibility of the billing-platform sub-skills — but this skill should always return the orphan list so the orchestrator can cross-reference.

## Output shape

```
platform: postgres
paid_user_count: 2917
free_user_count:  847
trialing_count:    62
total_paid_mrr_pence: 12740000

churn_risk_30d_no_login:
  count: 14
  users:
    - email: alice@northbridge.io   plan: pro          billing_platform: stripe
    - email: bob@quarter.co         plan: pro          billing_platform: stripe
    ...

conversion_candidates:
  count: 89
  signals: { limit_hit: 64, upgrade_clicked: 32 }     # may overlap

data_integrity:
  paid_flag_no_billing_record:
    count: 34
    users:
      - email: charlie@orphan.dev   plan: starter      billing_platform: null
      ...
  billing_flag_but_churned:
    count: 3
    users: [...]

notes:
  - 34 paid-flagged users not in any billing platform — escalate to ops
  - 14 Pro accounts no login 30+ days — CSM review
  - 89 free users hit limit / clicked upgrade in last 30d — conversion oppy
```

## Rules

- **Read-only.** No `INSERT` / `UPDATE` / `DELETE` — use only `get_*` / `query_*` / `summary` tools.
- **`mrr_cents` is GBP pence** despite the name. £79 = `7900`.
- **Use summary tools for whole-table counts** — `get_users_summary` is one round-trip and authoritative. Don't enumerate.
- **Always include the data-integrity finding** — it's the unique value of the product database vs the billing platforms.
- **Don't fold internal MRR into the billing total.** The orchestrator presents them as a cross-check, not a sum.
- **No PII in prose summaries beyond email/company.** Don't dump the events table.
