# Design: Webhook-Driven "Live Mode"

> Status: Draft / RFC
> Branch: `claude/webhook-live-mode-design`
> Author: design exploration

## 1. Thesis

Today Mimic seeds **both** the external surface (Stripe mock) **and** the
mirrored database (Postgres) from the same persona blueprint. The two sides
agree because we wrote them both. That hides the exact layer that breaks in
production: **the integration code that keeps your database in sync with the
external system of record** — webhook handlers, idempotency, ordering,
reconciliation, business logic.

**Live Mode** flips the model:

- Seed **only** the source of truth (the adapter, e.g. Stripe).
- The mock behaves like the real production API — including **emitting
  webhooks** on every state transition.
- Your **own** webhook handlers + business logic populate the database.

You stop testing against a consistent photograph and start testing the thing
that actually fails. The promise to the user becomes:

> "Describe a persona. We make Stripe (and friends) behave like production —
> reads, writes, **and webhooks**. You don't write seeding scripts against a
> rate-limited third-party sandbox; you point your app at us and your real
> sync code runs."

This is achievable because **~80% of the machinery already exists**. This doc
maps the remaining 20%.

## 2. What already exists (grounded in the code)

| Capability | Where | Notes |
|---|---|---|
| Stateful resource store | `packages/core/src/mock/state-store.ts` | `set/get/update/delete/list`, plus `serialize()` for persistence |
| Real state machines | `packages/adapters/adapter-stripe/src/overrides/*.ts` | PaymentIntent `confirm→capture→cancel`, invoices `finalize/pay/void`, refunds, subscriptions — correct transitions + Stripe error codes |
| Writes mutate state | `openapi-mock-adapter.ts:299/350/366` (CRUD scaffold) + every override | All writes flow through `StateStore` |
| `events` config block | `packages/core/src/types/config.ts:160` | `type: 'kafka' \| 'webhook' \| 'sqs'`, `config`, `topics` — declared, **not wired to emit** |
| Mirror modelling | `config.ts` `modeling.tableRoles` | roles `identity \| external-mirrored \| internal-only` — already names which DB tables mirror an adapter |
| Per-adapter MCP + API host | `packages/cli/src/commands/host.ts` | one mock API + one MCP server per adapter |

**The gap:** no component turns a state transition into an outbound webhook.
`confirm` advances a PaymentIntent to `succeeded` and stops — it never POSTs
`payment_intent.succeeded` to your app.

## 3. The single missing primitive

A **state transition → semantic event → signed delivery** pipeline.

The elegant insight: because **all** mutations pass through `StateStore`,
instrumenting the store gives us a universal, zero-per-handler change feed.
A small per-adapter "event map" then translates raw row changes into the
platform's real event vocabulary (`payment_intent.succeeded`, not "row
changed").

## 4. Architecture

Four components. Three are new; one is an extension of `StateStore`.

```
         write (POST /confirm)                     your app
                │                                      ▲
                ▼                                      │ HTTP POST (signed)
   ┌─────────────────────────┐                        │
   │  Override / CRUD handler │                        │
   │  store.set(ns, id, obj)  │                        │
   └───────────┬─────────────┘                         │
               │ (A) emits ChangeEvent                 │
               ▼                                        │
   ┌─────────────────────────┐   (B) maps to    ┌──────┴──────────┐
   │   StateStore (+ bus)     │─────────────────▶│  Event Mapper   │
   │   set/update/delete      │   semantic event │  (per adapter)  │
   └─────────────────────────┘                  └──────┬──────────┘
                                                        │ EventEnvelope
                                                        ▼
                                              ┌───────────────────┐
                                              │ Delivery Engine   │
                                              │ sign · queue ·    │
                                              │ retry · flush     │
                                              └───────────────────┘
```

### (A) StateStore change feed

Extend `StateStore` to emit a low-level change record on every mutation.
This is the only change to an existing core file and it is additive.

```ts
// state-store.ts
export interface ChangeEvent {
  namespace: string;          // "stripe:payment_intents"
  key: string;                // "pi_abc123"
  op: 'create' | 'update' | 'delete';
  before?: unknown;           // prior value (for update/delete)
  after?: unknown;            // new value (for create/update)
  seq: number;                // monotonic, deterministic ordering
}

class StateStore {
  private seq = 0;
  private listeners = new Set<(e: ChangeEvent) => void>();
  onChange(fn: (e: ChangeEvent) => void): () => void { /* subscribe */ }
  // set/update/delete capture before/after and emit with seq++
}
```

Why the store and not each handler: the Stripe adapter alone has ~25 override
handlers plus 617 generated routes. Hooking the store means **one** change
covers every current and future mutation, in every adapter, for free.

`seq` (a per-store counter) gives us deterministic event ordering without
wall-clock time — important for §6.

### (B) Per-adapter Event Map

Raw row changes are not webhook events. Stripe doesn't emit "payment_intents
row updated"; it emits `payment_intent.succeeded` when `status` becomes
`succeeded`. Each adapter declares a declarative map from transitions to
events. This lives next to the state machine it describes.

```ts
// adapter-stripe/src/events.ts
export const stripeEventMap: EventMap = {
  'stripe:payment_intents': [
    { on: 'create', event: 'payment_intent.created' },
    { on: 'update', when: (b, a) => a.status === 'succeeded' && b?.status !== 'succeeded',
      event: 'payment_intent.succeeded' },
    { on: 'update', when: (b, a) => a.status === 'canceled' && b?.status !== 'canceled',
      event: 'payment_intent.canceled' },
  ],
  'stripe:charges':   [{ on: 'create', event: 'charge.succeeded', when: (_b, a) => a.status === 'succeeded' }],
  'stripe:invoices':  [{ on: 'update', when: (b, a) => a.status === 'paid' && b?.status !== 'paid', event: 'invoice.paid' }],
  // ...
};
```

The mapper wraps the matched event in the platform's real envelope shape
(Stripe's `{ id: 'evt_…', type, data: { object } }`). Envelope shaping is
per-adapter because every platform's webhook format differs.

New optional field on the adapter contract (`types/adapter.ts`,
`ApiMockAdapter`):

```ts
/** Declarative map: state transition → platform webhook event. */
readonly eventMap?: EventMap;
/** Wrap a matched event in the platform's webhook envelope + sign it. */
buildWebhookEnvelope?(event: MatchedEvent, secret: string): WebhookEnvelope;
```

Adapters with no native webhooks (most DB adapters, read-only mirrors) simply
omit `eventMap` and Live Mode is a no-op for them — graceful degradation.

### (C) Delivery Engine

New module `packages/core/src/events/` (sibling to `mock/`).

Responsibilities:
- **Destination resolution** — read endpoint(s) from config (§5).
- **Signing** — per-platform signature header (Stripe `Stripe-Signature`
  with `whsec_…`, Svix-style, HMAC, etc.). Adapter-provided via
  `buildWebhookEnvelope`.
- **Delivery modes:**
  - `sync` (default for tests) — buffer events; deliver only when the test
    calls `flush()`. No races, fully deterministic.
  - `async` (default for `mimic host` interactive) — fire shortly after the
    triggering response, like production.
  - `manual` — never auto-deliver; events are emitted only via
    `mimic emit` / replay tooling.
- **Retry** — bounded, deterministic backoff schedule (no jitter in test mode).
- **Inbox/log** — record every event for inspection, replay, and assertions
  (reuse the pattern in `mock/request-logger.ts`).

### (D) Config surface

Extend the existing `events` block — it already exists, it just isn't wired.

```jsonc
{
  "events": {
    "stripe": {
      "type": "webhook",
      "endpoint": "http://localhost:3000/api/webhooks/stripe",
      "secret": "$STRIPE_WEBHOOK_SECRET",
      "delivery": "async",          // sync | async | manual
      "events": ["payment_intent.*", "invoice.paid"]   // optional allow-list
    }
  },
  "modeling": {
    "tableRoles": {
      "payments": { "role": "external-mirrored",
                    "sources": [{ "adapter": "stripe", "resource": "payment_intents" }] }
    }
  }
}
```

`endpoint` and `secret` are the per-adapter knobs the user asked for: every
adapter "takes a webhook endpoint," and the user's system supplies the matching
handler + secret.

## 5. Two modes, one config — and how `tableRoles` decides

Live Mode is not a replacement for snapshot seeding; it **repositions**
seeding as *initial state*.

| | Snapshot Mode (today) | Live Mode (new) |
|---|---|---|
| Seed Stripe mock | yes | yes |
| Seed mirrored DB tables | yes | **no** — derived by your code |
| Webhooks | none | emitted on transitions |
| Tests | agent vs. consistent world | **your sync/business logic** |

The switch is driven by `modeling.tableRoles`:

- `external-mirrored` table **+ Live Mode** → seeder **skips** it; the table
  is populated only by your webhook handler. This is the seam where
  `mimic seed` stops writing the Postgres side.
- `external-mirrored` table **+ Snapshot Mode** → seeded as today.
- `identity` / `internal-only` tables → always seeded (your app owns them).

A global toggle (`"mode": "snapshot" | "live"`) or a per-table override
selects behavior. Default stays `snapshot` so nothing breaks.

## 6. Determinism (the hard part = the moat)

"Identical every run" is Mimic's headline promise; async webhooks threaten it.
Design choices that preserve it:

1. **No wall-clock ordering.** Events carry the store's `seq` counter, not
   `Date.now()`. (The codebase already leans on seeded determinism; note
   `mimic.ts`/overrides currently mix in `Date.now()` — Live Mode needs a
   single injected clock. Tracked as a cleanup.)
2. **Deterministic IDs.** `evt_…` IDs derive from `(seed, seq)`, not random.
3. **`sync` delivery in tests.** Events buffer and flush on demand, so the
   test controls exactly when the handler runs. Wall-clock races disappear.
4. **Deterministic retry schedule.** Fixed backoff, no jitter, in test mode.
5. **Chaos is opt-in and seeded.** Out-of-order / duplicate / dropped delivery
   are *injected deliberately* with a seed, so even "chaos" replays identically.

This is the part nobody ships well: `stripe-mock` has no webhooks at all;
`stripe trigger` is neither stateful nor deterministic. Deterministic,
controllable webhook delivery is the defensible surface.

## 7. CLI surface

```
mimic host                      # now also boots the delivery engine; async by default
mimic events ls                 # list emitted events (the inbox)
mimic events flush              # deliver buffered events (sync mode)
mimic events replay <evt_id>    # re-deliver one event
mimic events inject <type> --out-of-order --dupe   # chaos, seeded
```

`mimic host` wiring (`packages/cli/src/commands/host.ts:239`): after
`mockServer.registerAdapter(...)`, subscribe a `DeliveryEngine` to
`mockServer.stateStore.onChange`, configured from `config.events[apiName]`
and `adapter.eventMap`.

## 8. Per-platform reality

Not every platform has webhooks; the design degrades gracefully.

| Platform | Native webhooks | Live Mode value |
|---|---|---|
| Stripe | yes (rich) | **flagship** — full event catalog |
| Plaid | yes | high (transactions/sync events) |
| Paddle / Chargebee / Recurly / etc. | yes | high (billing lifecycle) |
| GoCardless / Stripe-like | yes | high |
| Slack / Gmail | events/push, different model | medium — different envelope |
| DB adapters (pg/mysql/mongo/sqlite) | n/a | none — they are the *sink*, not a source |

Strategy: ship Live Mode for **Stripe first** (most complete state machine +
event map already 80% implied by the overrides), then the billing set, then
Plaid. The long-tail adapters stay static mocks until someone needs them live —
keeps the "100+ adapters" roadmap honest, because a faithful event map is real
per-adapter work and shouldn't gate breadth.

## 9. Phased rollout

- **Phase 0 — Core plumbing.** `StateStore` change feed + `seq`; injected
  clock; `EventMap`/`EventEnvelope` types in `types/adapter.ts`; empty
  `core/src/events/` delivery engine with `sync` mode + inbox. No behavior
  change yet (no adapter opts in).
- **Phase 1 — Stripe Live Mode.** `adapter-stripe/src/events.ts` map +
  envelope/signing; wire into `mimic host`; `mode` + `events.endpoint` config;
  `external-mirrored` seed-skip. E2E test: confirm a PI → assert
  `payment_intent.succeeded` hits a local handler → assert the handler wrote
  the mirrored Postgres row.
- **Phase 2 — Determinism + DX.** `mimic events` CLI, replay, seeded chaos
  injection, `async` mode for interactive host.
- **Phase 3 — Breadth.** Billing adapters + Plaid event maps. Document the
  `eventMap` contract in `docs/ADAPTER_GUIDE.md` so community adapters ship
  webhooks.

## 10. File-by-file change map

| File | Change |
|---|---|
| `packages/core/src/mock/state-store.ts` | add `ChangeEvent`, `seq`, `onChange`, before/after capture (additive) |
| `packages/core/src/events/` (new) | delivery engine: mapper runner, signer, queue, retry, inbox, flush |
| `packages/core/src/types/adapter.ts` | add optional `eventMap` + `buildWebhookEnvelope` to `ApiMockAdapter`; `EventMap`/`MatchedEvent`/`WebhookEnvelope` types |
| `packages/core/src/types/config.ts` | flesh out `events` (endpoint/secret/delivery/events); add top-level `mode` |
| `packages/core/src/seed/*` | honor `external-mirrored` + Live Mode → skip seeding mirrored tables |
| `packages/adapters/adapter-stripe/src/events.ts` (new) | Stripe event map + envelope/signature |
| `packages/cli/src/commands/host.ts` | boot `DeliveryEngine`, subscribe to `stateStore.onChange` |
| `packages/cli/src/commands/events.ts` (new) | `mimic events ls/flush/replay/inject` |
| `packages/adapter-sdk/src/index.ts` | re-export new event types/helpers for adapter authors |
| `docs/ADAPTER_GUIDE.md` | document the `eventMap` contract |

## 11. Decisions for you

1. **Mode switch granularity** — global `mode: live`, or per-table via
   `tableRoles`, or both? (Recommend: global default + per-table override.)
2. **Default delivery for `mimic host`** — `async` (prod-like) or `sync`
   (deterministic)? (Recommend: `async` interactive, `sync` under `mimic test`.)
3. **Clock unification** — adopt a single injected clock now (Phase 0) and
   purge stray `Date.now()`? Required for true determinism; modest refactor.
4. **Signature scope** — ship Stripe-style signing first only, or a generic
   HMAC + per-adapter override from day one?
5. **Scope of Phase 1** — Stripe only, or Stripe + one billing adapter to
   prove the contract generalizes before locking it?
```
