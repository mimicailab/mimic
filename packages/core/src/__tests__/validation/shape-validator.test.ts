/**
 * Phase 9 — Shape validator tests.
 */
import { describe, it, expect } from 'vitest';
import {
  validateShape,
  type ShapeFailure,
  type ShapeValidationResult,
} from '../../validation/shape-validator.js';
import {
  createWorldState,
  SeededRandom,
  type WorldState,
} from '../../world/index.js';
import type { MaterialisedDataset } from '../../projection/index.js';

function emptyState(): WorldState {
  return createWorldState(new SeededRandom(1));
}

describe('shape validator — classification', () => {
  it('returns clean when there are no failures', () => {
    const state = emptyState();
    const ds: MaterialisedDataset = { tables: {}, apiResponses: {} };
    const r = validateShape(ds, undefined, state);
    expect(r).toEqual<ShapeValidationResult>({ failures: [], classification: 'clean' });
  });

  it('classifies missing_id as local-only', () => {
    const state = emptyState();
    const ds: MaterialisedDataset = {
      tables: { users: [{ id: '', name: 'A' }] },
      apiResponses: {},
    };
    const r = validateShape(ds, undefined, state);
    expect(r.classification).toBe('local-only');
    expect(r.failures.every((f) => f.scope === 'local')).toBe(true);
  });

  it('escalates to owner-level when any failure is owner-level (cohort drift)', () => {
    const state = createWorldState(new SeededRandom(1));
    state.populations.set('paying_customers', [
      {
        id: 'e1',
        populationId: 'paying_customers',
        cohorts: new Set(['tier:starter']),
        attrs: { tier: 'pro' }, // disagrees with cohort label
        lifecycle: { start: '2026-01-01', status: 'active' },
      },
    ]);
    const ds: MaterialisedDataset = {
      // Add a row with missing id (local-only failure) to prove the
      // mixture still classifies as owner-level.
      tables: { users: [{ id: '' }] },
      apiResponses: {},
    };
    const r = validateShape(ds, undefined, state);
    expect(r.classification).toBe('owner-level');
    const cohort = r.failures.find((f): f is Extract<ShapeFailure, { kind: 'cohort_drift' }> => f.kind === 'cohort_drift');
    expect(cohort?.ownerId).toBe('population');
  });
});

describe('shape validator — local-only failure kinds', () => {
  it('detects missing_id on DB rows', () => {
    const state = emptyState();
    const ds: MaterialisedDataset = {
      tables: { users: [{ id: '', name: 'no-id' }, { id: 'ok' }] },
      apiResponses: {},
    };
    const r = validateShape(ds, undefined, state);
    const missing = r.failures.filter((f) => f.kind === 'missing_id');
    expect(missing).toHaveLength(1);
  });

  it('detects missing_id on API responses', () => {
    const state = emptyState();
    const ds: MaterialisedDataset = {
      tables: {},
      apiResponses: {
        stripe: {
          adapterId: 'stripe',
          responses: {
            customer: [
              { statusCode: 200, headers: {}, body: { name: 'no-id' }, personaId: 'v5' },
              { statusCode: 200, headers: {}, body: { id: 'ok' }, personaId: 'v5' },
            ],
          },
        },
      },
    };
    const r = validateShape(ds, undefined, state);
    const missing = r.failures.filter((f) => f.kind === 'missing_id');
    expect(missing).toHaveLength(1);
  });
});

describe('shape validator — owner-level failure kinds', () => {
  it('detects identity_drift when projector emits rows for an unreserved slot', () => {
    const state = createWorldState(new SeededRandom(1));
    state.identities.set('e1', {
      entityId: 'e1',
      slots: [{ surface: 'stripe', objectKind: 'customer', deterministicSeed: 'e1' }],
    });
    const ds: MaterialisedDataset = {
      tables: { ghost_table: [{ id: 'x' }] },
      apiResponses: {},
    };
    const r = validateShape(ds, undefined, state);
    expect(r.failures.some((f) => f.kind === 'identity_drift')).toBe(true);
    expect(r.classification).toBe('owner-level');
  });

  it('detects count_mismatch on db-prefixed populations', () => {
    const state = createWorldState(new SeededRandom(1));
    state.populations.set('db:users', [
      { id: 'a', populationId: 'db:users', cohorts: new Set(), attrs: {}, lifecycle: { start: '2026-01-01', status: 'active' } },
      { id: 'b', populationId: 'db:users', cohorts: new Set(), attrs: {}, lifecycle: { start: '2026-01-01', status: 'active' } },
    ]);
    state.identities.set('a', { entityId: 'a', slots: [{ surface: 'db', objectKind: 'users', deterministicSeed: 'a' }] });
    state.identities.set('b', { entityId: 'b', slots: [{ surface: 'db', objectKind: 'users', deterministicSeed: 'b' }] });
    const ds: MaterialisedDataset = {
      tables: { users: [{ id: 'a' }] }, // expecting 2, got 1
      apiResponses: {},
    };
    const r = validateShape(ds, undefined, state);
    const fail = r.failures.find((f): f is Extract<ShapeFailure, { kind: 'count_mismatch' }> => f.kind === 'count_mismatch');
    expect(fail).toBeDefined();
    expect(fail!.expected).toBe(2);
    expect(fail!.actual).toBe(1);
    expect(r.classification).toBe('owner-level');
  });
});
