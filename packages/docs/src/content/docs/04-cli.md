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

Start the mock API server and MCP server.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic host [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">-t, --transport</span> &lt;transport&gt;  MCP transport: stdio or sse (default: stdio)
  <span class="flag">-P, --port</span> &lt;number&gt;          Port for SSE transport (default: 4200)
  <span class="flag">-p, --api-port</span> &lt;number&gt;      Port for mock API server (default: 4100)
  <span class="flag">--no-api</span>                     Skip starting the mock API server (MCP only)
  <span class="flag">--verbose</span>                    Enable verbose logging</code></pre>
</div>

Starts a Fastify server with all configured API mocks mounted at their base paths. Also starts a unified MCP server that exposes both database tools (auto-generated from schema) and API adapter tools (when `mcp: true` is set in config).

<h2 id="cli-test">mimic test</h2>

Run test scenarios against your AI agent.

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
  <span class="flag">--verbose</span>                 Enable verbose logging
  <span class="flag">--full</span>                    Full pipeline: run &rarr; seed &rarr; host (background) &rarr; test &rarr; stop</code></pre>
</div>

Reads scenarios from the `test` section of `mimic.json`. Each scenario sends a goal to the agent and verifies the response &mdash; which tools were called, whether the response contains expected keywords, and whether it's factually accurate. Supports keyword matching and LLM-as-judge evaluation.

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

Shows persona name, occupation, and generation timestamp for each cached blueprint in `.mimic/blueprints/`.

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
