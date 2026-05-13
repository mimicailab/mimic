import type {
  Blueprint,
  EntityArchetype,
  EntityArchetypeConfig,
} from '../types/blueprint.js';
import type { BlueprintPatch, PatchOp } from '../types/claim.js';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Apply a BlueprintPatch to a Blueprint in place. Returns the same blueprint
 * reference for chaining, plus a list of any ops that couldn't be applied
 * (silent failures would let the next audit catch the same problem).
 */
export function applyBlueprintPatch(
  blueprint: Blueprint,
  patch: BlueprintPatch,
): { blueprint: Blueprint; failures: Array<{ op: PatchOp; reason: string }> } {
  const failures: Array<{ op: PatchOp; reason: string }> = [];
  for (const op of patch.ops) {
    try {
      applyOp(blueprint, op);
    } catch (err) {
      failures.push({
        op,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { blueprint, failures };
}

// ---------------------------------------------------------------------------
// Per-op dispatch
// ---------------------------------------------------------------------------

function applyOp(blueprint: Blueprint, op: PatchOp): void {
  switch (op.op) {
    case 'set_field':
      applySetField(blueprint, op.path, op.value);
      return;
    case 'set_vary':
      applySetVary(blueprint, op.path, op.variation);
      return;
    case 'set_count':
      applySetCount(blueprint, op.path, op.count);
      return;
    case 'add_archetype':
      applyAddArchetype(blueprint, op.surface, op.target, op.archetype);
      return;
    case 'remove_archetype':
      applyRemoveArchetype(blueprint, op.surface, op.target, op.label);
      return;
  }
}

// ---------------------------------------------------------------------------
// set_field — write into archetype.fields or any other addressable scalar
// ---------------------------------------------------------------------------

function applySetField(blueprint: Blueprint, path: string, value: unknown): void {
  const resolved = resolvePathParent(blueprint, path);
  // `value === undefined` means "clear this slot". Use `delete` so iterators
  // over the parent (e.g. `Object.entries(vary)`) don't see a stray key
  // pointing at `undefined` — the expander crashes when it reads `.type` on
  // it. The deterministic-repair pinned-field path emits this op to clear a
  // vary entry after writing the constant; before this guard, that produced
  // `vary[field] === undefined` and the next re-expansion blew up.
  if (value === undefined) {
    delete resolved.parent[resolved.lastKey];
    return;
  }
  setNestedField(resolved.parent, resolved.lastKey, value);
}

// ---------------------------------------------------------------------------
// set_vary — write a FieldVariation into archetype.vary
// ---------------------------------------------------------------------------

function applySetVary(blueprint: Blueprint, path: string, variation: unknown): void {
  const resolved = resolvePathParent(blueprint, path);
  setNestedField(resolved.parent, resolved.lastKey, variation);
}

// ---------------------------------------------------------------------------
// set_count — write `count` on an archetype OR on the archetype config
// ---------------------------------------------------------------------------

function applySetCount(blueprint: Blueprint, path: string, count: number): void {
  const target = resolvePath(blueprint, path);
  if (target == null || typeof target !== 'object') {
    throw new Error(`set_count: path "${path}" did not resolve to an object`);
  }
  (target as Record<string, unknown>).count = count;
}

// ---------------------------------------------------------------------------
// add_archetype — push a new archetype onto an archetype config's list,
// creating the config if it doesn't exist yet
// ---------------------------------------------------------------------------

function applyAddArchetype(
  blueprint: Blueprint,
  surface: 'db' | 'api',
  target: string,
  archetype: EntityArchetype,
): void {
  const config = getOrCreateConfig(blueprint, surface, target);
  // Replace any existing archetype with the same label (idempotent)
  const idx = config.archetypes.findIndex((a) => a.label === archetype.label);
  if (idx >= 0) config.archetypes.splice(idx, 1);
  config.archetypes.push(archetype);
}

// ---------------------------------------------------------------------------
// remove_archetype — drop by label
// ---------------------------------------------------------------------------

function applyRemoveArchetype(
  blueprint: Blueprint,
  surface: 'db' | 'api',
  target: string,
  label: string,
): void {
  const config = getConfig(blueprint, surface, target);
  if (!config) return;
  const idx = config.archetypes.findIndex((a) => a.label === label);
  if (idx >= 0) config.archetypes.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// Path resolver — supports dotted paths and `[label]` archetype lookup
//
// Examples:
//   data.entityArchetypes.users.archetypes[pro-churn-risk].fields.last_login_at
//   data.apiEntityArchetypes.stripe.price[starter-monthly]
//   data.apiEntityArchetypes.stripe.price[starter-monthly].vary.unit_amount
//
// `archetypes[<label>]` and `<resource>[<label>]` both look up an archetype
// by its `label` field within an EntityArchetypeConfig.
// ---------------------------------------------------------------------------

function resolvePath(blueprint: Blueprint, path: string): unknown {
  const segments = parsePath(path);
  let cur: unknown = blueprint;
  for (const seg of segments) {
    if (cur == null) return undefined;
    cur = stepInto(cur, seg);
  }
  return cur;
}

function resolvePathParent(
  blueprint: Blueprint,
  path: string,
): { parent: Record<string, unknown>; lastKey: string } {
  const segments = parsePath(path);
  if (segments.length === 0) throw new Error(`empty path`);
  const last = segments[segments.length - 1]!;
  if (last.kind !== 'key') {
    throw new Error(
      `Path "${path}" ends in a label lookup; can't assign — point at a field within the archetype instead.`,
    );
  }
  let cur: unknown = blueprint;
  for (let i = 0; i < segments.length - 1; i++) {
    cur = stepInto(cur, segments[i]!);
    if (cur == null) {
      // Auto-vivify intermediate objects only for `key` steps; `label` steps
      // mean the archetype must already exist.
      const next = segments[i + 1];
      if (next?.kind === 'key' && segments[i]!.kind === 'key') {
        const parent = pathParentForVivify(blueprint, segments, i);
        const k = segments[i]!.value;
        parent[k] = {};
        cur = parent[k];
      } else {
        throw new Error(`set_field: path "${path}" can't be resolved — segment ${i} missing`);
      }
    }
  }
  if (cur == null || typeof cur !== 'object') {
    throw new Error(`set_field: parent of "${path}" is not an object`);
  }
  return { parent: cur as Record<string, unknown>, lastKey: last.value };
}

function pathParentForVivify(
  blueprint: Blueprint,
  segments: PathSegment[],
  i: number,
): Record<string, unknown> {
  let cur: unknown = blueprint;
  for (let j = 0; j < i; j++) {
    cur = stepInto(cur, segments[j]!);
  }
  if (cur == null || typeof cur !== 'object') {
    throw new Error(`vivify: parent at depth ${i} is not an object`);
  }
  return cur as Record<string, unknown>;
}

type PathSegment =
  | { kind: 'key'; value: string }
  | { kind: 'label'; value: string };

function parsePath(path: string): PathSegment[] {
  const out: PathSegment[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === '.') {
      i++;
      continue;
    }
    if (path[i] === '[') {
      const end = path.indexOf(']', i + 1);
      if (end < 0) throw new Error(`unmatched [ in path "${path}"`);
      out.push({ kind: 'label', value: path.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < path.length && path[j] !== '.' && path[j] !== '[') j++;
    out.push({ kind: 'key', value: path.slice(i, j) });
    i = j;
  }
  return out;
}

function stepInto(cur: unknown, seg: PathSegment): unknown {
  if (cur == null) return undefined;
  if (seg.kind === 'key') {
    if (typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    return (cur as Record<string, unknown>)[seg.value];
  }
  // label lookup — works on EntityArchetypeConfig.archetypes (array)
  // or directly when the parent is the archetypes array
  if (Array.isArray(cur)) {
    return (cur as { label?: string }[]).find((a) => a?.label === seg.value);
  }
  if (typeof cur === 'object') {
    const obj = cur as Record<string, unknown>;
    // Allow `<resource>[label]` where parent is the archetype config
    if (Array.isArray(obj.archetypes)) {
      return (obj.archetypes as { label?: string }[]).find((a) => a?.label === seg.value);
    }
  }
  return undefined;
}

function setNestedField(parent: Record<string, unknown>, key: string, value: unknown): void {
  parent[key] = value;
}

// ---------------------------------------------------------------------------
// Archetype-config accessors (used by add/remove archetype ops)
// ---------------------------------------------------------------------------

function getConfig(
  blueprint: Blueprint,
  surface: 'db' | 'api',
  target: string,
): EntityArchetypeConfig | undefined {
  if (surface === 'db') {
    return blueprint.data.entityArchetypes?.[target];
  }
  const dot = target.indexOf('.');
  if (dot < 0) return undefined;
  const adapter = target.slice(0, dot);
  const resource = target.slice(dot + 1);
  return blueprint.data.apiEntityArchetypes?.[adapter]?.[resource];
}

function getOrCreateConfig(
  blueprint: Blueprint,
  surface: 'db' | 'api',
  target: string,
): EntityArchetypeConfig {
  const existing = getConfig(blueprint, surface, target);
  if (existing) return existing;
  if (surface === 'db') {
    blueprint.data.entityArchetypes = blueprint.data.entityArchetypes ?? {};
    const config: EntityArchetypeConfig = { count: 0, archetypes: [] };
    blueprint.data.entityArchetypes[target] = config;
    return config;
  }
  const dot = target.indexOf('.');
  if (dot < 0) {
    throw new Error(`add_archetype: api target "${target}" must be "<adapter>.<resource>"`);
  }
  const adapter = target.slice(0, dot);
  const resource = target.slice(dot + 1);
  blueprint.data.apiEntityArchetypes = blueprint.data.apiEntityArchetypes ?? {};
  blueprint.data.apiEntityArchetypes[adapter] = blueprint.data.apiEntityArchetypes[adapter] ?? {};
  const config: EntityArchetypeConfig = { count: 0, archetypes: [] };
  blueprint.data.apiEntityArchetypes[adapter][resource] = config;
  return config;
}
