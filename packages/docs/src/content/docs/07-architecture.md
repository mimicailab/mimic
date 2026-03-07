---
title: "Architecture"
description: "System overview, data flow, cross-surface consistency, and the package dependency graph."
order: 7
slug: "architecture"
prev: { slug: "mcp", title: "MCP Servers" }
next: { slug: "guides", title: "Guides" }
---

<h2 id="arch-overview">System Overview</h2>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">text</span><span>architecture</span><button class="code-copy">Copy</button></div>
  <pre><code>┌──────────────────────────────────────────────────────────┐
│                        CLI Layer                          │
│   mimic init │ mimic run │ mimic seed │ mimic host        │
└─────────────────────────┬────────────────────────────────┘
                          │
             ┌────────────┼────────────┐
             │            │            │
             v            v            v
  ┌──────────────┐ ┌────────────┐ ┌────────────┐
  │  Blueprint   │ │ Mock Server│ │  Database  │
  │              │ │            │ │  Adapters  │
  │ Persona load │ │ Fastify    │ │            │
  │ LLM Engine   │ │ Adapters   │ │ Postgres   │
  │ Expander     │ │ State store│ │ MySQL      │
  └──────────────┘ └──────┬─────┘ │ MongoDB    │
                    ┌─────┴─────┐  │ SQLite     │
                    │           │  └─────┬──────┘
                    v           v        v
             ┌────────────┐ ┌────────┐  Real databases
             │  API Mock  │ │  MCP   │
             │  Adapters  │ │Servers │
             │            │ │        │
             │ Stripe     │ │per-    │
             │ Plaid      │ │adapter │
             │ Slack      │ │(stdio/ │
             │ + 7 more   │ │ SSE)   │
             └────────────┘ └────────┘</code></pre>
</div>

<h2 id="arch-data-flow">Data Flow</h2>

### Seeding flow

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">text</span><button class="code-copy">Copy</button></div>
  <pre><code>mimic seed
  │
  ├─ Load persona blueprint from .mimic/blueprints/{persona}.json
  │
  ├─ For each configured database adapter:
  │   ├─ Connect to database
  │   ├─ Map blueprint data to table schemas
  │   ├─ INSERT/COPY rows (FK-aware ordering)
  │   └─ Report: "Seeded 42 rows across 5 tables"
  │
  └─ Done (API mocks seed lazily on first request)</code></pre>
</div>

### Request flow (API mock)

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">text</span><button class="code-copy">Copy</button></div>
  <pre><code>Agent sends: GET /stripe/v1/customers?email=alex@example.com
&#8203;
Mock Server (Fastify, port 4101)
  ├─ Route matched: /stripe/* &rarr; StripeAdapter
  ├─ StripeAdapter.registerRoutes handler
  │   ├─ Lazy seed &mdash; populate state store from blueprint on first request
  │   ├─ Filter customers by email query param
  │   ├─ Format response matching Stripe's real shape
  │   └─ reply.send({ object: "list", data: [...], has_more: false })
  └─ Response returned to agent</code></pre>
</div>

### MCP flow

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">text</span><button class="code-copy">Copy</button></div>
  <pre><code>Agent calls MCP tool: list_customers({ email: "alex@example.com" })
&#8203;
MCP Server (@mimicai/adapter-stripe, port 4201/sse)
  ├─ Validate params with Zod schema
  ├─ Translate to HTTP:
  │   GET http://localhost:4101/stripe/v1/customers?email=alex@example.com
  ├─ Parse response
  ├─ Format for agent: "Customers (1):\n• cus_abc — Alex (alex@example.com)"
  └─ Return MCP response</code></pre>
</div>

<h2 id="arch-consistency">Cross-Surface Consistency</h2>

The Blueprint Engine's core differentiator. When it generates data for persona "Alex", the **same Alex appears across all surfaces**:

- PostgreSQL `users` table has Alex with ID `user_001`
- Plaid API returns bank accounts owned by `user_001`
- Stripe API returns payment history for `user_001`'s card
- Chargebee API shows Alex's subscription and invoices
- Slack API shows messages from Alex

Achieved through a two-phase process:

1. **Phase 1: Persona Generation** &mdash; LLM creates a detailed persona with relationships, financial profile, work context
2. **Phase 2: Deterministic Expansion** &mdash; Rules engine expands into concrete data with shared identifiers, consistent timestamps, and correlated values

<h2 id="arch-packages">Package Dependency Graph</h2>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">text</span><button class="code-copy">Copy</button></div>
  <pre><code>@mimicai/cli
  ├── @mimicai/core
  │     ├── adapter system, state store, mock server
  │     ├── blueprint engine, persona generation, expander
  │     └── schema parsing (prisma-ast, pgsql-parser)
  ├── @mimicai/adapter-sdk
  │     └── BaseApiMockAdapter, StateStore, buildTestServer
  ├── @mimicai/blueprints
  │     └── pre-built persona blueprints (JSON)
  │
  ├── Database adapters (shipped)
  │     ├── @mimicai/adapter-postgres
  │     ├── @mimicai/adapter-mongodb
  │     ├── @mimicai/adapter-mysql
  │     └── @mimicai/adapter-sqlite
  │
  └── API mock adapters (shipped, each includes MCP server)
        ├── @mimicai/adapter-stripe
        ├── @mimicai/adapter-plaid
        ├── @mimicai/adapter-slack
        ├── @mimicai/adapter-paddle
        ├── @mimicai/adapter-chargebee
        ├── @mimicai/adapter-gocardless
        ├── @mimicai/adapter-lemonsqueezy
        ├── @mimicai/adapter-recurly
        ├── @mimicai/adapter-revenuecat
        └── @mimicai/adapter-zuora
&#8203;
Each API adapter contains:
  ├── src/mcp.ts          &mdash; registerTools() + startMcpServer()
  ├── src/bin/mcp.ts      &mdash; standalone binary entry point (3 lines)
  └── src/*-adapter.ts    &mdash; BaseApiMockAdapter implementation
&#8203;
Shared peer deps across adapters:
  ├── @mimicai/adapter-sdk
  ├── @modelcontextprotocol/sdk
  ├── fastify
  └── zod</code></pre>
</div>
