/**
 * V4.5 — Layer 2: Coverage planner.
 *
 * Deterministic, code-driven classification of every contract clause into
 * one of:
 *   - executable_now           lower directly into existing Claim/Anchor structures
 *   - executable_with_helper   needs a deterministic helper (reconciliation,
 *                              relative_gap, cross_surface_drift)
 *   - soft_only                nice-to-have, never blocks
 *   - unsupported_blocking     required but no rule covers it — the run stops
 *
 * The planner is intentionally a versioned RULE TABLE, not an LLM call.
 * Coverage planning by free-form classification is exactly the failure mode
 * V4.5 is trying to close — see private/v4.5.md "How the planner decides".
 */

import type { Clause } from './clause-types.js';
import type { CoverageDecision, CoverageReport, CoverageStatus } from './persona-contract.js';
import {
  describeSemanticTarget,
  resolveSemanticTarget,
  supportsSemanticDistribution,
} from './semantic-capabilities.js';

export const CAPABILITY_REGISTRY_VERSION = 'v4.5.1';

// ---------------------------------------------------------------------------
// Lowering / helper targets — referenced by rules, asserted by lowering.ts
// ---------------------------------------------------------------------------

export const LOWERING_TARGETS = {
  row_count: 'row_count.v1',
  aggregate_sum: 'aggregate_sum.v1',
  aggregate_avg: 'aggregate_avg.v1',
  distribution_pct: 'distribution_pct.v1',
  date_window: 'date_window.v1',
  anchor: 'anchor.v1',
} as const;

export const HELPER_TARGETS = {
  reconciliation: 'reconciliation.v1',
  temporal_gap: 'temporal_gap.v1',
  cross_surface_drift: 'cross_surface_drift.v1',
  semantic_distribution: 'semantic_distribution.v1',
} as const;

// ---------------------------------------------------------------------------
// Rule shape + table
// ---------------------------------------------------------------------------

type RuleDecision = Omit<CoverageDecision, 'clauseId' | 'family' | 'strength'>;

interface Rule {
  id: string;
  description: string;
  /** Returns null when the rule does not match. */
  match(clause: Clause): RuleDecision | null;
}

const RULES: Rule[] = [
  // ── count → row_count ──────────────────────────────────────────────────
  {
    id: 'count.exact',
    description: 'Count with a target and an expected integer → row_count claim',
    match(clause) {
      if (clause.family !== 'count') return null;
      if (typeof clause.expected !== 'number') return null;
      if (clause.semanticTarget) {
        const lowered = resolveSemanticTarget(clause.semanticTarget);
        if (!lowered) {
          return {
            status: clause.strength === 'soft' ? 'soft_only' : 'unsupported_blocking',
            ruleId: 'count.semantic_unsupported',
            explanation:
              `No capability registry entry can lower ${describeSemanticTarget(clause.semanticTarget)} ` +
              'into an executable count target.',
          };
        }
        return {
          status: 'executable_now',
          ruleId: 'count.semantic_cohort',
          loweringTarget: LOWERING_TARGETS.row_count,
          explanation: lowered.explanation,
        };
      }
      if (!clause.target) return null;
      return {
        status: 'executable_now',
        ruleId: 'count.exact',
        loweringTarget: LOWERING_TARGETS.row_count,
        explanation: 'Mapped to row_count claim.',
      };
    },
  },

  // ── aggregate → aggregate_sum/avg ──────────────────────────────────────
  {
    id: 'aggregate.sum_or_avg',
    description: 'Aggregate op sum/avg on a numeric field → aggregate claim',
    match(clause) {
      if (clause.family !== 'aggregate') return null;
      if (!clause.field) return null;
      if (clause.semanticTarget) {
        const lowered = resolveSemanticTarget(clause.semanticTarget);
        if (!lowered) {
          return {
            status: clause.strength === 'soft' ? 'soft_only' : 'unsupported_blocking',
            ruleId: 'aggregate.semantic_unsupported',
            explanation:
              `No capability registry entry can lower ${describeSemanticTarget(clause.semanticTarget)} ` +
              `for aggregate ${clause.op}.`,
          };
        }
        const target =
          clause.op === 'avg' ? LOWERING_TARGETS.aggregate_avg : LOWERING_TARGETS.aggregate_sum;
        return {
          status: 'executable_now',
          ruleId: 'aggregate.semantic_target',
          loweringTarget: target,
          explanation: `${lowered.explanation} Aggregate field ${clause.field} remains explicit.`,
        };
      }
      if (!clause.target) return null;
      const target =
        clause.op === 'avg' ? LOWERING_TARGETS.aggregate_avg : LOWERING_TARGETS.aggregate_sum;
      return {
        status: 'executable_now',
        ruleId: 'aggregate.sum_or_avg',
        loweringTarget: target,
        explanation: `Mapped to aggregate_${clause.op} claim on ${clause.field}.`,
      };
    },
  },

  // ── distribution → distribution_pct ────────────────────────────────────
  {
    id: 'distribution.categorical',
    description: 'Categorical distribution with bucket pct values → distribution_pct claim',
    match(clause) {
      if (clause.family !== 'distribution') return null;
      const buckets = Object.keys(clause.values ?? {});
      if (buckets.length === 0) return null;
      if (clause.semanticTarget) {
        if (!supportsSemanticDistribution(clause.semanticTarget, clause.semanticField)) {
          return {
            status: clause.strength === 'soft' ? 'soft_only' : 'unsupported_blocking',
            ruleId: 'distribution.semantic_unsupported',
            explanation:
              `No helper can evaluate semantic distribution ` +
              `${describeSemanticTarget(clause.semanticTarget)} by ${clause.semanticField ?? clause.field}.`,
          };
        }
        return {
          status: 'executable_with_helper',
          ruleId: 'distribution.semantic_helper',
          loweringTarget: HELPER_TARGETS.semantic_distribution,
          explanation:
            `Will be checked by ${HELPER_TARGETS.semantic_distribution} using canonical semantic buckets.`,
        };
      }
      return {
        status: 'executable_now',
        ruleId: 'distribution.categorical',
        loweringTarget: LOWERING_TARGETS.distribution_pct,
        explanation: `Mapped to distribution_pct claim across ${buckets.length} bucket(s).`,
      };
    },
  },

  // ── temporal window → date_window ──────────────────────────────────────
  {
    id: 'temporal.window',
    description: 'Date window on a resource → date_window claim',
    match(clause) {
      if (clause.family !== 'temporal' || clause.kind !== 'window') return null;
      if (!clause.field || !clause.min || !clause.max) return null;
      if (clause.semanticTarget) {
        const lowered = resolveSemanticTarget(clause.semanticTarget);
        if (!lowered) {
          return {
            status: clause.strength === 'soft' ? 'soft_only' : 'unsupported_blocking',
            ruleId: 'temporal.semantic_unsupported',
            explanation:
              `No capability registry entry can lower ${describeSemanticTarget(clause.semanticTarget)} ` +
              `for temporal window checks.`,
          };
        }
        return {
          status: 'executable_now',
          ruleId: 'temporal.semantic_window',
          loweringTarget: LOWERING_TARGETS.date_window,
          explanation: `${lowered.explanation} Window field ${clause.field} remains explicit.`,
        };
      }
      if (!clause.target) return null;
      return {
        status: 'executable_now',
        ruleId: 'temporal.window',
        loweringTarget: LOWERING_TARGETS.date_window,
        explanation: `Mapped to date_window claim on ${clause.field}.`,
      };
    },
  },

  // ── temporal relative_gap → helper ─────────────────────────────────────
  {
    id: 'temporal.relative_gap',
    description: 'AnchorA→AnchorB N-day offset → temporal_gap helper checker',
    match(clause) {
      if (clause.family !== 'temporal' || clause.kind !== 'relative_gap') return null;
      if (!clause.anchorA || !clause.anchorB || typeof clause.days !== 'number') return null;
      return {
        status: 'executable_with_helper',
        ruleId: 'temporal.relative_gap',
        loweringTarget: HELPER_TARGETS.temporal_gap,
        explanation: `Will be checked by ${HELPER_TARGETS.temporal_gap} after expansion.`,
      };
    },
  },

  // ── anchor → anchor.v1 ─────────────────────────────────────────────────
  {
    id: 'anchor.named',
    description: 'Named anchor with customer + dates → anchors block + binding via lowering',
    match(clause) {
      if (clause.family !== 'anchor') return null;
      if (!clause.anchorId || Object.keys(clause.dates ?? {}).length === 0) return null;
      return {
        status: 'executable_now',
        ruleId: 'anchor.named',
        loweringTarget: LOWERING_TARGETS.anchor,
        explanation: 'Mapped to an anchor entry; archetype must bind via the `anchor` field.',
      };
    },
  },

  // ── cross_surface → helper ─────────────────────────────────────────────
  {
    id: 'cross_surface.state_drift',
    description: 'Cross-surface state disagreement → cross_surface_drift helper checker',
    match(clause) {
      if (clause.family !== 'cross_surface') return null;
      if (!clause.entity || !clause.surfaceA || !clause.surfaceB || !clause.field) return null;
      return {
        status: 'executable_with_helper',
        ruleId: 'cross_surface.state_drift',
        loweringTarget: HELPER_TARGETS.cross_surface_drift,
        explanation: `Will be checked by ${HELPER_TARGETS.cross_surface_drift} after expansion.`,
      };
    },
  },

  // ── reconciliation → helper ────────────────────────────────────────────
  //
  // The reconciliation rule is the strictest: it covers only when the
  // clause carries an explicit metric, headline, and at least two named
  // buckets each with a target+field+op. Anything short of that becomes
  // unsupported_blocking — we will not guess our way into executability.
  {
    id: 'reconciliation.metric',
    description: 'Headline metric = sum of explicit named buckets → reconciliation helper',
    match(clause) {
      if (clause.family !== 'reconciliation') return null;
      if (!clause.metric || typeof clause.headline !== 'number') return null;
      if (!Array.isArray(clause.buckets) || clause.buckets.length < 2) return null;
      for (const b of clause.buckets) {
        if (!b.name || typeof b.value !== 'number') return null;
        if (!b.target || !b.field || !b.op) return null;
      }
      return {
        status: 'executable_with_helper',
        ruleId: 'reconciliation.metric',
        loweringTarget: HELPER_TARGETS.reconciliation,
        explanation: `Will be checked by ${HELPER_TARGETS.reconciliation} after expansion (${clause.buckets.length} buckets).`,
      };
    },
  },

  // ── narrative → soft_only ──────────────────────────────────────────────
  {
    id: 'narrative.style_only',
    description: 'Style-only / qualitative material → soft_only',
    match(clause) {
      if (clause.family !== 'narrative') return null;
      return {
        status: 'soft_only',
        ruleId: 'narrative.style_only',
        explanation: 'Style/tone-only requirement. Not lowered, not checked.',
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Planner entry point
// ---------------------------------------------------------------------------

export function planCoverage(clauses: Clause[]): CoverageReport {
  const decisions: CoverageDecision[] = clauses.map((clause) => {
    for (const rule of RULES) {
      const out = rule.match(clause);
      if (out) {
        return {
          clauseId: clause.id,
          family: clause.family,
          strength: clause.strength,
          ...out,
        };
      }
    }

    // No rule matched. Soft clauses degrade to soft_only; hard clauses become
    // explicit blockers — the v4.5 contract says they must never disappear.
    const status: CoverageStatus =
      clause.strength === 'soft' ? 'soft_only' : 'unsupported_blocking';
    return {
      clauseId: clause.id,
      family: clause.family,
      strength: clause.strength,
      status,
      ruleId: 'no-match',
      explanation:
        status === 'unsupported_blocking'
          ? `Hard clause (family=${clause.family}) is not covered by any rule in the ${CAPABILITY_REGISTRY_VERSION} registry. Run blocked.`
          : `Soft clause (family=${clause.family}) has no rule but is not blocking.`,
    };
  });

  const blockers = decisions.filter((d) => d.status === 'unsupported_blocking');

  return {
    decisions,
    blockers,
    registryVersion: CAPABILITY_REGISTRY_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Pretty-printer for telemetry / repair logs
// ---------------------------------------------------------------------------

export function formatCoverageReport(report: CoverageReport): string {
  const counts: Record<CoverageStatus, number> = {
    executable_now: 0,
    executable_with_helper: 0,
    soft_only: 0,
    unsupported_blocking: 0,
  };
  for (const d of report.decisions) counts[d.status]++;

  const lines = [
    `Coverage report (registry ${report.registryVersion}):`,
    `  executable_now: ${counts.executable_now}`,
    `  executable_with_helper: ${counts.executable_with_helper}`,
    `  soft_only: ${counts.soft_only}`,
    `  unsupported_blocking: ${counts.unsupported_blocking}`,
  ];
  if (report.blockers.length > 0) {
    lines.push('  Hard blockers:');
    for (const b of report.blockers) {
      lines.push(`    - ${b.clauseId} (${b.family}): ${b.explanation}`);
    }
  }
  return lines.join('\n');
}
