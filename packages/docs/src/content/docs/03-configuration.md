---
title: "Configuration"
eyebrow: "Configuration"
description: "The mimic.json file is the single entry point for all of Mimic's behaviour."
order: 3
slug: "configuration"
prev: { slug: "concepts", title: "Core Concepts" }
next: { slug: "cli", title: "CLI Reference" }
---

<h2 id="config-file">
  <span class="eyebrow">Configuration</span>
  mimic.json
</h2>

<p class="lead">
  The <code>mimic.json</code> file is the single entry point for all of Mimic's behaviour. It lives in your project root and defines <em>what</em> your agent's world looks like &mdash; the domain, the people in it, which databases to seed, and how to test the agent.
</p>

Created automatically by `mimic init`, or write one by hand. Only two fields are required: `domain` and `personas`. Everything else is optional with sensible defaults.

### Minimal example

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>mimic.json &mdash; bare minimum</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"domain"</span>: <span class="str">"personal finance assistant"</span>,
  <span class="yk">"personas"</span>: [
    {
      <span class="yk">"name"</span>: <span class="str">"young-professional"</span>,
      <span class="yk">"description"</span>: <span class="str">"28yo product designer, $95K salary, Austin TX"</span>
    }
  ]
}</code></pre>
</div>

That's it. Two fields and you can run `mimic run` to generate blueprints. Add a `databases` block when you're ready to seed real data.

### Full example

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>mimic.json &mdash; all options</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"domain"</span>: <span class="str">"personal finance and banking platform"</span>,
&#8203;
  <span class="yk">"llm"</span>: {
    <span class="yk">"provider"</span>: <span class="str">"anthropic"</span>,
    <span class="yk">"model"</span>: <span class="str">"claude-haiku-4-5"</span>
  },
&#8203;
  <span class="yk">"personas"</span>: [
    {
      <span class="yk">"name"</span>: <span class="str">"active-trader"</span>,
      <span class="yk">"description"</span>: <span class="str">"31yo software engineer, $140K salary, active stock trader, 5+ bank accounts"</span>
    },
    {
      <span class="yk">"name"</span>: <span class="str">"saver"</span>,
      <span class="yk">"description"</span>: <span class="str">"27yo teacher, $55K salary, focuses on saving, tracks every dollar"</span>
    }
  ],
&#8203;
  <span class="yk">"generate"</span>: {
    <span class="yk">"volume"</span>: <span class="str">"6 months"</span>,
    <span class="yk">"seed"</span>: <span class="ty">42</span>
  },
&#8203;
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
  },
&#8203;
  <span class="yk">"apis"</span>: {
    <span class="yk">"stripe"</span>: { <span class="yk">"enabled"</span>: <span class="ty">true</span>, <span class="yk">"mcp"</span>: <span class="ty">true</span> }
  },
&#8203;
  <span class="yk">"test"</span>: {
    <span class="yk">"agent"</span>: <span class="str">"http://localhost:3000/chat"</span>,
    <span class="yk">"scenarios"</span>: [
      {
        <span class="yk">"name"</span>: <span class="str">"balance-check"</span>,
        <span class="yk">"persona"</span>: <span class="str">"active-trader"</span>,
        <span class="yk">"goal"</span>: <span class="str">"Ask about current account balance"</span>,
        <span class="yk">"expect"</span>: {
          <span class="yk">"tools_called"</span>: [<span class="str">"get_accounts"</span>],
          <span class="yk">"response_accurate"</span>: <span class="ty">true</span>
        }
      }
    ]
  }
}</code></pre>
</div>

### Field reference

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>domain</code></td><td>Yes</td><td>string</td><td>What your app does &mdash; used as context during data generation</td></tr>
      <tr><td><code>personas</code></td><td>Yes</td><td>array</td><td>One or more persona definitions (min 1)</td></tr>
      <tr><td><code>llm</code></td><td>No</td><td>object</td><td>LLM provider and model for blueprint generation</td></tr>
      <tr><td><code>generate</code></td><td>No</td><td>object</td><td>Volume, seed, and per-table row overrides</td></tr>
      <tr><td><code>databases</code></td><td>No</td><td>object</td><td>Named database targets to seed</td></tr>
      <tr><td><code>apis</code></td><td>No</td><td>object</td><td>API mock adapters to enable (Stripe, Plaid, Slack, etc.)</td></tr>
      <tr><td><code>test</code></td><td>No</td><td>object</td><td>Agent endpoint and test scenarios</td></tr>
    </tbody>
  </table>
</div>

---

<h3 id="config-domain">domain</h3>

A plain-English description of what your application does. This is the most important field &mdash; it's the primary context given to the LLM when generating persona blueprints. Be specific: "personal finance assistant" generates better data than "app".

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"domain"</span>: <span class="str">"e-commerce storefront with product catalog, shopping cart, and order tracking"</span></code></pre>
</div>

Good domain descriptions include the kind of data your app works with. Here are examples from the bundled examples:

- `"project and task management app"` &mdash; generates projects, tasks, labels, comments
- `"technical blog and content platform"` &mdash; generates users, posts, comments, bookmarks
- `"e-commerce storefront"` &mdash; generates customers, products, orders, reviews
- `"personal finance and banking platform"` &mdash; generates accounts, transactions, activity logs

<h3 id="config-personas">personas</h3>

An array of fictional identities that drive data generation. Each persona produces a different **style** of data &mdash; different volumes, different patterns, different values &mdash; even though they share the same schema.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"personas"</span>: [
  {
    <span class="yk">"name"</span>: <span class="str">"power-shopper"</span>,
    <span class="yk">"description"</span>: <span class="str">"34yo marketing exec, frequent online buyer, $120K salary, loves electronics and fashion"</span>
  },
  {
    <span class="yk">"name"</span>: <span class="str">"casual-browser"</span>,
    <span class="yk">"description"</span>: <span class="str">"22yo grad student, occasional buyer, budget-conscious, mostly books and supplies"</span>
  }
]</code></pre>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>name</code></td><td>Yes</td><td>string</td><td>Unique identifier. Lowercase, hyphens, numbers only (<code>^[a-z0-9-]+$</code>)</td></tr>
      <tr><td><code>description</code></td><td>Yes</td><td>string</td><td>Detailed persona description &mdash; the LLM reads this to generate data</td></tr>
      <tr><td><code>blueprint</code></td><td>No</td><td>string</td><td>Path to a pre-built JSON blueprint file (skips LLM generation)</td></tr>
    </tbody>
  </table>
</div>

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div>**Writing good descriptions:** Include age, occupation, salary range, and behavioural patterns. The more specific you are, the more realistic the generated data. "29yo full-stack dev, manages 3 active projects, heavy task creator, uses labels extensively" produces much better data than "developer".</div>
</div>

Each persona generates its own blueprint and seeds its own dataset. When you run `mimic seed`, every persona's data is inserted into the same database, giving you a realistic multi-user environment.

<h3 id="config-llm">llm</h3>

Configures which LLM provider and model to use for blueprint generation. If omitted, defaults to Anthropic Claude Haiku.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"llm"</span>: {
  <span class="yk">"provider"</span>: <span class="str">"anthropic"</span>,
  <span class="yk">"model"</span>: <span class="str">"claude-haiku-4-5"</span>
}</code></pre>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>provider</code></td><td>Yes</td><td>string</td><td><code>anthropic</code></td><td><code>anthropic</code>, <code>openai</code>, <code>ollama</code>, or <code>custom</code></td></tr>
      <tr><td><code>model</code></td><td>Yes</td><td>string</td><td><code>claude-haiku-4-5</code></td><td>Model identifier for the chosen provider</td></tr>
      <tr><td><code>apiKey</code></td><td>No</td><td>string</td><td>from env</td><td>API key &mdash; defaults to <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code></td></tr>
      <tr><td><code>baseUrl</code></td><td>No</td><td>string</td><td>&mdash;</td><td>Custom endpoint for <code>ollama</code> or <code>custom</code> providers</td></tr>
    </tbody>
  </table>
</div>

The LLM is only called during `mimic run` (blueprint generation). Once blueprints are generated and cached in `.mimic/blueprints/`, subsequent `mimic seed` commands work entirely offline.

<h3 id="config-generate">generate</h3>

Controls the volume and reproducibility of generated data.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"generate"</span>: {
  <span class="yk">"volume"</span>: <span class="str">"6 months"</span>,
  <span class="yk">"seed"</span>: <span class="ty">42</span>,
  <span class="yk">"tables"</span>: {
    <span class="yk">"transactions"</span>: <span class="ty">500</span>,
    <span class="yk">"users"</span>: <span class="str">"auto"</span>
  }
}</code></pre>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>volume</code></td><td>No</td><td>string</td><td><code>6 months</code></td><td>Time span of synthetic data. Examples: <code>"3 months"</code>, <code>"1 year"</code>, <code>"2 weeks"</code></td></tr>
      <tr><td><code>seed</code></td><td>No</td><td>integer</td><td><code>42</code></td><td>PRNG seed for deterministic generation &mdash; same seed = same data every time</td></tr>
      <tr><td><code>tables</code></td><td>No</td><td>object</td><td>&mdash;</td><td>Override row counts per table. Value is a number or <code>"auto"</code></td></tr>
    </tbody>
  </table>
</div>

The `volume` field tells the blueprint expander how far back in time to generate data. A "busy-developer" persona with `"3 months"` might create 40-60 tasks, while `"1 year"` for the same persona would produce 150-200. The `seed` makes this deterministic &mdash; use it for reproducible test environments and CI pipelines.

<h3 id="config-databases">databases</h3>

A named map of database targets to seed. Each key is a label you choose (e.g. `"primary"`, `"analytics"`, `"cache"`), and the value configures the connection and seeding behaviour. The `type` field determines which adapter is used.

Mimic supports four database types: **PostgreSQL**, **MySQL**, **SQLite**, and **MongoDB**. You can configure multiple databases &mdash; even of different types &mdash; and `mimic seed` populates them all in a single command.

#### PostgreSQL

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"primary"</span>: {
  <span class="yk">"type"</span>: <span class="str">"postgres"</span>,
  <span class="yk">"url"</span>: <span class="str">"$DATABASE_URL"</span>,
  <span class="yk">"schema"</span>: {
    <span class="yk">"source"</span>: <span class="str">"prisma"</span>,
    <span class="yk">"path"</span>: <span class="str">"./prisma/schema.prisma"</span>
  },
  <span class="yk">"seedStrategy"</span>: <span class="str">"truncate-and-insert"</span>
}</code></pre>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>type</code></td><td>Yes</td><td><code>"postgres"</code></td><td>Selects the PostgreSQL adapter</td></tr>
      <tr><td><code>url</code></td><td>Yes</td><td>string</td><td>Connection string: <code>postgresql://user:pass@host:port/db</code></td></tr>
      <tr><td><code>schema.source</code></td><td>No</td><td>string</td><td><code>"prisma"</code>, <code>"sql"</code>, or <code>"introspect"</code> (reads live DB)</td></tr>
      <tr><td><code>schema.path</code></td><td>No</td><td>string</td><td>File path for <code>prisma</code> or <code>sql</code> sources</td></tr>
      <tr><td><code>seedStrategy</code></td><td>No</td><td>string</td><td><code>"truncate-and-insert"</code> (default), <code>"append"</code>, or <code>"upsert"</code></td></tr>
    </tbody>
  </table>
</div>

**Schema sources** tell Mimic how to discover your table structure:

- `"prisma"` &mdash; parses a Prisma schema file with `prisma-ast`. Supports enums, relations, and column-level annotations
- `"sql"` &mdash; parses SQL DDL files (CREATE TABLE statements)
- `"introspect"` &mdash; connects to the live database and reads `information_schema`. No schema files needed, but requires the database to be running with tables already created

#### MySQL

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"primary"</span>: {
  <span class="yk">"type"</span>: <span class="str">"mysql"</span>,
  <span class="yk">"url"</span>: <span class="str">"$DATABASE_URL"</span>,
  <span class="yk">"schema"</span>: { <span class="yk">"source"</span>: <span class="str">"introspect"</span> },
  <span class="yk">"seedStrategy"</span>: <span class="str">"truncate-and-insert"</span>
}</code></pre>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>type</code></td><td>Yes</td><td><code>"mysql"</code></td><td>Selects the MySQL adapter</td></tr>
      <tr><td><code>url</code></td><td>Yes</td><td>string</td><td>Connection string: <code>mysql://user:pass@host:port/db</code></td></tr>
      <tr><td><code>schema.source</code></td><td>No</td><td>string</td><td><code>"sql"</code> or <code>"introspect"</code></td></tr>
      <tr><td><code>schema.path</code></td><td>No</td><td>string</td><td>File path for <code>sql</code> source</td></tr>
      <tr><td><code>seedStrategy</code></td><td>No</td><td>string</td><td><code>"truncate-and-insert"</code> (default), <code>"append"</code>, or <code>"upsert"</code></td></tr>
      <tr><td><code>excludeTables</code></td><td>No</td><td>array</td><td>Table names to skip during seeding (e.g. <code>["_migrations"]</code>)</td></tr>
    </tbody>
  </table>
</div>

#### SQLite

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"local"</span>: {
  <span class="yk">"type"</span>: <span class="str">"sqlite"</span>,
  <span class="yk">"path"</span>: <span class="str">"./tasks.db"</span>,
  <span class="yk">"walMode"</span>: <span class="ty">true</span>,
  <span class="yk">"seedStrategy"</span>: <span class="str">"truncate-and-insert"</span>
}</code></pre>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>type</code></td><td>Yes</td><td><code>"sqlite"</code></td><td>Selects the SQLite adapter</td></tr>
      <tr><td><code>path</code></td><td>Yes</td><td>string</td><td>File path to the SQLite database (e.g. <code>"./data.db"</code>)</td></tr>
      <tr><td><code>walMode</code></td><td>No</td><td>boolean</td><td>Enable Write-Ahead Logging for better concurrency. Default: <code>false</code></td></tr>
      <tr><td><code>seedStrategy</code></td><td>No</td><td>string</td><td><code>"truncate-and-insert"</code> (default) or <code>"append"</code></td></tr>
    </tbody>
  </table>
</div>

SQLite requires no server &mdash; the database is a single file. Use `"walMode": true` if your agent reads the database while Mimic is seeding, to avoid locking issues.

#### MongoDB

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"documents"</span>: {
  <span class="yk">"type"</span>: <span class="str">"mongodb"</span>,
  <span class="yk">"url"</span>: <span class="str">"$MONGO_URL"</span>,
  <span class="yk">"database"</span>: <span class="str">"mimic_blog"</span>,
  <span class="yk">"seedStrategy"</span>: <span class="str">"delete-and-insert"</span>,
  <span class="yk">"autoCreateIndexes"</span>: <span class="ty">true</span>
}</code></pre>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>type</code></td><td>Yes</td><td><code>"mongodb"</code></td><td>Selects the MongoDB adapter</td></tr>
      <tr><td><code>url</code></td><td>Yes</td><td>string</td><td>Connection string: <code>mongodb://host:port</code> or <code>mongodb+srv://...</code></td></tr>
      <tr><td><code>database</code></td><td>No</td><td>string</td><td>Database name. If omitted, uses the name from the URL</td></tr>
      <tr><td><code>seedStrategy</code></td><td>No</td><td>string</td><td><code>"delete-and-insert"</code> (default), <code>"drop-and-insert"</code>, <code>"append"</code>, or <code>"upsert"</code></td></tr>
      <tr><td><code>autoCreateIndexes</code></td><td>No</td><td>boolean</td><td>Auto-create indexes on common fields (<code>user_id</code>, <code>email</code>, <code>created_at</code>, etc.)</td></tr>
      <tr><td><code>collections</code></td><td>No</td><td>array</td><td>Limit seeding to specific collections. If omitted, seeds all</td></tr>
    </tbody>
  </table>
</div>

MongoDB does not require a schema file. Mimic generates document shapes from the domain description and persona, making it the fastest database to get started with. Set `"autoCreateIndexes": true` to automatically index common query fields.

<div class="callout info">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-bright)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></span>
  <div>**Multi-database:** You can define multiple databases of different types in the same config. `mimic seed` populates them all in one command with consistent user IDs across databases. See the <a href="#example-fintech-multi">fintech-multi-db example</a>.</div>
</div>

#### Schema source availability

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Source</th><th>PostgreSQL</th><th>MySQL</th><th>SQLite</th><th>MongoDB</th></tr></thead>
    <tbody>
      <tr><td><code>prisma</code></td><td style="color: var(--green);">Yes</td><td>&mdash;</td><td>&mdash;</td><td>&mdash;</td></tr>
      <tr><td><code>sql</code></td><td style="color: var(--green);">Yes</td><td style="color: var(--green);">Yes</td><td>&mdash;</td><td>&mdash;</td></tr>
      <tr><td><code>introspect</code></td><td style="color: var(--green);">Yes</td><td style="color: var(--green);">Yes</td><td>&mdash;</td><td>&mdash;</td></tr>
      <tr><td>Schema-free</td><td>&mdash;</td><td>&mdash;</td><td>&mdash;</td><td style="color: var(--green);">Yes</td></tr>
    </tbody>
  </table>
</div>

#### Seed strategies

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Strategy</th><th>Behaviour</th><th>Available on</th></tr></thead>
    <tbody>
      <tr><td><code>truncate-and-insert</code></td><td>Clears all rows, then inserts fresh data. Idempotent</td><td>Postgres, MySQL, SQLite</td></tr>
      <tr><td><code>delete-and-insert</code></td><td>Deletes all documents, then inserts. Idempotent</td><td>MongoDB</td></tr>
      <tr><td><code>drop-and-insert</code></td><td>Drops collection entirely, recreates, then inserts</td><td>MongoDB</td></tr>
      <tr><td><code>append</code></td><td>Adds rows/documents without removing existing data</td><td>All</td></tr>
      <tr><td><code>upsert</code></td><td>Inserts or updates based on primary key / <code>_id</code></td><td>Postgres, MySQL, MongoDB</td></tr>
    </tbody>
  </table>
</div>

<h3 id="config-apis">apis</h3>

A named map of API mock adapters. Each key is the adapter ID (e.g. `"stripe"`, `"plaid"`, `"slack"`), and the value configures the adapter's behaviour. When `mimic host` runs, enabled adapters are registered as Fastify routes on the mock server. When `mcp: true`, the adapter's tools are also registered on the unified MCP server.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"apis"</span>: {
  <span class="yk">"stripe"</span>: { <span class="yk">"enabled"</span>: <span class="ty">true</span>, <span class="yk">"mcp"</span>: <span class="ty">true</span> },
  <span class="yk">"plaid"</span>: { <span class="yk">"enabled"</span>: <span class="ty">true</span>, <span class="yk">"mcp"</span>: <span class="ty">true</span> },
  <span class="yk">"slack"</span>: { <span class="yk">"enabled"</span>: <span class="ty">true</span>, <span class="yk">"mcp"</span>: <span class="ty">false</span> }
}</code></pre>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>adapter</code></td><td>No</td><td>string</td><td>key name</td><td>Maps to the <code>@mimicai/adapter-&lt;name&gt;</code> package. If omitted, uses the key</td></tr>
      <tr><td><code>version</code></td><td>No</td><td>string</td><td>&mdash;</td><td>API version (e.g. <code>"v1"</code>)</td></tr>
      <tr><td><code>port</code></td><td>No</td><td>number</td><td>&mdash;</td><td>Override per-adapter port</td></tr>
      <tr><td><code>enabled</code></td><td>No</td><td>boolean</td><td><code>true</code></td><td>Set to <code>false</code> to skip this adapter during <code>mimic host</code></td></tr>
      <tr><td><code>mcp</code></td><td>No</td><td>boolean</td><td><code>false</code></td><td>Register this adapter's tools on the unified MCP server</td></tr>
      <tr><td><code>config</code></td><td>No</td><td>object</td><td>&mdash;</td><td>Adapter-specific configuration</td></tr>
    </tbody>
  </table>
</div>

Use `mimic adapters add stripe` to install and configure an adapter, or add the entry to `mimic.json` by hand.

---

<h3 id="config-test">test</h3>

Defines test scenarios that `mimic test` runs against your agent. Each scenario sends a goal to the agent and verifies the response against expected outcomes &mdash; which tools were called, whether the response contains expected keywords, and whether the response is factually accurate.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"test"</span>: {
  <span class="yk">"agent"</span>: <span class="str">"http://localhost:3000/chat"</span>,
  <span class="yk">"mode"</span>: <span class="str">"text"</span>,
  <span class="yk">"evaluator"</span>: <span class="str">"both"</span>,
  <span class="yk">"scenarios"</span>: [
    {
      <span class="yk">"name"</span>: <span class="str">"monthly-spending"</span>,
      <span class="yk">"persona"</span>: <span class="str">"young-professional"</span>,
      <span class="yk">"goal"</span>: <span class="str">"Ask about total spending last month"</span>,
      <span class="yk">"expect"</span>: {
        <span class="yk">"tools_called"</span>: [<span class="str">"get_transactions"</span>],
        <span class="yk">"response_contains"</span>: [<span class="str">"spending"</span>, <span class="str">"total"</span>],
        <span class="yk">"response_accurate"</span>: <span class="ty">true</span>,
        <span class="yk">"no_hallucination"</span>: <span class="ty">true</span>,
        <span class="yk">"max_latency_ms"</span>: <span class="ty">5000</span>
      }
    }
  ]
}</code></pre>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>agent</code></td><td>Yes</td><td>string (URL)</td><td>Your agent's chat endpoint. Must accept <code>POST {"{"} "message": "..." {"}"}</code></td></tr>
      <tr><td><code>mode</code></td><td>No</td><td>string</td><td><code>"text"</code> (default) or <code>"voice"</code></td></tr>
      <tr><td><code>evaluator</code></td><td>No</td><td>string</td><td><code>"keyword"</code>, <code>"llm"</code>, or <code>"both"</code> (default)</td></tr>
      <tr><td><code>scenarios</code></td><td>No</td><td>array</td><td>List of test scenario objects (see below)</td></tr>
    </tbody>
  </table>
</div>

#### Scenario fields

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>name</code></td><td>Yes</td><td>string</td><td>Unique scenario identifier</td></tr>
      <tr><td><code>persona</code></td><td>No</td><td>string</td><td>Which persona's data to test against</td></tr>
      <tr><td><code>goal</code></td><td>Yes</td><td>string</td><td>What the test asks the agent to do</td></tr>
      <tr><td><code>input</code></td><td>No</td><td>string</td><td>Explicit input string (if omitted, <code>goal</code> is used)</td></tr>
    </tbody>
  </table>
</div>

#### Expectation fields

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>tools_called</code></td><td>array of strings</td><td>Agent must have called these tools</td></tr>
      <tr><td><code>response_contains</code></td><td>array of strings</td><td>Response must contain these substrings</td></tr>
      <tr><td><code>response_accurate</code></td><td>boolean</td><td>LLM checks factual accuracy against seeded data</td></tr>
      <tr><td><code>no_hallucination</code></td><td>boolean</td><td>LLM checks that response doesn't fabricate data</td></tr>
      <tr><td><code>max_latency_ms</code></td><td>number</td><td>Response must arrive within this many milliseconds</td></tr>
    </tbody>
  </table>
</div>

---

<h3 id="env-vars">Environment Variables</h3>

Any string value in `mimic.json` can reference an environment variable using the `$VARIABLE_NAME` syntax. Variables are resolved at config load time.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="cm">// In mimic.json:</span>
<span class="yk">"url"</span>: <span class="str">"$DATABASE_URL"</span>
&#8203;
<span class="cm">// Resolved from your shell:</span>
<span class="cm">// export DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"</span></code></pre>
</div>

Common environment variables used across examples:

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Variable</th><th>Used by</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>DATABASE_URL</code></td><td>Postgres, MySQL</td><td>Database connection string</td></tr>
      <tr><td><code>MONGO_URL</code></td><td>MongoDB</td><td>MongoDB connection string</td></tr>
      <tr><td><code>ANTHROPIC_API_KEY</code></td><td>LLM provider</td><td>Required for blueprint generation with Anthropic models</td></tr>
      <tr><td><code>OPENAI_API_KEY</code></td><td>LLM provider</td><td>Required when using <code>"provider": "openai"</code></td></tr>
    </tbody>
  </table>
</div>

<div class="callout warn">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></span>
  <div>Missing environment variables cause a `ConfigInvalidError` at load time with a clear message telling you which variable is missing. Never hardcode secrets in `mimic.json` &mdash; always use `$VARIABLE_NAME` references.</div>
</div>
