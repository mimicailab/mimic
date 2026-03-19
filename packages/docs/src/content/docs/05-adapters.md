---
title: "Adapters"
description: "Adapter catalog, database and API mock adapters, the Adapter SDK, and how to build your own."
order: 5
slug: "adapters"
prev: { slug: "cli", title: "CLI Reference" }
next: { slug: "mcp", title: "MCP Servers" }
---

<h2 id="adapter-list">Adapter Catalog</h2>

Mimic ships **9 API mock adapters** and **4 database adapters** today, with 100+ more on the roadmap. Every adapter is open source (Apache 2.0) and community-contributable.

<h3 id="adapter-databases">Database Adapters</h3>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Adapter</th><th>Package</th><th>Status</th><th>What it does</th></tr></thead>
    <tbody>
      <tr><td>PostgreSQL</td><td><code>@mimicai/adapter-postgres</code></td><td style="color: var(--green);">Shipped</td><td>Seeds tables via COPY FROM STDIN, FK-aware ordering</td></tr>
      <tr><td>MongoDB</td><td><code>@mimicai/adapter-mongodb</code></td><td style="color: var(--green);">Shipped</td><td>Seeds collections with embedded documents</td></tr>
      <tr><td>MySQL</td><td><code>@mimicai/adapter-mysql</code></td><td style="color: var(--green);">Shipped</td><td>Seeds tables with relational integrity</td></tr>
      <tr><td>SQLite</td><td><code>@mimicai/adapter-sqlite</code></td><td style="color: var(--green);">Shipped</td><td>File-based database seeding, WAL mode support</td></tr>
      <tr><td>Pinecone</td><td><code>@mimicai/adapter-pinecone</code></td><td>Planned</td><td>Seeds vector embeddings for RAG testing</td></tr>
      <tr><td>Redis</td><td><code>@mimicai/adapter-redis</code></td><td>Planned</td><td>Seeds key-value pairs, sorted sets, streams</td></tr>
    </tbody>
  </table>
</div>

<h3 id="adapter-api">API Mock Adapters</h3>

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div><p><strong>9 adapters shipped:</strong> All adapters below are published packages with full mock route coverage, MCP server support, and a standalone MCP binary (<code>src/bin/mcp.ts</code>). Each is built on <code>@mimicai/adapter-sdk</code>.</p></div>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Adapter</th><th>Package</th><th>Routes</th><th>Status</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><strong>Stripe</strong></td><td><code>@mimicai/adapter-stripe</code></td><td>616</td><td style="color: var(--green);">Shipped</td><td>Full v1 + v2 coverage: customers, payment intents, charges, refunds, subscriptions, invoices, products, prices, balance, billing meters, event destinations</td></tr>
      <tr><td><strong>Plaid</strong></td><td><code>@mimicai/adapter-plaid</code></td><td>10</td><td style="color: var(--green);">Shipped</td><td>Accounts, transactions, identity, auth, balance, institutions, link tokens</td></tr>
      <tr><td><strong>Paddle</strong></td><td><code>@mimicai/adapter-paddle</code></td><td>83</td><td style="color: var(--green);">Shipped</td><td>Subscriptions, products, prices, transactions, customers, discounts, adjustments</td></tr>
      <tr><td><strong>Chargebee</strong></td><td><code>@mimicai/adapter-chargebee</code></td><td>55</td><td style="color: var(--green);">Shipped</td><td>Subscriptions, customers, invoices, plans, addons, credit notes, payment sources</td></tr>
      <tr><td><strong>GoCardless</strong></td><td><code>@mimicai/adapter-gocardless</code></td><td>45</td><td style="color: var(--green);">Shipped</td><td>Mandates, payments, customers, subscriptions, bank accounts, refunds</td></tr>
      <tr><td><strong>Lemon Squeezy</strong></td><td><code>@mimicai/adapter-lemonsqueezy</code></td><td>50</td><td style="color: var(--green);">Shipped</td><td>Products, variants, orders, subscriptions, customers, discounts, license keys</td></tr>
      <tr><td><strong>Recurly</strong></td><td><code>@mimicai/adapter-recurly</code></td><td>47</td><td style="color: var(--green);">Shipped</td><td>Accounts, subscriptions, invoices, transactions, plans, coupons, credit adjustments</td></tr>
      <tr><td><strong>RevenueCat</strong></td><td><code>@mimicai/adapter-revenuecat</code></td><td>42</td><td style="color: var(--green);">Shipped</td><td>Subscribers, entitlements, offerings, products, purchases, receipts</td></tr>
      <tr><td><strong>Zuora</strong></td><td><code>@mimicai/adapter-zuora</code></td><td>54</td><td style="color: var(--green);">Shipped</td><td>Accounts, subscriptions, invoices, payments, products, rate plans, usage records</td></tr>
    </tbody>
  </table>
</div>

#### Fintech / Payments — shipped

<div class="adapter-doc-grid">
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Stripe</span><span class="adapter-doc-routes">616 routes</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Plaid</span><span class="adapter-doc-routes">10 routes</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Paddle</span><span class="adapter-doc-routes">83 routes</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Chargebee</span><span class="adapter-doc-routes">55 routes</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">GoCardless</span><span class="adapter-doc-routes">45 routes</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Lemon Squeezy</span><span class="adapter-doc-routes">50 routes</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Recurly</span><span class="adapter-doc-routes">47 routes</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">RevenueCat</span><span class="adapter-doc-routes">42 routes</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Zuora</span><span class="adapter-doc-routes">54 routes</span></div>
</div>

#### Fintech / Payments — planned

<div class="adapter-doc-grid">
  <div class="adapter-doc-item"><span class="adapter-doc-name">Square</span><span class="adapter-doc-routes">16 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Wise</span><span class="adapter-doc-routes">14 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Adyen</span><span class="adapter-doc-routes">12 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Coinbase</span><span class="adapter-doc-routes">12 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">PayPal</span><span class="adapter-doc-routes">13 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Brex</span><span class="adapter-doc-routes">10 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Ramp</span><span class="adapter-doc-routes">10 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Mercury</span><span class="adapter-doc-routes">9 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Moov</span><span class="adapter-doc-routes">8 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Marqeta</span><span class="adapter-doc-routes">12 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Checkout.com</span><span class="adapter-doc-routes">10 routes</span></div>
</div>

#### Communication — Roadmap

<div class="adapter-doc-grid">
  <div class="adapter-doc-item"><span class="adapter-doc-name">Slack</span><span class="adapter-doc-routes">planned</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Twilio</span><span class="adapter-doc-routes">planned</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">SendGrid</span><span class="adapter-doc-routes">11 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Discord</span><span class="adapter-doc-routes">13 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">MS Teams</span><span class="adapter-doc-routes">12 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">WhatsApp</span><span class="adapter-doc-routes">9 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Telegram</span><span class="adapter-doc-routes">11 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Mailgun</span><span class="adapter-doc-routes">10 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Postmark</span><span class="adapter-doc-routes">9 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Vonage</span><span class="adapter-doc-routes">8 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">MessageBird</span><span class="adapter-doc-routes">7 routes</span></div>
</div>

#### CRM — Roadmap (7 adapters)

<div class="adapter-doc-grid">
  <div class="adapter-doc-item"><span class="adapter-doc-name">Salesforce</span><span class="adapter-doc-routes">16 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">HubSpot</span><span class="adapter-doc-routes">16 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Pipedrive</span><span class="adapter-doc-routes">14 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Zoho CRM</span><span class="adapter-doc-routes">13 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Close</span><span class="adapter-doc-routes">14 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Attio</span><span class="adapter-doc-routes">12 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Dynamics 365</span><span class="adapter-doc-routes">11 routes</span></div>
</div>

#### Ticketing — Roadmap (8 adapters)

<div class="adapter-doc-grid">
  <div class="adapter-doc-item"><span class="adapter-doc-name">Zendesk</span><span class="adapter-doc-routes">24 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Jira</span><span class="adapter-doc-routes">21 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Linear</span><span class="adapter-doc-routes">20 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Intercom</span><span class="adapter-doc-routes">25 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">PagerDuty</span><span class="adapter-doc-routes">17 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Freshdesk</span><span class="adapter-doc-routes">18 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">ServiceNow</span><span class="adapter-doc-routes">9 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Shortcut</span><span class="adapter-doc-routes">22 routes</span></div>
</div>

#### Project Management — Roadmap (8 adapters)

<div class="adapter-doc-grid">
  <div class="adapter-doc-item"><span class="adapter-doc-name">Notion</span><span class="adapter-doc-routes">19 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Asana</span><span class="adapter-doc-routes">22 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Trello</span><span class="adapter-doc-routes">23 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Monday.com</span><span class="adapter-doc-routes">19 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Airtable</span><span class="adapter-doc-routes">11 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">ClickUp</span><span class="adapter-doc-routes">20 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Todoist</span><span class="adapter-doc-routes">18 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Basecamp</span><span class="adapter-doc-routes">23 routes</span></div>
</div>

#### Calendar / Scheduling — Roadmap (6 adapters)

<div class="adapter-doc-grid">
  <div class="adapter-doc-item"><span class="adapter-doc-name">Google Calendar</span><span class="adapter-doc-routes">10 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Calendly</span><span class="adapter-doc-routes">11 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Cal.com</span><span class="adapter-doc-routes">12 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Nylas</span><span class="adapter-doc-routes">9 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Cronofy</span><span class="adapter-doc-routes">10 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Acuity</span><span class="adapter-doc-routes">9 routes</span></div>
</div>

<h2 id="adapter-sdk">Adapter SDK</h2>

The `@mimicai/adapter-sdk` package provides the base classes and utilities for building API mock adapters. It re-exports core types and adds test helpers, format helpers, and two abstract base classes.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> npm install @mimicai/adapter-sdk</code></pre>
</div>

### Base Classes

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Class</th><th>When to use</th><th>What it provides</th></tr></thead>
    <tbody>
      <tr><td><code>BaseApiMockAdapter</code></td><td>Simple adapters with hand-written routes</td><td>Adapter lifecycle defaults (<code>init</code>, <code>apply</code>, <code>clean</code>, <code>healthcheck</code>, <code>dispose</code>)</td></tr>
      <tr><td><code>OpenApiMockAdapter</code></td><td><strong>Recommended.</strong> Adapters built from an OpenAPI spec via codegen</td><td>Everything in Base, plus automatic CRUD scaffolding (list/create/retrieve/update/delete), cursor pagination, override system, seeding from ExpandedData, and default factories</td></tr>
    </tbody>
  </table>
</div>

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div><p><strong>OpenApiMockAdapter</strong> is the standard path for new adapters. Given an OpenAPI spec, a codegen script generates routes, schemas, and resource specs. The base class auto-handles CRUD for every route &mdash; you only write custom "override" handlers for state-machine endpoints (e.g., confirm, capture, cancel).</p></div>
</div>

### Exports

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Export</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>BaseApiMockAdapter</code></td><td>Abstract class</td><td>Low-level base. Provides lifecycle defaults. Extend directly only for non-OpenAPI adapters.</td></tr>
      <tr><td><code>OpenApiMockAdapter</code></td><td>Abstract class</td><td>OpenAPI-driven base. Auto-scaffolds CRUD routes from generated route definitions, handles pagination, seeding, and the override system.</td></tr>
      <tr><td><code>buildTestServer(adapter, seedData?)</code></td><td>Function</td><td>Spins up an in-memory Fastify instance with your adapter routes loaded. Returns <code>{ server, stateStore, close }</code> &mdash; use <code>server.inject()</code> for in-process requests.</td></tr>
      <tr><td><code>MockServer</code></td><td>Class</td><td>The HTTP server used by <code>mimic host</code>. Use directly in integration tests to run a full mock server.</td></tr>
      <tr><td><code>StateStore</code></td><td>Class</td><td>In-memory key-value store shared across routes for mutation tracking (e.g. created/updated resources)</td></tr>
      <tr><td><code>generateId</code></td><td>Function</td><td>Generate prefixed IDs matching real platform formats (e.g. <code>cus_xxx</code>, <code>pi_xxx</code>)</td></tr>
      <tr><td><code>unixNow</code>, <code>toDateStr</code>, <code>capitalize</code></td><td>Utilities</td><td>Formatting helpers for response generation</td></tr>
    </tbody>
  </table>
</div>

### Methods to implement

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Method</th><th>Required</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>registerRoutes(server, data, stateStore)</code></td><td>Yes</td><td>Mount Fastify routes. For <code>OpenApiMockAdapter</code>, call <code>this.mountOverrides(store)</code> then <code>this.registerGeneratedRoutes(server, data, store, ns)</code>.</td></tr>
      <tr><td><code>resolvePersona(req)</code></td><td>Yes</td><td>Extract persona ID from the incoming request (auth header, body field, or query param)</td></tr>
      <tr><td><code>getEndpoints()</code></td><td>Yes</td><td>Return <code>EndpointDefinition[]</code>. For <code>OpenApiMockAdapter</code>, just call <code>this.endpointsFromRoutes()</code>.</td></tr>
      <tr><td><code>registerMcpTools(mcpServer, mockBaseUrl)</code></td><td>No</td><td>Register MCP tools on the MCP server pointed at your mock API URL. Required if you want <code>mcp: true</code> in <code>mimic.json</code> to expose tools to agents.</td></tr>
    </tbody>
  </table>
</div>

<h2 id="adapter-dev">Build an Adapter</h2>

Adapters are built from OpenAPI specs using a **codegen-driven pipeline**. A codegen script reads the spec and generates route definitions, schema defaults, and resource metadata. The `OpenApiMockAdapter` base class auto-scaffolds CRUD for every generated route &mdash; you only write custom handlers for state-machine endpoints.

### Pipeline overview

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">text</span><button class="code-copy">Copy</button></div>
  <pre><code>OpenAPI spec (.json)
    &darr;
Codegen script (pnpm generate)
    &darr;
  src/generated/
    ├── routes.ts           &larr; HTTP route definitions (method, path, operation type)
    ├── resource-specs.ts   &larr; Field metadata for data generation
    ├── schemas.ts          &larr; Default factory functions (one per resource)
    └── meta.ts             &larr; Spec version + timestamp
    &darr;
Adapter class (extends OpenApiMockAdapter)
    ├── CRUD scaffolding    &larr; Automatic from generated routes
    ├── Override handlers   &larr; State machines, computed endpoints
    ├── MCP tools           &larr; AI agent access
    └── Error helpers       &larr; Platform-specific error format</code></pre>
</div>

### Package structure

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">text</span><button class="code-copy">Copy</button></div>
  <pre><code>packages/adapters/adapter-{name}/
├── adapter.json                 &larr; Identity: id, basePath, versions, spec URL
├── {name}-spec.json             &larr; OpenAPI spec (gitignored, download from source)
├── scripts/
│   └── {name}-codegen.ts        &larr; Reads spec &rarr; generates TypeScript files
├── src/
│   ├── index.ts                 &larr; Public exports + AdapterManifest
│   ├── adapter-meta.ts          &larr; Loads adapter.json at runtime
│   ├── config.ts                &larr; Zod config schema
│   ├── {name}-adapter.ts        &larr; Adapter class
│   ├── {name}-errors.ts         &larr; Platform-specific error builders
│   ├── mcp.ts                   &larr; MCP tool registration
│   ├── bin/mcp.ts               &larr; Standalone MCP binary
│   ├── generated/               &larr; Auto-generated (never hand-edit)
│   │   ├── routes.ts
│   │   ├── resource-specs.ts
│   │   ├── schemas.ts
│   │   └── meta.ts
│   ├── overrides/               &larr; Custom route handlers
│   └── __tests__/
└── package.json                 &larr; Scripts: build, generate, test</code></pre>
</div>

### Step 1: adapter.json

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>adapter.json</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  "id": "my-platform",
  "name": "My Platform API",
  "description": "My Platform mock adapter",
  "type": "api-mock",
  "basePath": "/my-platform",
  "versions": ["2025-01-01", "2026-01-01"],
  "specUrl": "https://example.com/openapi/spec.json",
  "specFile": "my-platform-spec.json",
  "mcp": {
    "serverName": "mimic-my-platform",
    "serverVersion": "0.5.0",
    "description": "Mimic MCP server for My Platform"
  }
}</code></pre>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Purpose</th></tr></thead>
    <tbody>
      <tr><td><code>id</code></td><td>Unique identifier. Used as StateStore namespace prefix (<code>{id}:{resource}</code>)</td></tr>
      <tr><td><code>basePath</code></td><td>URL prefix for all routes (e.g., <code>/my-platform</code>). Routes become <code>/{basePath}/v1/{path}</code></td></tr>
      <tr><td><code>versions</code></td><td>API versions this adapter supports</td></tr>
      <tr><td><code>specFile</code></td><td>OpenAPI spec filename (gitignored &mdash; download from <code>specUrl</code>)</td></tr>
      <tr><td><code>mcp</code></td><td>MCP server metadata for Claude/AI tool registration</td></tr>
    </tbody>
  </table>
</div>

### Step 2: Codegen script

The codegen script reads the OpenAPI spec and generates four TypeScript files. Each API has different conventions, so the codegen is adapter-specific.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> pnpm --filter @mimicai/adapter-my-platform generate</code></pre>
</div>

The script must:

1. **Extract resources** from OpenAPI schemas (via `x-resourceId`, tags, or schema names)
2. **Extract routes** from paths, converting `{param}` to `:param` for Fastify
3. **Detect operation type** for each route: `list`, `create`, `retrieve`, `update`, `delete`, or `action`
4. **Map fields** with semantic metadata: ID prefixes, timestamps, amount formats, enums, refs
5. **Generate default factories** &mdash; one function per resource that returns a spec-faithful default object

Key codegen concerns:

- **Multi-version paths**: Use `path.replace(/^\/v\d+\//, '')` to strip version prefixes generically
- **ID prefixes**: Usually not in the spec &mdash; hardcode a `ID_PREFIXES` map (e.g., `customer: 'cus_'`)
- **Volume hints**: Classify resources as `entity` (main objects) or `reference` (supporting data) for blueprint generation
- **Field overrides**: Some spec defaults are wrong for mock data (e.g., payment_intent status should default to `requires_payment_method`, not `canceled`)

### Step 3: Generated files

All generated files go in `src/generated/` with the banner `// !! AUTO-GENERATED — do not edit`.

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>File</th><th>Exports</th><th>Used by</th></tr></thead>
    <tbody>
      <tr><td><code>routes.ts</code></td><td><code>GENERATED_ROUTES: GeneratedRoute[]</code></td><td>OpenApiMockAdapter CRUD scaffolding, endpoint listing</td></tr>
      <tr><td><code>resource-specs.ts</code></td><td><code>AdapterResourceSpecs</code></td><td>Blueprint engine for data generation</td></tr>
      <tr><td><code>schemas.ts</code></td><td><code>SCHEMA_DEFAULTS: Record&lt;string, DefaultFactory&gt;</code></td><td>Create handlers and seeding</td></tr>
      <tr><td><code>meta.ts</code></td><td>Spec version + timestamp</td><td>Informational</td></tr>
    </tbody>
  </table>
</div>

Each `DefaultFactory` returns a full object with spec-faithful defaults, merging any overrides:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">typescript</span><span>schemas.ts (generated)</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="kw">export function</span> <span class="fn">defaultCustomer</span>(overrides = {}) {
  <span class="kw">return</span> {
    id: generateId(<span class="str">"cus_"</span>, 14),
    object: <span class="str">"customer"</span>,
    created: unixNow(),
    email: <span class="kw">null</span>,
    metadata: {},
    <span class="cm">// ... every field from the schema</span>
    ...overrides,
  };
}</code></pre>
</div>

### Step 4: Adapter class

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">typescript</span><span>src/my-platform-adapter.ts</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="kw">import</span> { <span class="ty">OpenApiMockAdapter</span> } <span class="kw">from</span> <span class="str">'@mimicai/adapter-sdk'</span>;
<span class="kw">import</span> meta <span class="kw">from</span> <span class="str">'./adapter-meta.js'</span>;
<span class="kw">import</span> { myPlatformResourceSpecs } <span class="kw">from</span> <span class="str">'./generated/resource-specs.js'</span>;
<span class="kw">import</span> { SCHEMA_DEFAULTS } <span class="kw">from</span> <span class="str">'./generated/schemas.js'</span>;
<span class="kw">import</span> { GENERATED_ROUTES } <span class="kw">from</span> <span class="str">'./generated/routes.js'</span>;
&#8203;
<span class="kw">function</span> <span class="fn">ns</span>(resource: <span class="ty">string</span>): <span class="ty">string</span> {
  <span class="kw">return</span> <span class="str">`myplatform:${resource}`</span>;
}
&#8203;
<span class="kw">export class</span> <span class="ty">MyPlatformAdapter</span> <span class="kw">extends</span> <span class="ty">OpenApiMockAdapter</span> {
  <span class="kw">readonly</span> id = meta.id;
  <span class="kw">readonly</span> name = meta.name;
  <span class="kw">readonly</span> basePath = meta.basePath;
  <span class="kw">readonly</span> versions = meta.versions;
  <span class="kw">readonly</span> resourceSpecs = myPlatformResourceSpecs;
&#8203;
  <span class="kw">protected readonly</span> generatedRoutes = GENERATED_ROUTES;
  <span class="kw">protected readonly</span> defaultFactories = SCHEMA_DEFAULTS;
&#8203;
  <span class="kw">async</span> <span class="fn">registerRoutes</span>(server, data, store) {
    <span class="kw">this</span>.mountOverrides(store);  <span class="cm">// Override handlers FIRST</span>
    <span class="kw">await this</span>.registerGeneratedRoutes(server, data, store, ns);  <span class="cm">// CRUD scaffolding</span>
  }
&#8203;
  <span class="fn">getEndpoints</span>() { <span class="kw">return this</span>.endpointsFromRoutes(); }
&#8203;
  <span class="fn">resolvePersona</span>(req) {
    <span class="cm">// Match platform auth pattern (API key, Bearer token, etc.)</span>
    <span class="kw">const</span> auth = req.headers.authorization;
    <span class="kw">if</span> (!auth) <span class="kw">return null</span>;
    <span class="kw">const</span> match = auth.match(<span class="str">/^Bearer\s+test_([a-z0-9-]+)_/</span>);
    <span class="kw">return</span> match ? match[1] : <span class="kw">null</span>;
  }
&#8203;
  <span class="kw">private</span> <span class="fn">mountOverrides</span>(store) {
    <span class="cm">// Register state-machine handlers BEFORE registerGeneratedRoutes()</span>
    <span class="kw">this</span>.registerOverride(<span class="str">'POST'</span>, <span class="str">'/my-platform/v1/orders/:order/confirm'</span>,
      orderOverrides.buildConfirmHandler(store));
  }
}</code></pre>
</div>

### Step 5: Override handlers

Overrides replace auto-generated CRUD for endpoints that need custom logic &mdash; state transitions, cross-resource side effects, computed responses, or singletons.

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Use case</th><th>Example</th></tr></thead>
    <tbody>
      <tr><td>State machine transition</td><td><code>POST /orders/:id/confirm</code> (draft &rarr; confirmed)</td></tr>
      <tr><td>Cross-resource side effect</td><td>Creating a refund updates <code>charge.amount_refunded</code></td></tr>
      <tr><td>Computed response</td><td><code>GET /balance</code> computed from charges &minus; refunds</td></tr>
      <tr><td>Singleton resource</td><td><code>GET /account</code> (no ID param, not a list)</td></tr>
      <tr><td>Non-standard create</td><td>Subscription create converts items array to list format</td></tr>
      <tr><td>Non-standard delete</td><td>Subscription delete returns updated object, not deleted stub</td></tr>
    </tbody>
  </table>
</div>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">typescript</span><span>src/overrides/orders.ts</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="kw">export function</span> <span class="fn">buildConfirmHandler</span>(store: <span class="ty">StateStore</span>): <span class="ty">OverrideHandler</span> {
  <span class="kw">return async</span> (req, reply) =&gt; {
    <span class="kw">const</span> { order } = req.params <span class="kw">as</span> { order: <span class="ty">string</span> };
    <span class="kw">const</span> existing = store.get(<span class="str">'myplatform:orders'</span>, order);
    <span class="kw">if</span> (!existing) <span class="kw">return</span> reply.code(404).send(notFoundError(order));
    <span class="kw">if</span> (existing.status !== <span class="str">'draft'</span>)
      <span class="kw">return</span> reply.code(400).send(stateError(<span class="str">`Cannot confirm: ${existing.status}`</span>));
&#8203;
    <span class="kw">const</span> updated = { ...existing, status: <span class="str">'confirmed'</span>, confirmed_at: unixNow() };
    store.set(<span class="str">'myplatform:orders'</span>, order, updated);
    <span class="kw">return</span> reply.code(200).send(updated);
  };
}</code></pre>
</div>

### What you get for free from OpenApiMockAdapter

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Operation</th><th>Auto-generated behavior</th></tr></thead>
    <tbody>
      <tr><td><strong>List</strong> (GET /resource)</td><td>Cursor pagination (<code>starting_after</code>, <code>ending_before</code>, <code>limit</code>), query filtering by declared params</td></tr>
      <tr><td><strong>Create</strong> (POST /resource)</td><td>Uses DefaultFactory, generates ID + timestamp, merges request body</td></tr>
      <tr><td><strong>Retrieve</strong> (GET /resource/:id)</td><td>Lookup by idParam, 404 with platform error format if missing</td></tr>
      <tr><td><strong>Update</strong> (POST /resource/:id)</td><td>Fetch + merge body (deep-merges metadata)</td></tr>
      <tr><td><strong>Delete</strong> (DELETE /resource/:id)</td><td>Remove from store, return <code>{ id, object, deleted: true }</code></td></tr>
      <tr><td><strong>Action</strong> (POST /resource/:id/verb)</td><td>Returns 501 unless overridden</td></tr>
      <tr><td><strong>Seeding</strong></td><td>Maps <code>ExpandedData.apiResponses</code> into StateStore, enriches with factories</td></tr>
      <tr><td><strong>Endpoints</strong></td><td><code>endpointsFromRoutes()</code> builds <code>EndpointDefinition[]</code> from generated routes</td></tr>
    </tbody>
  </table>
</div>

You can customize behavior by overriding protected methods: `wrapList()`, `paginate()`, `mergeUpdate()`, `deleteResponse()`, `notFoundError()`, `parseBody()`.

### Build workflow

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="cm"># Download the OpenAPI spec (gitignored)</span>
<span class="prompt">$</span> curl -o packages/adapters/adapter-{name}/{name}-spec.json {SPEC_URL}
&#8203;
<span class="cm"># Generate routes, schemas, resource-specs from the spec</span>
<span class="prompt">$</span> pnpm --filter @mimicai/adapter-{name} generate
&#8203;
<span class="cm"># Build</span>
<span class="prompt">$</span> pnpm --filter @mimicai/adapter-{name} build
&#8203;
<span class="cm"># Test</span>
<span class="prompt">$</span> pnpm --filter @mimicai/adapter-{name} test</code></pre>
</div>

### Key guidelines

- **Match real response shapes exactly** &mdash; agents are trained on real API docs
- **Match real ID formats** &mdash; Stripe uses `cus_xxx`, Jira uses `MIM-1`, Notion uses UUIDs
- **Match real error formats** &mdash; Stripe wraps in `{"error": {...}}`, Jira uses `{"errorMessages": [...]}`
- **Use path param names from generated routes** &mdash; these may differ from the spec docs (e.g., Stripe uses `:intent` not `:payment_intent`)
- **Register overrides BEFORE `registerGeneratedRoutes()`** &mdash; the base class checks the override map and skips CRUD for matched routes
- **Rebuild adapter-sdk after changing the base class** &mdash; `pnpm --filter @mimicai/adapter-sdk build`

### Submission checklist

<ul class="checklist">
  <li><span class="checklist-box"></span>Extends <code>OpenApiMockAdapter</code> from <code>@mimicai/adapter-sdk</code></li>
  <li><span class="checklist-box"></span><code>adapter.json</code> with id, basePath, versions, specUrl, specFile, mcp config</li>
  <li><span class="checklist-box"></span>Codegen script reads spec and generates <code>routes.ts</code>, <code>resource-specs.ts</code>, <code>schemas.ts</code>, <code>meta.ts</code></li>
  <li><span class="checklist-box"></span><code>resolvePersona()</code> matches platform auth pattern</li>
  <li><span class="checklist-box"></span>Override handlers for state-machine and computed endpoints</li>
  <li><span class="checklist-box"></span>Platform-specific error helpers matching real error format</li>
  <li><span class="checklist-box"></span><code>registerMcpTools()</code> registers tools for key endpoints</li>
  <li><span class="checklist-box"></span>Tests cover CRUD, overrides, and seeding using <code>buildTestServer</code></li>
  <li><span class="checklist-box"></span>TypeScript strict mode, no untyped <code>any</code></li>
</ul>

PRs are reviewed within 48 hours.
