#!/usr/bin/env node
/**
 * Demo driver — exercises the Stripe mock so it fires webhooks.
 *
 * Zero dependencies; uses the global `fetch`. It:
 *   1. Creates two PaymentIntents.
 *   2. Confirms one   → fires payment_intent.succeeded.
 *   3. Cancels the other → fires payment_intent.canceled.
 *   4. GETs  /__mimic/events to show the buffered (pending) events.
 *   5. POSTs /__mimic/flush  to deliver them to the webhook handler.
 *
 * Because mimic.json uses `mode: "sync"`, the webhooks are NOT delivered until
 * step 5 — so the handler sees nothing until you flush. Deterministic mode
 * (`deterministic: true`) gives stable event ids: evt_1, evt_2, ...
 *
 * Run:  node demo.mjs   (with `mimic host` and the handler already running)
 */

const BASE = process.env.MIMIC_BASE_URL ?? 'http://localhost:4101';

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    // Only declare a JSON content-type when we actually send a body — Fastify
    // rejects an empty body when content-type is application/json.
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return json;
}

function line() {
  console.log('─'.repeat(60));
}

async function main() {
  line();
  console.log('1. Create two PaymentIntents');
  const pi1 = await api('POST', '/v1/payment_intents', {
    amount: 2000,
    currency: 'usd',
    payment_method: 'pm_card_visa',
  });
  console.log(`   created ${pi1.id} status=${pi1.status}`);

  const pi2 = await api('POST', '/v1/payment_intents', {
    amount: 5000,
    currency: 'usd',
    payment_method: 'pm_card_visa',
  });
  console.log(`   created ${pi2.id} status=${pi2.status}`);

  line();
  console.log('2. Confirm the first PaymentIntent → payment_intent.succeeded');
  const confirmed = await api('POST', `/v1/payment_intents/${pi1.id}/confirm`, {});
  console.log(`   ${confirmed.id} status=${confirmed.status}`);

  line();
  console.log('3. Cancel the second PaymentIntent → payment_intent.canceled');
  const canceled = await api('POST', `/v1/payment_intents/${pi2.id}/cancel`, {});
  console.log(`   ${canceled.id} status=${canceled.status}`);

  line();
  console.log('4. Inspect the event inbox (before flush)');
  const before = await api('GET', '/__mimic/events');
  console.log(`   pending=${before.pending}`);
  for (const e of before.events) {
    console.log(`   - ${e.id} ${e.type} delivered=${e.delivered}`);
  }
  console.log('   (sync mode: nothing has reached the handler yet)');

  line();
  console.log('5. Flush → deliver buffered webhooks to the handler');
  const flushed = await api('POST', '/__mimic/flush');
  console.log(`   flushed=${flushed.flushed}`);

  const after = await api('GET', '/__mimic/events');
  console.log('   inbox after flush:');
  for (const e of after.events) {
    console.log(`   - ${e.id} ${e.type} delivered=${e.delivered}`);
  }

  line();
  console.log('Done. Check the webhook-handler terminal for the received events.');
}

main().catch((err) => {
  console.error('demo failed:', err.message);
  process.exit(1);
});
