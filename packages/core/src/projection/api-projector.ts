/**
 * V5 — Phase 7: Generic API projector (billing / CRM / analytics).
 *
 * Translates canonical entities + lifecycle events into API response
 * objects for one (adapter, resource) coordinate. Uses `ProjectorHints`
 * declared by the adapter (via `adapter-sdk/src/projector-hints.ts`) to
 * pick the surface id prefix; falls back to a deterministic default
 * when nothing is declared.
 *
 * Per-adapter specialisation (Stripe `customer.subscriptions.data`,
 * Chargebee invoice-line marshalling, etc.) is left to follow-on work —
 * Phase 7's contract is just "for each canonical entity that has a slot
 * on this surface, emit one response body". Phase 9's shape validator
 * surfaces any required-field gaps as `local-only` failures which the
 * Phase 10 shape repair can backfill.
 */

import { getProjectorHints } from './projector-hints.js';
import type { ApiResponse, ApiResponseSet } from '../types/dataset.js';
import type { WorldState } from '../world/world-state.js';
import { getPersonaIdPrefix } from './identity-prefix.js';

export function projectApi(
  state: WorldState,
  adapter: string,
  resource: string,
): ApiResponseSet['responses'][string] {
  const hints = getProjectorHints(adapter);
  const idPrefix =
    hints.idPrefixes?.[resource] ?? hints.idPrefix ?? defaultPrefix(resource);
  const requiredDefaults = hints.requiredDefaults?.[resource] ?? {};
  const responses: ApiResponse[] = [];

  for (const [, entities] of state.populations) {
    for (const entity of entities) {
      const slot = state.identities
        .get(entity.id)
        ?.slots.find((s) => s.surface === adapter && s.objectKind === resource);
      if (!slot) continue;

      const id = mintApiId(idPrefix, slot.deterministicSeed, state.personaIndex);
      const body: Record<string, unknown> = {
        id,
        ...requiredDefaults,
        ...entity.attrs,
      };
      if (body.status == null) body.status = entity.lifecycle.status;
      if (body.created == null && body.created_at == null) {
        body.created_at = entity.lifecycle.start;
      }
      responses.push({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body,
        personaId: 'v5',
      });
    }
  }

  return responses;
}

function defaultPrefix(resource: string): string {
  return `${resource.slice(0, 3).toLowerCase()}_`;
}

function mintApiId(prefix: string, seed: string, personaIndex: number): string {
  const tail = seed.replace(/[^a-z0-9]/gi, '').slice(-10).toLowerCase();
  return `${getPersonaIdPrefix(prefix, personaIndex)}${tail}`;
}
