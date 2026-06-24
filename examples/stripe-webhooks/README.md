# Stripe Live-Mode Webhooks Example

Demonstrates Mimic's **live-mode webhook** capability: when you run `mimic host`,
the Stripe mock doesn't just answer API calls — it fires **real outbound
webhooks** to your endpoint when resources change state, exactly like Stripe
does in production. This lets you exercise your webhook **sync layer**
end-to-end, deterministically, without ever touching real Stripe.

## The idea

In a real billing/checkout service:

1. **Stripe is the processor**, but **your database is the source of truth.**
2. When a payment succeeds or is canceled, Stripe sends you a **webhook**.
3. Your **webhook handler** reacts — marks the order paid, releases inventory,
   sends a receipt, etc. This is the **sync layer** between Stripe and your DB.

That sync layer is notoriously hard to test, because it depends on Stripe
actually firing events. Mimic closes the loop: `mimic host` serves the Stripe
mock **and** fires the same webhooks Stripe would when state-machine transitions
occur:

| API call                                   | Webhook fired              |
|--------------------------------------------|----------------------------|
| `POST /v1/payment_intents/:id/confirm`     | `payment_intent.succeeded` |
| `POST /v1/payment_intents/:id/cancel`      | `payment_intent.canceled`  |
| invoice finalize / pay                     | `invoice.finalized` / `invoice.paid` |

## What's here

| File                  | Purpose                                                                 |
|-----------------------|-------------------------------------------------------------------------|
| `mimic.json`          | Config: Stripe API mock + an `events.stripe` **webhook** block.         |
| `webhook-handler.mjs` | A tiny zero-dep Node server (port 3000) — stands in for **your** sync code. It verifies the `Stripe-Signature` and logs each event. |
| `demo.mjs`            | A zero-dep driver that creates / confirms / cancels PaymentIntents, then inspects and flushes the event inbox. |

## Run it

You'll use three terminals.

### Terminal 1 — your webhook handler

```bash
node webhook-handler.mjs
```

```
webhook handler listening on http://localhost:3000/webhooks/stripe
verifying Stripe-Signature with secret "whsec_demo"
```

### Terminal 2 — the mock + webhook engine

```bash
mimic host          # or: npx @mimicai/cli host
```

Wait for:

```
Mock server running on http://localhost:4101
```

### Terminal 3 — drive some transitions

```bash
node demo.mjs
```

The demo creates two PaymentIntents, confirms one (→ `payment_intent.succeeded`)
and cancels the other (→ `payment_intent.canceled`), then prints the event
inbox **before** and **after** flushing:

```
4. Inspect the event inbox (before flush)
   pending=2
   - evt_1 payment_intent.succeeded delivered=false
   - evt_2 payment_intent.canceled delivered=false
   (sync mode: nothing has reached the handler yet)
5. Flush → deliver buffered webhooks to the handler
   flushed=2
```

And **terminal 1** now logs the delivered webhooks:

```
received payment_intent.succeeded evt_1
  object: pi_... status=succeeded
received payment_intent.canceled evt_2
  object: pi_... status=canceled
```

## Sync vs async delivery

The `events.stripe.config.mode` field controls **when** webhooks are delivered:

- **`sync`** (used here) — events are **buffered** when a transition occurs and
  delivered only when you `POST /__mimic/flush`. This removes timing races, so
  webhook-driven tests are reproducible. Your handler sees **nothing** until you
  flush.
- **`async`** — fire-and-forget on emit, just like production. The webhook is
  delivered immediately when the transition happens; there's nothing to flush.

Combined with `deterministic: true` (+ `seed`), `sync` mode makes the whole flow
byte-reproducible: event ids are `evt_1`, `evt_2`, … and timestamps derive from
the seed, so the same run produces identical envelopes every time — ideal for CI.

## The control plane

The mock server exposes two control routes for inspecting and driving webhook
delivery:

| Route                              | Description                                                        |
|------------------------------------|--------------------------------------------------------------------|
| `GET  http://localhost:4101/__mimic/events` | Returns `{ events: [...], pending: N }` — the recorded event inbox and the count of buffered, not-yet-delivered events. |
| `POST http://localhost:4101/__mimic/flush`  | Delivers all buffered events to the endpoint; returns `{ flushed: N }`. |

```bash
curl http://localhost:4101/__mimic/events
curl -X POST http://localhost:4101/__mimic/flush
```

## The webhook envelope & signature

Events are delivered as a Stripe-style envelope:

```json
{
  "id": "evt_1",
  "object": "event",
  "type": "payment_intent.succeeded",
  "created": 1700000001,
  "data": { "object": { "id": "pi_...", "status": "succeeded", ... } }
}
```

Each request carries a signature header you can verify with the shared secret
(see `webhook-handler.mjs`):

```
Stripe-Signature: t=<timestamp>,v1=<hmac-sha256(secret, `${t}.${payload}`)>
```

## Configuration

The webhook engine is driven entirely by the `events.stripe` block in
`mimic.json`:

```jsonc
{
  "apis": { "stripe": { "enabled": true, "mcp": false } },
  "events": {
    "stripe": {
      "type": "webhook",
      "config": {
        "endpoint": "http://localhost:3000/webhooks/stripe",
        "secret": "whsec_demo",
        "envelope": "stripe",
        "mode": "sync",            // buffer until flushed (deterministic). use "async" for fire-and-forget.
        "deterministic": true,
        "seed": 1700000000
      }
    }
  }
}
```

| Field           | Meaning                                                            |
|-----------------|--------------------------------------------------------------------|
| `endpoint`      | Where to POST webhooks (your handler).                             |
| `secret`        | Shared secret for the `Stripe-Signature` HMAC.                     |
| `envelope`      | `stripe` (Stripe-style) or `generic`.                              |
| `mode`          | `sync` (buffer + flush) or `async` (fire-and-forget).              |
| `deterministic` | Stable `evt_<n>` ids and seed-derived timestamps.                  |
| `seed`          | Base timestamp for deterministic mode.                             |
