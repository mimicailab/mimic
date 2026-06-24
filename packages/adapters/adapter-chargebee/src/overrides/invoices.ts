import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { unixNow, generateId } from '@mimicai/adapter-sdk';
import { SCHEMA_DEFAULTS } from '../generated/schemas.js';

const NS = 'chargebee:invoices';

export function buildCreateInvoiceHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const factory = SCHEMA_DEFAULTS['invoice']!;
    const id = (body.id as string) || generateId('', 14);
    const now = unixNow();
    const obj = factory({
      id,
      created_at: now,
      updated_at: now,
      resource_version: now * 1000,
      ...body,
    });
    store.set(NS, id, obj);
    return reply.code(200).send(obj);
  };
}

// ---------------------------------------------------------------------------
// The lifecycle state machines (void / write_off / record_payment) were
// migrated to the declarative behavior pack at src/behavior/invoices.yaml and
// are now mounted via mountBehaviorPacks. Only the creation handler — which
// relies on the schema-default factory — remains here as an escape hatch.
// ---------------------------------------------------------------------------
