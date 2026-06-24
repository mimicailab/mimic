/**
 * Webhook delivery — turns behavior-pack `emit` declarations into outbound
 * HTTP webhooks, with deterministic, CI-grade delivery modes.
 *
 * Modes:
 *   - `async` (default): fire-and-forget on emit, like production.
 *   - `sync`: buffer events; deliver only when `flush()` is called (or the
 *     MockServer's `POST /__mimic/flush` control route fires). Removes timing
 *     races so webhook-driven tests are reproducible.
 *
 * Determinism: with `deterministic: true`, event ids are `evt_<n>` and
 * timestamps are `seed + n` (seed defaults to a fixed epoch), so the same run
 * produces byte-identical envelopes every time.
 *
 * Every event is recorded in the shared `webhookHub` inbox (in core), which the
 * MockServer exposes via `GET /__mimic/events`.
 */

import { createHmac } from 'node:crypto';
import { generateId } from '@mimicai/core';
import { webhookHub, type WebhookHub } from '@mimicai/core';
import { unixNow } from '../format-helpers.js';
import type { EmitSink } from './interpreter.js';

export type EnvelopeStyle = 'stripe' | 'generic';
export type DeliveryMode = 'async' | 'sync';

/** Fixed base epoch for deterministic timestamps (2024-01-01T00:00:00Z). */
const DETERMINISTIC_EPOCH = 1704067200;

export interface WebhookSinkOptions {
  endpoint?: string;
  secret?: string;
  signatureHeader?: string;
  envelope?: EnvelopeStyle;
  /** `async` (fire-and-forget) or `sync` (buffer until flush). Default `async`. */
  mode?: DeliveryMode;
  /** Deterministic event ids/timestamps (for reproducible tests). */
  deterministic?: boolean;
  /** Base timestamp for deterministic mode (default fixed epoch). */
  seed?: number;
  source?: string;
  log?: (msg: string) => void;
  /** Hub to record into (defaults to the shared singleton; injectable for tests). */
  hub?: WebhookHub;
}

function buildEnvelope(style: EnvelopeStyle, id: string, created: number, type: string, data: unknown): Record<string, unknown> {
  if (style === 'generic') {
    return { id, type, created, data };
  }
  return {
    id,
    object: 'event',
    api_version: '2024-06-20',
    created,
    type,
    data: { object: data },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  };
}

function sign(payload: string, secret: string, ts: number): string {
  const v1 = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${v1}`;
}

/**
 * A configured webhook delivery channel. Use `.sink` as the behavior EmitSink;
 * call `.flush()` (sync mode) to deliver buffered events.
 */
export class WebhookDelivery {
  readonly sink: EmitSink;
  private seq = 0;
  private buffer: Array<{ id: string; type: string; payload: string; ts: number }> = [];
  private readonly hub: WebhookHub;
  private readonly mode: DeliveryMode;

  constructor(private readonly opts: WebhookSinkOptions) {
    this.hub = opts.hub ?? webhookHub;
    this.mode = opts.mode ?? 'async';
    if (this.mode === 'sync') this.hub.registerFlusher(() => this.flush());

    const log = opts.log ?? ((m: string) => console.log(m));
    const sigHeader = opts.signatureHeader ?? 'Stripe-Signature';
    const style: EnvelopeStyle = opts.envelope ?? 'stripe';
    const src = opts.source ? `[${opts.source}] ` : '';

    this.sink = (event) => {
      const n = ++this.seq;
      const id = opts.deterministic ? `evt_${n}` : generateId('evt_', 24);
      const created = opts.deterministic ? (opts.seed ?? DETERMINISTIC_EPOCH) + n : unixNow();
      const envelope = buildEnvelope(style, id, created, event.type, event.data);
      const payload = JSON.stringify(envelope);

      this.hub.record({ id, type: event.type, created, source: opts.source, delivered: false });

      if (this.mode === 'sync') {
        this.buffer.push({ id, type: event.type, payload, ts: created });
        return;
      }
      void this.deliver(id, event.type, payload, created, sigHeader, style, src, log);
    };
  }

  /** Number of buffered, not-yet-delivered events (sync mode). */
  get pending(): number {
    return this.buffer.length;
  }

  /** Deliver all buffered events in order (sync mode). */
  async flush(): Promise<void> {
    const log = this.opts.log ?? ((m: string) => console.log(m));
    const sigHeader = this.opts.signatureHeader ?? 'Stripe-Signature';
    const style: EnvelopeStyle = this.opts.envelope ?? 'stripe';
    const src = this.opts.source ? `[${this.opts.source}] ` : '';
    const items = this.buffer;
    this.buffer = [];
    for (const it of items) {
      await this.deliver(it.id, it.type, it.payload, it.ts, sigHeader, style, src, log);
    }
  }

  private async deliver(
    id: string, type: string, payload: string, ts: number,
    sigHeader: string, _style: EnvelopeStyle, src: string, log: (m: string) => void,
  ): Promise<void> {
    // No endpoint: still mark delivered so the inbox reflects completion
    // (useful for tests that assert on the inbox without a real server).
    if (!this.opts.endpoint) {
      this.hub.markDelivered(id);
      return;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.opts.secret) headers[sigHeader] = sign(payload, this.opts.secret, ts);
    try {
      const res = await fetch(this.opts.endpoint, { method: 'POST', headers, body: payload });
      this.hub.markDelivered(id);
      log(`${src}webhook → ${type} → ${this.opts.endpoint} (${res.status})`);
    } catch (err) {
      log(`${src}webhook FAILED ${type} → ${this.opts.endpoint}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Build an EmitSink that delivers events to a webhook endpoint.
 * (Convenience wrapper around WebhookDelivery; flush is via the hub.)
 */
export function createWebhookEmitSink(opts: WebhookSinkOptions): EmitSink {
  return new WebhookDelivery(opts).sink;
}

/**
 * Resolve a webhook EmitSink from a Mimic config `events` block for an adapter.
 *
 * Config shape (mimic.json):
 *   "events": { "stripe": { "type": "webhook", "config": {
 *      "endpoint": "...", "secret": "...", "mode": "sync", "deterministic": true } } }
 */
export function webhookSinkFromConfig(
  config: unknown,
  adapterId: string,
  opts?: { log?: (msg: string) => void; defaultEnvelope?: EnvelopeStyle },
): EmitSink | undefined {
  const events = (config as { events?: Record<string, { type?: string; config?: Record<string, unknown> }> } | undefined)?.events;
  const entry = events?.[adapterId];
  if (!entry || entry.type !== 'webhook') return undefined;
  const c = entry.config ?? {};
  const endpoint = c.endpoint as string | undefined;
  // Allow sync/manual buffering even without an endpoint (inbox-only testing).
  if (!endpoint && c.mode !== 'sync') return undefined;
  return createWebhookEmitSink({
    endpoint,
    secret: c.secret as string | undefined,
    signatureHeader: c.signatureHeader as string | undefined,
    envelope: (c.envelope as EnvelopeStyle | undefined) ?? opts?.defaultEnvelope,
    mode: (c.mode as DeliveryMode | undefined),
    deterministic: c.deterministic as boolean | undefined,
    seed: c.seed as number | undefined,
    source: adapterId,
    log: opts?.log,
  });
}
