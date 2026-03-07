---
title: "Guides"
description: "CI/CD integration guide for running Mimic in automated pipelines."
order: 9
slug: "guides"
prev: { slug: "testing", title: "Testing & Auto-Scenarios" }
next: { slug: "examples", title: "Examples" }
---

<h2 id="guide-cicd">Guide: CI/CD Integration</h2>

<div class="code-block">
  <div class="code-bar"><span class="code-bar-lang">yaml</span><span>.github/workflows/agent-tests.yml</span><button class="code-copy">Copy</button></div>
  <pre><code><span class="yk">name:</span> <span class="ys">Agent Tests</span>
<span class="yk">on:</span> [push, pull_request]
&#8203;
<span class="yk">jobs:</span>
  <span class="yk">test:</span>
    <span class="yk">runs-on:</span> <span class="ys">ubuntu-latest</span>
    <span class="yk">steps:</span>
      - <span class="yk">uses:</span> <span class="ys">actions/checkout@v4</span>
      - <span class="yk">uses:</span> <span class="ys">actions/setup-node@v4</span>
        <span class="yk">with:</span>
          <span class="yk">node-version:</span> <span class="ys">22</span>
&#8203;
      - <span class="yk">name:</span> <span class="ys">Start Mimic</span>
        <span class="yk">run:</span> |
          npx @mimicai/cli seed --persona finance-alex
          npx @mimicai/cli host &
&#8203;
      - <span class="yk">name:</span> <span class="ys">Run agent tests</span>
        <span class="yk">run:</span> <span class="ys">npm test</span>
        <span class="yk">env:</span>
          <span class="yk">PLAID_BASE_URL:</span> <span class="ys">http://localhost:4101/plaid</span>
          <span class="yk">STRIPE_API_BASE:</span> <span class="ys">http://localhost:4102/stripe/v1</span>
&#8203;
      - <span class="yk">name:</span> <span class="ys">Cleanup</span>
        <span class="yk">run:</span> <span class="ys">npx @mimicai/cli clean</span></code></pre>
</div>

<div class="callout info">
  <span class="callout-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-bright)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></span>
  <div>Pre-built personas work fully offline &mdash; no API keys or secrets needed in your CI environment. Deterministic seeding guarantees identical data in every pipeline run.</div>
</div>
