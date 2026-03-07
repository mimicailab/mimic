---
title: "Adapters"
description: "Adapter catalog, database and API mock adapters, the Adapter SDK, and how to build your own."
order: 5
slug: "adapters"
prev: { slug: "cli", title: "CLI Reference" }
next: { slug: "mcp", title: "MCP Servers" }
---

<h2 id="adapter-list">Adapter Catalog</h2>

Mimic ships **10 API mock adapters** and **4 database adapters** today, with more planned. Every adapter is open source (Apache 2.0) and community-contributable.

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
  <div><p><strong>10 adapters shipped:</strong> All adapters below are published packages with full mock route coverage, MCP server support, and a standalone MCP binary (<code>src/bin/mcp.ts</code>). Each is built on <code>@mimicai/adapter-sdk</code>.</p></div>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Adapter</th><th>Package</th><th>Routes</th><th>Status</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><strong>Stripe</strong></td><td><code>@mimicai/adapter-stripe</code></td><td>44</td><td style="color: var(--green);">Shipped</td><td>Customers, payment intents, charges, refunds, subscriptions, invoices, products, prices, balance</td></tr>
      <tr><td><strong>Plaid</strong></td><td><code>@mimicai/adapter-plaid</code></td><td>10</td><td style="color: var(--green);">Shipped</td><td>Accounts, transactions, identity, auth, balance, institutions, link tokens</td></tr>
      <tr><td><strong>Slack</strong></td><td><code>@mimicai/adapter-slack</code></td><td>28</td><td style="color: var(--green);">Shipped</td><td>Channels, messages, threads, reactions, users, search, team info</td></tr>
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
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Stripe</span><span class="adapter-doc-routes">44 routes</span></div>
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

#### Communication

<div class="adapter-doc-grid">
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Slack</span><span class="adapter-doc-routes">28 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Twilio</span><span class="adapter-doc-routes">14 routes</span></div>
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

#### CRM (7 adapters)

<div class="adapter-doc-grid">
  <div class="adapter-doc-item"><span class="adapter-doc-name">Salesforce</span><span class="adapter-doc-routes">16 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">HubSpot</span><span class="adapter-doc-routes">16 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Pipedrive</span><span class="adapter-doc-routes">14 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Zoho CRM</span><span class="adapter-doc-routes">13 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Close</span><span class="adapter-doc-routes">14 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Attio</span><span class="adapter-doc-routes">12 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Dynamics 365</span><span class="adapter-doc-routes">11 routes</span></div>
</div>

#### Ticketing (8 adapters)

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

#### Project Management (8 adapters)

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

#### Calendar / Scheduling (6 adapters)

<div class="adapter-doc-grid">
  <div class="adapter-doc-item"><span class="adapter-doc-name">Google Calendar</span><span class="adapter-doc-routes">10 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Calendly</span><span class="adapter-doc-routes">11 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Cal.com</span><span class="adapter-doc-routes">12 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Nylas</span><span class="adapter-doc-routes">9 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Cronofy</span><span class="adapter-doc-routes">10 routes</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Acuity</span><span class="adapter-doc-routes">9 routes</span></div>
</div>

<h2 id="adapter-sdk">Adapter SDK</h2>

The `@mimicai/adapter-sdk` package provides the base class and utilities for building API mock adapters. It re-exports core types and adds test helpers, format helpers, and `BaseApiMockAdapter` &mdash; an abstract class that handles the adapter lifecycle so you only implement API-specific logic.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> npm install @mimicai/adapter-sdk</code></pre>
</div>

### Exports

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Export</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>BaseApiMockAdapter</code></td><td>Abstract class</td><td>Extend this to build adapters. Provides default <code>init</code>, <code>apply</code>, <code>clean</code>, <code>healthcheck</code>, <code>dispose</code>. Has optional <code>versions</code> property for API versioning.</td></tr>
      <tr><td><code>buildTestServer(adapter, seedData?)</code></td><td>Function</td><td>Spins up an in-memory Fastify instance with your adapter routes loaded. Returns <code>{ server, stateStore, close }</code> &mdash; use <code>server.inject()</code> for in-process requests.</td></tr>
      <tr><td><code>MockServer</code></td><td>Class</td><td>The HTTP server used by <code>mimic host</code>. Use directly in integration tests to run a full mock server.</td></tr>
      <tr><td><code>StateStore</code></td><td>Class</td><td>In-memory key-value store shared across routes for mutation tracking (e.g. created/updated resources)</td></tr>
      <tr><td><code>generateId</code></td><td>Function</td><td>Generate prefixed IDs matching real platform formats (e.g. <code>cus_xxx</code>, <code>pi_xxx</code>)</td></tr>
      <tr><td><code>paginate</code></td><td>Function</td><td>Cursor-based or offset-based pagination helper</td></tr>
      <tr><td><code>filterByDate</code></td><td>Function</td><td>Date range filtering for collections</td></tr>
      <tr><td><code>resolvePersonaFromBearer</code></td><td>Function</td><td>Extract persona ID from <code>Authorization: Bearer</code> header</td></tr>
      <tr><td><code>resolvePersonaFromBody</code></td><td>Function</td><td>Extract persona ID from request body</td></tr>
      <tr><td><code>unixNow</code>, <code>toDateStr</code>, <code>capitalize</code></td><td>Utilities</td><td>Formatting helpers for response generation</td></tr>
    </tbody>
  </table>
</div>

### Methods to implement

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Method</th><th>Required</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>registerRoutes(server, data, stateStore)</code></td><td>Yes</td><td>Mount Fastify routes. <code>data</code> is a <code>Map&lt;string, ExpandedData&gt;</code> keyed by persona name.</td></tr>
      <tr><td><code>resolvePersona(req)</code></td><td>Yes</td><td>Extract persona ID from the incoming request (auth header, body field, or query param)</td></tr>
      <tr><td><code>getEndpoints()</code></td><td>Yes</td><td>Return <code>EndpointDefinition[]</code> used by <code>mimic adapters inspect</code> and the adapter catalog. Not used for MCP.</td></tr>
      <tr><td><code>registerMcpTools(mcpServer, mockBaseUrl)</code></td><td>No</td><td>Register MCP tools on the MCP server pointed at your mock API URL. Required if you want <code>mcp: true</code> in <code>mimic.json</code> to expose tools to agents.</td></tr>
    </tbody>
  </table>
</div>

<h2 id="adapter-dev">Build an Adapter</h2>

Every adapter extends `BaseApiMockAdapter` from the adapter SDK. Copy an existing adapter as a starting point:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> cp -r packages/adapters/adapter-plaid packages/adapters/adapter-my-platform</code></pre>
</div>

### The Adapter Structure

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">typescript</span><span>src/my-platform-adapter.ts</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="kw">import</span> { <span class="ty">McpServer</span> } <span class="kw">from</span> <span class="str">'@modelcontextprotocol/sdk/server/mcp.js'</span>;
<span class="kw">import</span> { <span class="ty">BaseApiMockAdapter</span>, <span class="ty">EndpointDefinition</span> } <span class="kw">from</span> <span class="str">'@mimicai/adapter-sdk'</span>;
&#8203;
<span class="kw">export class</span> <span class="ty">MyPlatformAdapter</span> <span class="kw">extends</span> <span class="ty">BaseApiMockAdapter</span> {
  <span class="kw">readonly</span> id <span class="op">=</span> <span class="str">'my-platform'</span>;
  <span class="kw">readonly</span> name <span class="op">=</span> <span class="str">'My Platform API'</span>;
  <span class="kw">readonly</span> basePath <span class="op">=</span> <span class="str">'/my-platform'</span>;
  <span class="kw">readonly</span> versions <span class="op">=</span> [<span class="str">'v1'</span>]; <span class="cm">// optional — API version strings</span>
&#8203;
  <span class="cm">// Extract persona ID from incoming request</span>
  <span class="fn">resolvePersona</span>(req): <span class="ty">string</span> | <span class="ty">null</span> { <span class="cm">/* ... */</span> }
&#8203;
  <span class="cm">// Mount HTTP routes on the Fastify server</span>
  <span class="kw">async</span> <span class="fn">registerRoutes</span>(server, data, stateStore) { <span class="cm">/* ... */</span> }
&#8203;
  <span class="cm">// Declare endpoints for the adapter catalog</span>
  <span class="fn">getEndpoints</span>(): <span class="ty">EndpointDefinition</span>[] { <span class="cm">/* ... */</span> }
&#8203;
  <span class="cm">// Register MCP tools (needed for mcp: true in mimic.json)</span>
  <span class="fn">registerMcpTools</span>(mcpServer: <span class="ty">McpServer</span>, mockBaseUrl: <span class="ty">string</span>): <span class="ty">void</span> {
    mcpServer.tool(<span class="str">'get_my_resource'</span>, <span class="str">'Fetch a resource'</span>, {}, <span class="kw">async</span> () =&gt; {
      <span class="kw">const</span> data <span class="op">=</span> <span class="kw">await</span> <span class="fn">fetch</span>(<span class="str">`${mockBaseUrl}/my-platform/resources`</span>);
      <span class="kw">return</span> { content: [{ type: <span class="str">'text'</span>, text: <span class="ty">JSON</span>.stringify(<span class="kw">await</span> data.json()) }] };
    });
  }
}</code></pre>
</div>

### Key guidelines

- **Match real response shapes exactly** &mdash; agents are trained on real API docs
- **Match real ID formats** &mdash; Stripe uses `cus_xxx`, Jira uses `MIM-1`, Notion uses UUIDs
- **Match real pagination** &mdash; cursor-based, offset-based, or page-based per platform
- **Match real error formats** &mdash; Stripe wraps in `{"error": {...}}`, Jira uses `{"errorMessages": [...]}`
- **Seed realistic data** &mdash; no "test", "foo", "bar" in seed values
- **Aim for 8-20 routes** &mdash; cover core CRUD + 1-2 domain-specific actions
- **Implement `registerMcpTools`** &mdash; required for your adapter to expose tools via `mcp: true`

### Submission checklist

<ul class="checklist">
  <li><span class="checklist-box"></span>Extends <code>BaseApiMockAdapter</code> from <code>@mimicai/adapter-sdk</code></li>
  <li><span class="checklist-box"></span><code>resolvePersona()</code> matches platform auth pattern</li>
  <li><span class="checklist-box"></span>8+ routes covering core CRUD operations</li>
  <li><span class="checklist-box"></span>Realistic seed data (3-5 records per resource)</li>
  <li><span class="checklist-box"></span>Response shapes match real API docs</li>
  <li><span class="checklist-box"></span>Error responses match real API error format</li>
  <li><span class="checklist-box"></span><code>getEndpoints()</code> returns all route definitions</li>
  <li><span class="checklist-box"></span><code>registerMcpTools()</code> registers tools for all key endpoints</li>
  <li><span class="checklist-box"></span>Tests cover list, create, get, update using <code>buildTestServer</code></li>
  <li><span class="checklist-box"></span>TypeScript strict mode, no untyped <code>any</code></li>
</ul>

PRs are reviewed within 48 hours.
