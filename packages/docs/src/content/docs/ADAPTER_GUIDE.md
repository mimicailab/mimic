---
title: "Adapter Guide: Behavior Packs"
eyebrow: "Adapters"
description: "How adapters express lifecycle logic as declarative YAML behavior packs, the codegen step, and when to drop down to hand-written handlers."
order: 5.5
slug: "adapter-guide"
prev: { slug: "adapters", title: "Adapters" }
next: { slug: "mcp", title: "MCP Servers" }
---

<h2 id="behavior-overview">
  <span class="eyebrow">Adapters</span>
  Behavior Packs
</h2>

<p class="lead">
  An adapter's lifecycle logic &mdash; the state machines behind endpoints like <code>confirm</code>, <code>capture</code>, <code>cancel</code>, or <code>refund</code> &mdash; is now authored as declarative YAML <strong>behavior packs</strong> instead of hand-written override handlers. A shared codegen step compiles the YAML to TypeScript, and a generic interpreter in <code>@mimicai/adapter-sdk</code> executes it at request time.
</p>

Every behavior follows the same shape: **guard** on the current state, **mutate** fields, run **optional side effects**, then **respond**. Expressing that pattern in YAML keeps it consistent across adapters, reviewable as data, and free of repetitive imperative boilerplate.

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div>Behavior packs cover the <strong>state-machine</strong> endpoints. CRUD scaffolding still comes for free from <code>OpenApiMockAdapter</code> &mdash; see <a href="/docs/adapters#adapter-dev">Build an Adapter</a>. Behavior packs replace the hand-written <strong>override handlers</strong> for adapters that have been migrated.</div>
</div>

---

<h2 id="behavior-pipeline">The Pipeline</h2>

Behavior YAML lives alongside the adapter and compiles into a generated TypeScript module that the interpreter loads:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">text</span><button class="code-copy">Copy</button></div>
  <pre><code>src/behavior/*.yaml
    &darr;
mimic-behavior-codegen (shared bin)
    &darr;
src/generated/behavior.ts
    &darr;
Generic interpreter in @mimicai/adapter-sdk
    (mounted via this.mountBehaviorPacks(...))</code></pre>
</div>

1. **Author** &mdash; Write declarative state-machine logic in `src/behavior/*.yaml`.
2. **Compile** &mdash; Run the shared `mimic-behavior-codegen` bin, which emits `src/generated/behavior.ts`. As with all generated files, never hand-edit the output.
3. **Mount** &mdash; In the adapter's `registerRoutes`, call the interpreter:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">typescript</span><span>src/my-platform-adapter.ts</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="kw">import</span> { behaviorPacks } <span class="kw">from</span> <span class="str">'./generated/behavior.js'</span>;
&#8203;
<span class="kw">async</span> <span class="fn">registerRoutes</span>(server, data, store) {
  <span class="kw">this</span>.mountBehaviorPacks(store, behaviorPacks, errorFactory, emitSink);
  <span class="kw">await this</span>.registerGeneratedRoutes(server, data, store, ns);
}</code></pre>
</div>

`mountBehaviorPacks(store, behaviorPacks, errorFactory, emitSink?)` takes the state store, the generated packs, an error factory for platform-specific error envelopes, and an optional `emitSink` used to deliver outbound webhooks (see [Webhooks & Live Mode](/docs/webhooks)).

---

<h2 id="behavior-action">Action Schema</h2>

A behavior pack is a list of **actions**. Each action binds one route to a guard/mutate/respond flow.

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>method</code></td><td>HTTP method (e.g. <code>POST</code>)</td></tr>
      <tr><td><code>path</code></td><td>Route path. Must match a generated route</td></tr>
      <tr><td><code>target</code></td><td><code>{ namespace, id }</code> &mdash; the StateStore record this action operates on</td></tr>
      <tr><td><code>notFound</code></td><td><code>{ status, code, message, kind }</code> &mdash; error returned when the target record does not exist</td></tr>
      <tr><td><code>guard</code></td><td>Expression that must evaluate truthy for the action to proceed (e.g. the current-state check)</td></tr>
      <tr><td><code>guardError</code></td><td>Error returned when <code>guard</code> fails</td></tr>
      <tr><td><code>effects</code></td><td>Ordered list of mutations and side effects (see below)</td></tr>
      <tr><td><code>respond</code></td><td>What to return. Defaults to the updated target</td></tr>
      <tr><td><code>delete</code></td><td>Boolean &mdash; remove the target record</td></tr>
      <tr><td><code>emit</code></td><td>List of <code>{ when?, event }</code> outbound webhook declarations</td></tr>
    </tbody>
  </table>
</div>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">yaml</span><span>src/behavior/orders.yaml</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">- method:</span> <span class="str">POST</span>
  <span class="yk">path:</span> <span class="str">/my-platform/v1/orders/:order/confirm</span>
  <span class="yk">target:</span> { <span class="yk">namespace:</span> <span class="str">myplatform:orders</span>, <span class="yk">id:</span> <span class="str">params.order</span> }
  <span class="yk">notFound:</span> { <span class="yk">status:</span> <span class="ty">404</span>, <span class="yk">code:</span> <span class="str">resource_missing</span>, <span class="yk">message:</span> <span class="str">"No such order"</span>, <span class="yk">kind:</span> <span class="str">invalid_request_error</span> }
  <span class="yk">guard:</span> <span class="str">self.status == 'draft'</span>
  <span class="yk">guardError:</span> { <span class="yk">status:</span> <span class="ty">400</span>, <span class="yk">code:</span> <span class="str">invalid_state</span>, <span class="yk">message:</span> <span class="str">"Order is not draft"</span>, <span class="yk">kind:</span> <span class="str">invalid_request_error</span> }
  <span class="yk">effects:</span>
    <span class="yk">- set:</span> { <span class="yk">status:</span> <span class="str">confirmed</span> }
    <span class="yk">- set:</span> { <span class="yk">confirmed_at:</span> <span class="str">now</span> }
  <span class="yk">emit:</span>
    <span class="yk">- event:</span> <span class="str">order.confirmed</span></code></pre>
</div>

If `respond` is omitted, the action returns the updated target record.

---

<h2 id="behavior-effects">Effects</h2>

`effects` run in order. Each entry is one of:

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Effect</th><th>What it does</th></tr></thead>
    <tbody>
      <tr><td><code>set</code></td><td>Assign fields on the target (replace)</td></tr>
      <tr><td><code>merge</code></td><td>Deep-merge fields into the target</td></tr>
      <tr><td><code>create</code></td><td>Create a new record (binds a name in scope for later effects)</td></tr>
      <tr><td><code>update</code></td><td>Update an existing record (cross-resource side effects)</td></tr>
      <tr><td><code>var</code></td><td>Bind a named value into scope for use in later expressions</td></tr>
      <tr><td><code>when</code></td><td>Conditionally run nested effects based on an expression</td></tr>
      <tr><td><code>error</code></td><td>Abort and return an error</td></tr>
    </tbody>
  </table>
</div>

`create` and `var` bind names into the expression scope, so a later effect or the `respond`/`emit` blocks can reference them.

---

<h2 id="behavior-expressions">Expression Language</h2>

Guards, `when` conditions, and field values use a small expression language.

**Supported forms:** literals, dotted paths (`self.x`), arrays, the unary <code>!</code> and <code>-</code>, the operators <code>==</code> <code>!=</code> <code>&lt;</code> <code>&gt;</code> <code>&lt;=</code> <code>&gt;=</code> <code>&amp;&amp;</code> <code>||</code> <code>+</code> <code>-</code> <code>*</code> <code>/</code> <code>%</code>, the <code>in</code> membership operator, and a ternary.

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div><strong>Nullish equality:</strong> <code>==</code> and <code>!=</code> treat <code>null</code> and <code>undefined</code> as equal. So <code>x != null</code> is the idiomatic "is this set?" check, matching either nullish value.</div>
</div>

#### Scope

Expressions can reference these names:

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Name</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>self</code></td><td>The target record</td></tr>
      <tr><td><code>body</code></td><td>The request body</td></tr>
      <tr><td><code>params</code></td><td>Path parameters (e.g. <code>params.order</code>)</td></tr>
      <tr><td><code>query</code></td><td>Query-string parameters</td></tr>
      <tr><td><code>now</code></td><td>Current time as unix seconds</td></tr>
      <tr><td><code>nowIso</code></td><td>Current time as an ISO-8601 string</td></tr>
      <tr><td colspan="2">Plus any names bound earlier in the same action by <code>var</code> or <code>create</code>.</td></tr>
    </tbody>
  </table>
</div>

---

<h2 id="behavior-migrated">Migrated Adapters</h2>

The following adapters express their lifecycle logic as behavior packs:

<div class="adapter-doc-grid">
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Stripe</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Recurly</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Chargebee</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">GoCardless</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">RevenueCat</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Zuora</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Lemon Squeezy</span></div>
  <div class="adapter-doc-item" style="border-color: var(--green);"><span class="adapter-doc-name" style="color: var(--green);">Paddle</span></div>
</div>

---

<h2 id="behavior-escape-hatch">The Imperative Escape Hatch</h2>

Behavior packs target lifecycle state machines. Some adapters are **synthesis-heavy** &mdash; their endpoints do non-trivial work like incremental sync, search ranking, threading, or computed aggregates that does not reduce cleanly to guard/mutate/respond. These keep hand-written handlers, which remains a fully supported path.

<div class="adapter-doc-grid">
  <div class="adapter-doc-item"><span class="adapter-doc-name">Gmail</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Slack</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Attio</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">HubSpot</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Plaid</span></div>
  <div class="adapter-doc-item"><span class="adapter-doc-name">Granola</span></div>
</div>

**Reach for the escape hatch when** the endpoint computes a response from many records, maintains its own derived index, or implements logic the guard/mutate/respond shape can't express. **Use a behavior pack when** the endpoint reads one record, checks its state, mutates fields, optionally touches a related record, and responds &mdash; the common case for billing and payments state machines. See [Override handlers](/docs/adapters#adapter-dev) for the hand-written path.
