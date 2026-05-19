/**
 * Spec-driven object-ref embedding.
 *
 * Stripe-style APIs frequently return a referenced resource as a fully
 * embedded object on the parent, not just an id string. For example,
 * `subscription_item.price` is the full Price object, not `"price_xxx"`.
 *
 * Our codegen already declares this in the spec:
 *
 *   "price": {
 *     type: "object",         // embed, not id
 *     ref: "price",           // pulled from the price resource
 *     default: { id: "", object: "price", unit_amount: null, ... }   // empty Price skeleton
 *   }
 *
 * The assembler leaves the field at its `default` (the empty skeleton).
 * This module walks every response body post-expansion, finds object-ref
 * fields, picks a target row from the matching resource pool, and copies
 * its body in. Single-level only — nested object-refs inside the embedded
 * body are NOT recursively embedded (mirrors Stripe's default behaviour;
 * without explicit `expand[]=field.subfield` the inner refs stay as ids).
 *
 * No spec changes, no LLM changes. Reads what the spec already says.
 */
import type { AdapterResourceSpecs } from '../types/adapter.js';
import type { ApiResponseSet, ApiResponse } from '../types/dataset.js';
import { SeededRandom } from './seed-random.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface EmbedRule {
  /** Resource whose body carries the object-ref field (e.g. "subscription_item"). */
  parentResource: string;
  /** Field name on that body to embed into (e.g. "price"). */
  fieldName: string;
  /** Resource key to pull target rows from (e.g. "price"). */
  targetResource: string;
}

/**
 * Walk an adapter's spec and emit one EmbedRule per `type:object + ref:` field.
 */
export function detectEmbedRules(specs: AdapterResourceSpecs): EmbedRule[] {
  const rules: EmbedRule[] = [];
  for (const [parentResource, parentSpec] of Object.entries(specs.resources)) {
    for (const [fieldName, fieldSpec] of Object.entries(parentSpec.fields)) {
      if (fieldSpec.type !== 'object') continue;
      if (!fieldSpec.ref) continue;
      if (!specs.resources[fieldSpec.ref]) continue;
      rules.push({
        parentResource,
        fieldName,
        targetResource: fieldSpec.ref,
      });
    }
  }
  return rules;
}

// ---------------------------------------------------------------------------
// Embed
// ---------------------------------------------------------------------------

interface EmbedStats {
  embedsApplied: number;
  embedsSkipped: number;
}

/**
 * Apply detected embed rules to an adapter's ApiResponseSet.
 *
 * For each rule: build an index of target bodies by id; for each parent body
 * carrying the embed field, pick a target body and copy it in.
 *
 * Mutates `responseSet` in place. The copy is shallow — bodies are owned
 * by the response set and we want any later edits to a target body to
 * propagate to the embedded copy. (A real Stripe response is a snapshot,
 * but at expansion time nothing edits target bodies anymore, so sharing
 * the reference is safe and saves memory.)
 *
 * Selection policy:
 *  - If the parent body's field is already a non-empty object with a real
 *    `id` (the LLM emitted a literal), look up that target by id. Honors
 *    archetype field overrides like `fields.price = { id: "price_starter" }`.
 *  - Otherwise pick a target uniformly at random from the pool, using the
 *    expander's seeded RNG so runs are reproducible.
 *  - If the pool is empty, skip — leave the default skeleton in place. The
 *    validator will see the empty shape and the conformance check can flag
 *    it. We never invent a target.
 */
export function applyEmbedRules(
  responseSet: ApiResponseSet,
  rules: EmbedRule[],
  rng: SeededRandom,
): EmbedStats {
  let embedsApplied = 0;
  let embedsSkipped = 0;

  for (const rule of rules) {
    const targets = responseSet.responses[rule.targetResource];
    if (!targets || targets.length === 0) continue;

    // Index targets by id for keyed lookups; keep an array form for random pick.
    const targetIndex = new Map<string, Record<string, unknown>>();
    const targetPool: Array<Record<string, unknown>> = [];
    for (const tResp of targets) {
      const body = tResp.body as Record<string, unknown> | null | undefined;
      if (!body) continue;
      targetPool.push(body);
      const id = body.id;
      if (typeof id === 'string' && id.length > 0) targetIndex.set(id, body);
    }
    if (targetPool.length === 0) continue;

    const parents = responseSet.responses[rule.parentResource];
    if (!parents) continue;

    for (const pResp of parents) {
      const body = pResp.body as Record<string, unknown> | null | undefined;
      if (!body) continue;
      const current = body[rule.fieldName];

      // String-guard, pool-aware. Two cases produce a string in an
      // object-ref field:
      //   (a) Real but unfulfilled — the assembler/cross-ref resolver
      //       wrote a valid target id (because the LLM's archetype
      //       declared the field as a string sequence, or the spec
      //       missed the type:object hint). The spec says this field
      //       should be the full embedded body; recover by looking up
      //       the id in the target pool and embedding it.
      //   (b) Deliberate literal that is NOT a known id — a persona
      //       author pinned an arbitrary string. Leave it untouched.
      if (typeof current === 'string') {
        const hit = targetIndex.get(current);
        if (hit) {
          body[rule.fieldName] = hit;
          embedsApplied += 1;
        } else {
          embedsSkipped += 1;
        }
        continue;
      }

      // Keyed lookup: the field is already an object with a real id (LLM
      // pinned a specific target via fieldOverrides). Look it up directly.
      if (
        current !== null &&
        typeof current === 'object' &&
        !Array.isArray(current)
      ) {
        const curId = (current as Record<string, unknown>).id;
        if (typeof curId === 'string' && curId.length > 0) {
          const hit = targetIndex.get(curId);
          if (hit) {
            body[rule.fieldName] = hit;
            embedsApplied += 1;
            continue;
          }
        }
      }

      // Random pick — same policy as the cross-ref resolver uses for
      // string refs, so embedded objects are distributed like id refs would
      // have been.
      body[rule.fieldName] = rng.pick(targetPool);
      embedsApplied += 1;
    }
  }

  return { embedsApplied, embedsSkipped };
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Convenience entry: detect + apply for every adapter in a per-persona
 * apiResponses bundle. Safe to call when no specs are passed (no-op).
 */
export function embedObjectRefs(
  apiResponses: Record<string, ApiResponseSet>,
  resourceSpecs: Record<string, AdapterResourceSpecs> | undefined,
  rng: SeededRandom,
): void {
  if (!resourceSpecs) return;

  let total = 0;
  const ruleSummary: string[] = [];

  for (const [adapterId, responseSet] of Object.entries(apiResponses)) {
    const specs = resourceSpecs[adapterId];
    if (!specs) continue;
    const rules = detectEmbedRules(specs);
    if (rules.length === 0) continue;
    const stats = applyEmbedRules(responseSet, rules, rng);
    total += stats.embedsApplied;
    for (const r of rules) {
      ruleSummary.push(`${adapterId}.${r.parentResource}.${r.fieldName}←${r.targetResource}`);
    }
  }

  if (total > 0) {
    logger.debug(
      `ObjectRefEmbed: ${total} field(s) embedded via ${ruleSummary.length} rule(s): ${ruleSummary.join(', ')}`,
    );
  }
}

// Helpers exported for tests
export const __testing__ = { detectEmbedRules, applyEmbedRules };
// Re-export ApiResponse type for test fixtures.
export type { ApiResponse };
