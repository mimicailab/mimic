/**
 * Spec-driven list-envelope splice.
 *
 * Stripe-style APIs expose nested collections as list envelopes on the
 * parent body:
 *
 *   subscription.items = {
 *     object: "list",
 *     data: [ { id, object: "subscription_item", subscription, price, ... }, ... ],
 *     has_more: false,
 *     url: "..."
 *   }
 *
 * Our codegen already encodes the envelope SHAPE in the parent spec's
 * field default, and the child shape as a sibling resource. The expander
 * already generates both as flat resources. This module detects the
 * pattern from the spec at startup, then after expansion + cross-ref
 * resolution it groups children by their back-link and splices them into
 * each parent body's envelope `data` array.
 *
 * No spec changes, no adapter changes, no LLM changes — the expander
 * just respects what the spec already says.
 */
import type { AdapterResourceSpecs, ResourceSpec, ResourceFieldSpec } from '../types/adapter.js';
import type { ApiResponseSet, ApiResponse } from '../types/dataset.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface SpliceRule {
  /** Parent resource key (e.g. "subscription"). */
  parentResource: string;
  /** Field name on the parent body whose default is a list envelope (e.g. "items"). */
  envelopeField: string;
  /** Child resource key holding the rows that fill the envelope (e.g. "subscription_item"). */
  childResource: string;
  /** Field name on the child carrying the parent id (e.g. "subscription"). */
  backLinkField: string;
}

/**
 * A list-envelope default looks like Stripe's canonical empty list:
 *   { object: "list", data: [], has_more: <boolean>, url: <string> }
 * Only `object === "list"` and a present `data` array are load-bearing.
 */
function isListEnvelopeDefault(def: unknown): boolean {
  if (def === null || typeof def !== 'object' || Array.isArray(def)) return false;
  const obj = def as Record<string, unknown>;
  return obj.object === 'list' && Array.isArray(obj.data);
}

/**
 * Singularize Stripe's common collection field names. The mapping is short
 * by design — the codepath has a structural fallback below for anything
 * irregular. Add entries here only when both naming + structural detection
 * miss a real case.
 */
function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('xes') || word.endsWith('ses') || word.endsWith('zes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * Find the sibling resource that fills `parentResource.envelopeField`.
 *
 * Two paths, in order:
 *  1. Naming convention: `<parent>_<singular(envelopeField)>` is the standard
 *     Stripe form (`subscription` + `_` + `item` = `subscription_item`).
 *  2. Structural fallback: scan siblings for one whose `object` field default
 *     equals the singular of the envelope field (Stripe's child objects all
 *     declare their object type as a constant default).
 */
function findChildResource(
  parentResource: string,
  envelopeField: string,
  resources: Record<string, ResourceSpec>,
): string | null {
  const singular = singularize(envelopeField);
  const conventional = `${parentResource}_${singular}`;
  if (resources[conventional]) return conventional;

  // Structural fallback — look for a sibling whose `object` field default is
  // exactly the singular form. Stripe's children all do this.
  for (const [name, res] of Object.entries(resources)) {
    if (name === parentResource) continue;
    const objField = res.fields.object;
    if (objField && objField.default === singular) return name;
  }
  return null;
}

/**
 * Find the field on the child resource that holds the parent id.
 *
 * Three signals, in order:
 *  1. A field whose `ref` matches the parent resource — most precise.
 *  2. A field whose name equals the parent resource name (Stripe's convention:
 *     `subscription_item.subscription`, `invoice_line_item.invoice`).
 *  3. A field whose name equals `<parent>_id` — common in non-Stripe specs.
 */
function findBackLinkField(
  parentResource: string,
  childSpec: ResourceSpec,
): string | null {
  for (const [name, field] of Object.entries(childSpec.fields)) {
    if (field.ref === parentResource) return name;
  }
  if (childSpec.fields[parentResource]) return parentResource;
  const idForm = `${parentResource}_id`;
  if (childSpec.fields[idForm]) return idForm;
  return null;
}

/**
 * Walk a single adapter's resources and emit one SpliceRule per detectable
 * list envelope. Pure, deterministic, no I/O.
 */
export function detectSpliceRules(
  specs: AdapterResourceSpecs,
): SpliceRule[] {
  const rules: SpliceRule[] = [];

  for (const [parentResource, parentSpec] of Object.entries(specs.resources)) {
    for (const [fieldName, fieldSpec] of Object.entries(parentSpec.fields)) {
      if (fieldSpec.type !== 'object') continue;
      if (!isListEnvelopeDefault(fieldSpec.default)) continue;

      const childResource = findChildResource(parentResource, fieldName, specs.resources);
      if (!childResource) continue;

      const childSpec = specs.resources[childResource]!;
      const backLinkField = findBackLinkField(parentResource, childSpec);
      if (!backLinkField) continue;

      rules.push({ parentResource, envelopeField: fieldName, childResource, backLinkField });
    }
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Splice
// ---------------------------------------------------------------------------

/**
 * Apply detected splice rules to an adapter's ApiResponseSet.
 *
 * For each rule: group the child resource's response bodies by the value of
 * their back-link field; for each parent, set its envelope field to a fresh
 * list envelope containing the matching children.
 *
 * Mutates `responseSet` in place. Returns the number of parent envelopes
 * populated and the total child rows attached.
 *
 * Notes:
 *  - Children remain accessible as a top-level sibling resource — this is
 *    the same semantics Stripe exposes: items are reachable both inline on
 *    the subscription and via the subscription_items endpoint. No dedup.
 *  - Children with no matching parent (dangling back-link) are left as
 *    siblings only; they do not appear inside any envelope.
 *  - Parents with no matching children get an explicit empty envelope —
 *    a legitimate result (a subscription with zero items is rare but valid).
 */
export function applySpliceRules(
  responseSet: ApiResponseSet,
  rules: SpliceRule[],
): { envelopesPopulated: number; childrenAttached: number } {
  let envelopesPopulated = 0;
  let childrenAttached = 0;

  for (const rule of rules) {
    const parents = responseSet.responses[rule.parentResource];
    const children = responseSet.responses[rule.childResource];
    if (!parents || !children) continue;

    // Build child index: parent-id (string) → child bodies.
    const childIndex = new Map<string, Array<Record<string, unknown>>>();
    for (const childResp of children) {
      const body = childResp.body as Record<string, unknown> | null | undefined;
      if (!body) continue;
      const key = body[rule.backLinkField];
      if (typeof key !== 'string' || key.length === 0) continue;
      const bucket = childIndex.get(key);
      if (bucket) bucket.push(body);
      else childIndex.set(key, [body]);
    }

    for (const parentResp of parents) {
      const parentBody = parentResp.body as Record<string, unknown> | null | undefined;
      if (!parentBody) continue;
      const parentId = parentBody.id;
      if (typeof parentId !== 'string' || parentId.length === 0) continue;

      const matching = childIndex.get(parentId) ?? [];

      // Preserve any url/has_more from the existing envelope (if the LLM or
      // codegen set them); only overwrite `data` and `object`. Keeps the
      // envelope shape stable across surfaces.
      const existing =
        (parentBody[rule.envelopeField] as Record<string, unknown> | undefined) ?? {};
      parentBody[rule.envelopeField] = {
        ...existing,
        object: 'list',
        data: matching,
        has_more: false,
      };
      envelopesPopulated += 1;
      childrenAttached += matching.length;
    }
  }

  return { envelopesPopulated, childrenAttached };
}

// ---------------------------------------------------------------------------
// Public entry — wire one call into the expander
// ---------------------------------------------------------------------------

/**
 * Convenience entry: detect + apply for every adapter in a per-persona
 * apiResponses bundle. Safe to call when no specs are passed (no-op).
 */
export function spliceListEnvelopes(
  apiResponses: Record<string, ApiResponseSet>,
  resourceSpecs: Record<string, AdapterResourceSpecs> | undefined,
): void {
  if (!resourceSpecs) return;

  let totalEnvelopes = 0;
  let totalChildren = 0;
  const ruleSummary: string[] = [];

  for (const [adapterId, responseSet] of Object.entries(apiResponses)) {
    const specs = resourceSpecs[adapterId];
    if (!specs) continue;
    const rules = detectSpliceRules(specs);
    if (rules.length === 0) continue;
    const { envelopesPopulated, childrenAttached } = applySpliceRules(responseSet, rules);
    totalEnvelopes += envelopesPopulated;
    totalChildren += childrenAttached;
    for (const r of rules) {
      ruleSummary.push(`${adapterId}.${r.parentResource}.${r.envelopeField}←${r.childResource}.${r.backLinkField}`);
    }
  }

  if (totalEnvelopes > 0) {
    logger.debug(
      `EnvelopeSplice: ${totalEnvelopes} envelope(s) populated with ${totalChildren} child row(s) ` +
        `via ${ruleSummary.length} rule(s): ${ruleSummary.join(', ')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers exported for tests
// ---------------------------------------------------------------------------

export const __testing__ = {
  isListEnvelopeDefault,
  singularize,
  findChildResource,
  findBackLinkField,
};
// Re-export the field spec type for test convenience.
export type { ResourceFieldSpec };
