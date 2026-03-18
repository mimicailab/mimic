---
title: "CLI Reference"
description: "Complete reference for all Mimic CLI commands."
order: 4
slug: "cli"
prev: { slug: "configuration", title: "Configuration" }
next: { slug: "adapters", title: "Adapters" }
---

<h2 id="cli-init">mimic init</h2>

Interactive wizard to create a `mimic.json` configuration.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic init</code></pre>
</div>

Walks you through domain, schema source, database URL, persona selection, and LLM provider. Creates `mimic.json` plus `.mimic/data/` and `.mimic/blueprints/` directories.

<h2 id="cli-run">mimic run</h2>

Generate blueprints and expand persona data.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic run [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">-g, --generate</span>           Force LLM regeneration of blueprints
  <span class="flag">-d, --dry-run</span>            Show what would be generated without writing files
  <span class="flag">-p, --persona</span> &lt;names...&gt; Limit to specific personas
  <span class="flag">-s, --seed</span> &lt;number&gt;      Override random seed
  <span class="flag">--verbose</span>                Enable verbose logging</code></pre>
</div>

Parses your database schema, generates persona blueprints via LLM (or loads from cache), and expands them into concrete rows. Output is written to `.mimic/data/` as JSON files per persona. Blueprints are cached in `.mimic/blueprints/` &mdash; use `-g` to force regeneration.

<h2 id="cli-seed">mimic seed</h2>

Push expanded data to configured databases.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic seed [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">-p, --persona</span> &lt;names...&gt; Limit to specific personas
  <span class="flag">-s, --strategy</span> &lt;strategy&gt; Override seed strategy (depends on database type)
  <span class="flag">-d, --database</span> &lt;name&gt;    Seed a specific database entry
  <span class="flag">--verbose</span>                Enable verbose logging
  <span class="flag">--json</span>                   Output results as JSON</code></pre>
</div>

Loads expanded data from `.mimic/data/` and pushes it to your configured databases. Uses COPY FROM STDIN for PostgreSQL (&ge;500 rows) for high throughput. Handles foreign key ordering via topological sort. Atomic transactions &mdash; all or nothing.

<h2 id="cli-host">mimic host</h2>

Start mock API servers and MCP servers to expose seeded data to AI agents.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic host [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">--mcp-base-port</span> &lt;number&gt;     Starting port for MCP servers (default: 4201)
  <span class="flag">--api-base-port</span> &lt;number&gt;     Starting port for mock API servers (default: 4101)
  <span class="flag">--no-api</span>                     Skip starting mock API servers
  <span class="flag">--verbose</span>                    Enable verbose logging</code></pre>
</div>

#### What it starts

`mimic host` spins up one server pair per configured database and one server pair per enabled API adapter &mdash; there is no single shared server.

**For each database** in `mimic.json`:
- Connects to the database and parses the schema
- Starts an MCP server exposing auto-generated query tools for every table

**For each enabled adapter** in `mimic.json`:
- Loads persona data from `.mimic/data/` and registers it with the adapter
- Starts a mock HTTP API server serving realistic responses at the adapter&rsquo;s base path
- Starts an MCP server exposing the adapter&rsquo;s tools (when `mcp: true` is set), pointed at the mock API

#### Port assignment

Ports are assigned sequentially starting from the base port values:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="cm"># Example: 1 database + 2 adapters</span>
<span class="cm">#   main-db   MCP :4201</span>
<span class="cm">#   plaid     API :4101 | MCP :4202</span>
<span class="cm">#   stripe    API :4102 | MCP :4203</span>
<span class="prompt">$</span> mimic host</code></pre>
</div>

Use `--mcp-base-port` and `--api-base-port` to shift the port ranges if they conflict with other services.

#### Transport auto-detection

The MCP transport protocol is chosen automatically based on server count:

- **One server** &rarr; `stdio` (reads/writes stdin&sol;stdout directly)
- **Multiple servers** &rarr; `http` (each MCP server listens at `http://localhost:&lt;port&gt;/mcp`, Streamable HTTP per MCP spec 2025-03-26)

You cannot override this &mdash; use `--no-api` to reduce server count if you need `stdio` with a single adapter.

#### Connection summary

After all servers start, `mimic host` prints a JSON block of MCP endpoints ready to paste into your agent&rsquo;s MCP configuration:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"main-db"</span>: { <span class="yk">"url"</span>: <span class="ys">"http://localhost:4201/mcp"</span>, <span class="yk">"type"</span>: <span class="ys">"database"</span> },
  <span class="yk">"plaid"</span>:   { <span class="yk">"url"</span>: <span class="ys">"http://localhost:4202/mcp"</span>, <span class="yk">"type"</span>: <span class="ys">"adapter"</span> },
  <span class="yk">"stripe"</span>:  { <span class="yk">"url"</span>: <span class="ys">"http://localhost:4203/mcp"</span>, <span class="yk">"type"</span>: <span class="ys">"adapter"</span> }
}</code></pre>
</div>

#### `--no-api` flag

Skips starting mock HTTP API servers for all adapters. MCP servers for adapters are also omitted since they depend on the mock API URL. Only database MCP servers start. Useful when you only need the database tools exposed to your agent.

#### Graceful shutdown

`mimic host` blocks the terminal until you press `Ctrl+C` (or send `SIGTERM`). On shutdown it stops all MCP servers, mock API servers, and closes all database connections cleanly.

<h2 id="cli-test">mimic test</h2>

Run test scenarios against your AI agent, with optional auto-scenario generation from facts and export to eval platforms.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic test [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">-S, --scenario</span> &lt;names...&gt; Limit to specific scenarios
  <span class="flag">-p, --persona</span> &lt;names...&gt;  Limit to specific personas
  <span class="flag">-f, --format</span> &lt;format&gt;     Output format: cli, json, junit (default: cli)
  <span class="flag">-o, --output</span> &lt;path&gt;       Write report to file
  <span class="flag">--ci</span>                      CI mode: exit code 1 on failure
  <span class="flag">-t, --timeout</span> &lt;ms&gt;        Per-scenario timeout in ms
  <span class="flag">--tier</span> &lt;tiers...&gt;         Filter auto-generated scenarios by tier: smoke, functional, adversarial
  <span class="flag">--export</span> &lt;format&gt;         Export scenarios: mimic, promptfoo, braintrust, langsmith, inspect
  <span class="flag">--inspect</span>                 Shortcut for --export inspect
  <span class="flag">--verbose</span>                 Enable verbose logging
  <span class="flag">--full</span>                    Full pipeline: run &rarr; seed &rarr; serve &rarr; test &rarr; stop</code></pre>
</div>

Runs manual scenarios from `mimic.json` and, when `auto_scenarios` is enabled, generates additional scenarios from the fact manifest (`.mimic/fact-manifest.json`). The fact manifest is created automatically by `mimic run`. See <a href="/docs/testing">Testing &amp; Auto-Scenarios</a> for the full guide.

#### Auto-scenario generation

When `auto_scenarios: true` is set in `mimic.json` (or when `--tier` or `--export` flags are used), Mimic reads the fact manifest and uses an LLM call to generate test scenarios from facts. Each fact becomes a scenario with natural-language input and specific assertions.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="cm"># Generate + export to PromptFoo format</span>
<span class="prompt">$</span> mimic test --export promptfoo
&#8203;
<span class="cm"># Generate only smoke-tier scenarios</span>
<span class="prompt">$</span> mimic test --tier smoke
&#8203;
<span class="cm"># Export to Mimic's own JSON format</span>
<span class="prompt">$</span> mimic test --export mimic
&#8203;
<span class="cm"># Export to Inspect AI (Python task file)</span>
<span class="prompt">$</span> mimic test --inspect</code></pre>
</div>

#### Export formats

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Format</th><th>Output files</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>mimic</code></td><td><code>mimic-scenarios.json</code></td><td>Mimic's native scenario format &mdash; paste into <code>mimic.json</code> or load standalone</td></tr>
      <tr><td><code>promptfoo</code></td><td><code>promptfooconfig.yaml</code></td><td>PromptFoo config with contains/not-contains/javascript/llm-rubric assertions</td></tr>
      <tr><td><code>braintrust</code></td><td><code>braintrust-dataset.jsonl</code>, <code>braintrust-scorer.ts</code></td><td>Braintrust dataset + TypeScript scorer</td></tr>
      <tr><td><code>langsmith</code></td><td><code>langsmith-dataset.json</code>, <code>langsmith-upload.ts</code>, <code>langsmith-evaluator.ts</code></td><td>LangSmith dataset + upload script + evaluator</td></tr>
      <tr><td><code>inspect</code></td><td><code>inspect_task.py</code></td><td>Self-contained Inspect AI Python task with dataset + scorer</td></tr>
    </tbody>
  </table>
</div>

All exports are written to `.mimic/exports/`.

<h2 id="cli-inspect">mimic inspect</h2>

Show schema, data, or blueprint information.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic inspect &lt;subcommand&gt;</code></pre>
</div>

#### inspect schema

Parse and display the database schema.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic inspect schema [--verbose]</code></pre>
</div>

Shows tables, columns, primary/foreign keys, and enums. Use `--verbose` for per-table column details.

#### inspect data

Show row counts per persona per table.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic inspect data [-p &lt;names...&gt;] [--verbose]</code></pre>
</div>

Displays a persona &times; table grid showing how many rows each persona generated.

#### inspect blueprints

List cached blueprints.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic inspect blueprints [--verbose]</code></pre>
</div>

Shows a table with five columns for each cached blueprint in `.mimic/blueprints/`: persona ID slug, full name, occupation, the LLM model that generated it (Generated By), and the generation timestamp (Generated At).

#### inspect db

Query live database(s) for row/document counts.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic inspect db [-d &lt;name&gt;] [--verbose]</code></pre>
</div>

Connects to your configured databases and reports current row counts. Use `-d` to inspect a specific database entry.

<h2 id="cli-clean">mimic clean</h2>

Truncate database tables and remove generated data.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic clean [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">-y, --yes</span>                Skip confirmation prompt
  <span class="flag">--keep-blueprints</span>        Keep cached blueprints in .mimic/blueprints/
  <span class="flag">-d, --database</span> &lt;name&gt;    Clean a specific database entry
  <span class="flag">--verbose</span>                Enable verbose logging</code></pre>
</div>

Truncates all Mimic-seeded tables in configured databases, removes `.mimic/data/`, and removes `.mimic/blueprints/` (unless `--keep-blueprints` is set).

<h2 id="cli-adapters">mimic adapters</h2>

Manage API mock adapters.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic adapters &lt;subcommand&gt;</code></pre>
</div>

#### adapters add

Install an adapter package and add it to `mimic.json`.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic adapters add &lt;id&gt; [--port &lt;number&gt;] [--no-install]</code></pre>
</div>

Installs the adapter npm package, adds an entry to the `apis` section in `mimic.json`, and shows available endpoints. Use `--no-install` to skip npm install and just update config.

#### adapters remove

Remove an adapter from `mimic.json` and uninstall the package.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic adapters remove &lt;id&gt; [--no-uninstall]</code></pre>
</div>

#### adapters enable / disable

Toggle an adapter without removing it.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic adapters enable &lt;id&gt;
<span class="prompt">$</span> mimic adapters disable &lt;id&gt;</code></pre>
</div>

Disabled adapters are skipped by `mimic host`.

#### adapters list

List all configured adapters with their status.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic adapters list</code></pre>
</div>

Shows databases and API adapters, installation status, and enabled/disabled state.

#### adapters inspect

Show details and endpoints for an adapter.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic adapters inspect &lt;id&gt;</code></pre>
</div>

Displays the adapter manifest (name, type, version, description) and lists all endpoints with their descriptions.

<h2 id="cli-info">mimic info</h2>

Print environment and package info for bug reports.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic info [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">--json</span>                   Output as JSON</code></pre>
</div>

Prints system information (OS, architecture, Node version, package manager), installed `@mimicai/*` package versions, and whether a `mimic.json` config file is found in the current directory.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic info
&#8203;
  Mimic Environment Info
&#8203;
  System:
    OS:              darwin (25.3.0)
    Arch:            arm64
    Node:            v22.14.0
    Package Manager: pnpm
&#8203;
  Packages:
    @mimicai/core              0.6.0
    @mimicai/cli               0.6.0
    @mimicai/adapter-stripe    0.6.0
&#8203;
  Config:
    mimic.json:      found
&#8203;
  Copy the above into your bug report.</code></pre>
</div>

Use `--json` for machine-readable output, useful in CI or automated diagnostics.
