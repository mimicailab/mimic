# Spec-Driven Adapters: the Behavior DSL

> Status: Implemented (phase 1) on `claude/webhook-live-mode-design`
> Companion to `webhook-live-mode.md`

## Why

Today every adapter is a hand-written code package: an OpenAPI spec is codegen'd
into routes/schemas/resource-specs (the generic CRUD half), and the
platform-specific *behavior* — lifecycle state machines, guards, cross-resource
side effects — is written by hand as `overrides/*.ts`. That behavior code is the
expensive, per-adapter, doesn't-scale part.

This work makes that behavior **declarative data** executed by a shared engine,
so an adapter's state machines become a small YAML file instead of a TypeScript
module. The OpenAPI spec already gives shapes + CRUD; the behavior pack gives the
residue a spec can't describe.

## What shipped

A generic **behavior-pack engine** in `@mimicai/adapter-sdk`:

- `behavior/expr.ts` — a safe expression evaluator (tokenizer + Pratt parser, no
  `eval`). Literals, dotted paths, arrays, `! -`, `== != < > <= >= && || + - * / %`,
  `in`, ternary. `==`/`!=` treat `null`/`undefined` as equal, matching the
  `x != null` nullish idiom the overrides used.
- `behavior/interpreter.ts` — compiles an `ActionSpec` into a Fastify handler:
  load target → guard → ordered effects → persist/delete → emit → respond.
- `behavior/types.ts` — the pack schema.
- `behavior/loader.ts` + `bin/behavior-codegen.ts` — YAML is the source of truth,
  compiled to `generated/behavior.ts` (mirrors the OpenAPI codegen pattern; no
  YAML parsed at runtime). Shared bin: `mimic-behavior-codegen`.
- `OpenApiMockAdapter.mountBehaviorPacks(store, packs, errorFactory, emitSink?)`
  — one call mounts a pack; the per-adapter `errorFactory` maps a generic
  `ErrorSpec` to that platform's error envelope.

### DSL surface

```yaml
adapter: stripe
actions:
  - method: POST
    path: /v1/payment_intents/:intent/confirm      # must match the generated route
    target: { namespace: stripe:payment_intents, id: '{{ params.intent }}' }
    notFound: { status: 404, code: resource_missing, message: "No such ..." }
    guard: "!(self.status in ['succeeded','canceled'])"
    guardError: { status: 400, code: ..., message: "..." }
    effects:
      - var:    { capture_method: "{{ body.capture_method != null ? body.capture_method : 'automatic' }}" }
      - create: charge            # create a sibling resource, bind its id
        namespace: stripe:charges
        idPrefix: ch_
        bind: charge
        fields: { object: charge, amount: '{{ self.amount }}', ... }
      - set:    { status: succeeded, latest_charge: '{{ charge }}' }
      - merge:  '{{ body }}'      # spread a resolved object onto self
      - update: { namespace: stripe:charges, id: '{{ self.latest_charge }}', set: { captured: true } }
      - when:   "self.status == 'draft'"
        then: [ ... ]
        else: [ ... ]
      - error:  { status: 422, code: ..., message: "..." }
    delete: false                 # true → remove target instead of re-storing
    respond: '{{ self }}'         # default = the updated target
    status: 200
    emit:
      - { when: "self.status == 'succeeded'", event: payment_intent.succeeded }
```

Scope available to expressions/templates: `self` (the target, mutated copy),
`body`, `params`, `query`, `now` (unix seconds), `nowIso` (ISO-8601), plus any
`var`/`create`-bound names. The `emit` list is the seam for the webhook delivery
engine in `webhook-live-mode.md`.

## Results

Migration was driven by each adapter's **existing test suite** as the guardrail —
no test was modified; pass counts are unchanged.

| Adapter | Actions → YAML | Tests | Notes |
|---|---|---|---|
| stripe | 12 | 64/64 | payment-intents, setup-intents, invoices, charges |
| zuora | 5 | 55/55 | subscriptions, credit-memos |
| chargebee | 7 | 25/25 | subscriptions, invoices |
| gocardless | 7 | 14/14 | subscriptions, payments, mandates (full `overrides/` removed) |
| revenuecat | 8 | 14/14 | subscriptions, products, offerings, entitlements (full) |
| recurly | 6 | 25/25 | subscription lifecycle |
| lemonsqueezy | 2 | 19/19 | subscription cancel/update (JSON:API) |
| paddle | 2 | 14/14 | subscription activate/resume |
| **Total** | **~49** | **all green** | engine: 27 SDK tests |

Plus end-to-end proof through the real `mimic host` runtime: a full PaymentIntent
lifecycle (confirm→capture→succeeded, illegal re-capture → 400) executed against
the running server, driven entirely by the YAML pack.

### Adapters with nothing to migrate (correctly)

`gmail`, `hubspot`, `attio`, `plaid`, `granola`, `slack` were surveyed and
**intentionally left unchanged** — their overrides are not fixed-field state
machines. This is the designed boundary, not a gap: it tells you exactly where
the escape hatch earns its place. (Database adapters — postgres/mysql/mongodb/
sqlite — have no API-mock overrides and are out of scope.)

## DSL limitations (the escape-hatch boundary)

The engine deliberately covers *fixed-field state machines*. It does NOT express,
and those handlers stay as code:

1. **Array push/remove** — e.g. Gmail `labelIds` add/remove, Attio multiselect /
   comment threads. `set`/`merge` overwrite, they don't splice.
2. **Nested-path set** — e.g. HubSpot/Attio writing `self.properties.<k>` /
   `record.values.<attr>`. `set` keys are top-level; no deep-merge.
3. **Two-hop / join resolution** — e.g. Plaid resolving `body.access_token →
   item_id → item`. `target` loads one namespace by one id template.
4. **List scan / filter / aggregate / paginate** — computed reads (Stripe
   `balance`, Plaid transactions/sync), list envelopes (Granola), search.
5. **Factory-style create with custom response wrapping** — resource creation via
   schema-default factories (Stripe/Chargebee subscription create).
6. **Date arithmetic on ISO strings** — `now` (unix) supports arithmetic
   (`now + 30*86400`), but there is no ISO date-add (Paddle/LemonSqueezy +30d).
7. **Cross-resource computed sync** — Stripe refunds updating
   `charge.amount_refunded` via `Math.max` over the charge's current value.
8. **Validate-args-before-load** — Slack returns `invalid_arguments` before any
   resource lookup; the interpreter loads `target` first, so verb-style APIs that
   validate-then-load don't map cleanly. A pre-load `validate` hook would close this.

These are honest candidates for future DSL primitives (an `append`/`removeFrom`
array effect, nested-path `set`, a `lookup`/join resolver) — added only when a
real adapter needs them, the same discipline used to add `merge` and `delete`
during this work.

## How a new adapter looks now

1. `openapi.yaml` → `mimic-codegen` → routes/schemas/specs (existing).
2. `behavior/*.yaml` → `mimic-behavior-codegen` → `generated/behavior.ts`.
3. `mountBehaviorPacks(store, behaviorPacks, errorFactory)` in the adapter.
4. The platform's existing test suite (recorded fixtures) is the guardrail.

The engine is written once; adapters are increasingly **content, not code**. The
LLM-authored-behavior-pack + golden-test path described in the companion doc plugs
in here: the LLM drafts the `behavior/*.yaml`, the engine executes it
deterministically, and the test suite gates it.
