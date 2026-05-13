import { describe, it, expect } from 'vitest';
import { deterministicRepair } from '../../generate/deterministic-repair.js';
import type { Blueprint } from '../../types/blueprint.js';
import type { AuditResult } from '../../types/claim.js';

function bp(overrides: any): Blueprint {
  return {
    version: '1.0',
    personaId: 't',
    domain: 't',
    generatedAt: '',
    generatedBy: '',
    checksum: '',
    persona: { name: 'T', age: 30, occupation: 't', location: 't', description: '' },
    data: {
      entities: {},
      patterns: [],
      ...overrides,
    },
  } as Blueprint;
}

describe('deterministic-repair', () => {
  it('patches row_count failures by adjusting the largest cited archetype', () => {
    const blueprint = bp({
      entityArchetypes: {
        users: {
          count: 100,
          archetypes: [
            { label: 'a', weight: 0.5, fields: {}, vary: {}, count: 50, cites: ['c1'] },
            { label: 'b', weight: 0.3, fields: {}, vary: {}, count: 30, cites: ['c1'] },
          ],
        },
      },
    });
    const audit: AuditResult = {
      evaluations: [],
      failures: [
        {
          claim: { id: 'c1', quote: '', kind: 'row_count', target: { surface: 'db', name: 'users' }, expected: 100 } as any,
          passed: false,
          predicate: 'count = 100',
          actual: 80,
          citedBy: [],
        },
      ],
    };
    const result = deterministicRepair(blueprint, audit);
    // Largest citer is 'a' (count=50), delta=+20 → bump to 70.
    const op = result.patch.ops[0]! as any;
    expect(op.op).toBe('set_count');
    expect(op.path).toBe('data.entityArchetypes.users.archetypes[a]');
    expect(op.count).toBe(70);
    expect(result.residualFailures).toEqual([]);
  });

  it('patches pinned_field perRow failures by setting fields on each citer', () => {
    const blueprint = bp({
      entityArchetypes: {
        invoices: {
          count: 3,
          archetypes: [
            { label: 'overdue', weight: 1, fields: { status: 'paid' }, vary: {}, count: 3, cites: ['c_status'] },
          ],
        },
      },
    });
    const audit: AuditResult = {
      evaluations: [],
      failures: [
        {
          claim: { id: 'c_status', quote: '', kind: 'pinned_field', target: { surface: 'db', name: 'invoices' }, field: 'status', expected: 'payment_due', perRow: true } as any,
          passed: false,
          predicate: 'all rows have status=payment_due',
          actual: '0/3 rows match',
          citedBy: [],
        },
      ],
    };
    const result = deterministicRepair(blueprint, audit);
    const setFieldOps = result.patch.ops.filter((o: any) => o.op === 'set_field' && o.path.endsWith('.status'));
    expect(setFieldOps).toHaveLength(1);
    expect((setFieldOps[0] as any).value).toBe('payment_due');
    expect(result.residualFailures).toEqual([]);
  });

  it('patches no_row_with failures by zeroing cited archetypes', () => {
    const blueprint = bp({
      entityArchetypes: {
        users: {
          count: 1,
          archetypes: [
            { label: 'bad', weight: 0, fields: {}, vary: {}, count: 5, cites: ['c_none'] },
          ],
        },
      },
    });
    const audit: AuditResult = {
      evaluations: [],
      failures: [
        {
          claim: { id: 'c_none', quote: '', kind: 'no_row_with', target: { surface: 'db', name: 'users' } } as any,
          passed: false,
          predicate: 'count = 0',
          actual: 5,
          citedBy: [],
        },
      ],
    };
    const result = deterministicRepair(blueprint, audit);
    const op = result.patch.ops[0]! as any;
    expect(op.op).toBe('set_count');
    expect(op.count).toBe(0);
  });

  it('defers aggregate_sum failures to the LLM repair path', () => {
    const blueprint = bp({});
    const audit: AuditResult = {
      evaluations: [],
      failures: [
        {
          claim: { id: 'c_sum', quote: '', kind: 'aggregate_sum', target: { surface: 'db', name: 'invoices' }, field: 'total', expected: 1240000 } as any,
          passed: false,
          predicate: 'sum(total) = 1240000',
          actual: 800000,
          citedBy: [],
        },
      ],
    };
    const result = deterministicRepair(blueprint, audit);
    expect(result.patch.ops).toEqual([]);
    expect(result.residualFailures).toHaveLength(1);
    expect(result.decisions[0]!.status).toBe('deferred');
  });

  it('defers row_count failures with no citers', () => {
    const blueprint = bp({});
    const audit: AuditResult = {
      evaluations: [],
      failures: [
        {
          claim: { id: 'c_orphan', quote: '', kind: 'row_count', target: { surface: 'db', name: 'x' }, expected: 5 } as any,
          passed: false,
          predicate: 'count = 5',
          actual: 0,
          citedBy: [],
        },
      ],
    };
    const result = deterministicRepair(blueprint, audit);
    expect(result.patch.ops).toEqual([]);
    expect(result.residualFailures).toHaveLength(1);
    expect(result.decisions[0]!.reason).toMatch(/no archetype cites/);
  });
});
