/**
 * V4.5 — Layer 3: Lowering.
 *
 * Lower the executable subset of a contract into the structures the existing
 * V2/V3 generator already understands:
 *   - Claim[] consumed by claim-extractor downstream + claim-auditor.
 *   - Anchor[] consumed by archetypes via `anchor: <id>`.
 *
 * Clauses marked `executable_with_helper` or `soft_only` or
 * `unsupported_blocking` produce NO lowered claim — the fidelity validator
 * (Layer 6) checks them after expansion, where applicable.
 *
 * The contract remains the source of truth: lowering is a one-way projection,
 * never a replacement.
 */

import type { Clause, AnchorClause } from './clause-types.js';
import type { CoverageReport } from './persona-contract.js';
import type { Claim } from '../types/claim.js';
import type { Anchor } from '../types/blueprint.js';
import { describeSemanticTarget, resolveSemanticTarget } from './semantic-capabilities.js';

export interface LoweringResult {
  claims: Claim[];
  anchors: Anchor[];
  /** Map of original clauseId → array of lowered claim ids (1:N when needed). */
  clauseIdToClaimIds: Record<string, string[]>;
  /** Clauses that were skipped on purpose (helper/soft/unsupported). */
  skipped: Array<{ clauseId: string; reason: string }>;
}

export function lowerContract(
  clauses: Clause[],
  coverage: CoverageReport,
): LoweringResult {
  const claims: Claim[] = [];
  const anchorMap = new Map<string, Anchor>();
  const clauseIdToClaimIds: Record<string, string[]> = {};
  const skipped: Array<{ clauseId: string; reason: string }> = [];

  const decisionById = new Map(coverage.decisions.map((d) => [d.clauseId, d]));

  for (const clause of clauses) {
    const decision = decisionById.get(clause.id);
    if (!decision) {
      skipped.push({ clauseId: clause.id, reason: 'No coverage decision recorded.' });
      continue;
    }
    if (decision.status !== 'executable_now') {
      skipped.push({
        clauseId: clause.id,
        reason: `Coverage status ${decision.status} — lowering deferred to helpers or fidelity validator.`,
      });
      // Anchor-family clauses still need to register an Anchor so archetypes can bind.
      if (clause.family === 'anchor') {
        registerAnchorFromClause(anchorMap, clause as AnchorClause);
      }
      continue;
    }

    const loweredIds: string[] = [];
    switch (clause.family) {
      case 'count': {
        const target = resolveTargetForLowering(clause);
        if (!target) {
          skipped.push({
            clauseId: clause.id,
            reason:
              clause.semanticTarget != null
                ? `Semantic target ${describeSemanticTarget(clause.semanticTarget)} could not be lowered.`
                : 'No executable target available for count clause.',
          });
          break;
        }
        const claim: Claim = {
          id: claimIdFor(clause.id, 'count'),
          quote: clause.quote,
          kind: 'row_count',
          target,
          expected: clause.expected,
          ...(typeof clause.tolerance === 'number' ? { tolerance: clause.tolerance } : {}),
        };
        claims.push(claim);
        loweredIds.push(claim.id);
        break;
      }
      case 'aggregate': {
        const target = resolveTargetForLowering(clause);
        if (!target) {
          skipped.push({
            clauseId: clause.id,
            reason:
              clause.semanticTarget != null
                ? `Semantic target ${describeSemanticTarget(clause.semanticTarget)} could not be lowered.`
                : 'No executable target available for aggregate clause.',
          });
          break;
        }
        const claim: Claim = {
          id: claimIdFor(clause.id, `agg_${clause.op}`),
          quote: clause.quote,
          kind: clause.op === 'avg' ? 'aggregate_avg' : 'aggregate_sum',
          target,
          field: clause.field,
          expected: clause.expected,
          ...(typeof clause.tolerance === 'number' ? { tolerance: clause.tolerance } : {}),
        } as Claim;
        claims.push(claim);
        loweredIds.push(claim.id);
        break;
      }
      case 'distribution': {
        const target = resolveTargetForLowering(clause);
        if (!target) {
          skipped.push({
            clauseId: clause.id,
            reason:
              clause.semanticTarget != null
                ? `Semantic target ${describeSemanticTarget(clause.semanticTarget)} is helper-only and does not lower to a claim.`
                : 'No executable target available for distribution clause.',
          });
          break;
        }
        const claim: Claim = {
          id: claimIdFor(clause.id, 'dist'),
          quote: clause.quote,
          kind: 'distribution_pct',
          target,
          field: clause.field,
          values: clause.values,
          ...(typeof clause.tolerance === 'number' ? { tolerance: clause.tolerance } : {}),
        };
        claims.push(claim);
        loweredIds.push(claim.id);
        break;
      }
      case 'temporal': {
        if (clause.kind === 'window') {
          const target = resolveTargetForLowering(clause);
          if (!target) {
            skipped.push({
              clauseId: clause.id,
              reason:
                clause.semanticTarget != null
                  ? `Semantic target ${describeSemanticTarget(clause.semanticTarget)} could not be lowered.`
                  : 'No executable target available for temporal window clause.',
            });
            break;
          }
          const claim: Claim = {
            id: claimIdFor(clause.id, 'window'),
            quote: clause.quote,
            kind: 'date_window',
            target,
            field: clause.field,
            min: clause.min,
            max: clause.max,
            expected: clause.expected,
            ...(typeof clause.tolerance === 'number' ? { tolerance: clause.tolerance } : {}),
          };
          claims.push(claim);
          loweredIds.push(claim.id);
        }
        // relative_gap is helper-only; nothing to lower.
        break;
      }
      case 'anchor': {
        registerAnchorFromClause(anchorMap, clause as AnchorClause);
        // No claim emitted for anchors — they don't have a numeric predicate
        // on their own. The fidelity validator still checks anchor-bound rows
        // exist in expanded data; structural binding is enforced by
        // validateAnchorBindings inside the generator.
        break;
      }
      // Helper-only / soft families are filtered out above; the planner
      // should never emit `executable_now` for them.
      case 'cross_surface':
      case 'reconciliation':
      case 'narrative':
        skipped.push({
          clauseId: clause.id,
          reason: `family=${clause.family} is helper/soft-only and is not lowered.`,
        });
        break;
    }

    if (loweredIds.length > 0) {
      clauseIdToClaimIds[clause.id] = loweredIds;
    }
  }

  return {
    claims,
    anchors: [...anchorMap.values()],
    clauseIdToClaimIds,
    skipped,
  };
}

function claimIdFor(clauseId: string, suffix: string): string {
  // Keep a deterministic, traceable id so logs/fidelity reports can link the
  // lowered Claim back to its source Clause.
  return `claim_${clauseId.replace(/[^a-z0-9_-]/gi, '_')}_${suffix}`;
}

function resolveTargetForLowering(
  clause: Extract<Clause, { family: 'count' | 'aggregate' | 'distribution' }> | Extract<Clause, { family: 'temporal'; kind: 'window' }>,
) {
  if (clause.semanticTarget) {
    return resolveSemanticTarget(clause.semanticTarget)?.target;
  }
  return clause.target;
}

function registerAnchorFromClause(map: Map<string, Anchor>, clause: AnchorClause): void {
  const existing = map.get(clause.anchorId);
  const customer = clause.customer ? { match: clause.customer } : existing?.customer;
  map.set(clause.anchorId, {
    id: clause.anchorId,
    customer,
    dates: { ...(existing?.dates ?? {}), ...clause.dates },
  });
}

// ---------------------------------------------------------------------------
// Pretty-printer
// ---------------------------------------------------------------------------

export function formatLoweringResult(result: LoweringResult): string {
  const lines = [
    `Lowering: ${result.claims.length} claim(s), ${result.anchors.length} anchor(s).`,
  ];
  if (result.skipped.length > 0) {
    lines.push(`  Skipped (${result.skipped.length}):`);
    for (const s of result.skipped) lines.push(`    - ${s.clauseId}: ${s.reason}`);
  }
  return lines.join('\n');
}
