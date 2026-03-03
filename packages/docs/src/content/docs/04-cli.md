---
title: "CLI Reference"
description: "Complete reference for all Mimic CLI commands."
order: 4
slug: "cli"
prev: { slug: "configuration", title: "Configuration" }
next: { slug: "adapters", title: "Adapters" }
---

<h2 id="cli-init">mimic init</h2>

Initialise a new Mimic project in the current directory.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic init [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">--persona</span> &lt;name&gt;     Pre-select a persona (default: finance-alex)
  <span class="flag">--force</span>              Overwrite existing .mimic/ directory</code></pre>
</div>

Creates `.mimic/config.yaml`, `.mimic/blueprints/`, and `.mimic/scenarios/`. If a Prisma schema or SQL files are detected, surfaces are auto-configured.

<h2 id="cli-seed">mimic seed</h2>

Seed databases with persona-consistent data.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic seed [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">--persona</span> &lt;name&gt;     Override the persona from config
  <span class="flag">--tables</span> &lt;list&gt;      Comma-separated list of tables to seed
  <span class="flag">--rows</span> &lt;n&gt;           Number of rows per table (default: varies by persona)
  <span class="flag">--clean-first</span>        Truncate before seeding
  <span class="flag">--dry-run</span>            Print SQL without executing</code></pre>
</div>

Uses COPY FROM STDIN for PostgreSQL (&ge;500 rows) for ~714K rows/sec throughput. Handles foreign key ordering via topological sort. Atomic transactions &mdash; all or nothing.

<h2 id="cli-host">mimic host</h2>

Start the mock API server and MCP servers.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic host [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">--port</span> &lt;n&gt;           Server port (default: 4000)
  <span class="flag">--adapters</span> &lt;list&gt;    Comma-separated adapter IDs to load
  <span class="flag">--background</span>         Run as background process
  <span class="flag">--cors</span>               Enable CORS (default: true)
  <span class="flag">--watch</span>              Reload on config changes</code></pre>
</div>

Starts a Fastify server with all configured API mocks mounted at their base paths. MCP servers are available via stdio or HTTP transport as configured.

<h2 id="cli-test">mimic test</h2>

Run test scenarios against the mock environment.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic test [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">--scenario</span> &lt;file&gt;    Path to specific scenario file
  <span class="flag">--eval</span> &lt;mode&gt;        Evaluation mode: keyword | llm (Pro)
  <span class="flag">--workers</span> &lt;n&gt;        Parallel test workers (Pro)
  <span class="flag">--verbose</span>            Show detailed output</code></pre>
</div>

Reads scenarios from `.mimic/scenarios/`. Each scenario defines synthetic user inputs and expected outcomes. Supports keyword matching (free) and LLM-as-judge evaluation (Pro).

<h2 id="cli-inspect">mimic inspect</h2>

View seeded data across all surfaces.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic inspect [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">--surface</span> &lt;name&gt;     Inspect a specific surface (e.g., postgres, stripe)
  <span class="flag">--format</span> &lt;fmt&gt;       Output format: table | json (default: table)</code></pre>
</div>

<h2 id="cli-clean">mimic clean</h2>

Remove all seeded data and stop running servers.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic clean [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">--databases-only</span>     Only truncate database tables
  <span class="flag">--keep-config</span>        Don't remove .mimic/ directory</code></pre>
</div>

<h2 id="cli-generate">mimic generate</h2>

Generate a custom persona blueprint using the Blueprint Engine. **Requires Pro.**

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic generate [options]
&#8203;
<span class="cm">Options:</span>
  <span class="flag">--description</span> &lt;text&gt;  Natural language persona description
  <span class="flag">--domain</span> &lt;name&gt;       Target domain: finance | support | devops | healthcare
  <span class="flag">--output</span> &lt;path&gt;       Save blueprint to file
  <span class="flag">--model</span> &lt;id&gt;          LLM model to use (default: claude-haiku-4-5)</code></pre>
</div>

<div class="callout info">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-bright)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></span>
  <div><p>Community tier gets 3 custom blueprints per month. Pro tier gets unlimited. Custom blueprints cost ~$0.02-$0.05 per generation via LLM.</p></div>
</div>
