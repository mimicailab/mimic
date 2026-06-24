/**
 * Webhook hub — process-level registry of webhook deliveries and an inbox of
 * emitted events.
 *
 * Lives in core (not the SDK) so the MockServer can expose control routes
 * (`/__mimic/events`, `/__mimic/flush`) without depending on the adapter SDK.
 * The actual delivery logic (signing, envelopes, fetch) lives in
 * `@mimicai/adapter-sdk`'s WebhookDelivery, which records into this hub and
 * registers its flush callback here.
 *
 * This is what makes webhooks CI-grade: in `sync` mode events are buffered and
 * delivered only when `flush()` is called, so tests never race async delivery.
 */

export interface RecordedWebhook {
  /** Event id (deterministic `evt_<n>` in deterministic mode). */
  id: string;
  /** Event type, e.g. `payment_intent.succeeded`. */
  type: string;
  /** Event timestamp (unix seconds). */
  created: number;
  /** Adapter that produced the event. */
  source?: string;
  /** Whether the event has been delivered to its endpoint. */
  delivered: boolean;
}

export class WebhookHub {
  /** Every event emitted this process, in order. */
  readonly inbox: RecordedWebhook[] = [];
  private flushers = new Set<() => Promise<void>>();

  /** Register a buffered delivery's flush callback (sync mode). */
  registerFlusher(fn: () => Promise<void>): () => void {
    this.flushers.add(fn);
    return () => this.flushers.delete(fn);
  }

  /** Record an emitted event in the inbox. */
  record(rec: RecordedWebhook): void {
    this.inbox.push(rec);
  }

  /** Mark a recorded event as delivered. */
  markDelivered(id: string): void {
    const rec = this.inbox.find((r) => r.id === id);
    if (rec) rec.delivered = true;
  }

  /** Number of buffered, not-yet-delivered events. */
  get pending(): number {
    return this.inbox.filter((r) => !r.delivered).length;
  }

  /** Flush every registered buffered delivery; returns the count flushed. */
  async flush(): Promise<number> {
    const before = this.pending;
    for (const fn of this.flushers) await fn();
    return before;
  }

  /** Clear all state — for test isolation. */
  reset(): void {
    this.inbox.length = 0;
    this.flushers.clear();
  }
}

/** Process-wide singleton used by adapters and the MockServer control routes. */
export const webhookHub = new WebhookHub();
