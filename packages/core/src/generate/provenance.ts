/**
 * Row provenance — V3 Layer 2.
 *
 * Every row materialised by the expander gets a provenance stamp identifying
 * the archetype (and surface) that produced it. The stamp uses a `Symbol`
 * key so it survives Object spread but is invisible to `Object.keys` /
 * `Object.entries` / `JSON.stringify` — no risk of leaking into seeded data,
 * audit predicates, or facts.
 *
 * Provenance powers cross-surface leakage repair: when a `db.users` row_count
 * overshoots, the auditor groups matched rows by their producing archetype.
 * Some matched rows trace back to an API archetype via the mirror flow — the
 * repair logic can then narrow that API archetype's vary range instead of
 * fruitlessly clamping the cited DB archetype.
 */
import type { Row } from '../types/dataset.js';

/**
 * The Symbol-keyed property carrying provenance on materialised rows.
 * Using Symbol.for so multiple module copies (rare, but possible with
 * tsup/dual-mode builds) share the same identity.
 */
export const PROVENANCE_KEY = Symbol.for('mimic.provenance');

export interface RowProvenance {
  /** Surface the producing archetype lives on. */
  surface: 'db' | 'api';
  /** Archetype target — table name (db) or "<adapter>.<resource>" (api). */
  target: string;
  /** Archetype label, exactly as it appears in the blueprint. */
  label: string;
  /**
   * How this row ended up on its current surface.
   *  - `direct`: produced directly by the archetype (in tables[X]) — most common
   *  - `mirror`: produced on the API surface, mirrored into a DB table
   *  - `static`: copied from blueprint.data.entities[X]
   *  - `pattern`: emitted by a data-pattern, not an archetype
   *  - `fk-backfill`: synthesised to satisfy a child's FK reference
   */
  via: 'direct' | 'mirror' | 'static' | 'pattern' | 'fk-backfill';
  /**
   * Cross-surface source attribution. Set when `via` involves a transformation
   * across surfaces (mirror, fk-backfill) so the repair loop can trace a DB
   * leak back to the API archetype that drove it (or vice-versa).
   */
  sourceSurface?: 'db' | 'api';
  sourceTarget?: string;
  sourceLabel?: string;
}

/**
 * Attach provenance to a row. No-op when info is `undefined`.
 */
export function stampProvenance(row: Row, info: RowProvenance | undefined): void {
  if (!info) return;
  (row as Record<PropertyKey, unknown>)[PROVENANCE_KEY] = info;
}

/**
 * Read provenance from a row. Returns `undefined` when the row was never
 * stamped (legacy code paths, FK-backfill cases not yet instrumented, etc).
 */
export function getProvenance(row: Row): RowProvenance | undefined {
  return (row as Record<PropertyKey, unknown>)[PROVENANCE_KEY] as RowProvenance | undefined;
}

/**
 * Group a list of rows by their provenance ref. Rows without provenance fall
 * into an "(unstamped)" bucket so the report can still account for them.
 *
 * For cross-surface mirrored / fk-backfilled rows, the key surfaces the
 * original producing archetype (e.g. `api.stripe.customer[starter-monthly]
 * (via mirror)`) so the repair loop sees where to narrow.
 */
export function groupRowsByProvenance(rows: ReadonlyArray<Row>): Map<string, Row[]> {
  const buckets = new Map<string, Row[]>();
  for (const row of rows) {
    const prov = getProvenance(row);
    const key = prov ? provenanceKey(prov) : '(unstamped)';
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  return buckets;
}

/**
 * Stable string key for a provenance record. When the row crossed surfaces
 * (mirror / fk-backfill) and the source archetype is known, the key cites the
 * source instead of the materialised surface — so an audit failure on
 * `db.users` whose matched rows came from `stripe.customer[starter-monthly]`
 * via the mirror flow groups under `api.stripe.customer[starter-monthly]
 * (via mirror)`. That is the archetype a repair patch needs to narrow.
 */
export function provenanceKey(prov: RowProvenance): string {
  if ((prov.via === 'mirror' || prov.via === 'fk-backfill') && prov.sourceTarget) {
    const sourceSurface = prov.sourceSurface ?? (prov.surface === 'db' ? 'api' : 'db');
    const sourceLabel = prov.sourceLabel ?? prov.label;
    return `${sourceSurface}.${prov.sourceTarget}[${sourceLabel}] (via ${prov.via})`;
  }
  return `${prov.surface}.${prov.target}[${prov.label}]${prov.via !== 'direct' ? ` (via ${prov.via})` : ''}`;
}
