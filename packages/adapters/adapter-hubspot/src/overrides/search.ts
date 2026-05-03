/**
 * Generic search handler. HubSpot uses POST /<resource>/search across nearly
 * every CRM object type with the same body shape (filterGroups + filters).
 *
 * One handler covers all of them — given the resource it reads from the
 * appropriate StateStore namespace and applies the filterGroups.
 */

import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { applySearch, parseBody, sendList } from './_shared.js';
import type { SearchBody } from './_shared.js';

/**
 * Build a search handler scoped to a fixed StateStore namespace.
 *
 * Used directly for typed CRM endpoints (`/crm/contacts/{version}/contacts/search`,
 * `/crm/deals/{version}/deals/search`, etc.) where the resource is known
 * at registration time.
 */
export function buildSearchHandler(store: StateStore, ns: string): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req) as SearchBody;
    const items = store.list<Record<string, unknown>>(ns);
    const matched = applySearch(items, body);

    const limit = Math.min(body.limit ?? 10, 100);
    const after = body.after;
    let startIdx = 0;
    if (after) {
      const idx = matched.findIndex((x) => (x as { id?: string }).id === after);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = matched.slice(startIdx, startIdx + limit);
    const nextAfter = startIdx + limit < matched.length && page.length > 0
      ? ((page[page.length - 1] as { id?: string }).id ?? null)
      : null;

    return sendList(reply, page, nextAfter);
  };
}

/**
 * Build a search handler for the unified `/crm/objects/{version}/{objectType}/search`
 * endpoint — namespace is derived per-request from the `:objectType` path param.
 */
export function buildUnifiedSearchHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = ((req.params as Record<string, unknown> | null) ?? {}).objectType;
    const ns = `hubspot:crm_objects:${String(objectType ?? 'unknown')}`;
    const body = parseBody(req) as SearchBody;
    const items = store.list<Record<string, unknown>>(ns);
    const matched = applySearch(items, body);

    const limit = Math.min(body.limit ?? 10, 100);
    const after = body.after;
    let startIdx = 0;
    if (after) {
      const idx = matched.findIndex((x) => (x as { id?: string }).id === after);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = matched.slice(startIdx, startIdx + limit);
    const nextAfter = startIdx + limit < matched.length && page.length > 0
      ? ((page[page.length - 1] as { id?: string }).id ?? null)
      : null;

    return sendList(reply, page, nextAfter);
  };
}
