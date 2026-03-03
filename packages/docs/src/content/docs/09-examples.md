---
title: "Examples"
eyebrow: "Examples"
description: "Nine working examples demonstrating different database backends, API mock adapters, and agent architectures."
order: 9
slug: "examples"
prev: { slug: "guides", title: "Guides" }
---

<h2 id="examples-overview">
  <span class="eyebrow">Examples</span>
  Working Examples
</h2>

<p class="lead">
  Every example ships with a <code>mimic.json</code> config, a database schema, and a fully wired AI agent.
  Clone, seed, and chat &mdash; each example works end-to-end out of the box.
</p>

<p>Mimic ships with nine working examples that demonstrate different database backends, API mock adapters, persona styles, and agent architectures. Each example lives in the <code>examples/</code> directory and follows the same pattern:</p>

<ol>
  <li><strong>Define personas</strong> in <code>mimic.json</code> &mdash; describe who generates the data</li>
  <li><strong>Provide a schema</strong> &mdash; SQL DDL, Prisma schema, or nothing at all (MongoDB auto-discovers)</li>
  <li><strong>Seed the database</strong> with <code>mimic seed</code> &mdash; persona-consistent synthetic data</li>
  <li><strong>Run the agent</strong> &mdash; a tool-equipped AI agent queries the seeded data</li>
</ol>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Example</th><th>Database</th><th>API Adapter</th><th>Domain</th><th>Agent SDK</th><th>Key Feature</th></tr></thead>
    <tbody>
      <tr><td><code>tasks-sqlite</code></td><td>SQLite</td><td>&mdash;</td><td>Task management</td><td>Vercel AI SDK</td><td>Zero-infrastructure &mdash; no Docker required</td></tr>
      <tr><td><code>ecommerce-mysql</code></td><td>MySQL</td><td>&mdash;</td><td>E-commerce storefront</td><td>Vercel AI SDK</td><td>Relational schema with FKs, categories, orders</td></tr>
      <tr><td><code>blog-mongodb</code></td><td>MongoDB</td><td>&mdash;</td><td>Technical blog</td><td>Vercel AI SDK</td><td>Schema-free &mdash; no DDL files needed</td></tr>
      <tr><td><code>fintech-multi-db</code></td><td>PostgreSQL + MongoDB</td><td>&mdash;</td><td>Personal finance</td><td>OpenAI Agents SDK</td><td>Multi-database seeding + MCP tools</td></tr>
      <tr><td><code>finance-assistant</code></td><td>PostgreSQL (Prisma)</td><td>&mdash;</td><td>Personal finance</td><td>Vercel AI SDK</td><td>Prisma schema + <code>mimic test</code> scenarios</td></tr>
      <tr><td><code>billing-agent</code></td><td>PostgreSQL (Prisma)</td><td>Stripe</td><td>SaaS billing</td><td>OpenAI Agents SDK</td><td>Stripe MCP + HTTP dual-mode, cross-surface data</td></tr>
      <tr><td><code>budget-agent</code></td><td>PostgreSQL (Prisma)</td><td>Plaid</td><td>Personal budgeting</td><td>OpenAI Agents SDK</td><td>Plaid bank accounts + budgets + savings goals</td></tr>
      <tr><td><code>payments-monitor</code></td><td>PostgreSQL (Prisma)</td><td>Stripe</td><td>Payment operations</td><td>OpenAI Agents SDK</td><td>Revenue metrics, failure analysis, dunning</td></tr>
      <tr><td><code>meeting-notes</code></td><td>PostgreSQL (Prisma)</td><td>Slack</td><td>Team meetings</td><td>OpenAI Agents SDK</td><td>Meeting summaries posted to Slack channels</td></tr>
    </tbody>
  </table>
</div>

<h3 id="example-tasks-sqlite">Tasks &mdash; SQLite</h3>

<p>The simplest way to get started. No Docker, no external database servers &mdash; SQLite is file-based, so you just need Node.js and an Anthropic API key.</p>

<p><strong>Domain:</strong> A project and task management app with projects, tasks, labels, and comments. Two personas generate different usage patterns: a <strong>busy-developer</strong> (heavy task creator, 3 active projects, extensive label usage) and a <strong>project-manager</strong> (milestone-focused, delegates across 8 team members, tracks blockers).</p>

<h4>Config</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>examples/tasks-sqlite/mimic.json</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"domain"</span>: <span class="str">"project and task management app"</span>,
  <span class="yk">"llm"</span>: { <span class="yk">"provider"</span>: <span class="str">"anthropic"</span>, <span class="yk">"model"</span>: <span class="str">"claude-haiku-4-5"</span> },
  <span class="yk">"personas"</span>: [
    {
      <span class="yk">"name"</span>: <span class="str">"busy-developer"</span>,
      <span class="yk">"description"</span>: <span class="str">"29yo full-stack dev, manages 3 active projects, heavy task creator, uses labels extensively"</span>
    },
    {
      <span class="yk">"name"</span>: <span class="str">"project-manager"</span>,
      <span class="yk">"description"</span>: <span class="str">"35yo PM, oversees team of 8, focuses on milestones and deadlines, tracks blockers"</span>
    }
  ],
  <span class="yk">"generate"</span>: { <span class="yk">"volume"</span>: <span class="str">"3 months"</span>, <span class="yk">"seed"</span>: <span class="ty">42</span> },
  <span class="yk">"databases"</span>: {
    <span class="yk">"local"</span>: {
      <span class="yk">"type"</span>: <span class="str">"sqlite"</span>,
      <span class="yk">"path"</span>: <span class="str">"./tasks.db"</span>,
      <span class="yk">"walMode"</span>: <span class="ty">true</span>,
      <span class="yk">"seedStrategy"</span>: <span class="str">"truncate-and-insert"</span>
    }
  }
}</code></pre>
</div>

<h4>Schema</h4>

<p>Five tables capture the task management domain: <code>projects</code>, <code>tasks</code> (with status and priority enums), <code>labels</code>, <code>task_labels</code> (many-to-many), and <code>comments</code>.</p>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">sql</span><span>examples/tasks-sqlite/schema.sql</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="kw">CREATE TABLE</span> projects (
  id          <span class="ty">INTEGER PRIMARY KEY AUTOINCREMENT</span>,
  name        <span class="ty">TEXT NOT NULL</span>,
  description <span class="ty">TEXT</span>,
  status      <span class="ty">TEXT CHECK</span>(status <span class="kw">IN</span> (<span class="str">'active'</span>, <span class="str">'completed'</span>, <span class="str">'archived'</span>)) <span class="kw">DEFAULT</span> <span class="str">'active'</span>,
  created_at  <span class="ty">TEXT DEFAULT</span> (datetime(<span class="str">'now'</span>)),
  updated_at  <span class="ty">TEXT DEFAULT</span> (datetime(<span class="str">'now'</span>))
);
&#8203;
<span class="kw">CREATE TABLE</span> tasks (
  id              <span class="ty">INTEGER PRIMARY KEY AUTOINCREMENT</span>,
  project_id      <span class="ty">INTEGER NOT NULL REFERENCES</span> projects(id),
  title           <span class="ty">TEXT NOT NULL</span>,
  status          <span class="ty">TEXT CHECK</span>(status <span class="kw">IN</span> (<span class="str">'todo'</span>, <span class="str">'in_progress'</span>, <span class="str">'review'</span>, <span class="str">'done'</span>, <span class="str">'blocked'</span>)),
  priority        <span class="ty">TEXT CHECK</span>(priority <span class="kw">IN</span> (<span class="str">'low'</span>, <span class="str">'medium'</span>, <span class="str">'high'</span>, <span class="str">'urgent'</span>)),
  assignee        <span class="ty">TEXT</span>,
  due_date        <span class="ty">TEXT</span>,
  estimated_hours <span class="ty">REAL</span>,
  actual_hours    <span class="ty">REAL</span>,
  <span class="cm">-- ...timestamps</span>
);
&#8203;
<span class="kw">CREATE TABLE</span> labels ( id <span class="ty">INTEGER PRIMARY KEY</span>, name <span class="ty">TEXT UNIQUE</span>, color <span class="ty">TEXT</span> );
<span class="kw">CREATE TABLE</span> task_labels ( task_id <span class="ty">INTEGER</span>, label_id <span class="ty">INTEGER</span>, <span class="kw">PRIMARY KEY</span> (task_id, label_id) );
<span class="kw">CREATE TABLE</span> comments ( id <span class="ty">INTEGER PRIMARY KEY</span>, task_id <span class="ty">INTEGER</span>, author <span class="ty">TEXT</span>, body <span class="ty">TEXT</span>, created_at <span class="ty">TEXT</span> );</code></pre>
</div>

<h4>Agent</h4>

<p>The agent uses the <strong>Vercel AI SDK</strong> with <code>better-sqlite3</code> for read-only queries. It exposes six tools to the LLM: <code>list_projects</code>, <code>search_tasks</code>, <code>get_task_details</code>, <code>get_project_tasks</code>, <code>get_task_comments</code>, and <code>get_blocked_tasks</code>. All queries are prepared statements &mdash; no string interpolation, no SQL injection risk.</p>

<h4>Quick start</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="cm"># No Docker needed &mdash; SQLite is file-based</span>
<span class="prompt">$</span> cd examples/tasks-sqlite
<span class="prompt">$</span> ./init-db.sh                       <span class="cm"># Create the SQLite database</span>
<span class="prompt">$</span> mimic run                           <span class="cm"># Generate blueprints</span>
<span class="prompt">$</span> mimic seed --verbose                <span class="cm"># Seed tasks.db</span>
&#8203;
<span class="cm"># Start the agent</span>
<span class="prompt">$</span> cd agent && npm install && npm start
&#8203;
<span class="cm"># Chat with it</span>
<span class="prompt">$</span> curl -s -X POST http://localhost:3002/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "What projects are currently active?"}'</span> | jq .
&#8203;
<span class="prompt">$</span> curl -s -X POST http://localhost:3002/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "Show me all blocked tasks"}'</span> | jq .</code></pre>
</div>

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div><p><strong>Best for:</strong> Getting started quickly, local development, demos, and environments where you can't run Docker. Cleanup is just <code>rm tasks.db</code>.</p></div>
</div>

<h3 id="example-ecommerce-mysql">E-Commerce &mdash; MySQL</h3>

<p>A full relational e-commerce storefront with customers, categories (self-referencing for sub-categories), products, orders, order items, and reviews. Demonstrates Mimic with a traditional relational MySQL schema including foreign keys, unique constraints, and CHECK constraints.</p>

<p><strong>Personas:</strong> A <strong>power-shopper</strong> (34yo marketing exec, frequent buyer, $120K salary, loves electronics and fashion &mdash; generates ~25-40 orders over 6 months) and a <strong>casual-browser</strong> (22yo grad student, budget-conscious, mostly books &mdash; generates ~8-12 orders).</p>

<h4>Config</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>examples/ecommerce-mysql/mimic.json</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"domain"</span>: <span class="str">"e-commerce storefront"</span>,
  <span class="yk">"personas"</span>: [
    { <span class="yk">"name"</span>: <span class="str">"power-shopper"</span>,  <span class="yk">"description"</span>: <span class="str">"34yo marketing exec, frequent online buyer, $120K salary"</span> },
    { <span class="yk">"name"</span>: <span class="str">"casual-browser"</span>, <span class="yk">"description"</span>: <span class="str">"22yo grad student, occasional buyer, budget-conscious"</span> }
  ],
  <span class="yk">"databases"</span>: {
    <span class="yk">"primary"</span>: {
      <span class="yk">"type"</span>: <span class="str">"mysql"</span>,
      <span class="yk">"url"</span>: <span class="str">"$DATABASE_URL"</span>,
      <span class="yk">"schema"</span>: { <span class="yk">"source"</span>: <span class="str">"introspect"</span> },
      <span class="yk">"seedStrategy"</span>: <span class="str">"truncate-and-insert"</span>
    }
  }
}</code></pre>
</div>

<h4>Schema highlights</h4>

<p>Six tables with full relational integrity. Categories support self-referencing parent-child hierarchy. Products have unique SKUs and slugs. Orders track status through a lifecycle (<code>pending</code> &rarr; <code>confirmed</code> &rarr; <code>shipped</code> &rarr; <code>delivered</code> or <code>cancelled</code>). Reviews enforce a 1-5 rating CHECK constraint.</p>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">sql</span><span>examples/ecommerce-mysql/schema.sql (excerpt)</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="kw">CREATE TABLE</span> customers ( id <span class="ty">INT AUTO_INCREMENT PRIMARY KEY</span>, email <span class="ty">VARCHAR(255) UNIQUE</span>, ... );
<span class="kw">CREATE TABLE</span> categories ( id <span class="ty">INT AUTO_INCREMENT PRIMARY KEY</span>, slug <span class="ty">VARCHAR(120) UNIQUE</span>, parent_id <span class="ty">INT REFERENCES</span> categories(id) );
<span class="kw">CREATE TABLE</span> products ( id <span class="ty">INT AUTO_INCREMENT PRIMARY KEY</span>, category_id <span class="ty">INT</span>, price <span class="ty">DECIMAL(10,2)</span>, sku <span class="ty">VARCHAR(50) UNIQUE</span> );
<span class="kw">CREATE TABLE</span> orders ( id <span class="ty">INT AUTO_INCREMENT PRIMARY KEY</span>, customer_id <span class="ty">INT</span>, status <span class="ty">ENUM</span>(<span class="str">'pending'</span>,<span class="str">'confirmed'</span>,<span class="str">'shipped'</span>,<span class="str">'delivered'</span>,<span class="str">'cancelled'</span>) );
<span class="kw">CREATE TABLE</span> order_items ( order_id <span class="ty">INT</span>, product_id <span class="ty">INT</span>, quantity <span class="ty">INT</span>, unit_price <span class="ty">DECIMAL(10,2)</span> );
<span class="kw">CREATE TABLE</span> reviews ( product_id <span class="ty">INT</span>, customer_id <span class="ty">INT</span>, rating <span class="ty">TINYINT CHECK</span>(rating <span class="kw">BETWEEN</span> <span class="ty">1</span> <span class="kw">AND</span> <span class="ty">5</span>) );</code></pre>
</div>

<h4>Agent tools</h4>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Tool</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>search_products</code></td><td>Search by name, category, price range; filter in-stock only</td></tr>
      <tr><td><code>get_orders</code></td><td>Customer order history with status and date filters</td></tr>
      <tr><td><code>get_order_details</code></td><td>Full order breakdown with line items and product info</td></tr>
      <tr><td><code>get_customer_info</code></td><td>Customer profile with total order count and lifetime spend</td></tr>
      <tr><td><code>get_reviews</code></td><td>Product reviews with optional rating filter and averages</td></tr>
    </tbody>
  </table>
</div>

<h4>Quick start</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> cd examples/ecommerce-mysql
<span class="prompt">$</span> docker compose up -d               <span class="cm"># Start MySQL</span>
<span class="prompt">$</span> export DATABASE_URL=<span class="str">"mysql://mimic:mimic@localhost:3306/mimic_ecommerce"</span>
<span class="prompt">$</span> mimic run && mimic seed --verbose
&#8203;
<span class="prompt">$</span> cd agent && npm install && npm start
&#8203;
<span class="prompt">$</span> curl -s -X POST http://localhost:3001/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "What electronics do you have under $50?"}'</span> | jq .
&#8203;
<span class="prompt">$</span> curl -s -X POST http://localhost:3001/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "What are the highest rated products?"}'</span> | jq .</code></pre>
</div>

<h3 id="example-blog-mongodb">Blog &mdash; MongoDB</h3>

<p>Demonstrates Mimic's <strong>schema-free</strong> mode. No Prisma files, no SQL DDL &mdash; just describe your domain and personas in <code>mimic.json</code> and Mimic figures out the document shapes automatically. This makes MongoDB the fastest way to get started.</p>

<p><strong>Personas:</strong> A <strong>prolific-writer</strong> (32yo senior engineer, writes 2-3 posts/week on distributed systems and Rust, ~50-70 posts over 6 months) and a <strong>casual-reader</strong> (24yo junior dev, reads daily, bookmarks tutorials, ~80-120 bookmarks).</p>

<h4>Config</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>examples/blog-mongodb/mimic.json</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"domain"</span>: <span class="str">"technical blog and content platform"</span>,
  <span class="yk">"personas"</span>: [
    { <span class="yk">"name"</span>: <span class="str">"prolific-writer"</span>, <span class="yk">"description"</span>: <span class="str">"32yo senior engineer, writes 2-3 posts/week on distributed systems and Rust"</span> },
    { <span class="yk">"name"</span>: <span class="str">"casual-reader"</span>,   <span class="yk">"description"</span>: <span class="str">"24yo junior dev, reads daily, comments occasionally, bookmarks tutorials"</span> }
  ],
  <span class="yk">"databases"</span>: {
    <span class="yk">"primary"</span>: {
      <span class="yk">"type"</span>: <span class="str">"mongodb"</span>,
      <span class="yk">"url"</span>: <span class="str">"$MONGO_URL"</span>,
      <span class="yk">"database"</span>: <span class="str">"mimic_blog"</span>,
      <span class="yk">"seedStrategy"</span>: <span class="str">"delete-and-insert"</span>,
      <span class="yk">"autoCreateIndexes"</span>: <span class="ty">true</span>
    }
  }
}</code></pre>
</div>

<p>Notice there is <strong>no schema file</strong>. Mimic auto-discovers collections from the database and generates documents matching the domain description. Collections created: <code>users</code>, <code>posts</code>, <code>comments</code>, <code>bookmarks</code>.</p>

<h4>Agent tools</h4>

<p>The agent leverages MongoDB's aggregation pipeline and <code>$lookup</code> for join-like queries:</p>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Tool</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>search_posts</code></td><td>Full-text search with optional tag, author, and date range filters</td></tr>
      <tr><td><code>get_post</code></td><td>Retrieve a single post by ID with full body content</td></tr>
      <tr><td><code>get_comments</code></td><td>Paginated comments for a post, with author info via <code>$lookup</code></td></tr>
      <tr><td><code>get_author_posts</code></td><td>All posts by an author (by ID or username), plus their profile</td></tr>
      <tr><td><code>get_popular_posts</code></td><td>Posts ranked by engagement score (views + 5&times; likes + 10&times; comments)</td></tr>
      <tr><td><code>search_by_tag</code></td><td>Posts matching tags (AND/OR mode), with tag frequency breakdown</td></tr>
    </tbody>
  </table>
</div>

<h4>Quick start</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> cd examples/blog-mongodb
<span class="prompt">$</span> docker compose up -d               <span class="cm"># Start MongoDB</span>
<span class="prompt">$</span> export MONGO_URL=<span class="str">"mongodb://localhost:27017"</span>
<span class="prompt">$</span> mimic run && mimic seed --verbose   <span class="cm"># No schema file needed!</span>
&#8203;
<span class="prompt">$</span> cd agent && npm install && npm start
&#8203;
<span class="prompt">$</span> curl -X POST http://localhost:3003/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "What are the most popular posts about Rust?"}'</span></code></pre>
</div>

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div><p><strong>Schema-free mode:</strong> MongoDB is the fastest way to prototype with Mimic. No schema files, no migrations &mdash; just define personas and <code>mimic seed</code>. Mimic generates documents that match your domain description.</p></div>
</div>

<h3 id="example-fintech-multi">Fintech &mdash; Multi-Database</h3>

<p>The flagship example demonstrating Mimic's multi-database capabilities. A personal finance platform where <strong>structured financial data</strong> (users, accounts, transactions) lives in PostgreSQL and <strong>semi-structured activity data</strong> (activity logs, preferences, notifications) lives in MongoDB &mdash; with a single AI agent querying both transparently.</p>

<h4>Architecture</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">text</span><span>multi-database architecture</span><button class="code-copy">Copy</button></div>
  <pre><code>                      +---------------------+
                      |    AI Agent (:3004)  |
                      |  OpenAI Agents SDK   |
                      |  + Claude Haiku      |
                      +----------+----------+
                                 |
                +----------------+----------------+
                |                                 |
          MCP (stdio)                      Direct Driver
                |                                 |
       +--------+--------+             +----------+----------+
       |   PostgreSQL    |             |      MongoDB        |
       |   (port 5432)  |             |   (port 27017)      |
       |                 |             |                     |
       |  users          |             |  activity_logs      |
       |  accounts       |             |  user_preferences   |
       |  transactions   |             |  notifications      |
       +-----------------+             +---------------------+</code></pre>
</div>

<p><strong>How it works:</strong> The agent uses the <strong>OpenAI Agents JS SDK</strong> with Claude as the model. It spawns <code>mimic host --transport stdio</code> as a subprocess for auto-discovered PostgreSQL MCP tools, and connects directly to MongoDB for document-based tools. The AI model decides which database to query based on the user's question.</p>

<h4>Config</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>examples/fintech-multi-db/mimic.json</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"domain"</span>: <span class="str">"personal finance and banking platform"</span>,
  <span class="yk">"personas"</span>: [
    { <span class="yk">"name"</span>: <span class="str">"active-trader"</span>, <span class="yk">"description"</span>: <span class="str">"31yo software engineer, $140K salary, active stock trader, 5+ bank accounts"</span> },
    { <span class="yk">"name"</span>: <span class="str">"saver"</span>,          <span class="yk">"description"</span>: <span class="str">"27yo teacher, $55K salary, focuses on saving, tracks every dollar"</span> }
  ],
  <span class="yk">"databases"</span>: {
    <span class="yk">"postgres"</span>: {
      <span class="yk">"type"</span>: <span class="str">"postgres"</span>,
      <span class="yk">"url"</span>: <span class="str">"$DATABASE_URL"</span>,
      <span class="yk">"schema"</span>: { <span class="yk">"source"</span>: <span class="str">"introspect"</span> },
      <span class="yk">"seedStrategy"</span>: <span class="str">"truncate-and-insert"</span>
    },
    <span class="yk">"mongodb"</span>: {
      <span class="yk">"type"</span>: <span class="str">"mongodb"</span>,
      <span class="yk">"url"</span>: <span class="str">"$MONGO_URL"</span>,
      <span class="yk">"database"</span>: <span class="str">"mimic_fintech"</span>,
      <span class="yk">"seedStrategy"</span>: <span class="str">"delete-and-insert"</span>,
      <span class="yk">"autoCreateIndexes"</span>: <span class="ty">true</span>
    }
  }
}</code></pre>
</div>

<p>Both databases are seeded from the same generated data set with a single <code>mimic seed</code> command, ensuring consistent user IDs across databases.</p>

<h4>What gets seeded</h4>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Database</th><th>Table / Collection</th><th>Active Trader</th><th>Saver</th></tr></thead>
    <tbody>
      <tr><td>PostgreSQL</td><td><code>users</code></td><td>1 row</td><td>1 row</td></tr>
      <tr><td>PostgreSQL</td><td><code>accounts</code></td><td>5+ rows</td><td>2-3 rows</td></tr>
      <tr><td>PostgreSQL</td><td><code>transactions</code></td><td>500+ rows</td><td>100+ rows</td></tr>
      <tr><td>MongoDB</td><td><code>activity_logs</code></td><td colspan="2">Login events, page views, transfers, settings changes</td></tr>
      <tr><td>MongoDB</td><td><code>user_preferences</code></td><td colspan="2">Notification settings, budget goals, feature flags</td></tr>
      <tr><td>MongoDB</td><td><code>notifications</code></td><td colspan="2">Alerts, warnings, promotions, info messages</td></tr>
    </tbody>
  </table>
</div>

<h4>Agent tools</h4>

<p>The agent combines two tool sources &mdash; auto-discovered MCP tools from PostgreSQL and hand-written MongoDB tools:</p>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Source</th><th>Tool</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td style="color: var(--cyan);">MCP (Postgres)</td><td><code>get_transactions</code></td><td>Query with date range, category, merchant filters</td></tr>
      <tr><td style="color: var(--cyan);">MCP (Postgres)</td><td><code>get_accounts</code></td><td>List accounts, filter by type or institution</td></tr>
      <tr><td style="color: var(--amber);">Direct (Mongo)</td><td><code>get_activity_log</code></td><td>Query activity events by user, action, date range</td></tr>
      <tr><td style="color: var(--amber);">Direct (Mongo)</td><td><code>get_user_preferences</code></td><td>Notification settings, display prefs, budget goals</td></tr>
      <tr><td style="color: var(--amber);">Direct (Mongo)</td><td><code>get_notifications</code></td><td>Alerts with read/unread and type filtering</td></tr>
    </tbody>
  </table>
</div>

<h4>Quick start</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> cd examples/fintech-multi-db
<span class="prompt">$</span> docker compose up -d               <span class="cm"># Starts PostgreSQL + MongoDB</span>
<span class="prompt">$</span> export DATABASE_URL=<span class="str">"postgresql://mimic:mimic@localhost:5432/mimic_fintech"</span>
<span class="prompt">$</span> export MONGO_URL=<span class="str">"mongodb://localhost:27017"</span>
<span class="prompt">$</span> mimic run && mimic seed --verbose   <span class="cm"># Seeds BOTH databases</span>
&#8203;
<span class="prompt">$</span> cd agent && npm install && npm start
&#8203;
<span class="cm"># Query PostgreSQL (transactions)</span>
<span class="prompt">$</span> curl -s -X POST http://localhost:3004/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "What are my account balances?"}'</span> | jq
&#8203;
<span class="cm"># Query MongoDB (activity)</span>
<span class="prompt">$</span> curl -s -X POST http://localhost:3004/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "Show my unread notifications"}'</span> | jq
&#8203;
<span class="cm"># Cross-database query (both!)</span>
<span class="prompt">$</span> curl -s -X POST http://localhost:3004/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "How much did I spend on dining last month, and do I have any alerts about it?"}'</span> | jq</code></pre>
</div>

<div class="callout info">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-bright)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></span>
  <div><p><strong>Cross-database queries:</strong> Ask about spending <em>and</em> notifications in the same question. The agent decides which database to query and combines results from both PostgreSQL and MongoDB into a single response.</p></div>
</div>

<h3 id="example-finance-assistant">Finance Assistant &mdash; PostgreSQL + Prisma</h3>

<p>The original Mimic example and the only one that includes <strong>test scenarios</strong>. Uses a Prisma schema to define the database structure (no raw SQL needed) and demonstrates <code>mimic test</code> with scenario-based evaluation.</p>

<p><strong>Personas:</strong> A <strong>young-professional</strong> (28yo product designer, $95K salary, Austin TX) and a <strong>college-student</strong> (21yo CS student, part-time barista, tight budget).</p>

<h4>Schema (Prisma)</h4>

<p>Instead of SQL DDL, this example uses a Prisma schema that Mimic parses with <code>prisma-ast</code>:</p>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">prisma</span><span>examples/finance-assistant/prisma/schema.prisma</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="kw">enum</span> <span class="ty">AccountType</span> { CHECKING  SAVINGS  CREDIT }
<span class="kw">enum</span> <span class="ty">TransactionCategory</span> { INCOME  RENT  GROCERIES  DINING  ENTERTAINMENT  <span class="cm">// ...12 more</span> }
<span class="kw">enum</span> <span class="ty">TransactionStatus</span>   { PENDING  POSTED  CANCELLED }
&#8203;
<span class="kw">model</span> <span class="ty">User</span> {
  id        <span class="ty">Int</span>       <span class="fn">@id</span> <span class="fn">@default</span>(autoincrement())
  email     <span class="ty">String</span>    <span class="fn">@unique</span>
  firstName <span class="ty">String</span>    <span class="fn">@map</span>(<span class="str">"first_name"</span>)
  accounts  <span class="ty">Account</span>[]
  <span class="fn">@@map</span>(<span class="str">"users"</span>)
}
&#8203;
<span class="kw">model</span> <span class="ty">Account</span> {
  id            <span class="ty">Int</span>          <span class="fn">@id</span> <span class="fn">@default</span>(autoincrement())
  userId        <span class="ty">Int</span>          <span class="fn">@map</span>(<span class="str">"user_id"</span>)
  name          <span class="ty">String</span>       <span class="cm">/// e.g. "Chase Checking"</span>
  type          <span class="ty">AccountType</span>
  balance       <span class="ty">Decimal</span>      <span class="fn">@db.Decimal</span>(12, 2)
  transactions  <span class="ty">Transaction</span>[]
  <span class="fn">@@map</span>(<span class="str">"accounts"</span>)
}
&#8203;
<span class="kw">model</span> <span class="ty">Transaction</span> {
  id       <span class="ty">Int</span>                    <span class="fn">@id</span> <span class="fn">@default</span>(autoincrement())
  amount   <span class="ty">Decimal</span>                <span class="fn">@db.Decimal</span>(12, 2)  <span class="cm">/// +credit, -debit</span>
  category <span class="ty">TransactionCategory</span>
  merchant <span class="ty">String</span>
  status   <span class="ty">TransactionStatus</span>      <span class="fn">@default</span>(POSTED)
  <span class="fn">@@map</span>(<span class="str">"transactions"</span>)
}</code></pre>
</div>

<h4>Test scenarios</h4>

<p>This is the only example that defines <code>mimic test</code> scenarios. Each scenario specifies a persona, a goal for the agent, and expected outcomes:</p>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>mimic.json &mdash; test section</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"test"</span>: {
  <span class="yk">"agent"</span>: <span class="str">"http://localhost: <span class="ty">3000</span>/chat"</span>,
  <span class="yk">"scenarios"</span>: [
    {
      <span class="yk">"name"</span>: <span class="str">"monthly-spending"</span>,
      <span class="yk">"persona"</span>: <span class="str">"young-professional"</span>,
      <span class="yk">"goal"</span>: <span class="str">"Ask about total spending last month"</span>,
      <span class="yk">"expect"</span>: {
        <span class="yk">"tools_called"</span>: ["get_transactions"],
        <span class="yk">"response_accurate"</span>: <span class="ty">true</span>,
        <span class="yk">"no_hallucination"</span>: <span class="ty">true</span>
      }
    },
    {
      <span class="yk">"name"</span>: <span class="str">"category-breakdown"</span>,
      <span class="yk">"persona"</span>: <span class="str">"young-professional"</span>,
      <span class="yk">"goal"</span>: <span class="str">"Ask for a breakdown of spending by category"</span>,
      <span class="yk">"expect"</span>: {
        <span class="yk">"tools_called"</span>: ["get_transactions_summary"],
        <span class="yk">"response_contains"</span>: ["dining", "groceries"],
        <span class="yk">"response_accurate"</span>: <span class="ty">true</span>
      }
    }
  ]
}</code></pre>
</div>

<p>Run the test suite with <code>mimic test</code>. Scenarios verify that the agent calls the right tools and returns accurate, non-hallucinated responses grounded in the seeded data.</p>

<h4>Quick start</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> cd examples/finance-assistant
<span class="prompt">$</span> export DATABASE_URL=<span class="str">"postgresql://localhost:5432/mimic_finance"</span>
<span class="prompt">$</span> mimic run && mimic seed --verbose
&#8203;
<span class="cm"># Start the agent</span>
<span class="prompt">$</span> cd agent && npm install && npm start
&#8203;
<span class="cm"># Run test scenarios</span>
<span class="prompt">$</span> mimic test --verbose</code></pre>
</div>

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div><p><strong>Prisma + testing:</strong> This example shows the full Mimic workflow: Prisma schema &rarr; persona-driven data generation &rarr; seeding &rarr; agent testing with <code>mimic test</code>. Use it as a template when you want to add evaluation to your agent development cycle.</p></div>
</div>

<h3 id="example-billing-agent">Billing Agent &mdash; PostgreSQL + Stripe</h3>

<p>A SaaS billing and subscription management agent that combines <strong>PostgreSQL</strong> (customer records, subscriptions, invoices, payments) with the <strong>Stripe API mock adapter</strong>. Demonstrates Mimic's cross-surface data consistency &mdash; the same customers appear in both the database and Stripe with matching IDs.</p>

<p><strong>Personas:</strong> A <strong>growth-startup</strong> (50 customers across 3 tiers, mix of monthly/annual subscriptions, some past-due invoices, increasing MRR) and an <strong>established-saas</strong> (200+ customers, low churn, mostly enterprise annual contracts, clean billing history).</p>

<h4>Architecture</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">text</span><span>dual-surface architecture</span><button class="code-copy">Copy</button></div>
  <pre><code>                    +-------------------------+
                    |   Billing Agent (:3010)  |
                    |   OpenAI Agents SDK      |
                    |   + Claude Haiku         |
                    +-----------+-------------+
                                |
                   +------------+------------+
                   |                         |
             MCP (stdio)              MCP or HTTP
                   |                         |
          +--------+--------+     +----------+----------+
          |   PostgreSQL    |     |   Stripe Mock API   |
          |  (via Mimic)    |     |   (Mimic adapter)   |
          |                 |     |                     |
          |  customers      |     |  /v1/customers      |
          |  subscriptions  |     |  /v1/charges        |
          |  invoices       |     |  /v1/subscriptions  |
          |  payments       |     |  /v1/invoices       |
          +-----------------+     +---------------------+</code></pre>
</div>

<p><strong>Dual Stripe mode:</strong> The agent supports two approaches for interacting with Stripe &mdash; set <code>USE_HTTP_STRIPE=true</code> for direct HTTP tool calls, or leave it unset (default) to use the Stripe MCP server. Both approaches connect to the same Mimic mock adapter.</p>

<h4>Config</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>examples/billing-agent/mimic.json</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"domain"</span>: <span class="str">"SaaS billing and subscription management platform"</span>,
  <span class="yk">"personas"</span>: [
    { <span class="yk">"name"</span>: <span class="str">"growth-startup"</span>, <span class="yk">"description"</span>: <span class="str">"50 customers across 3 pricing tiers, mix of monthly/annual, some past-due invoices"</span> },
    { <span class="yk">"name"</span>: <span class="str">"established-saas"</span>, <span class="yk">"description"</span>: <span class="str">"200+ customers, low churn, mostly enterprise annual contracts"</span> }
  ],
  <span class="yk">"databases"</span>: {
    <span class="yk">"primary"</span>: {
      <span class="yk">"type"</span>: <span class="str">"postgres"</span>,
      <span class="yk">"url"</span>: <span class="str">"$DATABASE_URL"</span>,
      <span class="yk">"schema"</span>: { <span class="yk">"source"</span>: <span class="str">"prisma"</span>, <span class="yk">"path"</span>: <span class="str">"./prisma/schema.prisma"</span> }
    }
  },
  <span class="yk">"apis"</span>: { <span class="yk">"stripe"</span>: { <span class="yk">"enabled"</span>: <span class="ty">true</span>, <span class="yk">"mcp"</span>: <span class="ty">true</span> } }
}</code></pre>
</div>

<h4>Schema highlights</h4>

<p>Four tables with Stripe ID cross-references: <code>customers</code> (with <code>stripe_customer_id</code>), <code>subscriptions</code> (with <code>stripe_subscription_id</code>), <code>invoices</code> (with <code>stripe_invoice_id</code>), and <code>payments</code> (with <code>stripe_payment_id</code>). This enables the agent to correlate database records with Stripe API objects.</p>

<h4>Agent tools</h4>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Source</th><th>Tool</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td style="color: var(--cyan);">MCP (Postgres)</td><td><code>get_customers</code></td><td>Query customers by name, email, plan, or status</td></tr>
      <tr><td style="color: var(--cyan);">MCP (Postgres)</td><td><code>get_subscriptions</code></td><td>List subscriptions with status and billing info</td></tr>
      <tr><td style="color: var(--cyan);">MCP (Postgres)</td><td><code>get_invoices</code></td><td>Invoice history with payment status</td></tr>
      <tr><td style="color: var(--amber);">Stripe (MCP/HTTP)</td><td><code>stripe_create_charge</code></td><td>Create a charge against a Stripe customer</td></tr>
      <tr><td style="color: var(--amber);">Stripe (MCP/HTTP)</td><td><code>stripe_create_refund</code></td><td>Issue full or partial refund on a charge</td></tr>
      <tr><td style="color: var(--amber);">Stripe (MCP/HTTP)</td><td><code>stripe_list_subscriptions</code></td><td>List subscriptions via Stripe API</td></tr>
      <tr><td style="color: var(--amber);">Stripe (MCP/HTTP)</td><td><code>stripe_get_balance</code></td><td>Retrieve account balance</td></tr>
      <tr><td style="color: var(--amber);">Stripe (MCP/HTTP)</td><td><code>stripe_list_invoices</code></td><td>List invoices via Stripe API</td></tr>
    </tbody>
  </table>
</div>

<h4>Quick start</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> cd examples/billing-agent
<span class="prompt">$</span> docker compose up -d               <span class="cm"># Start PostgreSQL</span>
<span class="prompt">$</span> export DATABASE_URL=<span class="str">"postgresql://mimic:mimic@localhost:5433/mimic_billing"</span>
<span class="prompt">$</span> mimic run && mimic seed --verbose   <span class="cm"># Seed database + Stripe mock</span>
<span class="prompt">$</span> mimic host --background             <span class="cm"># Start Stripe mock API</span>
&#8203;
<span class="prompt">$</span> cd agent && npm install && npm start
&#8203;
<span class="cm"># Query billing data</span>
<span class="prompt">$</span> curl -s -X POST http://localhost:3010/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "Show customers with past-due invoices"}'</span> | jq .
&#8203;
<span class="cm"># Issue a refund via Stripe</span>
<span class="prompt">$</span> curl -s -X POST http://localhost:3010/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "Refund the last charge for customer cus_001"}'</span> | jq .</code></pre>
</div>

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div><p><strong>Cross-surface consistency:</strong> Customers in PostgreSQL have matching <code>stripe_customer_id</code> values. The agent queries the database for customer info, then uses the Stripe ID to perform payment operations &mdash; exactly how a real billing agent works.</p></div>
</div>

<h3 id="example-budget-agent">Budget Agent &mdash; PostgreSQL + Plaid</h3>

<p>A personal budgeting assistant that combines <strong>PostgreSQL</strong> (budgets, savings goals) with the <strong>Plaid API mock adapter</strong> (linked bank accounts, transactions). Demonstrates how to build agents that bridge internal application data with external financial APIs.</p>

<p><strong>Personas:</strong> A <strong>budget-conscious</strong> professional (tracks every dollar, strict monthly budgets, some overspending patterns) and a <strong>high-earner</strong> engineer (multiple accounts including investment, loose budgets, focused on savings rate).</p>

<h4>Config</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>examples/budget-agent/mimic.json</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"domain"</span>: <span class="str">"Personal finance and budgeting app"</span>,
  <span class="yk">"personas"</span>: [
    { <span class="yk">"name"</span>: <span class="str">"budget-conscious"</span>, <span class="yk">"description"</span>: <span class="str">"Young professional tracking every dollar, strict monthly budgets"</span> },
    { <span class="yk">"name"</span>: <span class="str">"high-earner"</span>, <span class="yk">"description"</span>: <span class="str">"Senior engineer, multiple accounts, focused on savings rate"</span> }
  ],
  <span class="yk">"databases"</span>: {
    <span class="yk">"primary"</span>: {
      <span class="yk">"type"</span>: <span class="str">"postgres"</span>,
      <span class="yk">"url"</span>: <span class="str">"$DATABASE_URL"</span>,
      <span class="yk">"schema"</span>: { <span class="yk">"source"</span>: <span class="str">"prisma"</span>, <span class="yk">"path"</span>: <span class="str">"./prisma/schema.prisma"</span> }
    }
  },
  <span class="yk">"apis"</span>: { <span class="yk">"plaid"</span>: { <span class="yk">"enabled"</span>: <span class="ty">true</span>, <span class="yk">"mcp"</span>: <span class="ty">true</span> } }
}</code></pre>
</div>

<h4>Schema highlights</h4>

<p>Four tables covering the budgeting domain: <code>accounts</code> (with <code>plaid_account_id</code> cross-reference), <code>transactions</code> (with <code>plaid_txn_id</code>), <code>budgets</code> (per-category monthly limits with unique constraint on category+month), and <code>savings_goals</code> (target amounts with progress tracking).</p>

<h4>Agent tools</h4>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Source</th><th>Tool</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td style="color: var(--cyan);">MCP (Postgres)</td><td><code>get_budgets</code></td><td>Query budget status per category and month</td></tr>
      <tr><td style="color: var(--cyan);">MCP (Postgres)</td><td><code>get_savings_goals</code></td><td>Check savings goal progress</td></tr>
      <tr><td style="color: var(--cyan);">MCP (Postgres)</td><td><code>get_transactions</code></td><td>Stored transaction history from database</td></tr>
      <tr><td style="color: var(--green);">Plaid (MCP/HTTP)</td><td><code>get_plaid_accounts</code></td><td>Fetch linked bank accounts and balances</td></tr>
      <tr><td style="color: var(--green);">Plaid (MCP/HTTP)</td><td><code>get_plaid_transactions</code></td><td>Fetch recent transactions with date filters</td></tr>
      <tr><td style="color: var(--green);">Plaid (MCP/HTTP)</td><td><code>get_plaid_balance</code></td><td>Real-time balance for a specific account</td></tr>
    </tbody>
  </table>
</div>

<h4>Quick start</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> cd examples/budget-agent
<span class="prompt">$</span> docker compose up -d               <span class="cm"># Start PostgreSQL</span>
<span class="prompt">$</span> export DATABASE_URL=<span class="str">"postgresql://mimic:mimic@localhost:5434/mimic_budget"</span>
<span class="prompt">$</span> mimic run && mimic seed --verbose   <span class="cm"># Seed database + Plaid mock</span>
<span class="prompt">$</span> mimic host --background             <span class="cm"># Start Plaid mock API</span>
&#8203;
<span class="prompt">$</span> cd agent && npm install && npm start
&#8203;
<span class="prompt">$</span> curl -s -X POST http://localhost:3011/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "Am I over budget on dining this month?"}'</span> | jq .
&#8203;
<span class="prompt">$</span> curl -s -X POST http://localhost:3011/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "How is my emergency fund savings goal going?"}'</span> | jq .</code></pre>
</div>

<div class="callout info">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-bright)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></span>
  <div><p><strong>Plaid integration:</strong> Accounts have matching <code>plaid_account_id</code> values, so the agent can correlate Plaid bank data with internal budget tracking. Ask about spending patterns, and the agent fetches live transactions from Plaid while checking budgets from PostgreSQL.</p></div>
</div>

<h3 id="example-payments-monitor">Payments Monitor &mdash; PostgreSQL + Stripe</h3>

<p>A payment operations monitoring agent for SaaS platforms. Combines <strong>PostgreSQL</strong> (payment metrics, charges, subscriptions, daily aggregates) with the <strong>Stripe API</strong> (live payment operations). Built for ops teams who need to monitor payment health, investigate failures, and take action on at-risk subscriptions.</p>

<p><strong>Personas:</strong> A <strong>healthy-business</strong> (95% payment success rate, &lt;2% churn, steady MRR growth, 500 active subscriptions) and a <strong>struggling-business</strong> (15% failure rate, 8% churn, rising refunds, needs dunning and recovery workflows).</p>

<h4>Config</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>examples/payments-monitor/mimic.json</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"domain"</span>: <span class="str">"Payment operations dashboard for a SaaS platform"</span>,
  <span class="yk">"personas"</span>: [
    { <span class="yk">"name"</span>: <span class="str">"healthy-business"</span>, <span class="yk">"description"</span>: <span class="str">"95% success rate, <2% churn, 500 subscriptions"</span> },
    { <span class="yk">"name"</span>: <span class="str">"struggling-business"</span>, <span class="yk">"description"</span>: <span class="str">"15% failure rate, 8% churn, needs dunning workflows"</span> }
  ],
  <span class="yk">"databases"</span>: {
    <span class="yk">"primary"</span>: {
      <span class="yk">"type"</span>: <span class="str">"postgres"</span>,
      <span class="yk">"url"</span>: <span class="str">"$DATABASE_URL"</span>,
      <span class="yk">"schema"</span>: { <span class="yk">"source"</span>: <span class="str">"prisma"</span>, <span class="yk">"path"</span>: <span class="str">"./prisma/schema.prisma"</span> }
    }
  },
  <span class="yk">"apis"</span>: { <span class="yk">"stripe"</span>: { <span class="yk">"enabled"</span>: <span class="ty">true</span>, <span class="yk">"mcp"</span>: <span class="ty">true</span> } }
}</code></pre>
</div>

<h4>Schema highlights</h4>

<p>Five tables for payment operations: <code>customers</code> (with <code>stripe_id</code>), <code>charges</code> (with failure codes like <code>card_declined</code>, <code>expired_card</code>, <code>insufficient_funds</code>), <code>subscriptions</code> (with cancel reasons), <code>payment_events</code> (webhook-style event log), and <code>daily_metrics</code> (pre-aggregated success rates, revenue, churn by day).</p>

<h4>Agent tools</h4>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Source</th><th>Tool</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td style="color: var(--cyan);">Direct (Postgres)</td><td><code>get_payment_success_rate</code></td><td>Success rate for a date or range from daily_metrics</td></tr>
      <tr><td style="color: var(--cyan);">Direct (Postgres)</td><td><code>get_failed_charges</code></td><td>List failed charges with failure reasons and customer info</td></tr>
      <tr><td style="color: var(--cyan);">Direct (Postgres)</td><td><code>get_mrr_and_churn</code></td><td>Current MRR, churn rate, and churned subscriptions</td></tr>
      <tr><td style="color: var(--cyan);">Direct (Postgres)</td><td><code>get_at_risk_subscriptions</code></td><td>Past-due or unpaid subscriptions needing outreach</td></tr>
      <tr><td style="color: var(--cyan);">Direct (Postgres)</td><td><code>get_revenue_timeline</code></td><td>Daily revenue and charge metrics for trend analysis</td></tr>
      <tr><td style="color: var(--amber);">Stripe (HTTP)</td><td><code>retry_failed_payment</code></td><td>Retry a failed charge via Stripe API</td></tr>
      <tr><td style="color: var(--amber);">Stripe (HTTP)</td><td><code>issue_refund</code></td><td>Issue full or partial refund</td></tr>
      <tr><td style="color: var(--amber);">Stripe (HTTP)</td><td><code>get_stripe_balance</code></td><td>Check current Stripe account balance</td></tr>
    </tbody>
  </table>
</div>

<h4>Quick start</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> cd examples/payments-monitor
<span class="prompt">$</span> docker compose up -d               <span class="cm"># Start PostgreSQL</span>
<span class="prompt">$</span> export DATABASE_URL=<span class="str">"postgresql://mimic:mimic@localhost:5435/mimic_payments"</span>
<span class="prompt">$</span> mimic run && mimic seed --verbose
&#8203;
<span class="prompt">$</span> cd agent && npm install && npm start
&#8203;
<span class="cm"># Monitor payment health</span>
<span class="prompt">$</span> curl -s -X POST http://localhost:3012/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "What is the payment success rate this week?"}'</span> | jq .
&#8203;
<span class="cm"># Investigate failures</span>
<span class="prompt">$</span> curl -s -X POST http://localhost:3012/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "Show me the most common failure reasons and which customers are affected"}'</span> | jq .
&#8203;
<span class="cm"># Check churn</span>
<span class="prompt">$</span> curl -s -X POST http://localhost:3012/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "What is our MRR and churn rate?"}'</span> | jq .</code></pre>
</div>

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div><p><strong>Persona contrast:</strong> Switch between the <code>healthy-business</code> and <code>struggling-business</code> personas to see radically different payment data. The healthy business shows clean metrics; the struggling one surfaces failure patterns, at-risk subscriptions, and churn spikes &mdash; perfect for testing monitoring and alerting agents.</p></div>
</div>

<h3 id="example-meeting-notes">Meeting Notes &mdash; PostgreSQL + Slack</h3>

<p>A team meeting management agent that combines <strong>PostgreSQL</strong> (meetings, action items, decisions, team members) with the <strong>Slack API mock adapter</strong> (posting summaries, searching messages, listing channels). Demonstrates how agents can bridge internal data with communication platforms.</p>

<p><strong>Personas:</strong> An <strong>engineering-team</strong> (10-person team with daily standups, weekly sprint planning, bi-weekly retros, active Slack workspace) and a <strong>cross-functional</strong> team (product/engineering/design with weekly syncs, monthly all-hands, design reviews).</p>

<h4>Config</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>examples/meeting-notes/mimic.json</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"domain"</span>: <span class="str">"Team meeting management and note-taking platform"</span>,
  <span class="yk">"personas"</span>: [
    { <span class="yk">"name"</span>: <span class="str">"engineering-team"</span>, <span class="yk">"description"</span>: <span class="str">"10-person team, daily standups, sprint planning, retros"</span> },
    { <span class="yk">"name"</span>: <span class="str">"cross-functional"</span>, <span class="yk">"description"</span>: <span class="str">"Product/eng/design team, weekly syncs, monthly all-hands"</span> }
  ],
  <span class="yk">"databases"</span>: {
    <span class="yk">"primary"</span>: {
      <span class="yk">"type"</span>: <span class="str">"postgres"</span>,
      <span class="yk">"url"</span>: <span class="str">"$DATABASE_URL"</span>,
      <span class="yk">"schema"</span>: { <span class="yk">"source"</span>: <span class="str">"prisma"</span>, <span class="yk">"path"</span>: <span class="str">"./prisma/schema.prisma"</span> }
    }
  },
  <span class="yk">"apis"</span>: { <span class="yk">"slack"</span>: { <span class="yk">"enabled"</span>: <span class="ty">true</span>, <span class="yk">"mcp"</span>: <span class="ty">true</span> } }
}</code></pre>
</div>

<h4>Schema highlights</h4>

<p>Five tables capturing the meeting domain: <code>meetings</code> (with type enum: standup, sprint-planning, retro, sync, all-hands, design-review; includes <code>slack_channel</code> and <code>slack_thread_ts</code> for cross-referencing), <code>team_members</code> (with <code>slack_user_id</code>), <code>meeting_participants</code> (attendance tracking), <code>action_items</code> (with status lifecycle), and <code>decisions</code> (with context and attribution).</p>

<h4>Agent tools</h4>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Source</th><th>Tool</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td style="color: var(--cyan);">Direct (Postgres)</td><td><code>get_recent_meetings</code></td><td>List meetings with participant/action item counts</td></tr>
      <tr><td style="color: var(--cyan);">Direct (Postgres)</td><td><code>search_action_items</code></td><td>Search by status, assignee, or keyword</td></tr>
      <tr><td style="color: var(--cyan);">Direct (Postgres)</td><td><code>get_meeting_decisions</code></td><td>Decisions with context and attribution</td></tr>
      <tr><td style="color: var(--cyan);">Direct (Postgres)</td><td><code>get_team_members</code></td><td>Team info with attendance stats and open items</td></tr>
      <tr><td style="color: var(--pink);">Slack (HTTP)</td><td><code>list_slack_channels</code></td><td>Available channels for posting summaries</td></tr>
      <tr><td style="color: var(--pink);">Slack (HTTP)</td><td><code>post_meeting_summary</code></td><td>Compose and post formatted summary to a channel</td></tr>
      <tr><td style="color: var(--pink);">Slack (HTTP)</td><td><code>search_slack</code></td><td>Search messages for prior discussions</td></tr>
    </tbody>
  </table>
</div>

<h4>Quick start</h4>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> cd examples/meeting-notes
<span class="prompt">$</span> docker compose up -d               <span class="cm"># Start PostgreSQL</span>
<span class="prompt">$</span> export DATABASE_URL=<span class="str">"postgresql://mimic:mimic@localhost:5436/mimic_meetings"</span>
<span class="prompt">$</span> mimic run && mimic seed --verbose
<span class="prompt">$</span> mimic host --background             <span class="cm"># Start Slack mock API</span>
&#8203;
<span class="prompt">$</span> cd agent && npm install && npm start
&#8203;
<span class="cm"># Review meetings</span>
<span class="prompt">$</span> curl -s -X POST http://localhost:3013/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "What were the key decisions from last sprint planning?"}'</span> | jq .
&#8203;
<span class="cm"># Track action items</span>
<span class="prompt">$</span> curl -s -X POST http://localhost:3013/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "Show all open action items assigned to engineers"}'</span> | jq .
&#8203;
<span class="cm"># Post to Slack</span>
<span class="prompt">$</span> curl -s -X POST http://localhost:3013/chat \
    -H <span class="str">"Content-Type: application/json"</span> \
    -d <span class="str">'{"message": "Post the summary of meeting #5 to the #engineering channel"}'</span> | jq .</code></pre>
</div>

<div class="callout info">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-bright)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></span>
  <div><p><strong>Slack integration:</strong> Meeting records in PostgreSQL have <code>slack_channel</code> and <code>slack_thread_ts</code> fields that update when summaries are posted. Team members have <code>slack_user_id</code> for mention support. The agent composes rich Slack Block Kit messages with headers, action items, and decisions.</p></div>
</div>
