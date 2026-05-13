# CFO Agent (Skills Edition)

A CFO-grade financial assistant for Verida Analytics — a synthetic growth-stage SaaS running on **8 billing platforms plus an internal Postgres product database**. The agent answers founder/CFO questions like "What's our MRR?", "Give me the board picture", "Why is mobile down this week?", or "Who's overdue?" by fanning out across every data source in parallel and presenting a single operator-grade answer.

The agent has **no orchestration code**. It is a set of Claude Skills (markdown files under `skills/`) that Claude Code reads at runtime and uses to decide which MCP tools to call.

This is the skills-edition reimplementation of [`cfo-agent`](../cfo-agent/) — same persona, same `mimic.json`, same Prisma schema. The difference: the original cfo-agent ships a LangGraph supervisor + 9 ReAct sub-agents over an HTTP server. This version replaces all of it with 10 markdown files. Claude Code is the runtime.

## Architecture

```
Claude Code  ──reads──▶  skills/cfo-briefing/SKILL.md
     │                        │   (orchestrator — fans out, aggregates, formats)
     │                        │
     │                        ├─▶ skills/stripe-platform/SKILL.md
     │                        ├─▶ skills/paddle-platform/SKILL.md
     │                        ├─▶ skills/revenuecat-platform/SKILL.md
     │                        ├─▶ skills/chargebee-platform/SKILL.md
     │                        ├─▶ skills/gocardless-platform/SKILL.md
     │                        ├─▶ skills/lemonsqueezy-platform/SKILL.md
     │                        ├─▶ skills/zuora-platform/SKILL.md
     │                        ├─▶ skills/recurly-platform/SKILL.md
     │                        └─▶ skills/postgres-product/SKILL.md
     │
     └──connects to (MCP)──▶ mimic host
                                ├─ postgres MCP     (users, events, usage, flags)
                                ├─ stripe MCP       (core web subscriptions)
                                ├─ paddle MCP       (EU + international)
                                ├─ revenuecat MCP   (mobile iOS / Android)
                                ├─ chargebee MCP    (enterprise invoicing)
                                ├─ gocardless MCP   (UK direct debit)
                                ├─ lemonsqueezy MCP (indie licenses)
                                ├─ zuora MCP        (usage-based contracts)
                                └─ recurly MCP      (legacy subscribers)
```

Read-only. The CFO briefing is a reporting agent — every skill markdown explicitly forbids write tools. No `create_*`, no `cancel_*`, no `refund_*`.

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

# 4. Generate synthetic data (Postgres + 8 billing platforms, causally consistent)
npx mimic run -g
npx mimic seed --verbose

# 5. Inspect what was generated (optional)
npx mimic explore

# 6. Host the MCP servers
npx mimic host
```

`mimic host` prints the API and MCP ports. Point Claude Code at the endpoints in `.mcp.json`, then in a chat:

> "What's our MRR right now?"

Claude Code picks up `skills/cfo-briefing/SKILL.md`, fans out across the 9 platform skills in parallel, aggregates the per-platform pence amounts into a GBP headline, and presents the breakdown with cross-cutting findings (overdue invoices, churn-risk Pro accounts, data-integrity orphans).

## How fan-out works

The orchestrator (`cfo-briefing/SKILL.md`) tells Claude to invoke ALL 9 sub-skills in parallel for **any** revenue-shaped question — even if the operator names a single platform. The cross-cuts are the value: a Stripe customer who never logs in (Postgres × Stripe), a Paddle subscriber missing from the product database (Paddle × Postgres), a paid user with no billing record at all (Postgres × all).

Each sub-skill knows what it owns and returns a small, structured payload in **pence** (integer minor units). The orchestrator converts to pounds for the prose answer.

Currency rule, enforced in every skill: **pence in `_pence` fields, pounds in prose.** `7900` is `£79.00`, never the other way round. The most common slip is treating `mrr_cents = 7900` as £7,900 when it's £79.

## Demo questions

- "What's our MRR right now?"
- "Give me the full picture for my investor meeting"
- "Why is RevenueCat down this week?"
- "Who's overdue and how bad is it?"
- "Are any customers paying for a plan they're not using?"
- "Give me an honest picture before the board meeting"

## What's in the persona

The `growth-saas` persona is a synthetic ~£127k-MRR SaaS spread deliberately across 8 platforms so the cross-platform findings are non-trivial:

- **Stripe** — £77k (61%), 1,200 customers across starter/pro/enterprise
- **Paddle** — £28k (22%), EU + international, +31% MoM EU driven by Germany
- **RevenueCat** — £15k (12%), mobile, currently **−23% this week** from an App Store outage on Tuesday
- **Chargebee** — £6k (5%), enterprise invoicing — **3 invoices overdue, £12,400, oldest 34 days**
- **GoCardless** — UK direct debit, **£8,400 pending Thursday settlement** (Bacs 2-day lag)
- **Lemon Squeezy** — 534 indie licenses (long tail)
- **Zuora** — 3 usage-based enterprise contracts (concentration risk)
- **Recurly** — 47 legacy migrated subscribers

Cross-cutting facts the agent should surface:
- **34 users** in Postgres flagged as paid but with no billing-platform record (data integrity)
- **14 Pro customers** with no login in 30+ days (churn risk)
- **847 free-tier users** with limit-hit / upgrade-click signals (conversion opportunity)

Every number reconciles. The platform breakdowns sum to the headline. The mobile dip explains the MoM drag. The overdue total matches the named Chargebee invoices.

## Skills

| Skill | Purpose |
|---|---|
| [`cfo-briefing`](skills/cfo-briefing/SKILL.md) | Orchestrator — fans out across all 9 sub-skills in parallel, aggregates pence → pounds, surfaces cross-platform findings, presents operator-grade answer. |
| [`stripe-platform`](skills/stripe-platform/SKILL.md) | Core web subscriptions (~£77k MRR, 61%). Plan mix, growth, failed payments. |
| [`paddle-platform`](skills/paddle-platform/SKILL.md) | EU + international (~£28k MRR). Country breakdown, German growth. |
| [`revenuecat-platform`](skills/revenuecat-platform/SKILL.md) | Mobile (iOS / Android) ~£15k MRR. Surfaces the App Store dip. |
| [`chargebee-platform`](skills/chargebee-platform/SKILL.md) | Enterprise invoicing. Owns overdue AR. |
| [`gocardless-platform`](skills/gocardless-platform/SKILL.md) | UK direct debit. Distinguishes pending vs confirmed cash. |
| [`lemonsqueezy-platform`](skills/lemonsqueezy-platform/SKILL.md) | Indie licenses. Keeps one-off bookings out of MRR. |
| [`zuora-platform`](skills/zuora-platform/SKILL.md) | Usage-based enterprise contracts. Trailing MRR. |
| [`recurly-platform`](skills/recurly-platform/SKILL.md) | Legacy migrated subscribers. |
| [`postgres-product`](skills/postgres-product/SKILL.md) | Internal product DB. Free vs paid counts, churn-risk, data integrity, conversion candidates. |

To add a new data source: write another skill, add the adapter to `mimic.json`. No orchestration code to refactor.

## Why skills instead of LangGraph

The original [`cfo-agent`](../cfo-agent/) is ~560 lines of TypeScript: a LangGraph supervisor with 9 ReAct sub-agents wired over an HTTP server. Every change to fan-out logic, prompts, or platform behaviour is a code change.

This version is 10 markdown files. The fan-out is described in the orchestrator skill. Per-platform domain knowledge lives in each platform skill. Adding a 10th platform is one new markdown file plus a line in `mimic.json` — no orchestrator rewrite, no new sub-agent wiring, no server changes.

The trade-off: Claude Code is the runtime. You don't get a custom HTTP endpoint to point a frontend at — you talk to the agent inside Claude Code. The [`cfo-agent`](../cfo-agent/) folder keeps its bundled `ui/` for that case.

## Database schema

| Table | Purpose |
|---|---|
| `users` | Source-of-truth product records — id, email, plan (free/starter/pro/enterprise), status, billing_platform, external_id, mrr_cents (GBP pence), country, last_login_at |
| `events` | Product usage — login, api_call, feature_used, limit_hit, upgrade_clicked, export, invite_sent |
| `usage_metrics` | Monthly per-user api_calls, seats_used, storage_gb, exports |
| `feature_flags` | Per-user feature grants — advanced_analytics, api_access, team_seats, etc. |

The `billing_platform` + `external_id` columns are the join key back to whichever of the 8 billing platforms owns that customer's subscription. The orchestrator uses this to detect orphans (paid in product, missing in billing) and drift (paid in billing, churned in product).

## State

The MCP servers are in-memory per `mimic host` session. Restart `mimic host` to reset to the seeded baseline. Because the CFO briefing is read-only, there's nothing to persist across sessions — every run reads the same seeded universe.
