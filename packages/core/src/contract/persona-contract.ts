/**
 * V5 — Persona contract.
 *
 * Output of the contract compiler. Carries the original persona profile, the
 * full clause set, and the declared anchors. The contract is the runtime
 * plan: subsequent phases (canonicaliser, pre-generation gate, planners)
 * enrich clauses in place via the optional `canonicalTarget`, `ownerId`, and
 * `canonicalisationGap` fields rather than producing a parallel structure.
 *
 * `PersonaProfile` and `Anchor` live here too. They migrated from the V4.5
 * `types/blueprint.ts` carrier when that file was deleted as part of the
 * V5 cleanup — they're contract-shaped and have no remaining tie to the
 * deleted Blueprint format.
 */

import type { Clause } from './clause-types.js';

export interface PersonaProfile {
  name: string;
  age: number;
  occupation: string;
  location: string;
  salary?: number | null;
  description: string;
}

/**
 * A persona-narrated event whose implications span multiple tables / surfaces.
 * Anchors give the persona a way to say "these rows share a customer + date"
 * without enumerating every row — the planner / anchor-planner / contract
 * evaluator all key off the anchor id.
 */
export interface Anchor {
  /** Stable id referenced by anchor clauses and the anchor planner. */
  id: string;
  /**
   * Customer pinning. `match` looks up the customer by `name` or `company`
   * (case-insensitive); if no entity matches, the anchor planner picks one.
   */
  customer?: { match: string };
  /**
   * Named dates. Use `event` for the canonical anchor date. All values are
   * ISO strings (date or full timestamp).
   */
  dates: Record<string, string>;
}

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
