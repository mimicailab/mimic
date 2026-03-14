---
title: "Getting Started"
eyebrow: "Getting Started"
description: "Install Mimic and get a fully mocked environment running in under 60 seconds."
order: 1
slug: "getting-started"
next: { slug: "concepts", title: "Core Concepts" }
---

<h1 id="introduction">
  <span class="eyebrow">Getting Started</span>
  Mimic Documentation
</h1>

<p class="lead">
  Mimic is an open-source synthetic environment engine for AI agent development.
  One persona generates coherent data across every database, API, and MCP server your agent touches.
  Deterministic, offline-capable, and free.
</p>

<h2 id="installation">Installation</h2>

Install the CLI globally via npm, pnpm, or yarn:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> npm install -g @mimicai/cli</code></pre>
</div>

Or run directly with `npx` &mdash; no install needed:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> npx @mimicai/cli init</code></pre>
</div>

**Requirements:** Node.js 18+ (Node 22 recommended). No other dependencies.

<h2 id="quickstart">Quickstart</h2>

Get a fully mocked environment running in under 60 seconds.

### 1. Initialise a project

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic init</code></pre>
</div>

Creates a `mimic.json` config and `.mimic/` data directory. Edit it to declare your domain, personas, and databases:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>mimic.json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"domain"</span>: <span class="str">"personal finance assistant"</span>,
&#8203;
<span class="yk">"personas"</span>: [
  {
    <span class="yk">"name"</span>: <span class="str">"finance-alex"</span>,
    <span class="yk">"description"</span>: <span class="str">"32yo fintech PM, $85K salary, 3 bank accounts"</span>
  }
],
&#8203;
<span class="yk">"databases"</span>: {
  <span class="yk">"primary"</span>: {
    <span class="yk">"type"</span>: <span class="str">"postgres"</span>,
    <span class="yk">"url"</span>: <span class="str">"$DATABASE_URL"</span>,
    <span class="yk">"schema"</span>: { <span class="yk">"source"</span>: <span class="str">"prisma"</span>, <span class="yk">"path"</span>: <span class="str">"./prisma/schema.prisma"</span> }
  }
},
&#8203;
<span class="yk">"apis"</span>: {
  <span class="yk">"stripe"</span>: { <span class="yk">"enabled"</span>: <span class="ty">true</span>, <span class="yk">"mcp"</span>: <span class="ty">true</span> },
  <span class="yk">"plaid"</span>: { <span class="yk">"enabled"</span>: <span class="ty">true</span>, <span class="yk">"mcp"</span>: <span class="ty">true</span> }
}</code></pre>
</div>

### 2. Generate blueprints &amp; seed databases

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic run                           <span class="cm"># Generate persona blueprints</span>
<span class="prompt">$</span> mimic seed <span class="flag">--verbose</span>               <span class="cm"># Seed database with persona data</span></code></pre>
</div>

Populates your PostgreSQL (or MongoDB, MySQL, SQLite) with persona-consistent data &mdash; users, accounts, transactions, all matching the persona's story.

### 3. Start mock APIs + MCP servers

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic host
&#8203;
<span class="ok">&#10003;</span> <span class="out">Stripe API    &rarr; http://localhost:4100/stripe/v1</span>
<span class="ok">&#10003;</span> <span class="out">Plaid API     &rarr; http://localhost:4100/plaid</span>
<span class="ok">&#10003;</span> <span class="out">Ready in 1.2s</span></code></pre>
</div>

Point your agent at `localhost:4100` instead of production APIs. Everything just works.

### 4. Run tests

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic test</code></pre>
</div>

Execute test scenarios against your mock environment with optional AI-powered evaluation.

### 5. Clean up

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic clean</code></pre>
</div>

Truncates all seeded database tables, removes `.mimic/data/`, and clears cached blueprints in `.mimic/blueprints/`.
