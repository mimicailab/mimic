/**
 * Phase 10 — Shape repair tests.
 *
 *   - Each forbidden op throws IllegalRepairError.
 *   - missing_id is repaired and re-validation reaches clean.
 *   - Owner-level failures are REJECTED by the repair function (the
 *     pipeline must escalate, not attempt repair).
 */
import { describe, it, expect } from 'vitest';
import {
  performRepairOp,
  repairShape,
  IllegalRepairError,
} from '../../repair/index.js';
import { validateShape } from '../../validation/shape-validator.js';
import { createWorldState, SeededRandom } from '../../world/index.js';
import type { MaterialisedDataset } from '../../projection/index.js';

describe('shape-repair — forbidden ops throw', () => {
  it.each([
    'set_count',
    'add_cohort',
    'remove_cohort',
    'reassign_anchor',
    'rewrite_cross_surface_value',
    'rewrite_budget_part',
  ])('%s throws IllegalRepairError', (op) => {
    expect(() => performRepairOp(op)).toThrow(IllegalRepairError);
  });

  it('unknown ops also throw IllegalRepairError', () => {
    expect(() => performRepairOp('do_whatever')).toThrow(IllegalRepairError);
  });
});

describe('shape-repair — local-only successes', () => {
  it('mints missing IDs on DB rows and re-validation reaches clean', () => {
    const state = createWorldState(new SeededRandom(1));
    const ds: MaterialisedDataset = {
      tables: { users: [{ id: '', name: 'A' }, { id: '', name: 'B' }] },
      apiResponses: {},
    };
    const first = validateShape(ds, undefined, state);
    expect(first.classification).toBe('local-only');

    const { repaired, appliedOps } = repairShape(ds, first.failures, undefined);
    expect(appliedOps.length).toBe(2);
    expect(repaired.tables.users!.every((r) => typeof r.id === 'string' && r.id.length > 0)).toBe(true);

    const second = validateShape(repaired, undefined, state);
    expect(second.classification).toBe('clean');
  });

  it('mints missing IDs on API responses', () => {
    const state = createWorldState(new SeededRandom(1));
    const ds: MaterialisedDataset = {
      tables: {},
      apiResponses: {
        stripe: {
          adapterId: 'stripe',
          responses: {
            customer: [
              { statusCode: 200, headers: {}, body: { name: 'A' }, personaId: 'v5' },
            ],
          },
        },
      },
    };
    const first = validateShape(ds, undefined, state);
    expect(first.classification).toBe('local-only');
    const { repaired } = repairShape(ds, first.failures);
    const second = validateShape(repaired, undefined, state);
    expect(second.classification).toBe('clean');
    expect((repaired.apiResponses.stripe!.responses.customer![0]!.body as { id?: string }).id).toBeTruthy();
  });

  it('does NOT mutate the input dataset', () => {
    const state = createWorldState(new SeededRandom(1));
    const ds: MaterialisedDataset = {
      tables: { users: [{ id: '', name: 'A' }] },
      apiResponses: {},
    };
    const first = validateShape(ds, undefined, state);
    repairShape(ds, first.failures);
    // Original is untouched
    expect(ds.tables.users![0]!.id).toBe('');
  });
});

describe('shape-repair — refuses owner-level failures', () => {
  it('throws IllegalRepairError when handed an owner-level failure', () => {
    const ds: MaterialisedDataset = { tables: {}, apiResponses: {} };
    expect(() =>
      repairShape(ds, [
        {
          kind: 'identity_drift',
          scope: 'owner-level',
          ownerId: 'identity',
          entityId: 'e1',
          details: 'simulated',
        },
      ]),
    ).toThrow(IllegalRepairError);
  });
});

describe('shape-repair — bounded loop convergence', () => {
  it('two attempts are sufficient for the failure kinds emitted today', () => {
    const state = createWorldState(new SeededRandom(1));
    const ds: MaterialisedDataset = {
      tables: { users: [{ id: '' }, { id: '' }] },
      apiResponses: {},
    };
    let current = ds;
    let attempts = 0;
    while (attempts < 2) {
      const r = validateShape(current, undefined, state);
      if (r.classification === 'clean') break;
      if (r.classification === 'owner-level') {
        throw new Error('unexpected owner-level escalation in this test');
      }
      const { repaired } = repairShape(current, r.failures);
      current = repaired;
      attempts++;
    }
    expect(validateShape(current, undefined, state).classification).toBe('clean');
    expect(attempts).toBeLessThanOrEqual(2);
  });
});
