/**
 * Webhook delivery — turns behavior-pack `emit` declarations into outbound
 * HTTP webhooks.
 *
 * This is the bridge between the behavior interpreter's EmitSink and a user's
 * real webhook handler: when a state machine fires `emit: payment_intent.succeeded`,
 * this posts a Stripe-style event envelope (optionally signed) to the configured
 * endpoint. It is the first concrete piece of "live mode" — the user's own sync
 * code runs against these events instead of us seeding the mirrored DB.
 */

import { createHmac } from 'node:crypto';
import { generateId } from '@mimicai/core';
import { unixNow } from '../format-helpers.js';
import type { EmitSink } from './interpreter.js';

export interface WebhookSinkOptions {
  /** Destination URL for delivered events. */
  endpoint: string;
  /** Optional signing secret (Stripe-style `Stripe-Signature` HMAC). */
  secret?: string;
  /** Header name for the signature (default `Stripe-Signature`). */
  signatureHeader?: string;
  /** Short label used in logs, e.g. the adapter id. */
  source?: string;
  /** Log callback (defaults to console.log). */
  log?: (msg: string) => void;
}

/** Wrap a behavior emit in a Stripe-style event envelope. */
function buildEnvelope(type: string, data: unknown): Record<string, unknown> {
  return {
    id: generateId('evt_', 24),
    object: 'event',
    api_version: '2024-06-20',
    created: unixNow(),
    type,
    data: { object: data },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  };
}

/** Compute a Stripe-style signature header value: `t=<ts>,v1=<hmac>`. */
function sign(payload: string, secret: string): string {
  const t = unixNow();
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/**
 * Build an EmitSink that delivers events to a webhook endpoint.
 *
 * Delivery is fire-and-forget (like production) so it never blocks the API
 * response; failures are logged, not thrown.
 */
export function createWebhookEmitSink(opts: WebhookSinkOptions): EmitSink {
  const log = opts.log ?? ((m: string) => console.log(m));
  const sigHeader = opts.signatureHeader ?? 'Stripe-Signature';
  const src = opts.source ? `[${opts.source}] ` : '';

  return (event) => {
    const envelope = buildEnvelope(event.type, event.data);
    const payload = JSON.stringify(envelope);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.secret) headers[sigHeader] = sign(payload, opts.secret);

    // Fire-and-forget; do not block the triggering response.
    void fetch(opts.endpoint, { method: 'POST', headers, body: payload })
      .then((res) => {
        log(`${src}webhook → ${event.type} → ${opts.endpoint} (${res.status})`);
      })
      .catch((err) => {
        log(`${src}webhook FAILED ${event.type} → ${opts.endpoint}: ${err instanceof Error ? err.message : String(err)}`);
      });
  };
}

/**
 * Resolve a webhook EmitSink from a Mimic config `events` block for a given
 * adapter id, or undefined if no webhook destination is configured.
 *
 * Config shape (mimic.json):
 *   "events": { "stripe": { "type": "webhook", "config": { "endpoint": "...", "secret": "..." } } }
 */
export function webhookSinkFromConfig(
  config: unknown,
  adapterId: string,
  log?: (msg: string) => void,
): EmitSink | undefined {
  const events = (config as { events?: Record<string, { type?: string; config?: Record<string, unknown> }> } | undefined)?.events;
  const entry = events?.[adapterId];
  if (!entry || entry.type !== 'webhook') return undefined;
  const endpoint = entry.config?.endpoint as string | undefined;
  if (!endpoint) return undefined;
  return createWebhookEmitSink({
    endpoint,
    secret: entry.config?.secret as string | undefined,
    source: adapterId,
    log,
  });
}
