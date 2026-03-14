---
title: "MCP Servers"
description: "MCP server overview, setup with Claude Code and Cursor, and how to build servers."
order: 6
slug: "mcp"
prev: { slug: "adapters", title: "Adapters" }
next: { slug: "architecture", title: "Architecture" }
---

<h2 id="mcp-overview">MCP Servers &mdash; Overview</h2>

Every API mock adapter has a corresponding MCP server. MCP servers translate MCP tool calls into HTTP requests against the Mimic mock server.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">text</span><span>data flow</span><button class="code-copy">Copy</button></div>
  <pre><code>AI Agent  &mdash;MCP&mdash;&gt;  Mimic MCP Server  &mdash;HTTP&mdash;&gt;  Mimic Mock Adapter
(Claude)           (adapter-stripe)              (Stripe mock routes)</code></pre>
</div>

This matters because many agent frameworks use MCP as their primary tool interface. Mimic MCP servers give agents realistic mock data through the same protocol they'll use in production.

<h2 id="mcp-setup">MCP Setup &amp; Config</h2>

### With Claude Code

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> claude mcp add mimic-stripe -- npx -y @mimicai/adapter-stripe mcp
&#8203;
<span class="cm"># With custom URL</span>
<span class="prompt">$</span> claude mcp add <span class="flag">--env MIMIC_BASE_URL=http://localhost:4100</span> mimic-stripe -- npx -y @mimicai/adapter-stripe mcp</code></pre>
</div>

### With Cursor / VS Code

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>MCP config</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"mcpServers"</span>: {
    <span class="yk">"mimic-stripe"</span>: {
      <span class="yk">"command"</span>: <span class="str">"npx"</span>,
      <span class="yk">"args"</span>: [<span class="str">"-y"</span>, <span class="str">"@mimicai/adapter-stripe"</span>, <span class="str">"mcp"</span>],
      <span class="yk">"env"</span>: { <span class="yk">"MIMIC_BASE_URL"</span>: <span class="str">"http://localhost:4100"</span> }
    },
    <span class="yk">"mimic-plaid"</span>: {
      <span class="yk">"command"</span>: <span class="str">"npx"</span>,
      <span class="yk">"args"</span>: [<span class="str">"-y"</span>, <span class="str">"@mimicai/adapter-plaid"</span>, <span class="str">"mcp"</span>],
      <span class="yk">"env"</span>: { <span class="yk">"MIMIC_BASE_URL"</span>: <span class="str">"http://localhost:4100"</span> }
    }
  }
}</code></pre>
</div>

### With Mimic CLI

The simplest way &mdash; configure adapters in `mimic.json` with `mcp: true` and `mimic host` starts everything together:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>mimic.json</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"apis"</span>: {
    <span class="yk">"stripe"</span>: { <span class="yk">"enabled"</span>: <span class="ty">true</span>, <span class="yk">"mcp"</span>: <span class="ty">true</span> },
    <span class="yk">"plaid"</span>: { <span class="yk">"enabled"</span>: <span class="ty">true</span>, <span class="yk">"mcp"</span>: <span class="ty">true</span> }
  }
}</code></pre>
</div>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic host
&#8203;
<span class="ok">&#10003;</span> <span class="out">Stripe API    &rarr; http://localhost:4101/stripe/v1</span>
<span class="ok">&#10003;</span> <span class="out">Stripe MCP    &rarr; http://localhost:4201/sse</span>
<span class="ok">&#10003;</span> <span class="out">Plaid API     &rarr; http://localhost:4102/plaid</span>
<span class="ok">&#10003;</span> <span class="out">Plaid MCP     &rarr; http://localhost:4202/sse</span>
<span class="ok">&#10003;</span> <span class="out">Ready in 1.4s</span></code></pre>
</div>

<h2 id="mcp-catalog">Available MCP Servers</h2>

All 9 shipped adapters include a full MCP server. Each can be run standalone via `npx` or started together via `mimic host`.

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Adapter</th><th>Package</th><th>Standalone MCP Command</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td><strong>Stripe</strong></td><td><code>@mimicai/adapter-stripe</code></td><td><code>npx @mimicai/adapter-stripe mcp</code></td><td style="color: var(--green);">Shipped</td></tr>
      <tr><td><strong>Plaid</strong></td><td><code>@mimicai/adapter-plaid</code></td><td><code>npx @mimicai/adapter-plaid mcp</code></td><td style="color: var(--green);">Shipped</td></tr>
      <tr><td><strong>Paddle</strong></td><td><code>@mimicai/adapter-paddle</code></td><td><code>npx @mimicai/adapter-paddle mcp</code></td><td style="color: var(--green);">Shipped</td></tr>
      <tr><td><strong>Chargebee</strong></td><td><code>@mimicai/adapter-chargebee</code></td><td><code>npx @mimicai/adapter-chargebee mcp</code></td><td style="color: var(--green);">Shipped</td></tr>
      <tr><td><strong>GoCardless</strong></td><td><code>@mimicai/adapter-gocardless</code></td><td><code>npx @mimicai/adapter-gocardless mcp</code></td><td style="color: var(--green);">Shipped</td></tr>
      <tr><td><strong>Lemon Squeezy</strong></td><td><code>@mimicai/adapter-lemonsqueezy</code></td><td><code>npx @mimicai/adapter-lemonsqueezy mcp</code></td><td style="color: var(--green);">Shipped</td></tr>
      <tr><td><strong>Recurly</strong></td><td><code>@mimicai/adapter-recurly</code></td><td><code>npx @mimicai/adapter-recurly mcp</code></td><td style="color: var(--green);">Shipped</td></tr>
      <tr><td><strong>RevenueCat</strong></td><td><code>@mimicai/adapter-revenuecat</code></td><td><code>npx @mimicai/adapter-revenuecat mcp</code></td><td style="color: var(--green);">Shipped</td></tr>
      <tr><td><strong>Zuora</strong></td><td><code>@mimicai/adapter-zuora</code></td><td><code>npx @mimicai/adapter-zuora mcp</code></td><td style="color: var(--green);">Shipped</td></tr>
    </tbody>
  </table>
</div>

<h2 id="mcp-parity">Official Parity</h2>

Mimic MCP tools are designed to match the official MCP servers published by each platform — same tool names, same parameter shapes, same return format. The goal is zero code changes when you swap a Mimic MCP server for the real one.

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Adapter</th><th>Based on</th><th>Coverage</th></tr></thead>
    <tbody>
      <tr><td><strong>Stripe</strong></td><td><a href="https://mcp.stripe.com" target="_blank">mcp.stripe.com</a> official server</td><td>All 26 official tools + 4 Mimic extras for payment lifecycle testing</td></tr>
      <tr><td><strong>Plaid</strong></td><td>Plaid API surface</td><td>Link flow, accounts, transactions, balances, identity, auth, holdings, liabilities</td></tr>
      <tr><td><strong>Paddle</strong></td><td>Paddle Billing API</td><td>Products, prices, subscriptions, customers, transactions, discounts</td></tr>
      <tr><td><strong>Chargebee</strong></td><td>Chargebee API</td><td>Subscriptions, customers, invoices, plans, addons, events</td></tr>
      <tr><td><strong>GoCardless</strong></td><td>GoCardless API</td><td>Mandates, payments, customers, bank accounts, payouts, events</td></tr>
      <tr><td><strong>Lemon Squeezy</strong></td><td>Lemon Squeezy API</td><td>Products, variants, orders, subscriptions, customers, discounts</td></tr>
      <tr><td><strong>Recurly</strong></td><td>Recurly API</td><td>Accounts, subscriptions, invoices, plans, add-ons, transactions</td></tr>
      <tr><td><strong>RevenueCat</strong></td><td>RevenueCat API</td><td>Subscribers, entitlements, offerings, purchases, events</td></tr>
      <tr><td><strong>Zuora</strong></td><td>Zuora API</td><td>Accounts, subscriptions, orders, invoices, payments, products</td></tr>
    </tbody>
  </table>
</div>

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div><p><strong>Zero migration cost:</strong> Agent code that calls <code>mimic-stripe</code> MCP tools works unchanged against the real Stripe MCP server in production — no renames, no schema changes.</p></div>
</div>

<h2 id="mcp-env">Environment Variables</h2>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Variable</th><th>Applies to</th><th>Description</th><th>Default</th></tr></thead>
    <tbody>
      <tr><td><code>MIMIC_BASE_URL</code></td><td>Standalone binary only</td><td>URL of the mock API server the standalone MCP binary will call</td><td><code>http://localhost:4100</code></td></tr>
    </tbody>
  </table>
</div>

<div class="callout info">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg></span>
  <div><p><strong><code>MIMIC_BASE_URL</code> is only for standalone binary mode.</strong> When you run <code>npx @mimicai/adapter-stripe mcp</code> directly, it needs to know where your mock API server is listening. <code>mimic host</code> does not use this variable — it assigns ports internally and wires each MCP server to its own API server automatically.</p></div>
</div>

<h2 id="mcp-build">Build an MCP Server</h2>

Each adapter's MCP implementation lives in `src/mcp.ts`. The pattern is a `registerMyPlatformTools` function (used by both `mimic host` and the standalone binary) plus a `startMyPlatformMcpServer` function for the standalone path. A thin `src/bin/mcp.ts` entry point calls the start function.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">typescript</span><span>src/mcp.ts</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="kw">import</span> { <span class="ty">McpServer</span> } <span class="kw">from</span> <span class="str">'@modelcontextprotocol/sdk/server/mcp.js'</span>;
<span class="kw">import</span> { <span class="ty">StdioServerTransport</span> } <span class="kw">from</span> <span class="str">'@modelcontextprotocol/sdk/server/stdio.js'</span>;
<span class="kw">import</span> { z } <span class="kw">from</span> <span class="str">'zod'</span>;
&#8203;
<span class="cm">// Register tools on any McpServer instance — used by mimic host and standalone mode.</span>
<span class="kw">export function</span> <span class="fn">registerMyPlatformTools</span>(server: <span class="ty">McpServer</span>, baseUrl: <span class="ty">string</span>): <span class="ty">void</span> {
  server.<span class="fn">tool</span>(
    <span class="str">'list_items'</span>,
    <span class="str">'List all items in the account.'</span>,
    {},
    <span class="kw">async</span> () <span class="op">=&gt;</span> {
      <span class="kw">const</span> res = <span class="kw">await</span> <span class="fn">fetch</span>(<span class="str">`${baseUrl}/my-platform/items`</span>);
      <span class="kw">const</span> data = <span class="kw">await</span> res.<span class="fn">json</span>();
      <span class="kw">return</span> { content: [{ type: <span class="str">'text'</span>, text: JSON.<span class="fn">stringify</span>(data, <span class="ty">null</span>, 2) }] };
    }
  );
&#8203;
  server.<span class="fn">tool</span>(
    <span class="str">'create_item'</span>,
    <span class="str">'Create a new item. Requires title. Optionally set priority.'</span>,
    {
      title: z.<span class="fn">string</span>().<span class="fn">describe</span>(<span class="str">'Item title'</span>),
      priority: z.<span class="fn">enum</span>([<span class="str">'low'</span>, <span class="str">'medium'</span>, <span class="str">'high'</span>]).<span class="fn">optional</span>(),
    },
    <span class="kw">async</span> (params) <span class="op">=&gt;</span> {
      <span class="kw">const</span> res = <span class="kw">await</span> <span class="fn">fetch</span>(<span class="str">`${baseUrl}/my-platform/items`</span>, {
        method: <span class="str">'POST'</span>,
        headers: { <span class="str">'Content-Type'</span>: <span class="str">'application/json'</span> },
        body: JSON.<span class="fn">stringify</span>(params),
      });
      <span class="kw">const</span> data = <span class="kw">await</span> res.<span class="fn">json</span>();
      <span class="kw">return</span> { content: [{ type: <span class="str">'text'</span>, text: <span class="str">`Created item ${data.id}`</span> }] };
    }
  );
}
&#8203;
<span class="cm">// Standalone entry — called by src/bin/mcp.ts.</span>
<span class="kw">export async function</span> <span class="fn">startMyPlatformMcpServer</span>(): <span class="ty">Promise</span>&lt;<span class="ty">void</span>&gt; {
  <span class="kw">const</span> baseUrl = process.env.MIMIC_BASE_URL ?? <span class="str">'http://localhost:4100'</span>;
  <span class="kw">const</span> server = <span class="kw">new</span> <span class="ty">McpServer</span>({ name: <span class="str">'mimic-my-platform'</span>, version: <span class="str">'0.1.0'</span> });
  <span class="fn">registerMyPlatformTools</span>(server, baseUrl);
  <span class="kw">const</span> transport = <span class="kw">new</span> <span class="ty">StdioServerTransport</span>();
  <span class="kw">await</span> server.<span class="fn">connect</span>(transport);
}</code></pre>
</div>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">typescript</span><span>src/bin/mcp.ts</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="cm">#!/usr/bin/env node</span>
<span class="kw">import</span> { <span class="fn">startMyPlatformMcpServer</span> } <span class="kw">from</span> <span class="str">'../mcp.js'</span>;
<span class="fn">startMyPlatformMcpServer</span>().<span class="fn">catch</span>(console.error);</code></pre>
</div>

The `registerMyPlatformTools` function is also what you pass to `registerMcpTools` in your adapter class — so `mimic host` can mount the same tools on its shared MCP server without spawning a separate process.

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div><p><strong>Tool design tip:</strong> Name tools to match the platform's vocabulary. Write descriptions for LLMs, not humans. Return human-readable summaries for write operations, full JSON for reads.</p></div>
</div>

<h2 id="mcp-troubleshooting">Troubleshooting</h2>

- **"Connection refused"** &mdash; Ensure `mimic host` is running before connecting MCP servers
- **Tools not appearing** &mdash; Restart your MCP client after adding a new server
- **Wrong data** &mdash; MCP servers call the mock HTTP endpoints; lazy seeding happens on first request
