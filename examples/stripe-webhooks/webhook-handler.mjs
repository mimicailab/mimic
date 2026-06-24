#!/usr/bin/env node
/**
 * Webhook handler — a tiny zero-dependency Node HTTP server that stands in for
 * your real Stripe sync code. It receives the webhooks that `mimic host` fires
 * when PaymentIntents change state, verifies the Stripe-Signature, and logs
 * what it received.
 *
 * In a real service this is where you'd update your database (mark an order
 * paid, release inventory, send a receipt, ...). The point of this example is
 * that you can drive those transitions deterministically against the mock.
 *
 * Run:  node webhook-handler.mjs
 */

import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 3000);
// Must match events.stripe.config.secret in mimic.json.
const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_demo';

/**
 * Verify a Stripe-Signature header of the form `t=<ts>,v1=<hmac>`.
 * The signed payload is `${t}.${rawBody}` HMAC-SHA256'd with the shared secret.
 */
function verifySignature(header, rawBody) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=')),
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const expected = createHmac('sha256', SECRET).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks/stripe') {
    res.writeHead(404).end('not found');
    return;
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const sig = req.headers['stripe-signature'];

    if (!verifySignature(sig, rawBody)) {
      console.log('signature verification FAILED — rejecting');
      res.writeHead(400).end('bad signature');
      return;
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      res.writeHead(400).end('bad json');
      return;
    }

    // The resource (PaymentIntent, Invoice, ...) lives at data.object.
    const obj = event?.data?.object ?? {};
    console.log(`received ${event.type} ${event.id}`);
    console.log(`  object: ${obj.id ?? '(none)'} status=${obj.status ?? '(none)'}`);

    // This is where your real sync code would update your database.

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
  });
});

server.listen(PORT, () => {
  console.log(`webhook handler listening on http://localhost:${PORT}/webhooks/stripe`);
  console.log(`verifying Stripe-Signature with secret "${SECRET}"`);
});
