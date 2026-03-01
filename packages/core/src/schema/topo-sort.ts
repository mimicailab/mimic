/**
 * Topological sort using Kahn's algorithm.
 *
 * Produces a deterministic insertion order for tables based on foreign-key
 * dependencies. Self-referencing FKs are skipped (they don't create an edge).
 * If a cycle is detected the cyclic tables are appended at the end and a
 * warning is emitted — at seed time they are handled via
 * `SET CONSTRAINTS ALL DEFERRED`.
 */

import type { TableInfo } from '../types/schema.js';
import { logger } from '../utils/index.js';

/**
 * Return table names in topological (FK-dependency) order so that referenced
 * tables are inserted before the tables that reference them.
 *
 * @param tables - Array of `TableInfo` objects from any schema parser.
 * @returns Ordered array of table names safe for sequential INSERT / COPY.
 */
export function topologicalSort(tables: TableInfo[]): string[] {
  // ── Build adjacency list + in-degree map ──────────────────────────────
  const tableNames = new Set(tables.map((t) => t.name));

  /** table -> set of tables it depends on (i.e. inbound edges) */
  const inDegree = new Map<string, number>();

  /** table -> tables that depend on it (i.e. outbound edges) */
  const dependents = new Map<string, Set<string>>();

  for (const name of tableNames) {
    inDegree.set(name, 0);
    dependents.set(name, new Set());
  }

  for (const table of tables) {
    for (const fk of table.foreignKeys) {
      // Skip self-referencing FKs — they don't impose an ordering constraint.
      if (fk.referencedTable === table.name) {
        continue;
      }

      // Only consider FKs that point to tables we know about. External
      // references (cross-schema, etc.) are ignored silently.
      if (!tableNames.has(fk.referencedTable)) {
        continue;
      }

      // Edge: referencedTable → table (referenced must come first).
      // Guard against duplicate edges from multiple FK columns pointing at the
      // same referenced table.
      const deps = dependents.get(fk.referencedTable)!;
      if (!deps.has(table.name)) {
        deps.add(table.name);
        inDegree.set(table.name, (inDegree.get(table.name) ?? 0) + 1);
      }
    }
  }

  // ── Kahn's algorithm ──────────────────────────────────────────────────
  // Seed the queue with all zero-in-degree nodes, sorted alphabetically for
  // deterministic output across runs.
  const queue: string[] = [...tableNames]
    .filter((name) => inDegree.get(name) === 0)
    .sort();

  const sorted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const deps = dependents.get(current);
    if (!deps) continue;

    // Collect newly-freed neighbours and sort them for determinism.
    const freed: string[] = [];

    for (const dep of deps) {
      const newDeg = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) {
        freed.push(dep);
      }
    }

    freed.sort();
    queue.push(...freed);
  }

  // ── Handle cycles ─────────────────────────────────────────────────────
  if (sorted.length < tableNames.size) {
    const cyclic = [...tableNames]
      .filter((name) => !sorted.includes(name))
      .sort();

    logger.warn(
      `Circular FK dependency detected among tables: ${cyclic.join(', ')}. ` +
        'These tables will be appended at the end of the insertion order. ' +
        'Use SET CONSTRAINTS ALL DEFERRED during seeding to handle this.',
    );

    sorted.push(...cyclic);
  }

  return sorted;
}
