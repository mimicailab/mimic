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
<span class="ok">&#10003;</span> <span class="out">Stripe API    &rarr; http://localhost:4100/stripe/v1</span>
<span class="ok">&#10003;</span> <span class="out">Plaid API     &rarr; http://localhost:4100/plaid</span>
<span class="ok">&#10003;</span> <span class="out">MCP Server    &rarr; stdio (database + API adapter tools)</span>
<span class="ok">&#10003;</span> <span class="out">Ready in 1.2s</span></code></pre>
</div>

<h2 id="mcp-catalog">Available MCP Servers</h2>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Adapter</th><th>Package</th><th>MCP Command</th><th>Tools</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td><strong>Stripe</strong></td><td><code>@mimicai/adapter-stripe</code></td><td><code>npx @mimicai/adapter-stripe mcp</code></td><td>17</td><td style="color: var(--green);">Shipped</td></tr>
      <tr><td><strong>Plaid</strong></td><td><code>@mimicai/adapter-plaid</code></td><td><code>npx @mimicai/adapter-plaid mcp</code></td><td>10</td><td style="color: var(--green);">Shipped</td></tr>
      <tr><td><strong>Slack</strong></td><td><code>@mimicai/adapter-slack</code></td><td><code>npx @mimicai/adapter-slack mcp</code></td><td>12</td><td style="color: var(--green);">Shipped</td></tr>
    </tbody>
  </table>
</div>

### Stripe MCP Tools

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Tool</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>list_customers</code></td><td>List all customers with optional filtering</td></tr>
      <tr><td><code>create_customer</code></td><td>Create a new customer with name, email, description</td></tr>
      <tr><td><code>create_payment_intent</code></td><td>Create a payment intent with amount and currency</td></tr>
      <tr><td><code>list_charges</code></td><td>List charges with optional customer filter</td></tr>
      <tr><td><code>list_subscriptions</code></td><td>List active subscriptions</td></tr>
      <tr><td><code>create_subscription</code></td><td>Create a new subscription for a customer</td></tr>
      <tr><td><code>list_invoices</code></td><td>List invoices with optional status filter</td></tr>
      <tr><td><code>list_products</code></td><td>List all products</td></tr>
      <tr><td><code>create_product</code></td><td>Create a new product</td></tr>
      <tr><td><code>list_prices</code></td><td>List prices for products</td></tr>
      <tr><td><code>list_payment_methods</code></td><td>List payment methods for a customer</td></tr>
      <tr><td><code>create_refund</code></td><td>Refund a charge or payment intent</td></tr>
      <tr><td><code>get_balance</code></td><td>Retrieve current account balance</td></tr>
    </tbody>
  </table>
</div>

### Plaid MCP Tools

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Tool</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>create_link_token</code></td><td>Create a Link token to initialize Plaid Link</td></tr>
      <tr><td><code>exchange_public_token</code></td><td>Exchange a public token for an access token</td></tr>
      <tr><td><code>get_accounts</code></td><td>Get all linked bank accounts</td></tr>
      <tr><td><code>get_transactions</code></td><td>Get transactions with date range filtering</td></tr>
      <tr><td><code>get_balance</code></td><td>Get real-time account balances</td></tr>
      <tr><td><code>get_identity</code></td><td>Get account holder identity information</td></tr>
      <tr><td><code>get_auth</code></td><td>Get account and routing numbers</td></tr>
      <tr><td><code>get_institutions</code></td><td>Search financial institutions</td></tr>
    </tbody>
  </table>
</div>

### Slack MCP Tools

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Tool</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>slack_list_channels</code></td><td>List all channels in the workspace</td></tr>
      <tr><td><code>slack_post_message</code></td><td>Post a message to a channel</td></tr>
      <tr><td><code>slack_list_messages</code></td><td>List messages in a channel</td></tr>
      <tr><td><code>slack_list_users</code></td><td>List all users in the workspace</td></tr>
      <tr><td><code>slack_get_user_info</code></td><td>Get detailed info about a user</td></tr>
      <tr><td><code>slack_add_reaction</code></td><td>Add a reaction emoji to a message</td></tr>
      <tr><td><code>slack_list_reactions</code></td><td>List reactions on a message</td></tr>
      <tr><td><code>slack_upload_file</code></td><td>Upload a file to a channel</td></tr>
      <tr><td><code>slack_get_channel_info</code></td><td>Get detailed channel information</td></tr>
      <tr><td><code>slack_search_messages</code></td><td>Search messages across channels</td></tr>
    </tbody>
  </table>
</div>

<h2 id="mcp-env">Environment Variables</h2>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Variable</th><th>Description</th><th>Default</th></tr></thead>
    <tbody>
      <tr><td><code>MIMIC_BASE_URL</code></td><td>URL of the running Mimic mock server</td><td><code>http://localhost:4100</code></td></tr>
    </tbody>
  </table>
</div>

<h2 id="mcp-build">Build an MCP Server</h2>

Each adapter includes an MCP entry point at `src/bin/mcp.ts`. Here's the pattern:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">typescript</span><span>src/bin/mcp.ts</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="kw">import</span> { <span class="ty">McpServer</span> } <span class="kw">from</span> <span class="str">'@modelcontextprotocol/sdk/server/mcp.js'</span>;
<span class="kw">import</span> { <span class="ty">StdioServerTransport</span> } <span class="kw">from</span> <span class="str">'@modelcontextprotocol/sdk/server/stdio.js'</span>;
<span class="kw">import</span> { z } <span class="kw">from</span> <span class="str">'zod'</span>;
&#8203;
<span class="kw">const</span> BASE_URL = process.env.MIMIC_BASE_URL ?? <span class="str">'http://localhost:4100'</span>;
<span class="kw">const</span> server = <span class="kw">new</span> <span class="ty">McpServer</span>({ name: <span class="str">'mimic-my-platform'</span>, version: <span class="str">'0.3.0'</span> });
&#8203;
server.<span class="fn">tool</span>(
  <span class="str">'list_items'</span>,
  <span class="str">'List all items in the account.'</span>,
  {},
  <span class="kw">async</span> () <span class="op">=&gt;</span> {
    <span class="kw">const</span> res = <span class="kw">await</span> <span class="fn">fetch</span>(<span class="str">`${BASE_URL}/my-platform/items`</span>);
    <span class="kw">const</span> data = <span class="kw">await</span> res.<span class="fn">json</span>();
    <span class="kw">return</span> {
      content: [{ type: <span class="str">'text'</span>, text: JSON.<span class="fn">stringify</span>(data, <span class="ty">null</span>, 2) }],
    };
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
    <span class="kw">const</span> res = <span class="kw">await</span> <span class="fn">fetch</span>(<span class="str">`${BASE_URL}/my-platform/items`</span>, {
      method: <span class="str">'POST'</span>,
      headers: { <span class="str">'Content-Type'</span>: <span class="str">'application/json'</span> },
      body: JSON.<span class="fn">stringify</span>(params),
    });
    <span class="kw">const</span> data = <span class="kw">await</span> res.<span class="fn">json</span>();
    <span class="kw">return</span> {
      content: [{ type: <span class="str">'text'</span>, text: <span class="str">`Created item ${data.data.id}: "${data.data.title}"`</span> }],
    };
  }
);
&#8203;
<span class="kw">const</span> transport = <span class="kw">new</span> <span class="ty">StdioServerTransport</span>();
<span class="kw">await</span> server.<span class="fn">connect</span>(transport);</code></pre>
</div>

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div><p><strong>Tool design tip:</strong> Name tools to match the platform's vocabulary. Write descriptions for LLMs, not humans. Return human-readable summaries for write operations, full JSON for reads.</p></div>
</div>

<h2 id="mcp-troubleshooting">Troubleshooting</h2>

- **"Connection refused"** &mdash; Ensure `mimic host` is running before connecting MCP servers
- **Tools not appearing** &mdash; Restart your MCP client after adding a new server
- **Wrong data** &mdash; MCP servers call the mock HTTP endpoints; lazy seeding happens on first request
