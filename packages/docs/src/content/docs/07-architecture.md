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
│   mimic init │ mimic seed │ mimic host │ mimic test       │
└─────────────────────────┬────────────────────────────────┘
                          │
             ┌────────────┼────────────┐
             │            │            │
             v            v            v
  ┌──────────────┐ ┌────────────┐ ┌────────────┐
  │  Blueprint   │ │ Mock Server│ │Test Runner  │
  │              │ │            │ │             │
  │ Persona load │ │ Fastify    │ │ Scenarios   │
  │ Engine (Pro) │ │ Adapters   │ │ Eval (Pro)  │
  │ Expander     │ │ State store│ │ Coverage    │
  └──────┬───────┘ └──────┬─────┘ └─────────────┘
         │          ┌─────┴─────┐
         │          │           │
         v          v           v
  ┌──────────┐ ┌────────┐ ┌────────┐
  │ Database │ │API Mock│ │  MCP   │
  │ Adapters │ │Adapters│ │Servers │
  │          │ │        │ │        │
  │ Postgres │ │ Stripe │ │mcp-jira│
  │ MongoDB  │ │ Plaid  │ │mcp-slk │
  │ MySQL    │ │ 60+    │ │ ...    │
  └────┬─────┘ └────────┘ └────────┘
       v
   Real databases</code></pre>
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
  <pre><code>Agent sends: GET /jira/rest/api/3/search?jql=project=MIM
&#8203;
Mock Server
  ├─ Route matched: /jira/* &rarr; JiraAdapter
  ├─ JiraAdapter.handleSearch(req, reply)
  │   ├─ seedData()   &mdash; populate state store if empty
  │   ├─ Parse JQL from query params
  │   ├─ Filter state store by parsed criteria
  │   ├─ Format response matching Jira's real shape
  │   └─ reply.send({ issues: [...], total: N })
  └─ Response returned to agent</code></pre>
</div>

### MCP flow

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">text</span><button class="code-copy">Copy</button></div>
  <pre><code>Agent calls MCP tool: search_jql({ jql: "project = MIM" })
&#8203;
MCP Server (@mimicai/mcp-jira)
  ├─ Validate params with Zod schema
  ├─ Translate to HTTP:
  │   POST http://localhost:4000/jira/rest/api/3/search
  ├─ Parse response
  ├─ Format for agent: "Found 5 issues: MIM-1 | In Progress | ..."
  └─ Return MCP response</code></pre>
</div>

<h2 id="arch-consistency">Cross-Surface Consistency</h2>

The Blueprint Engine's core differentiator. When it generates data for persona "Alex", the **same Alex appears across all surfaces**:

- PostgreSQL `users` table has Alex with ID `user_001`
- Plaid API returns bank accounts owned by `user_001`
- Stripe API returns payment history for `user_001`'s card
- Jira API returns issues assigned to Alex
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
  │     ├── blueprint engine, consistency, test runner
  │     └── schema parsing (prisma-ast, pgsql-parser)
  ├── @mimicai/adapter-sdk
  │     └── BaseApiMockAdapter, test helpers, format helpers
  ├── @mimicai/adapter-postgres    (shipped)
  ├── @mimicai/adapter-mongodb     (shipped)
  ├── @mimicai/adapter-mysql       (shipped)
  ├── @mimicai/adapter-sqlite      (shipped)
  ├── @mimicai/adapter-stripe      (shipped, + MCP)
  ├── @mimicai/adapter-plaid       (shipped, + MCP)
  ├── @mimicai/adapter-slack       (shipped, + MCP)
  └── @mimicai/blueprints
        └── pre-built personas (JSON)
&#8203;
@mimicai/mcp-stripe (standalone binary)
  └── @modelcontextprotocol/sdk
&#8203;
@mimicai/adapter-sdk (standalone)
  └── zod, fastify (peer deps)</code></pre>
</div>
