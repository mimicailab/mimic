import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { unixNow, generateId } from '@mimicai/adapter-sdk';
import { SCHEMA_DEFAULTS } from '../generated/schemas.js';

const NS = 'chargebee:subscriptions';

export function buildCreateSubscriptionHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const customerId = (req.params as Record<string, string>)['customer_id'];
    const body = (req.body ?? {}) as Record<string, unknown>;
    const factory = SCHEMA_DEFAULTS['subscription']!;
    const id = (body.id as string) || generateId('', 14);
    const now = unixNow();
    const obj = factory({
      id,
      customer_id: customerId,
      created_at: now,
      updated_at: now,
      resource_version: now * 1000,
      ...body,
    });
    store.set(NS, id, obj);
    // This route is under /customers/ so the hook would wrap as {customer:...}.
    // Pre-wrap as {subscription:...} and signal hook to skip via __skipWrap.
    return reply.code(200).send({ subscription: obj, __skipWrap: true });
  };
}

// ---------------------------------------------------------------------------
// The lifecycle state machines (cancel / reactivate / pause / resume) were
// migrated to the declarative behavior pack at src/behavior/subscriptions.yaml
// and are now mounted via mountBehaviorPacks. Only the creation handler — which
// relies on the schema-default factory and response pre-wrapping — remains here
// as a documented escape hatch.
// ---------------------------------------------------------------------------
