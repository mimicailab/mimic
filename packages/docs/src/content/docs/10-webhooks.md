---
title: "Webhooks & Live Mode"
eyebrow: "Webhooks"
description: "Deliver real outbound webhooks from behavior emit declarations, run async or sync delivery, sign events, and drive deterministic CI tests."
order: 8.5
slug: "webhooks"
prev: { slug: "testing", title: "Testing & Auto-Scenarios" }
next: { slug: "guides", title: "Guides" }
---

<h2 id="webhooks-overview">
  <span class="eyebrow">Webhooks</span>
  Overview
</h2>

<p class="lead">
  When an adapter's behavior pack declares <code>emit:</code>, Mimic can deliver a <strong>real outbound webhook</strong> to an endpoint you control. This turns the mock into a source of truth that drives your own integration layer &mdash; instead of asserting against a static snapshot, you exercise your webhook handler and business logic end to end.
</p>

This is the **live-mode** point: seed only the source-of-truth adapter, then let your own webhook handler plus business logic populate your database. You test the sync layer, not a frozen fixture. The feature is opt-in and backwards compatible &mdash; adapters and configs that don't use it behave exactly as before.

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div>Webhooks are emitted from behavior-pack <code>emit:</code> declarations. See <a href="/docs/adapter-guide#behavior-action">Behavior Packs</a> for how an action declares the events it fires.</div>
</div>

---

<h2 id="webhooks-config">Configuration</h2>

Outbound webhooks are configured per adapter in an `events` block in `mimic.json`:

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>mimic.json</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"events"</span>: {
  <span class="yk">"stripe"</span>: {
    <span class="yk">"type"</span>: <span class="str">"webhook"</span>,
    <span class="yk">"config"</span>: {
      <span class="yk">"endpoint"</span>: <span class="str">"http://localhost:4000/webhooks/stripe"</span>,
      <span class="yk">"secret"</span>: <span class="str">"$STRIPE_WEBHOOK_SECRET"</span>,
      <span class="yk">"envelope"</span>: <span class="str">"stripe"</span>,
      <span class="yk">"mode"</span>: <span class="str">"async"</span>,
      <span class="yk">"deterministic"</span>: <span class="ty">false</span>,
      <span class="yk">"seed"</span>: <span class="ty">42</span>
    }
  }
}</code></pre>
</div>

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>endpoint</code></td><td>string (URL)</td><td>Where signed webhook events are delivered</td></tr>
      <tr><td><code>secret</code></td><td>string</td><td>Signing secret. When set, events are signed (see below)</td></tr>
      <tr><td><code>envelope</code></td><td>string</td><td><code>"stripe"</code> or <code>"generic"</code> &mdash; the event payload shape</td></tr>
      <tr><td><code>mode</code></td><td>string</td><td><code>"async"</code> (default) or <code>"sync"</code></td></tr>
      <tr><td><code>deterministic</code></td><td>boolean</td><td>Use predictable event IDs and timestamps</td></tr>
      <tr><td><code>seed</code></td><td>number</td><td>Seeds the deterministic timestamp sequence</td></tr>
    </tbody>
  </table>
</div>

---

<h2 id="webhooks-modes">Async vs Sync</h2>

#### async (default)

Events are delivered **fire-and-forget** on the triggering write, exactly like production. The write that triggers an `emit:` returns immediately and the event is delivered out of band. Use this for realistic local development against your own webhook handler.

#### sync

Events are **buffered** rather than delivered immediately, and flushed on demand. This gives tests full control over when delivery happens, which is what makes deterministic CI possible. Two control-plane routes on the mock server drive it:

<div class="doc-table-wrap">
  <table class="doc-table">
    <thead><tr><th>Route</th><th>Purpose</th></tr></thead>
    <tbody>
      <tr><td><code>GET /__mimic/events</code></td><td>Inspect the event inbox plus pending (buffered) events</td></tr>
      <tr><td><code>POST /__mimic/flush</code></td><td>Deliver all buffered events to the configured endpoint</td></tr>
    </tbody>
  </table>
</div>

When `deterministic` is `true`, buffered events get sequential `evt_<n>` IDs and seed-based timestamps, so replays produce identical payloads.

---

<h2 id="webhooks-signing">Signing</h2>

When `secret` is set, events are signed with a `Stripe-Signature` header of the form `t=<timestamp>,v1=<hmac-sha256>`. Verify it in your handler exactly as you would verify a production Stripe webhook signature. If `secret` is omitted, events are delivered unsigned.

---

<h2 id="webhooks-envelopes">Envelopes</h2>

The `envelope` field controls the JSON shape of the delivered event.

#### stripe

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"id"</span>: <span class="str">"evt_..."</span>,
  <span class="yk">"object"</span>: <span class="str">"event"</span>,
  <span class="yk">"type"</span>: <span class="str">"invoice.payment_succeeded"</span>,
  <span class="yk">"created"</span>: <span class="ty">1750000000</span>,
  <span class="yk">"data"</span>: { <span class="yk">"object"</span>: { <span class="cm">/* the resource */</span> } }
}</code></pre>
</div>

#### generic

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><button class="code-copy">Copy</button></div>
  <pre><code>{
  <span class="yk">"id"</span>: <span class="str">"evt_..."</span>,
  <span class="yk">"type"</span>: <span class="str">"invoice.payment_succeeded"</span>,
  <span class="yk">"created"</span>: <span class="ty">1750000000</span>,
  <span class="yk">"data"</span>: { <span class="cm">/* the resource */</span> }
}</code></pre>
</div>

The difference is nesting: the `stripe` envelope wraps the resource in `data.object` and adds `object: "event"`; the `generic` envelope puts the resource directly under `data`.

---

<h2 id="webhooks-ci">Deterministic CI Pattern</h2>

Sync mode plus `deterministic: true` gives a repeatable test loop: drive the API, flush, then assert your handler ran. No timing races, no flaky timestamps.

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">json</span><span>mimic.json &mdash; sync + deterministic</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">"events"</span>: {
  <span class="yk">"stripe"</span>: {
    <span class="yk">"type"</span>: <span class="str">"webhook"</span>,
    <span class="yk">"config"</span>: {
      <span class="yk">"endpoint"</span>: <span class="str">"http://localhost:4000/webhooks/stripe"</span>,
      <span class="yk">"secret"</span>: <span class="str">"whsec_test"</span>,
      <span class="yk">"envelope"</span>: <span class="str">"stripe"</span>,
      <span class="yk">"mode"</span>: <span class="str">"sync"</span>,
      <span class="yk">"deterministic"</span>: <span class="ty">true</span>,
      <span class="yk">"seed"</span>: <span class="ty">42</span>
    }
  }
}</code></pre>
</div>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">bash</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="cm"># 1. Drive the API &mdash; a write whose behavior declares emit:</span>
<span class="prompt">$</span> curl -X POST http://localhost:3000/stripe/v1/invoices/in_123/pay \
       -H <span class="str">"Authorization: Bearer test_growth-saas_key"</span>
&#8203;
<span class="cm"># 2. Inspect what's buffered (optional)</span>
<span class="prompt">$</span> curl http://localhost:3000/__mimic/events
&#8203;
<span class="cm"># 3. Flush &mdash; deliver buffered events to your endpoint</span>
<span class="prompt">$</span> curl -X POST http://localhost:3000/__mimic/flush
&#8203;
<span class="cm"># 4. Assert your webhook handler ran and your DB reflects the sync</span></code></pre>
</div>

<div class="callout tip">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></span>
  <div>The same flow drives an automated test: issue the write through your API client, <code>POST /__mimic/flush</code>, then assert the handler ran and your database changed. Because IDs and timestamps are deterministic, snapshots stay stable across runs.</div>
</div>
