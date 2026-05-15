/**
 * V5 — Phase 6: Population planner.
 *
 * Owns: count clauses, distribution clauses on populations, non-revenue
 * aggregates. Materialises canonical entities into the world state, tagging
 * them with cohort labels and seeding their attributes.
 *
 * Deterministic by construction. Reads:
 *   - the slice of obligation nodes whose ownerId is 'population'
 *   - the canonical contract clauses (for cohort rules + distribution mixes)
 *   - the world-state PRNG (for tie-breaking deterministic shuffles)
 *
 * Writes the `populations` map in the world state.
 */

import type {
  AggregateClause,
  Clause,
  DistributionClause,
  SemanticTarget,
} from '../contract/clause-types.js';
import type { PersonaContract } from '../contract/persona-contract.js';
import { resolveSemanticTarget } from '../contract/semantic-capabilities.js';
import type { Filter, FilterOp, ResourceTarget } from '../types/claim.js';
import type {
  CanonicalEntity,
  CohortId,
  LifecycleStatus,
  SurfaceBinding,
} from '../world/entity.js';
import type { WorldState, WorldStateDelta } from '../world/world-state.js';
import type { ObligationGraph, ObligationNode } from './obligation-graph.js';
import type { PlannerEvidence, PlannerResult } from './planner-result.js';

export function runPopulationPlanner(
  contract: PersonaContract,
  graph: ObligationGraph,
  state: WorldState,
): PlannerResult {
  const nodes = graph.byOwnerId.get('population') ?? [];
  const evidence: PlannerEvidence[] = [];

  // 1) Walk count obligations: ensure each (populationId, cohortKey) has
  //    the expected number of entities. Tracks per-cohort counts so a
  //    later count obligation on the same cohort is idempotent.
  const perPopulation = new Map<string, CanonicalEntity[]>();

  for (const node of nodes) {
    if (node.budgetClaim.kind !== 'count') continue;
    const populationId = primaryPopulation(node);
    if (!populationId) continue;

    const expected = node.budgetClaim.expected;
    const clause = contract.clauses.find((c) => c.id === node.clauseId);
    const entities = perPopulation.get(populationId) ?? [];

    ensureCount(entities, populationId, clause, expected);
    if (clause) attachProjectionBindings(matchingEntities(entities, clause), populationId, clause);
    perPopulation.set(populationId, entities);
    evidence.push({
      clauseId: node.clauseId,
      observed: {
        populationId,
        count: expected,
        cohorts: cohortsFor(clause),
        matched: matchingEntities(entities, clause).length,
      },
      note: `population planner satisfied ${expected} matching entity(ies) in ${populationId}`,
    });
  }

  // 2) Walk distribution obligations: assign cohort/tier attribute values
  //    over the entities so the distribution holds. Distribution mixes
  //    pin a SECOND attribute (typically `tier`) onto entities that
  //    population planner already created in step 1.
  for (const node of nodes) {
    if (node.budgetClaim.kind !== 'distribution') continue;
    const populationId = primaryPopulation(node);
    if (!populationId) continue;
    const entities = perPopulation.get(populationId) ?? [];
    const clause = contract.clauses.find((c) => c.id === node.clauseId) as
      | DistributionClause
      | undefined;
    if (!clause) continue;

    if (matchingEntities(entities, clause).length === 0) {
      seedDistributionPopulation(entities, populationId, clause);
    }

    attachProjectionBindings(matchingEntities(entities, clause), populationId, clause);
    applyDistribution(matchingEntities(entities, clause), clause);
    perPopulation.set(populationId, entities);
    evidence.push({
      clauseId: node.clauseId,
      observed: { populationId, field: clause.field, values: clause.values },
      note: `population planner applied distribution on ${clause.field}`,
    });
  }

  // 3) Walk non-revenue aggregates owned by population. These pin a
  //    derived attribute on every entity in the population (e.g. avg
  //    login_count = N). We simply stamp the expected/aggregate hint as
  //    an attribute so downstream projectors can read it.
  for (const node of nodes) {
    if (node.budgetClaim.kind !== 'aggregate') continue;
    const populationId = primaryPopulation(node);
    if (!populationId) continue;
    const entities = perPopulation.get(populationId) ?? [];
    const clause = contract.clauses.find((c) => c.id === node.clauseId) as
      | AggregateClause
      | undefined;
    if (!clause) continue;

    ensureAggregatePopulation(entities, populationId, clause);
    const matching = matchingEntities(entities, clause);
    if (matching.length === 0) continue;

  attachProjectionBindings(matching, populationId, clause);
    const claim = node.budgetClaim;
    stampAggregate(matching, clause.field, claim.metricId, claim.expected, claim.op);
    perPopulation.set(populationId, entities);
    evidence.push({
      clauseId: node.clauseId,
      observed: {
        populationId,
        metricId: claim.metricId,
        expected: claim.expected,
        matched: matching.length,
      },
      note: `population planner stamped ${claim.metricId} over ${matching.length} matching entity(ies)`,
    });
  }

  assignAnchorCustomers(contract, perPopulation);

  // Threading the PRNG into deterministic shuffles is a future hook —
  // for Phase 6's deterministic skeleton we don't need to consume it.
  void state.prng;

  const delta: WorldStateDelta = {
    populations: [...perPopulation.entries()].map(([populationId, entities]) => ({
      populationId,
      entities,
    })),
  };

  return { delta, evidence };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function primaryPopulation(node: ObligationNode): string | null {
  const id = node.canonicalEntities[0];
  return id ?? null;
}

function ensureCount(
  entities: CanonicalEntity[],
  populationId: string,
  clause: Clause | undefined,
  expected: number,
): void {
  if (!clause) return;

  // Compute the current matching count ONCE, then track it incrementally
  // through the hydrate + mint loops. Recomputing matchingEntities() inside
  // each iteration is O(N) per call, which made the whole step O(M·N²) and
  // dominated runtime on big personas (~15 min on 3.8k entities × 29
  // population clauses).
  let matched = matchingEntities(entities, clause).length;
  matched = hydrateExistingEntities(entities, clause, expected, matched);
  while (matched < expected) {
    entities.push(makeEntity(populationId, entities.length + 1, clause));
    matched++;
  }
}

function cohortsFor(clause: Clause | undefined): CohortId[] {
  if (!clause) return [];
  const cohorts = new Set<CohortId>();
  const rule = clause.canonicalTarget?.cohortRule;
  if (rule) {
    for (const [k, v] of Object.entries(rule)) {
      if (typeof v === 'string') cohorts.add(`${k}:${v}`);
    }
  }
  if ((clause as { semanticTarget?: { facets?: { tier?: string } } }).semanticTarget?.facets?.tier) {
    cohorts.add(`tier:${(clause as { semanticTarget?: { facets?: { tier?: string } } }).semanticTarget!.facets!.tier!}`);
  }
  return [...cohorts];
}

function seedAttrsFor(clause: Clause | undefined, entityIndex: number): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  if (!clause) return attrs;

  const rule = clause.canonicalTarget?.cohortRule;
  if (rule) {
    applyFilterSeed(attrs, rule);
  }
  applySemanticSeed(attrs, clause, entityIndex);

  if (shouldDefaultExternalId(clause) && readSeedField(attrs, 'external_id') === undefined) {
    setSeedField(attrs, 'external_id', buildExternalIdSeed(clause, entityIndex));
  }
  return attrs;
}

function applyDistribution(entities: CanonicalEntity[], clause: DistributionClause): void {
  const total = entities.length;
  if (total === 0) return;
  const entries = Object.entries(clause.values).sort((a, b) => b[1] - a[1]);
  // Only entities with an UNSET field are eligible for distribution
  // assignment. Entities that an earlier clause explicitly pinned to
  // `null` (e.g. orphan-count's `billing_platform: null`) are off-limits
  // — overwriting them would invalidate the pinning clause.
  const unassigned = entities.filter((entity) => readEntityField(entity, clause.field) === undefined);
  let cursor = 0;
  for (const [value, pct] of entries) {
    const targetCount = Math.round((pct / 100) * total);
    const existing = entities.filter((entity) => valuesEqual(readEntityField(entity, clause.field), value)).length;
    const needed = Math.max(0, targetCount - existing);
    for (let i = 0; i < needed && cursor < unassigned.length; i++, cursor++) {
      const entity = unassigned[cursor]!;
      setSeedField(entity.attrs, clause.field, value);
      entity.cohorts.add(`${clause.field}:${value}`);
    }
  }
}

function ensureAggregatePopulation(
  entities: CanonicalEntity[],
  populationId: string,
  clause: AggregateClause,
): void {
  let matched = matchingEntities(entities, clause).length;
  matched = hydrateExistingEntities(entities, clause, 1, matched);
  if (matched > 0) return;
  entities.push(makeEntity(populationId, entities.length + 1, clause));
}

function stampAggregate(
  entities: CanonicalEntity[],
  field: string,
  metricId: string,
  expected: number,
  op: 'sum' | 'avg',
): void {
  if (op === 'avg') {
    for (const entity of entities) {
      if (readSeedField(entity.attrs, field) === undefined) {
        setSeedField(entity.attrs, field, expected);
      }
      setSeedField(entity.attrs, `agg.${metricId}`, expected);
    }
    return;
  }

  // SUM op: when a broader aggregate runs after a narrower one already
  // stamped some entities (e.g. `total-mrr` on status=active AFTER
  // `stripe-mrr-sum` on billing_platform=stripe), preserve the existing
  // values and only distribute the REMAINDER across entities that don't
  // yet have the field set. Without this, the broader aggregate
  // overwrites the per-cohort stamps and every narrower clause fails.
  let alreadyStamped = 0;
  const unstamped: CanonicalEntity[] = [];
  for (const entity of entities) {
    const v = readSeedField(entity.attrs, field);
    if (typeof v === 'number') {
      alreadyStamped += v;
    } else {
      unstamped.push(entity);
    }
  }
  const remaining = expected - alreadyStamped;
  const values = splitExpected(remaining, unstamped.length);
  for (let i = 0; i < unstamped.length; i++) {
    const entity = unstamped[i]!;
    const value = values[i] ?? 0;
    setSeedField(entity.attrs, field, value);
    setSeedField(entity.attrs, `agg.${metricId}`, value);
  }
}

function splitExpected(expected: number, count: number): number[] {
  if (count <= 0) return [];
  if (!Number.isInteger(expected)) {
    return Array.from({ length: count }, () => expected / count);
  }
  const base = Math.trunc(expected / count);
  let remainder = expected - base * count;
  return Array.from({ length: count }, (_, idx) => {
    if (remainder === 0) return base;
    const step = remainder > 0 ? 1 : -1;
    if ((remainder > 0 && idx < remainder) || (remainder < 0 && idx < Math.abs(remainder))) {
      return base + step;
    }
    return base;
  });
}

function seedDistributionPopulation(
  entities: CanonicalEntity[],
  populationId: string,
  clause: DistributionClause,
): void {
  const seedTotal = 100;
  for (let i = entities.length; i < seedTotal; i++) {
    entities.push(makeEntity(populationId, i + 1, clause));
  }
}

function makeEntity(
  populationId: string,
  entityIndex: number,
  clause: Clause,
): CanonicalEntity {
  const attrs = seedAttrsFor(clause, entityIndex);
  const kind = entityKindFor(clause, populationId);
  return {
    id: `${populationId}/e${entityIndex}`,
    populationId,
    kind,
    cohorts: new Set(cohortsFor(clause)),
    attrs,
    surfaceBindings: surfaceBindingsForClause(clause),
    lifecycle: {
      start: clause.canonicalTarget?.window?.start ?? '2026-01-01',
      status: initialLifecycleStatus(readSeedField(attrs, 'status')),
    },
  };
}

function hydrateExistingEntities(
  entities: CanonicalEntity[],
  clause: Clause,
  expected: number,
  matched: number,
): number {
  // Cohort-only seed: drop per-entity-index defaults (external_id,
  // customer_reference) so canAdoptSeed doesn't reject every existing
  // entity on a fabricated id collision. Per-index fields stay on the
  // newly-minted entities from makeEntity; they're not adoption criteria.
  //
  // `matched` is threaded through (NOT recomputed) so this stays O(N) per
  // clause instead of O(N²). Every successful applySeed turns one
  // previously-unmatched entity into a matching one — increment by 1.
  const seed = cohortSeedFor(clause);
  for (const entity of entities) {
    if (matched >= expected) return matched;
    if (matchesClause(entity, clause)) continue;
    if (!canAdoptSeed(entity, seed)) continue;
    applySeed(entity, seed, clause);
    matched++;
  }
  return matched;
}

function cohortSeedFor(clause: Clause): Record<string, unknown> {
  // The cohort seed includes ONLY fields derived from the clause's cohort
  // rule + semantic attributes. It deliberately excludes the per-entity
  // positional defaults (`ext_<pop>_<idx>`, `customer_reference`) that
  // `seedAttrsFor` stamps for fresh entities — those are id strings, not
  // adoption criteria, and forcing them onto the seed makes canAdoptSeed
  // reject every existing entity whose id doesn't happen to be "1".
  //
  // A cohort rule that EXPLICITLY pins external_id (e.g. `null` or
  // `{is_null: true}`) is honoured via applyFilterSeed above — we don't
  // strip those, only the per-index `ext_*_1` placeholders.
  const attrs: Record<string, unknown> = {};
  const rule = clause.canonicalTarget?.cohortRule;
  if (rule) applyFilterSeed(attrs, rule);
  applySemanticSeed(attrs, clause, 1);
  const ext = (attrs as Record<string, unknown>).external_id;
  if (typeof ext === 'string' && /^ext_.*_\d+$/.test(ext)) {
    delete (attrs as Record<string, unknown>).external_id;
  }
  const cref = (attrs as Record<string, unknown>).customer_reference;
  if (typeof cref === 'string') {
    delete (attrs as Record<string, unknown>).customer_reference;
  }
  return attrs;
}

function canAdoptSeed(entity: CanonicalEntity, seed: Record<string, unknown>): boolean {
  for (const [path, desired] of leafEntries(seed)) {
    const current = readEntityField(entity, path);
    if (desired === null) continue;
    if (current !== undefined && !valuesEqual(current, desired)) return false;
  }
  return true;
}

function applySeed(
  entity: CanonicalEntity,
  seed: Record<string, unknown>,
  clause: Clause,
): void {
  for (const [path, desired] of leafEntries(seed)) {
    const current = readEntityField(entity, path);
    if (desired === null || current === undefined) {
      setSeedField(entity.attrs, path, desired);
    }
  }
  for (const cohort of cohortsFor(clause)) {
    entity.cohorts.add(cohort);
  }
  mergeSurfaceBindings(entity, surfaceBindingsForClause(clause));
  entity.kind ??= entityKindFor(clause, entity.populationId);
}

function attachProjectionBindings(
  entities: CanonicalEntity[],
  populationId: string,
  clause: Clause,
): void {
  const bindings = surfaceBindingsForClause(clause);
  const kind = entityKindFor(clause, populationId);
  for (const entity of entities) {
    mergeSurfaceBindings(entity, bindings);
    entity.kind ??= kind;
  }
}

function mergeSurfaceBindings(entity: CanonicalEntity, bindings: SurfaceBinding[]): void {
  if (bindings.length === 0) return;
  const existing = entity.surfaceBindings ?? [];
  const seen = new Set(existing.map((binding) => `${binding.surface}::${binding.objectKind}`));
  const next = [...existing];

  for (const binding of bindings) {
    const key = `${binding.surface}::${binding.objectKind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(binding);
  }

  entity.surfaceBindings = next;
}

function entityKindFor(clause: Clause, populationId: string): string {
  const semanticTarget = (clause as { semanticTarget?: SemanticTarget }).semanticTarget;
  if (semanticTarget) return semanticTarget.kind;
  const binding = targetToSurfaceBinding((clause as { target?: ResourceTarget }).target);
  if (binding) return `${binding.surface}:${binding.objectKind}`;
  return populationId;
}

function surfaceBindingsForClause(clause: Clause): SurfaceBinding[] {
  const seen = new Set<string>();
  const bindings: SurfaceBinding[] = [];

  const add = (binding: SurfaceBinding | null): void => {
    if (!binding) return;
    const key = `${binding.surface}::${binding.objectKind}`;
    if (seen.has(key)) return;
    seen.add(key);
    bindings.push(binding);
  };

  add(targetToSurfaceBinding((clause as { target?: ResourceTarget }).target));

  const semanticTarget = (clause as { semanticTarget?: SemanticTarget }).semanticTarget;
  if (semanticTarget) {
    add(targetToSurfaceBinding(resolveSemanticTarget(semanticTarget)?.target));
  }

  return bindings;
}

function targetToSurfaceBinding(target: ResourceTarget | undefined): SurfaceBinding | null {
  if (!target) return null;
  if (target.surface === 'db') return { surface: 'db', objectKind: target.name };
  const dot = target.name.indexOf('.');
  if (dot < 0) return null;
  return { surface: target.name.slice(0, dot), objectKind: target.name.slice(dot + 1) };
}

function matchingEntities(entities: CanonicalEntity[], clause: Clause | undefined): CanonicalEntity[] {
  if (!clause) return [];
  const rule = clause.canonicalTarget?.cohortRule;
  if (!rule) return entities;
  return entities.filter((entity) => matchesFilter(entity, rule));
}

function matchesClause(entity: CanonicalEntity, clause: Clause | undefined): boolean {
  return matchingEntities([entity], clause).length === 1;
}

function matchesFilter(entity: CanonicalEntity, filter: Filter): boolean {
  for (const [field, predicate] of Object.entries(filter)) {
    if (!matchesPredicate(readEntityField(entity, field), predicate)) return false;
  }
  return true;
}

function matchesPredicate(value: unknown, predicate: unknown): boolean {
  if (predicate === null) {
    // A bare-null predicate means "explicitly null" — distinct from
    // "field absent". A persona that says "no corresponding billing
    // platform record" is asking for the value `null`, not the
    // schemaless undefined that every other entity carries.
    return value === null;
  }
  if (typeof predicate !== 'object' || Array.isArray(predicate)) {
    return valuesEqual(value, predicate);
  }

  const op = predicate as FilterOp;
  if ('eq' in op) return valuesEqual(value, op.eq);
  if ('neq' in op) return !valuesEqual(value, op.neq);
  if ('in' in op) return op.in.some((candidate) => valuesEqual(value, candidate));
  if ('nin' in op) return !op.nin.some((candidate) => valuesEqual(value, candidate));
  if ('gte' in op) return compareValues(value, op.gte) >= 0;
  if ('lte' in op) return compareValues(value, op.lte) <= 0;
  if ('gt' in op) return compareValues(value, op.gt) > 0;
  if ('lt' in op) return compareValues(value, op.lt) < 0;
  if ('is_null' in op) {
    const isNull = value === null || value === undefined || value === '';
    return isNull === op.is_null;
  }
  if ('age_days_gte' in op || 'age_days_lte' in op) {
    const ms = toMillis(value);
    if (ms == null) return false;
    const ageDays = (Date.now() - ms) / (24 * 3600 * 1000);
    if ('age_days_gte' in op) return ageDays >= op.age_days_gte;
    if ('age_days_lte' in op) return ageDays <= op.age_days_lte;
  }
  return false;
}

function compareValues(value: unknown, expected: number | string): number {
  if (typeof expected === 'number') {
    return toNumber(value) - expected;
  }
  const left = toMillis(value);
  const right = toMillis(expected);
  if (left != null && right != null) return left - right;
  return String(value).localeCompare(String(expected));
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left)) return left.some((entry) => valuesEqual(entry, right));
  if (left === right) return true;
  if (left == null && right == null) return true;
  if (typeof left === 'number' && typeof right === 'string') return left === Number(right);
  if (typeof left === 'string' && typeof right === 'number') return Number(left) === right;
  return false;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function readEntityField(entity: CanonicalEntity, path: string): unknown {
  const fromAttrs = readSeedField(entity.attrs, path);
  if (fromAttrs !== undefined) return fromAttrs;
  if (path === 'status') return entity.lifecycle.status;
  if (path === 'created' || path === 'created_at') return entity.lifecycle.start;
  return undefined;
}

function applyFilterSeed(attrs: Record<string, unknown>, filter: Filter): void {
  for (const [field, predicate] of Object.entries(filter)) {
    const seeded = seedValueForPredicate(predicate);
    if (seeded !== undefined) setSeedField(attrs, field, seeded);
  }
}

function seedValueForPredicate(predicate: unknown): unknown {
  if (predicate === null || typeof predicate !== 'object' || Array.isArray(predicate)) {
    return predicate;
  }

  const op = predicate as FilterOp;
  if ('eq' in op) return op.eq;
  if ('in' in op && op.in.length === 1) return op.in[0];
  if ('is_null' in op && op.is_null) return null;
  return undefined;
}

function applySemanticSeed(
  attrs: Record<string, unknown>,
  clause: Clause,
  entityIndex: number,
): void {
  const semanticTarget = (clause as { semanticTarget?: SemanticTarget }).semanticTarget;
  if (!semanticTarget) return;

  if (semanticTarget.kind === 'billing_customer_cohort') {
    const tier = semanticTarget.facets?.tier;
    if (semanticTarget.facets?.billingState === 'paying' && readSeedField(attrs, 'status') === undefined) {
      setSeedField(attrs, 'status', 'active');
    }
    if (semanticTarget.facets?.billingState === 'free' && readSeedField(attrs, 'status') === undefined) {
      setSeedField(attrs, 'status', 'free');
    }
    if (readSeedField(attrs, 'billing_platform') === undefined) {
      setSeedField(attrs, 'billing_platform', semanticTarget.adapter);
    }
    if (!tier) return;

    const price = defaultTierAmountCents(tier);
    setIfMissing(attrs, 'tier', tier);
    setIfMissing(attrs, 'plan', tier);
    setIfMissing(attrs, 'nickname', `${tier}-monthly`);
    setIfMissing(attrs, 'lookup_key', `${tier}-monthly`);
    setIfMissing(attrs, 'items.data.price.lookup_key', `${tier}-monthly`);
    setIfMissing(attrs, 'items.data.price.nickname', `${tier}-monthly`);
    if (price != null) {
      setIfMissing(attrs, 'unit_amount', price);
      setIfMissing(attrs, 'mrr', price);
      setIfMissing(attrs, 'mrr_cents', price);
    }
    setIfMissing(attrs, 'customer_reference', `${semanticTarget.adapter}-customer-${entityIndex}`);
    return;
  }

  if (readSeedField(attrs, 'status') === undefined) {
    setSeedField(attrs, 'status', 'active');
  }
  if (semanticTarget.facets?.billingState === 'free') {
    setIfMissing(attrs, 'plan', 'free');
  }
  if (semanticTarget.facets?.linkage === 'unlinked') {
    setIfMissing(attrs, 'billing_platform', null);
    setIfMissing(attrs, 'external_id', null);
  }

  const tier = semanticTarget.facets?.tier;
  if (!tier) return;

  const price = defaultTierAmountCents(tier);
  setIfMissing(attrs, 'tier', tier);
  setIfMissing(attrs, 'plan', tier);
  if (price != null) {
    setIfMissing(attrs, 'mrr', price);
    setIfMissing(attrs, 'mrr_cents', price);
  }
}

function defaultTierAmountCents(tier: string): number | undefined {
  switch (tier.toLowerCase()) {
    case 'starter':
      return 2900;
    case 'pro':
      return 7900;
    case 'enterprise':
      return 49900;
    default:
      return undefined;
  }
}

function shouldDefaultExternalId(clause: Clause): boolean {
  const populationId = clause.canonicalTarget?.populationId ?? '';
  return populationId === 'db:users'
    || populationId === 'paying_customers'
    || populationId === 'billing_customers'
    || populationId === 'free_customers'
    || populationId.startsWith('product:');
}

function buildExternalIdSeed(clause: Clause, entityIndex: number): string {
  const populationId = clause.canonicalTarget?.populationId ?? 'entity';
  const base = populationId.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return `ext_${base}_${entityIndex}`;
}

function setIfMissing(attrs: Record<string, unknown>, path: string, value: unknown): void {
  if (readSeedField(attrs, path) === undefined) {
    setSeedField(attrs, path, value);
  }
}

function setSeedField(target: Record<string, unknown>, path: string, value: unknown): void {
  if (!path.includes('.')) {
    target[path] = value;
    return;
  }

  const parts = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cursor[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
}

function readSeedField(target: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return target[path];

  const parts = path.split('.');
  let cursor: unknown = target;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function leafEntries(
  target: Record<string, unknown>,
  prefix = '',
): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(target)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...leafEntries(value as Record<string, unknown>, path));
    } else {
      out.push([path, value]);
    }
  }
  return out;
}

function initialLifecycleStatus(status: unknown): LifecycleStatus {
  switch (status) {
    case 'active':
    case 'trialing':
    case 'paused':
    case 'churned':
    case 'past_due':
    case 'pending':
      return status;
    default:
      return 'active';
  }
}

function assignAnchorCustomers(
  contract: PersonaContract,
  perPopulation: Map<string, CanonicalEntity[]>,
): void {
  const customers = contract.clauses
    .filter((clause): clause is Extract<Clause, { family: 'anchor' }> => clause.family === 'anchor')
    .map((clause) => clause.customer)
    .filter((customer): customer is string => typeof customer === 'string' && customer.trim().length > 0);
  if (customers.length === 0) return;

  const entities = [...perPopulation.entries()]
    .sort((a, b) => anchorPopulationRank(a[0]) - anchorPopulationRank(b[0]) || a[0].localeCompare(b[0]))
    .flatMap(([, population]) => population);

  const assigned = new Set<string>();
  for (const customer of customers) {
    const existing = entities.find((entity) => anchorNameMatches(entity, customer));
    if (existing) {
      assigned.add(existing.id);
      continue;
    }
    const candidate = entities.find((entity) => !assigned.has(entity.id));
    if (!candidate) break;
    setIfMissing(candidate.attrs, 'name', customer);
    setIfMissing(candidate.attrs, 'company', customer);
    assigned.add(candidate.id);
  }
}

function anchorPopulationRank(populationId: string): number {
  if (/customer|users|subscription/i.test(populationId)) return 0;
  if (/invoice|charge|payment/i.test(populationId)) return 1;
  return 2;
}

function anchorNameMatches(entity: CanonicalEntity, customer: string): boolean {
  const target = normaliseText(customer);
  return [readEntityField(entity, 'name'), readEntityField(entity, 'company')]
    .some((value) => normaliseText(value) === target);
}

function normaliseText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
}
