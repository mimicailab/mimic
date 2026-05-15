/**
 * V5 — Persona contract.
 *
 * Output of the contract compiler. Carries the original persona profile, the
 * full clause set, and the declared anchors. The contract is the runtime
 * plan: subsequent phases (canonicaliser, pre-generation gate, planners)
 * enrich clauses in place via the optional `canonicalTarget`, `ownerId`, and
 * `canonicalisationGap` fields rather than producing a parallel structure.
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
  /** Source persona description, used by the proof report and prompts */
  source: { name: string; description: string };
  /**
   * Full clause set — both hard and soft. The contract is the source of
   * truth; every planner reads from it directly.
   */
  clauses: Clause[];
  /** Anchors declared by the contract (sometimes derived from anchor clauses) */
  anchors: Anchor[];
  /** ISO timestamp of compilation */
  compiledAt: string;
  /** Compiler version — bumped when the clause shape changes */
  compilerVersion: string;
}
