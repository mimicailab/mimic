---
title: "Testing & Auto-Scenarios"
eyebrow: "Testing"
description: "Auto-generate test scenarios from your data, run them against your agent, and export to eval platforms."
order: 8
slug: "testing"
prev: { slug: "architecture", title: "Architecture" }
next: { slug: "guides", title: "Guides" }
---

<h2 id="testing-overview">
  <span class="eyebrow">Testing</span>
  Overview
</h2>

<p class="lead">
  Mimic automatically generates test scenarios grounded in the data it creates. Every testable fact &mdash; an overdue invoice, a spending anomaly, a missing record &mdash; becomes a scenario with natural-language input and concrete assertions. No prompt templates, no hand-written test data.
</p>

The pipeline has three stages:

1. **Facts** &mdash; During `mimic run`, the LLM generates a set of testable facts alongside the persona data. These are written to `.mimic/fact-manifest.json`.
2. **Scenarios** &mdash; During `mimic test`, a single LLM call converts facts into test scenarios with natural questions and data-specific assertions.
3. **Export** &mdash; Scenarios can be exported to external eval platforms (PromptFoo, Braintrust, LangSmith, Inspect AI) or Mimic's own format.

---

<h2 id="testing-facts">Facts &amp; the Fact Manifest</h2>

A **fact** is a structured, testable statement about the generated data. Facts are created by the LLM during blueprint generation and describe anomalies, trends, risks, and integrity issues that an AI agent should be able to reason about.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>.mimic/fact-manifest.json (excerpt)</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"persona"</span>: <span class="str">"growth-saas"</span>,
  <span class="yk">"domain"</span>: <span class="str">"Multi-platform SaaS billing"</span>,
  <span class="yk">"facts"</span>: [
    {
      <span class="yk">"id"</span>: <span class="str">"fact_001"</span>,
      <span class="yk">"type"</span>: <span class="str">"overdue"</span>,
      <span class="yk">"platform"</span>: <span class="str">"chargebee"</span>,
      <span class="yk">"severity"</span>: <span class="str">"critical"</span>,
      <span class="yk">"detail"</span>: <span class="str">"3 overdue invoices totalling &pound;12,400. Oldest is 34 days overdue."</span>,
      <span class="yk">"data"</span>: {
        <span class="yk">"count"</span>: <span class="ty">3</span>,
        <span class="yk">"total_gbp"</span>: <span class="ty">12400</span>,
        <span class="yk">"oldest_days_overdue"</span>: <span class="ty">34</span>
      }
    }
  ]
}</code></pre>
</div>

#### Fact types

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Type</th><th>Description</th><th>Example</th></tr></thead>
    <tbody>
      <tr><td><code>anomaly</code></td><td>Unexpected deviation from normal patterns</td><td>Mobile MRR down 23% due to App Store outage</td></tr>
      <tr><td><code>overdue</code></td><td>Items past their due date</td><td>3 invoices totalling &pound;12,400 overdue</td></tr>
      <tr><td><code>pending</code></td><td>Items awaiting settlement or completion</td><td>&pound;8,400 direct debit pending bank settlement</td></tr>
      <tr><td><code>integrity</code></td><td>Data consistency issues across systems</td><td>34 users with paid flags but no billing record</td></tr>
      <tr><td><code>growth</code></td><td>Notable growth trends or patterns</td><td>EU segment up 31% MoM driven by German market</td></tr>
      <tr><td><code>risk</code></td><td>Churn risk or other business risks</td><td>14 Pro customers inactive for 30+ days</td></tr>
    </tbody>
  </table>
</div>

#### Severity levels

Each fact has a severity that maps to a scenario tier:

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Severity</th><th>Scenario Tier</th><th>Max Latency</th><th>Purpose</th></tr></thead>
    <tbody>
      <tr><td><code>info</code></td><td><code>smoke</code></td><td>10s</td><td>Agent surfaces basic information correctly</td></tr>
      <tr><td><code>warn</code></td><td><code>functional</code></td><td>20s</td><td>Agent handles nuanced or multi-step queries</td></tr>
      <tr><td><code>critical</code></td><td><code>adversarial</code></td><td>15s</td><td>Agent handles tricky edge cases without hallucinating</td></tr>
    </tbody>
  </table>
</div>

---

<h2 id="testing-scenarios">Auto-Scenario Generation</h2>

When `auto_scenarios: true` is set in `mimic.json`, `mimic test` reads the fact manifest and sends all facts to the LLM in a single batched call. The LLM generates one scenario per fact, each with:

- A **natural-language question** a user would realistically ask
- **`response_contains`** assertions using specific values from the fact data (numbers, IDs, dates)
- **`response_excludes`** hallucination guards &mdash; phrases the agent must *not* say
- **`numeric_range`** assertions with &plusmn;10% tolerance for numeric facts

This is adapter-agnostic &mdash; the LLM reads each fact's `detail` field and generates appropriate questions regardless of whether the data comes from Stripe, a Postgres database, or a future adapter.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="cm"># Enable in mimic.json:</span>
<span class="cm"># "test": { "agent": "...", "auto_scenarios": true }</span>
&#8203;
<span class="cm"># Then run:</span>
<span class="prompt">$</span> mimic run          <span class="cm"># generates data + fact manifest</span>
<span class="prompt">$</span> mimic test         <span class="cm"># generates scenarios from facts, then runs them</span></code></pre>
</div>

#### Filtering by tier

Use `--tier` to limit which scenarios are generated:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="cm"># Only smoke tests (info-severity facts)</span>
<span class="prompt">$</span> mimic test --tier smoke
&#8203;
<span class="cm"># Smoke + functional (skip adversarial)</span>
<span class="prompt">$</span> mimic test --tier smoke functional</code></pre>
</div>

Or set it in the config with `scenario_tiers`:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"test"</span>: {
  <span class="yk">"agent"</span>: <span class="str">"http://localhost:3000/chat"</span>,
  <span class="yk">"auto_scenarios"</span>: <span class="ty">true</span>,
  <span class="yk">"scenario_tiers"</span>: [<span class="str">"smoke"</span>, <span class="str">"functional"</span>]
}</code></pre>
</div>

---

<h2 id="testing-export">Exporting Scenarios</h2>

Auto-generated scenarios can be exported to external eval platforms or Mimic's own format using `--export`:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="prompt">$</span> mimic test --export promptfoo    <span class="cm"># PromptFoo YAML config</span>
<span class="prompt">$</span> mimic test --export braintrust   <span class="cm"># Braintrust dataset + scorer</span>
<span class="prompt">$</span> mimic test --export langsmith    <span class="cm"># LangSmith dataset + evaluator</span>
<span class="prompt">$</span> mimic test --export mimic        <span class="cm"># Mimic native JSON</span>
<span class="prompt">$</span> mimic test --inspect             <span class="cm"># Inspect AI Python task</span></code></pre>
</div>

All exported files are written to `.mimic/exports/`. If manual scenarios are defined in `mimic.json`, they are also run after the export.

#### mimic (native format)

Exports scenarios as a JSON array matching the `test.scenarios` shape in `mimic.json`. You can paste these directly into your config or load them as a standalone file.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>.mimic/exports/mimic-scenarios.json (excerpt)</span><button class="code-copy">Copy</button></div>
  <pre><code>[
  {
    <span class="yk">"name"</span>: <span class="str">"chargebee-overdue-critical-invoices"</span>,
    <span class="yk">"persona"</span>: <span class="str">"growth-saas"</span>,
    <span class="yk">"goal"</span>: <span class="str">"Agent surfaces the 34-day overdue invoice as highest priority"</span>,
    <span class="yk">"input"</span>: <span class="str">"What overdue invoices do we have in Chargebee?"</span>,
    <span class="yk">"expect"</span>: {
      <span class="yk">"response_contains"</span>: [<span class="str">"&pound;12,400"</span>, <span class="str">"34 days"</span>, <span class="str">"inv_p1_cb_overdue_001"</span>],
      <span class="yk">"response_excludes"</span>: [<span class="str">"no overdue invoices"</span>, <span class="str">"all paid"</span>],
      <span class="yk">"numeric_range"</span>: { <span class="yk">"field"</span>: <span class="str">"total_overdue_gbp"</span>, <span class="yk">"min"</span>: <span class="ty">11160</span>, <span class="yk">"max"</span>: <span class="ty">13640</span> },
      <span class="yk">"max_latency_ms"</span>: <span class="ty">15000</span>
    },
    <span class="yk">"metadata"</span>: {
      <span class="yk">"tier"</span>: <span class="str">"adversarial"</span>,
      <span class="yk">"source_fact"</span>: <span class="str">"fact_001"</span>,
      <span class="yk">"platform"</span>: <span class="str">"chargebee"</span>
    }
  }
]</code></pre>
</div>

#### PromptFoo

Generates a `promptfooconfig.yaml` with `contains`, `not-contains`, and `javascript` assertions. Ready to run with `npx promptfoo eval`.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">yaml</span><span>.mimic/exports/promptfooconfig.yaml (excerpt)</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">tests:</span>
  <span class="yk">- description:</span> <span class="str">"chargebee-overdue-critical-invoices [adversarial]"</span>
    <span class="yk">vars:</span>
      <span class="yk">question:</span> <span class="str">"What overdue invoices do we have in Chargebee?"</span>
    <span class="yk">assert:</span>
      - <span class="yk">type:</span> contains
        <span class="yk">value:</span> <span class="str">"&pound;12,400"</span>
      - <span class="yk">type:</span> not-contains
        <span class="yk">value:</span> <span class="str">"no overdue invoices"</span>
      - <span class="yk">type:</span> javascript
        <span class="yk">value:</span> |
          const nums = output.match(/[\d,]+\.?\d*/g) || [];
          return nums.some(n =&gt; {
            const v = parseFloat(n.replace(/,/g, ''));
            return v &gt;= 11160 &amp;&amp; v &lt;= 13640;
          });</code></pre>
</div>

#### Braintrust

Generates a `braintrust-dataset.jsonl` (one JSON object per line) and a `braintrust-scorer.ts` TypeScript scorer file for use with the Braintrust eval framework.

#### LangSmith

Generates three files:
- `langsmith-dataset.json` &mdash; the dataset definition
- `langsmith-upload.ts` &mdash; script to upload the dataset to LangSmith
- `langsmith-evaluator.ts` &mdash; evaluator functions for each assertion type

#### Inspect AI

Generates a self-contained `inspect_task.py` Python file with an inline dataset and custom scorer. Run it with `inspect eval inspect_task.py`.

---

<h2 id="testing-config">Configuration Reference</h2>

All auto-scenario settings live in the `test` block of `mimic.json`:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"test"</span>: {
  <span class="yk">"agent"</span>: <span class="str">"http://localhost:3000/chat"</span>,
  <span class="yk">"auto_scenarios"</span>: <span class="ty">true</span>,
  <span class="yk">"scenario_tiers"</span>: [<span class="str">"smoke"</span>, <span class="str">"functional"</span>, <span class="str">"adversarial"</span>],
  <span class="yk">"export"</span>: <span class="str">"promptfoo"</span>,
  <span class="yk">"scenarios"</span>: [
    <span class="cm">// manual scenarios are merged with auto-generated ones</span>
  ]
}</code></pre>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>auto_scenarios</code></td><td>boolean</td><td><code>false</code></td><td>Enable auto-scenario generation from fact manifest</td></tr>
      <tr><td><code>scenario_tiers</code></td><td>array</td><td>all tiers</td><td>Limit to <code>"smoke"</code>, <code>"functional"</code>, and/or <code>"adversarial"</code></td></tr>
      <tr><td><code>export</code></td><td>string</td><td>&mdash;</td><td>Default export format: <code>"mimic"</code>, <code>"promptfoo"</code>, <code>"braintrust"</code>, <code>"langsmith"</code>, <code>"inspect"</code></td></tr>
    </tbody>
  </table>
</div>

CLI flags (`--tier`, `--export`, `--inspect`) override the config values.

---

<h2 id="testing-pipeline">End-to-End Example</h2>

A complete workflow using the CFO Agent example:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="cm"># 1. Generate data with facts</span>
<span class="prompt">$</span> mimic run
<span class="cm">#   &rarr; .mimic/data/growth-saas.json</span>
<span class="cm">#   &rarr; .mimic/fact-manifest.json (11 facts)</span>
&#8203;
<span class="cm"># 2. Seed databases</span>
<span class="prompt">$</span> mimic seed
&#8203;
<span class="cm"># 3. Start mock servers</span>
<span class="prompt">$</span> mimic host
&#8203;
<span class="cm"># 4. Export auto-generated scenarios to PromptFoo</span>
<span class="prompt">$</span> mimic test --export promptfoo
<span class="cm">#   &rarr; .mimic/exports/promptfooconfig.yaml</span>
&#8203;
<span class="cm"># 5. Or run scenarios directly against the agent</span>
<span class="prompt">$</span> mimic test --ci
<span class="cm">#   &rarr; runs 11 auto + 2 manual scenarios</span>
<span class="cm">#   &rarr; exit code 1 if any fail</span></code></pre>
</div>

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div><strong>Combine with CI:</strong> Use <code>mimic test --export mimic --ci</code> in your pipeline to both export scenarios for review and fail the build if the agent doesn't pass.</div>
</div>
