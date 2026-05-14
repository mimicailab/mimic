/**
 * V4.5 helper — anchor multiplicity checker.
 *
 * Verifies that an anchor named by the persona ("Klein Records double-charge")
 * produced at least one row in the expanded data. The check is structural —
 * the row binding is enforced upstream by validateAnchorBindings, but the
 * helper closes the gap that an archetype declared an anchor binding yet
 * emitted zero rows (count=0, weight=0, expander short-circuit, etc.).
 */

import type { AnchorClause } from '../../contract/clause-types.js';
import type { ExpandedData, Row } from '../../types/dataset.js';
import type { Blueprint } from '../../types/blueprint.js';

export interface AnchorMultiplicityResult {
  passed: boolean;
  anchorId: string;
  matched_rows: number;
  surfaces: Array<{ surface: 'db' | 'api'; target: string; rows: number }>;
  reason?: string;
}

export function checkAnchorMultiplicity(
  clause: AnchorClause,
  blueprint: Blueprint,
  expanded: ExpandedData,
): AnchorMultiplicityResult {
  // Walk every archetype config; any with `anchor === clause.anchorId` is a
  // binding site. We collect the surfaces and count rows that look like they
  // came from each binding by matching the anchor's customer descriptor on
  // any text field.
  const customer = clause.customer ?? '';
  const surfaces: AnchorMultiplicityResult['surfaces'] = [];
  let totalRows = 0;

  for (const [table, config] of Object.entries(blueprint.data.entityArchetypes ?? {})) {
    const bindings = config.archetypes.filter((a) => a.anchor === clause.anchorId);
    if (bindings.length === 0) continue;
    const rows = (expanded.tables[table] ?? []) as Row[];
    const matched = customer ? rows.filter((r) => rowMentions(r, customer)) : rows;
    if (matched.length > 0) {
      surfaces.push({ surface: 'db', target: table, rows: matched.length });
      totalRows += matched.length;
    }
  }

  for (const [adapter, resources] of Object.entries(blueprint.data.apiEntityArchetypes ?? {})) {
    for (const [resource, config] of Object.entries(resources)) {
      const bindings = config.archetypes.filter((a) => a.anchor === clause.anchorId);
      if (bindings.length === 0) continue;
      const responses = expanded.apiResponses[adapter]?.responses[resource] ?? [];
      const rows = responses
        .map((r) => r.body)
        .filter((b): b is Record<string, unknown> =>
          b !== null && typeof b === 'object' && !Array.isArray(b),
        );
      const matched = customer ? rows.filter((r) => rowMentions(r, customer)) : rows;
      if (matched.length > 0) {
        surfaces.push({
          surface: 'api',
          target: `${adapter}.${resource}`,
          rows: matched.length,
        });
        totalRows += matched.length;
      }
    }
  }

  const passed = totalRows > 0;
  return {
    passed,
    anchorId: clause.anchorId,
    matched_rows: totalRows,
    surfaces,
    reason: passed
      ? undefined
      : `Anchor "${clause.anchorId}" has no materialised rows on any bound surface` +
        (customer ? ` (looked for customer "${customer}")` : ''),
  };
}

function rowMentions(row: Record<string, unknown>, needle: string): boolean {
  const lc = needle.toLowerCase();
  for (const v of Object.values(row)) {
    if (typeof v === 'string' && v.toLowerCase().includes(lc)) return true;
  }
  return false;
}
