/**
 * V5 helper — cross-surface drift checker.
 *
 * Evaluates drift over the canonical world, using entity-owned surface
 * bindings instead of fuzzy string matching over projected rows.
 */

import type { CrossSurfaceClause } from '../../contract/clause-types.js';
import type { CanonicalEntity, IdentityRecord } from '../../world/entity.js';
import type { WorldState } from '../../world/world-state.js';

export interface CrossSurfaceDriftResult {
  passed: boolean;
  entity: string;
  surfaceA: { target: string; field: string; expected: unknown; actual: unknown[] };
  surfaceB: { target: string; field: string; expected: unknown; actual: unknown[] };
  driftDays?: { expected: number; actual: number | null; tolerance: number };
  reason?: string;
}

export function checkCrossSurfaceDrift(
  clause: CrossSurfaceClause,
  worldState: WorldState,
): CrossSurfaceDriftResult {
  const candidates = buildCandidates(clause, worldState);
  const actualA = candidates.map((candidate) => candidate.actualA);
  const actualB = candidates.map((candidate) => candidate.actualB);
  const matched = candidates.filter((candidate) => candidate.matchesA && candidate.matchesB);

  const driftActual = clause.driftDays == null ? null : inferDriftDays(matched[0]?.entity, clause.field);
  const driftTolerance = clause.driftTolerance ?? 0;
  const driftPassed =
    clause.driftDays == null
      ? true
      : driftActual != null && Math.abs(driftActual - clause.driftDays) <= driftTolerance;

  const passed = matched.length > 0 && driftPassed;

  return {
    passed,
    entity: clause.entity,
    surfaceA: {
      target: `${clause.surfaceA.surface}.${clause.surfaceA.name}`,
      field: clause.field,
      expected: clause.valueA,
      actual: actualA,
    },
    surfaceB: {
      target: `${clause.surfaceB.surface}.${clause.surfaceB.name}`,
      field: clause.field,
      expected: clause.valueB,
      actual: actualB,
    },
    ...(typeof clause.driftDays === 'number'
      ? {
          driftDays: {
            expected: clause.driftDays,
            actual: driftActual,
            tolerance: driftTolerance,
          },
        }
      : {}),
    reason: passed
      ? undefined
      : buildReason(clause, candidates.length, matched.length, actualA, actualB, driftPassed, driftActual),
  };
}

function buildCandidates(
  clause: CrossSurfaceClause,
  worldState: WorldState,
): Array<{
  entity: CanonicalEntity;
  actualA: unknown;
  actualB: unknown;
  matchesA: boolean;
  matchesB: boolean;
}> {
  const allEntities = [...worldState.populations.values()].flat();
  let entities = allEntities.filter((entity) => matchesEntityDescriptor(entity, clause.entity));

  if (entities.length === 0) {
    entities = allEntities.filter((entity) => {
      const identity = worldState.identities.get(entity.id);
      return hasSurface(identity, clause.surfaceA.surface, surfaceObjectKind(clause.surfaceA.name))
        || hasSurface(identity, clause.surfaceB.surface, surfaceObjectKind(clause.surfaceB.name));
    });
  }

  return entities.map((entity) => {
    const identity = worldState.identities.get(entity.id);
    const hasA = hasSurface(identity, clause.surfaceA.surface, surfaceObjectKind(clause.surfaceA.name));
    const hasB = hasSurface(identity, clause.surfaceB.surface, surfaceObjectKind(clause.surfaceB.name));
    const actualA = valueForSurface(entity, clause.field, hasA, clause.valueA);
    const actualB = valueForSurface(entity, clause.field, hasB, clause.valueB);

    return {
      entity,
      actualA,
      actualB,
      matchesA: matchesExpected(actualA, clause.valueA),
      matchesB: matchesExpected(actualB, clause.valueB),
    };
  });
}

function matchesEntityDescriptor(entity: CanonicalEntity, descriptor: string): boolean {
  const needle = descriptor.trim().toLowerCase();
  if (!needle) return true;

  if (entity.populationId.toLowerCase().includes(needle)) return true;
  if ((entity.kind ?? '').toLowerCase().includes(needle)) return true;

  for (const value of [entity.id, entity.attrs.name, entity.attrs.company, entity.attrs.customer_reference]) {
    if (typeof value === 'string' && value.toLowerCase().includes(needle)) return true;
  }

  return false;
}

function hasSurface(identity: IdentityRecord | undefined, surface: string, objectKind: string): boolean {
  return identity?.slots.some((slot) => slot.surface === surface && slot.objectKind === objectKind) ?? false;
}

function surfaceObjectKind(targetName: string): string {
  const dot = targetName.indexOf('.');
  return dot >= 0 ? targetName.slice(dot + 1) : targetName;
}

function valueForSurface(
  entity: CanonicalEntity,
  field: string,
  hasSurfaceBinding: boolean,
  expected: unknown,
): unknown {
  if (isPresenceExpectation(expected)) {
    const value = hasSurfaceBinding ? readEntityField(entity, field) : undefined;
    return isPresent(value) ? 'present' : 'missing';
  }

  if (!hasSurfaceBinding) return null;
  return readEntityField(entity, field);
}

function isPresenceExpectation(value: unknown): value is 'present' | 'missing' {
  return typeof value === 'string' && ['present', 'missing'].includes(value.toLowerCase());
}

function isPresent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && value !== '';
}

function matchesExpected(actual: unknown, expected: unknown): boolean {
  if (isPresenceExpectation(expected)) {
    return typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();
  }
  return looseEquals(actual, expected);
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return String(a) === String(b);
}

function readEntityField(entity: CanonicalEntity, path: string): unknown {
  const fromAttrs = readNested(entity.attrs, path);
  if (fromAttrs !== undefined) return fromAttrs;
  if (path === 'status') return entity.lifecycle.status;
  if (path === 'created' || path === 'created_at') return entity.lifecycle.start;
  return undefined;
}

function readNested(record: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = record;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function inferDriftDays(entity: CanonicalEntity | undefined, field: string): number | null {
  if (!entity) return null;
  const value = readEntityField(entity, field);
  const ts = toTimestamp(value);
  if (ts == null) return null;
  const start = toTimestamp(entity.lifecycle.start);
  if (start == null) return null;
  return Math.round((ts - start) / (24 * 3600 * 1000));
}

function toTimestamp(value: unknown): number | null {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function buildReason(
  clause: CrossSurfaceClause,
  candidates: number,
  matched: number,
  actualA: unknown[],
  actualB: unknown[],
  driftPassed: boolean,
  driftActual: number | null,
): string {
  const parts: string[] = [];
  if (candidates === 0) {
    parts.push(`no canonical entity matched descriptor ${JSON.stringify(clause.entity)}`);
  } else if (matched === 0) {
    parts.push(
      `no canonical entity matched ${clause.surfaceA.surface}.${clause.surfaceA.name}.${clause.field}=${JSON.stringify(clause.valueA)} and ${clause.surfaceB.surface}.${clause.surfaceB.name}.${clause.field}=${JSON.stringify(clause.valueB)}`,
    );
    parts.push(`observed A=${JSON.stringify(actualA)}`);
    parts.push(`observed B=${JSON.stringify(actualB)}`);
  }
  if (typeof clause.driftDays === 'number' && !driftPassed)
    parts.push(`drift ${driftActual ?? 'unavailable'}d does not match expected ${clause.driftDays}d`);
  return parts.join('; ');
}
