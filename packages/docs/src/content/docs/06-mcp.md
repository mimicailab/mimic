---
title: "MCP Servers"
description: "MCP server overview, setup with Claude Code and Cursor, official parity, and how to build servers."
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
(Claude)           (mcp-jira)                    (adapter-jira)</code></pre>
</div>

This matters because many agent frameworks use MCP as their primary tool interface. Mimic MCP servers give agents realistic mock data through the same protocol they'll use in production.

<h2 id="mcp-setup">MCP Setup &amp; Config</h2>

### With Claude Code

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> claude mcp add mimic-jira -- npx -y @mimicai/mcp-jira
&#8203;
<span class="cm"># With custom URL</span>
<span class="prompt">$</span> claude mcp add <span class="flag">--env MIMIC_BASE_URL=http://localhost:4000</span> mimic-jira -- npx -y @mimicai/mcp-jira</code></pre>
</div>

### With Cursor / VS Code

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>MCP config</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"mcpServers"</span>: {
    <span class="yk">"mimic-jira"</span>: {
      <span class="yk">"command"</span>: <span class="str">"npx"</span>,
      <span class="yk">"args"</span>: [<span class="str">"-y"</span>, <span class="str">"@mimicai/mcp-jira"</span>],
      <span class="yk">"env"</span>: { <span class="yk">"MIMIC_BASE_URL"</span>: <span class="str">"http://localhost:4000"</span> }
    },
    <span class="yk">"mimic-slack"</span>: {
      <span class="yk">"command"</span>: <span class="str">"npx"</span>,
      <span class="yk">"args"</span>: [<span class="str">"-y"</span>, <span class="str">"@mimicai/mcp-slack"</span>],
      <span class="yk">"env"</span>: { <span class="yk">"MIMIC_BASE_URL"</span>: <span class="str">"http://localhost:4000"</span> }
    }
  }
}</code></pre>
</div>

### With Mimic CLI

The simplest way &mdash; configure MCP servers in your config and `mimic host` starts them alongside API mocks:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">yaml</span><span>.mimic/config.yaml</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">surfaces:</span>
  <span class="yk">mcp:</span>
    - <span class="yk">adapter:</span> <span class="ys">jira</span>
      <span class="yk">transport:</span> <span class="ys">stdio</span>
    - <span class="yk">adapter:</span> <span class="ys">slack</span>
      <span class="yk">transport:</span> <span class="ys">stdio</span></code></pre>
</div>

<h2 id="mcp-parity">Official MCP Parity</h2>

For platforms that ship official MCP servers, Mimic matches the **exact same tool names and parameter schemas**. Develop against Mimic, swap to real credentials in production &mdash; zero code changes.

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Platform</th><th>Official MCP</th><th>Mimic MCP</th><th>Parity</th></tr></thead>
    <tbody>
      <tr><td>Jira</td><td>Atlassian MCP</td><td><code>@mimicai/mcp-jira</code></td><td style="color: var(--green);">Matched</td></tr>
      <tr><td>Slack</td><td>Claude.ai connector</td><td><code>@mimicai/mcp-slack</code></td><td style="color: var(--green);">Matched</td></tr>
      <tr><td>Asana</td><td>mcp.asana.com/sse</td><td><code>@mimicai/mcp-asana</code></td><td style="color: var(--green);">Matched</td></tr>
      <tr><td>HubSpot</td><td>mcp.hubspot.com</td><td><code>@mimicai/mcp-hubspot</code></td><td style="color: var(--green);">Matched</td></tr>
      <tr><td>GitHub</td><td>@mcp/server-github</td><td><code>@mimicai/mcp-github</code></td><td style="color: var(--green);">Matched</td></tr>
      <tr><td>GitLab</td><td>Official GitLab MCP</td><td><code>@mimicai/mcp-gitlab</code></td><td style="color: var(--green);">Matched</td></tr>
    </tbody>
  </table>
</div>

<h2 id="mcp-catalog">MCP Server Catalog</h2>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Package</th><th>Tools</th><th>Status</th><th>Primary Tools</th></tr></thead>
    <tbody>
      <tr><td><code>@mimicai/mcp-stripe</code></td><td>17</td><td style="color: var(--green);">Shipped</td><td>create_customer, create_payment_intent, list_subscriptions, create_refund</td></tr>
      <tr><td><code>@mimicai/mcp-plaid</code></td><td>10</td><td style="color: var(--green);">Shipped</td><td>create_link_token, get_accounts, get_transactions</td></tr>
      <tr><td><code>@mimicai/mcp-slack</code></td><td>12</td><td style="color: var(--green);">Shipped</td><td>slack_post_message, slack_list_channels, slack_search_messages</td></tr>
      <tr><td><code>@mimicai/mcp-jira</code></td><td>10</td><td>Planned</td><td>create_issue, search_jql, transition_issue</td></tr>
      <tr><td><code>@mimicai/mcp-salesforce</code></td><td>10</td><td></td><td>query_soql, create_record, update_record</td></tr>
      <tr><td><code>@mimicai/mcp-hubspot</code></td><td>10</td><td></td><td>search_contacts, create_deal, list_companies</td></tr>
      <tr><td><code>@mimicai/mcp-notion</code></td><td>10</td><td></td><td>query_database, create_page, search</td></tr>
      <tr><td><code>@mimicai/mcp-zendesk</code></td><td>8</td><td></td><td>create_ticket, update_ticket, search_tickets</td></tr>
      <tr><td><code>@mimicai/mcp-linear</code></td><td>8</td><td></td><td>create_issue, update_issue, list_issues</td></tr>
      <tr><td><code>@mimicai/mcp-asana</code></td><td>8</td><td></td><td>list_tasks, create_task, update_task</td></tr>
      <tr><td><code>@mimicai/mcp-pagerduty</code></td><td>8</td><td></td><td>create_incident, acknowledge, resolve</td></tr>
      <tr><td><code>@mimicai/mcp-trello</code></td><td>8</td><td></td><td>list_cards, create_card, move_card</td></tr>
      <tr><td><code>@mimicai/mcp-twilio</code></td><td>8</td><td></td><td>send_sms, make_call, list_messages</td></tr>
      <tr><td><code>@mimicai/mcp-sendgrid</code></td><td>6</td><td></td><td>send_email, list_contacts, get_stats</td></tr>
      <tr><td><code>@mimicai/mcp-airtable</code></td><td>6</td><td></td><td>list_records, create_records, update_records</td></tr>
      <tr><td><code>@mimicai/mcp-pipedrive</code></td><td>8</td><td></td><td>list_deals, create_person, search</td></tr>
      <tr><td><code>@mimicai/mcp-square</code></td><td>8</td><td></td><td>create_payment, list_orders, create_customer</td></tr>
    </tbody>
  </table>
</div>

<h2 id="mcp-build">Build an MCP Server</h2>

Most MCP servers are auto-generated from the adapter's `getEndpoints()` definitions:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> pnpm mimic:generate-mcp my-platform</code></pre>
</div>

For hand-tuned implementations:

<CodeBlock lang="typescript" label="mcp-server.ts" code={`<span class="kw">import</span> { <span class="ty">McpServer</span> } <span class="kw">from</span> <span class="str">'@modelcontextprotocol/sdk/server/mcp.js'</span>;
<span class="kw">import</span> { z } <span class="kw">from</span> <span class="str">'zod'</span>;

<span class="kw">const</span> server = <span class="kw">new</span> <span class="ty">McpServer</span>({
  name: <span class="str">'mimic-my-platform'</span>,
  version: <span class="str">'1.0.0'</span>,
});

server.<span class="fn">tool</span>(
  <span class="str">'create_item'</span>,
  <span class="str">'Create a new item. Requires title. Optionally set priority.'</span>,
  {
    title: z.<span class="fn">string</span>().<span class="fn">describe</span>(<span class="str">'Item title'</span>),
    priority: z.<span class="fn">enum</span>([<span class="str">'low'</span>, <span class="str">'medium'</span>, <span class="str">'high'</span>]).<span class="fn">optional</span>(),
  },
  <span class="kw">async</span> (params) <span class="op">=&gt;</span> {
    <span class="kw">const</span> data = <span class="kw">await</span> <span class="fn">mimicFetch</span>(<span class="str">'POST'</span>, <span class="str">'/my-platform/items'</span>, params);
    <span class="kw">return</span> {
      content: [{ type: <span class="str">'text'</span>, text: <span class="str">{"\`Created #\${data.id}: \"\${data.title}\"\`\`}</span> }]\n    };\n  }\n);"} />

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div><p><strong>Tool design tip:</strong> Name tools to match the platform's vocabulary. Write descriptions for LLMs, not humans. Return human-readable summaries for write operations, full JSON for reads.</p></div>
</div>
