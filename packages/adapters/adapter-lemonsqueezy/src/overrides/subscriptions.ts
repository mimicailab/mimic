import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { lsNotFound, lsStateError } from '../lemonsqueezy-errors.js';

const NS = 'lemonsqueezy:subscriptions';

function wrapJsonApi(obj: Record<string, unknown>): unknown {
  const { id, ...attributes } = obj;
  return {
    jsonapi: { version: '1.0' },
    links: { self: `https://api.lemonsqueezy.com/v1/subscriptions/${id}` },
    data: {
      type: 'subscriptions',
      id: String(id),
      attributes,
      relationships: {},
    },
  };
}

function extractBody(body: Record<string, unknown>): Record<string, unknown> {
  const data = body.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object' && data.attributes) {
    return data.attributes as Record<string, unknown>;
  }
  return body;
}

/**
 * DELETE /subscriptions/:id → cancel (set status to 'cancelled')
 */
export function buildCancelHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = store.get<Record<string, unknown>>(NS, id);

    if (!existing) {
      return reply.code(404).send(lsNotFound('subscriptions', id));
    }

    if (existing.status === 'cancelled' || existing.status === 'expired') {
      return reply.code(422).send(
        lsStateError(`Subscription is already ${existing.status}`),
      );
    }

    const updated = {
      ...existing,
      status: 'cancelled',
      status_formatted: 'Cancelled',
      cancelled: true,
      ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.set(NS, id, updated);
    return reply.code(200).send(wrapJsonApi(updated));
  };
}

/**
 * PATCH /subscriptions/:id → update subscription
 * Handles: pause/unpause, cancel/uncancel, variant change, trial extension
 */
export function buildUpdateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = store.get<Record<string, unknown>>(NS, id);

    if (!existing) {
      return reply.code(404).send(lsNotFound('subscriptions', id));
    }

    const body = extractBody((req.body ?? {}) as Record<string, unknown>);

    let updated = { ...existing };

    // Handle pause
    if (body.pause !== undefined) {
      if (body.pause === null) {
        // Unpause
        updated.pause = null;
        updated.status = 'active';
        updated.status_formatted = 'Active';
      } else {
        const pause = body.pause as Record<string, unknown>;
        updated.pause = pause;
        updated.status = 'paused';
        updated.status_formatted = 'Paused';
      }
    }

    // Handle cancel/uncancel
    if (body.cancelled !== undefined) {
      if (body.cancelled) {
        updated.status = 'cancelled';
        updated.status_formatted = 'Cancelled';
        updated.cancelled = true;
        updated.ends_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      } else {
        // Uncancel — only if not past ends_at
        updated.status = 'active';
        updated.status_formatted = 'Active';
        updated.cancelled = false;
        updated.ends_at = null;
      }
    }

    // Handle variant change
    if (body.variant_id !== undefined) {
      updated.variant_id = body.variant_id;
    }

    // Handle trial extension
    if (body.trial_ends_at !== undefined) {
      updated.trial_ends_at = body.trial_ends_at;
    }

    // Handle billing anchor change
    if (body.billing_anchor !== undefined) {
      updated.billing_anchor = body.billing_anchor;
    }

    updated.updated_at = new Date().toISOString();
    store.set(NS, id, updated);
    return reply.code(200).send(wrapJsonApi(updated));
  };
}
