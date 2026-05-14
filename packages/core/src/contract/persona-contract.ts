/**
 * V4.5 — Persona contract.
 *
 * Output of the contract compiler. Carries the original persona profile, the
 * full clause set (richer than the lowered Claim[]), and the declared
 * anchors. Survives lowering so the fidelity validator can still check
 * every hard clause against the final output.
 *
 * Reference: private/v4.5.md.
 */

import type { Clause } from './clause-types.js';
import type { PersonaProfile, Anchor } from '../types/blueprint.js';

export interface PersonaContract {
  /** Stable persona id */
  personaId: string;
  /** Domain string */
  domain: string;
  /** Free-text profile fields the LLM extracted */
  persona: PersonaProfile;
  /** Source persona description, used by the fidelity report and prompts */
  source: { name: string; description: string };
  /**
   * Full clause set — both hard and soft. The contract is the source of
   * truth; the generator only sees a lowered subset.
   */
  clauses: Clause[];
  /** Anchors declared by the contract (sometimes derived from anchor clauses) */
  anchors: Anchor[];
  /** ISO timestamp of compilation */
  compiledAt: string;
  /** Compiler version — bumped when the clause shape changes */
  compilerVersion: string;
}

/** Possible coverage outcomes for one clause. */
export type CoverageStatus =
  | 'executable_now'
  | 'executable_with_helper'
  | 'soft_only'
  | 'unsupported_blocking';

export interface CoverageDecision {
  clauseId: string;
  family: import('./clause-types.js').ClauseFamily;
  strength: import('./clause-types.js').ClauseStrength;
  status: CoverageStatus;
  /** Planner rule id that fired (or `no-match` when none fired) */
  ruleId: string;
  /** Lowering target id when executable_now, helper id when executable_with_helper */
  loweringTarget?: string;
  /** Human-readable rationale */
  explanation: string;
}

export interface CoverageReport {
  /** Per-clause decisions in input order */
  decisions: CoverageDecision[];
  /** Convenience: hard clauses that came back as `unsupported_blocking` */
  blockers: CoverageDecision[];
  /** Versioned capability registry id this report was produced against */
  registryVersion: string;
}
