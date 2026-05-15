/**
 * V5 — Phase 4: Feasibility checks.
 *
 * Deterministic, contract-level checks that must hold before any planner
 * runs. Five rules, all driven by the canonical interpretation of clauses
 * (Phase 3). The pre-generation gate composes these with owner-coverage
 * and canonicalisation gaps into a single combined report.
 *
 * Hard clauses only — soft / narrative clauses are skipped.
 */

import type {
  AnchorClause,
  CanonicalisationGap,
  Clause,
  CountClause,
  CrossSurfaceClause,
  ReconciliationClause,
  TemporalClause,
} from '../contract/clause-types.js';

export type FeasibilityRuleId =
  | 'sum_identity'
  | 'population_coherence'
  | 'window_coherence'
  | 'anchor_uniqueness'
  | 'cross_surface_consistency';

export interface FeasibilityFailure {
  ruleId: FeasibilityRuleId;
  clauseIds: string[];
  /** Persona quotes implicated, in clauseIds order. */
  quotes: string[];
  /** Human-readable detail of the contradiction. */
  detail: string;
}

export interface FeasibilityResult {
  failures: FeasibilityFailure[];
}

export interface MissingOwnerFailure {
  clauseId: string;
  family: Clause['family'];
  quote: string;
  /** Rule id that came back `no-match` — anchors back to owners.ts. */
  ownerRuleId: string;
  detail: string;
}

export interface ContradictionAndCoverageReport {
  contradictions: FeasibilityFailure[];
  missingOwners: MissingOwnerFailure[];
  canonicalisationGaps: CanonicalisationGap[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Entry point — runs all 5 rules against the contract's clauses
// ---------------------------------------------------------------------------

export function runFeasibilityChecks(clauses: Clause[]): FeasibilityResult {
  const failures: FeasibilityFailure[] = [];
  const hard = clauses.filter((c) => c.strength === 'hard');

  failures.push(...checkSumIdentity(hard));
  failures.push(...checkPopulationCoherence(hard));
  failures.push(...checkWindowCoherence(hard));
  failures.push(...checkAnchorUniqueness(hard));
  failures.push(...checkCrossSurfaceConsistency(hard));

  return { failures };
}

// ---------------------------------------------------------------------------
// 1. Sum identity — reconciliation buckets must sum to headline ± tolerance
// ---------------------------------------------------------------------------

function checkSumIdentity(clauses: Clause[]): FeasibilityFailure[] {
  const failures: FeasibilityFailure[] = [];
  for (const c of clauses) {
    if (c.family !== 'reconciliation') continue;
    const recon = c as ReconciliationClause;
    const bucketSum = recon.buckets.reduce((s, b) => s + b.value, 0);
    const tolerance = recon.tolerance ?? 0;
    if (Math.abs(bucketSum - recon.headline) > tolerance) {
      failures.push({
        ruleId: 'sum_identity',
        clauseIds: [recon.id],
        quotes: [recon.quote],
        detail: `reconciliation ${recon.metric}: buckets sum to ${bucketSum}, headline is ${recon.headline} (tolerance ${tolerance}).`,
      });
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 2. Population coherence — same population + cohort rule cannot demand
//    contradictory counts
// ---------------------------------------------------------------------------

function checkPopulationCoherence(clauses: Clause[]): FeasibilityFailure[] {
  const failures: FeasibilityFailure[] = [];
  const byKey = new Map<string, Array<{ clause: CountClause; expected: number }>>();

  for (const c of clauses) {
    if (c.family !== 'count') continue;
    const count = c as CountClause;
    const ct = count.canonicalTarget;
    if (!ct || ct.populationId === 'unresolved') continue;
    const key = `${ct.populationId}::${stableStringify(ct.cohortRule)}::${stableStringify(ct.window)}`;
    const bucket = byKey.get(key) ?? [];
    bucket.push({ clause: count, expected: count.expected });
    byKey.set(key, bucket);
  }

  for (const [, group] of byKey) {
    if (group.length < 2) continue;
    // Disagreement if any pair differs beyond max tolerance of the two.
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const tol = Math.max(a.clause.tolerance ?? 0, b.clause.tolerance ?? 0);
        if (Math.abs(a.expected - b.expected) > tol) {
          failures.push({
            ruleId: 'population_coherence',
            clauseIds: [a.clause.id, b.clause.id],
            quotes: [a.clause.quote, b.clause.quote],
            detail: `Same canonical cohort demands incompatible counts: ${a.expected} vs ${b.expected} (tolerance ${tol}).`,
          });
        }
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 3. Window coherence — same metric over the same window cannot require
//    contradictory deltas
// ---------------------------------------------------------------------------

function checkWindowCoherence(clauses: Clause[]): FeasibilityFailure[] {
  const failures: FeasibilityFailure[] = [];
  const byKey = new Map<
    string,
    Array<{ clause: TemporalClause; expected: number; tolerance: number }>
  >();

  for (const c of clauses) {
    if (c.family !== 'temporal') continue;
    if ((c as TemporalClause).kind !== 'window') continue;
    const tw = c as Extract<TemporalClause, { kind: 'window' }>;
    const ct = tw.canonicalTarget;
    if (!ct || ct.populationId === 'unresolved' || !ct.window) continue;
    const key = `${ct.populationId}::${ct.metricId ?? ''}::${ct.window.start}::${ct.window.end}::${stableStringify(ct.cohortRule)}`;
    const bucket = byKey.get(key) ?? [];
    bucket.push({
      clause: tw,
      expected: tw.expected,
      tolerance: tw.tolerance ?? 0,
    });
    byKey.set(key, bucket);
  }

  for (const [, group] of byKey) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const tol = Math.max(a.tolerance, b.tolerance);
        if (Math.abs(a.expected - b.expected) > tol) {
          failures.push({
            ruleId: 'window_coherence',
            clauseIds: [a.clause.id, b.clause.id],
            quotes: [a.clause.quote, b.clause.quote],
            detail: `Same canonical metric over same window demands incompatible expecteds: ${a.expected} vs ${b.expected} (tolerance ${tol}).`,
          });
        }
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 4. Anchor uniqueness — each anchor id must resolve to one customer + dates
// ---------------------------------------------------------------------------

function checkAnchorUniqueness(clauses: Clause[]): FeasibilityFailure[] {
  const failures: FeasibilityFailure[] = [];
  const byId = new Map<string, AnchorClause[]>();
  for (const c of clauses) {
    if (c.family !== 'anchor') continue;
    const anchor = c as AnchorClause;
    const list = byId.get(anchor.anchorId) ?? [];
    list.push(anchor);
    byId.set(anchor.anchorId, list);
  }

  for (const [anchorId, group] of byId) {
    if (group.length < 2) continue;
    for (let i = 1; i < group.length; i++) {
      const a = group[0]!;
      const b = group[i]!;
      const customerMismatch =
        (a.customer ?? '') !== (b.customer ?? '') && a.customer != null && b.customer != null;
      const dateMismatch = !shallowEqualRecord(a.dates, b.dates);
      if (customerMismatch || dateMismatch) {
        failures.push({
          ruleId: 'anchor_uniqueness',
          clauseIds: [a.id, b.id],
          quotes: [a.quote, b.quote],
          detail: `Anchor "${anchorId}" bound to incompatible customer/dates by two clauses.`,
        });
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 5. Cross-surface consistency — clauses on identity scope X agree on
//    field/values
// ---------------------------------------------------------------------------

function checkCrossSurfaceConsistency(clauses: Clause[]): FeasibilityFailure[] {
  const failures: FeasibilityFailure[] = [];
  const byEntity = new Map<string, CrossSurfaceClause[]>();
  for (const c of clauses) {
    if (c.family !== 'cross_surface') continue;
    const cs = c as CrossSurfaceClause;
    const list = byEntity.get(cs.entity) ?? [];
    list.push(cs);
    byEntity.set(cs.entity, list);
  }

  for (const [entity, group] of byEntity) {
    if (group.length < 2) continue;
    for (let i = 1; i < group.length; i++) {
      const a = group[0]!;
      const b = group[i]!;
      if (a.field !== b.field) continue;
      if (a.valueA === b.valueA && a.valueB === b.valueB) continue;
      failures.push({
        ruleId: 'cross_surface_consistency',
        clauseIds: [a.id, b.id],
        quotes: [a.quote, b.quote],
        detail: `Entity "${entity}" field "${a.field}" demanded with incompatible (valueA, valueB) pairs.`,
      });
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

function shallowEqualRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    const k = aKeys[i]!;
    if (a[k] !== b[k]) return false;
  }
  return true;
}
