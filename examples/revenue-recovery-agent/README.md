# Revenue Recovery Agent Example

A SaaS revenue-recovery agent that investigates MRR drops by reconciling Postgres and Stripe, produces a recovery plan, and — on operator approval — executes payment retries, refunds, and reconciliation writes against Stripe.

The agent has **no orchestration code**. It is a set of Claude Skills (markdown files under `skills/`) that Claude Code reads at runtime and uses to decide which MCP tools to call.

The differentiator vs. [`briefing-agent`](../briefing-agent/) is **read + write**. Briefing Agent is read-only by design. Revenue Recovery is read-write, with a two-phase contract enforced in the skill markdown: investigate first, present a plan, **stop**, only execute writes after the operator explicitly approves.

## Architecture

```
Claude Code  ──reads──▶  skills/revenue-recovery/SKILL.md
     │                        │   (orchestrator, phase contract)
     │                        │
     │                        ├─▶ skills/mrr-diagnosis/SKILL.md
     │                        ├─▶ skills/churn-investigation/SKILL.md
     │                        ├─▶ skills/payment-failures/SKILL.md
     │                        ├─▶ skills/reconciliation/SKILL.md
     │                        └─▶ skills/risk-signals/SKILL.md
     │
     └──connects to (MCP)──▶ mimic host
                                ├─ postgres MCP   (customers, subscriptions,
                                │                  invoices, payments,
                                │                  risk_flags, support_notes)
                                └─ stripe   MCP   (read + write — payment_intents,
                                                   refunds, subscriptions, balance)
```

## Prerequisites

- Node.js `>=22`
- Docker (for PostgreSQL)
- `ANTHROPIC_API_KEY` — required for Mimic data generation
- Claude Code installed (the agent IS Claude Code, pointed at the MCP servers)

## Run

```bash
# 1. Postgres up
docker compose up -d

# 2. Env
cp .env.example .env
# fill in ANTHROPIC_API_KEY

# 3. Install + Prisma
npm install
export $(cat .env | xargs)
npx prisma generate
npx prisma migrate dev --name init

# 4. Generate synthetic data (Postgres + Stripe, causally consistent)
npx mimic run -g
npx mimic seed --verbose

# 5. Inspect what was generated (optional)
npx mimic explore

# 6. Host the MCP servers
npx mimic host
```

`mimic host` will print the API and MCP ports. Point Claude Code at those endpoints (in your Claude Code MCP config — see `.mcp.json` for the default ports), then in a chat:

> "MRR is down this week. Why, and what should we do?"

Claude Code picks up `skills/revenue-recovery/SKILL.md`, runs Phase 1 across the five sub-skills in parallel, and presents a recovery plan with named customers, root causes, and proposed actions tagged with the Stripe tool that would execute each one. The agent then **stops** and asks the operator to approve, approve a subset, or reject.

On approval, Phase 2 executes the writes — payment retries and refunds in Stripe, then reconciliation updates back to Postgres.

## Phase contract

The two-phase contract is enforced by the skill markdown, not by any runtime gate in Mimic. Mimic core stays general — it hosts 100+ adapters and has no domain knowledge of which tools are destructive. The discipline lives in `skills/revenue-recovery/SKILL.md`:

- **Phase 1 (Investigation)** — read-only by policy. The skill explicitly forbids calling `create_payment_intent`, `create_refund`, `cancel_subscription`, or any other write tool while building the plan. Step 4 is a hard stop: present plan, ask "Approve all, approve a subset, or reject?".
- **Phase 2 (Execution)** — only entered after explicit approval. Writes are tiered:
  - **Low risk** (retry on `insufficient_funds`, dunning on `expired_card`) — batched in parallel.
  - **Medium risk** (refunds < $1k, escalations, Postgres-only reconciliation writes) — one at a time, with logging.
  - **High risk** (refunds ≥ $1k, subscription cancellations, any action where `risk-signals` flagged the customer) — require a second per-action confirmation even after the plan was approved.

The synthetic environment is the safety. If the model ever slipped and fired a write in Phase 1, it would be against the in-memory mock Stripe — blast radius is one demo run, and `mimic host` resets to seeded baseline on restart. That's the Mimic claim: you can develop and demo write-path agents because slipping costs nothing.

## What's in the persona

The default persona, `growth-stage-leak`, is a 100-customer growth-stage SaaS with a -$4,820 MRR week constructed from five distinct, individually-discoverable causes:

- **8 failed charges** — 4 cards expired this month (need dunning, not retry), 2 `insufficient_funds` (retry well), 2 `lost_card` (do not retry — fraud signal)
- **3 enterprise downgrades** to `pro` on the same day, with matching `support_notes` tagged `downgrade`
- **2 voluntary cancellations** — both customers had `risk_flags` of type `billing_dispute` or `competitor_mentioned` set 18-21 days earlier by the CSM, with corresponding `support_notes`. Nobody acted.
- **1 accidental double-charge** on Klein Records — same amount, same day, two payment intents both succeeded. Eligible for a single refund.
- **1 drift case** — Larkspur Inc shows `status='active'` and `mrr_cents=9900` in Postgres, but the Stripe subscription was cancelled 9 days ago and Postgres never picked it up.

Plus: ~3 deliberate Stripe-only orphans from a botched import 4 weeks ago. Believable BIN clusters on the failed charges. Every number must reconcile — the bucket totals from `mrr-diagnosis` should sum exactly to the headline drop.

This is the kind of multi-cause causally-consistent universe that's impossible to fake by hand and trivial to regenerate with Mimic.

## Skills

| Skill | Purpose |
|---|---|
| [`revenue-recovery`](skills/revenue-recovery/SKILL.md) | Orchestrator — runs Phase 1 in parallel, builds the plan, stops at the approval prompt, executes Phase 2 by risk tier. The only skill that ever calls write tools. |
| [`mrr-diagnosis`](skills/mrr-diagnosis/SKILL.md) | Quantifies the MRR delta and decomposes into involuntary churn, voluntary churn, downgrades, refunds, expansion offset. |
| [`churn-investigation`](skills/churn-investigation/SKILL.md) | Named cancellations + downgrades with reasons from Stripe `cancellation_details` and Postgres `support_notes`. |
| [`payment-failures`](skills/payment-failures/SKILL.md) | Failed `payment_intents` ranked by retry-success probability (decline-reason driven). Detects BIN clusters and expiry waves. |
| [`reconciliation`](skills/reconciliation/SKILL.md) | Postgres↔Stripe drift detection — status mismatches, mrr_cents disagreements, orphans, refund drift. |
| [`risk-signals`](skills/risk-signals/SKILL.md) | Correlates affected customers with internal `risk_flags` and `support_notes`. Promotes risk tier when prior signals existed. |

To add a new data source: write another skill, add the adapter to `mimic.json`. No orchestration code to refactor.

## Database schema

| Table | Purpose |
|---|---|
| `customers` | Source-of-truth customer records — plan, status, mrr_cents, stripe_customer_id |
| `subscriptions` | Subscription history with `cancellation_reason` for human context |
| `invoices` | Invoice records mirrored from Stripe |
| `payments` | Payment history with `failure_reason` (drives retry probability) |
| `risk_flags` | **Internal** at-risk markers set by CSMs, support, or automation. `flag_type`, `severity`, `set_by`, `resolved_at`, `note`. |
| `support_notes` | **Internal** free-text notes from support tickets and CSM check-ins. `tags` for billing/churn-risk/downgrade categorisation. |

`risk_flags` and `support_notes` are the two new tables vs. [`billing-agent`](../billing-agent/). They're what makes the `risk-signals` skill's "we knew this was coming" finding possible.

## Stripe tools available (read + write)

The Stripe adapter exposes ~30 tools via MCP when `mcp: true` is set. The agent uses these in Phase 2:

- `create_payment_intent` — retry a failed charge
- `create_refund` — refund the duplicate charge
- `cancel_subscription` — propagate a cancellation if needed
- `list_payment_intents`, `list_subscriptions`, `list_invoices`, `retrieve_balance` — Phase 1 reads

State is in-memory per `mimic host` session: a refund issued in Phase 2 is visible to subsequent `list_invoices` calls within the same session. Restart `mimic host` to reset to the seeded baseline.
