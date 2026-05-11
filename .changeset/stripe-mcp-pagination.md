---
'@mimicai/adapter-stripe': minor
---

Stripe MCP `list_*` tools now auto-paginate across pages. Previously every `list_*` tool returned only the first page (10 records by default, max 100), with no `starting_after` cursor exposed — totals above the page cap were silently truncated, so eval scenarios asking the agent for accurate counts of subscriptions, invoices, payments, refunds, payouts, or disputes hit wrong-by-pagination failures.

By default each `list_*` tool now walks pages of 100 internally until `has_more === false`, up to a 1000-record safety cap, and reports the true total in the response. Callers that genuinely want single-page semantics can opt in by passing `limit` or `starting_after` explicitly — those parameters are now exposed on every `list_*` tool and on the generic `fetch_stripe_resources` listing path. When auto-pagination hits the 1000-record cap, the response signals it (`(N+)` count, "pass starting_after to continue") so the agent can resume.

Affected tools: `list_coupons`, `list_customers`, `list_disputes`, `list_invoices`, `list_payment_intents`, `list_prices`, `list_products`, `list_subscriptions`, `search_stripe_resources`, `fetch_stripe_resources`.
