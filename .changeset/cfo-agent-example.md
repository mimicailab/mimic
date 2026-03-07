---
"@mimicai/core": minor
"@mimicai/cli": minor
"@mimicai/adapter-revenuecat": patch
---

### feat(example): CFO agent with 8 billing platforms and chat UI

End-to-end example demonstrating cross-surface data generation across 8 billing adapters (Stripe, Paddle, Chargebee, GoCardless, RevenueCat, Lemon Squeezy, Zuora, Recurly) and PostgreSQL.

**Core changes:**
- Enhanced blueprint expander with multi-surface data generation
- Rewrote `mimic host` for multi-adapter MCP orchestration (per-adapter mock API + MCP SSE endpoints)
- Implemented full RevenueCat mock API surface with tests

**Example stack:**
- LangGraph ReAct supervisor + 9 sub-agents via MCP (214 tools)
- Next.js 16 chat UI with AI SDK v6 and GFM markdown rendering
- Docker Compose PostgreSQL with Prisma migrations
