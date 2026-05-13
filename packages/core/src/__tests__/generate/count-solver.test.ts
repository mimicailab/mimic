import { describe, it, expect } from 'vitest';
import { solveCounts } from '../../generate/count-solver.js';
import type { Blueprint } from '../../types/blueprint.js';

function makeBlueprint(
  archetypes: Record<string, { count?: number; archetypes: any[] }>,
  claims: any[] = [],
  apiArchetypes: Record<string, Record<string, { count?: number; archetypes: any[] }>> = {},
): Blueprint {
  return {
    version: '1.0',
    personaId: 'test',
    domain: 'test',
    generatedAt: '',
    generatedBy: '',
    checksum: '',
    persona: { name: 'T', age: 30, occupation: 't', location: 't', description: '' },
    data: {
      entities: {},
      patterns: [],
      claims,
      entityArchetypes: archetypes as any,
      apiEntityArchetypes: apiArchetypes as any,
    },
  } as Blueprint;
}

describe('count-solver', () => {
  it('pins singleton-cite claims directly', () => {
    const bp = makeBlueprint(
      {
        users: {
          count: 100,
          archetypes: [
            { label: 'churn-risk', weight: 0.1, fields: {}, vary: {}, cites: ['claim_churn'] },
            { label: 'normal', weight: 0.9, fields: {}, vary: [] },
          ],
        },
      },
      [
        { id: 'claim_churn', quote: '', kind: 'row_count', target: { surface: 'db', name: 'users' }, expected: 14 },
      ],
    );
    const res = solveCounts(bp);
    const op = res.patch.ops.find((o: any) => o.path.includes('churn-risk'));
    expect(op).toBeDefined();
    expect((op as any).count).toBe(14);
    expect(res.conflicts).toEqual([]);
  });

  it('distributes a multi-cite claim across unpinned archetypes by weight', () => {
    const bp = makeBlueprint(
      {
        customers: {
          count: 1000,
          archetypes: [
            { label: 'starter', weight: 0.6, fields: { plan: 'starter' }, vary: {}, cites: ['claim_total'] },
            { label: 'pro', weight: 0.3, fields: { plan: 'pro' }, vary: {}, cites: ['claim_total'] },
            { label: 'enterprise', weight: 0.1, fields: { plan: 'enterprise' }, vary: {}, cites: ['claim_total'] },
          ],
        },
      },
      [
        { id: 'claim_total', quote: '', kind: 'row_count', target: { surface: 'db', name: 'customers' }, expected: 1000 },
      ],
    );
    const res = solveCounts(bp);
    const counts = new Map(res.patch.ops.map((o: any) => [o.path, o.count]));
    const starter = counts.get('data.entityArchetypes.customers.archetypes[starter]')!;
    const pro = counts.get('data.entityArchetypes.customers.archetypes[pro]')!;
    const ent = counts.get('data.entityArchetypes.customers.archetypes[enterprise]')!;
    expect(starter + pro + ent).toBe(1000);
    expect(starter).toBeCloseTo(600, -1); // ±5
    expect(pro).toBeCloseTo(300, -1);
    expect(ent).toBeCloseTo(100, -1);
  });

  it('subtracts pinned singletons when distributing a multi-cite remainder', () => {
    const bp = makeBlueprint(
      {
        customers: {
          count: 1000,
          archetypes: [
            { label: 'churn', weight: 0, fields: {}, vary: {}, count: 14, cites: ['claim_total', 'claim_churn'] },
            { label: 'normal', weight: 1, fields: {}, vary: {}, cites: ['claim_total'] },
          ],
        },
      },
      [
        { id: 'claim_total', quote: '', kind: 'row_count', target: { surface: 'db', name: 'customers' }, expected: 1000 },
        { id: 'claim_churn', quote: '', kind: 'row_count', target: { surface: 'db', name: 'customers' }, expected: 14 },
      ],
    );
    const res = solveCounts(bp);
    const counts = new Map(res.patch.ops.map((o: any) => [o.path, o.count]));
    // churn pinned at 14 (already preserved — no op needed)
    // normal absorbs 1000 - 14 = 986
    expect(counts.get('data.entityArchetypes.customers.archetypes[normal]')).toBe(986);
    expect(res.conflicts).toEqual([]);
  });

  it('reports conflicts when sum of citers cannot match expected', () => {
    const bp = makeBlueprint(
      {
        customers: {
          count: 100,
          archetypes: [
            // both pinned, summing to 30, but claim says 50
            { label: 'a', weight: 0, fields: {}, vary: {}, count: 20, cites: ['claim_total'] },
            { label: 'b', weight: 0, fields: {}, vary: {}, count: 10, cites: ['claim_total'] },
          ],
        },
      },
      [
        { id: 'claim_total', quote: '', kind: 'row_count', target: { surface: 'db', name: 'customers' }, expected: 50 },
      ],
    );
    const res = solveCounts(bp);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]!.claimId).toBe('claim_total');
    expect(res.conflicts[0]!.assignedSum).toBe(30);
  });

  it('honors tolerance — within tolerance does not trip conflict', () => {
    const bp = makeBlueprint(
      {
        customers: {
          count: 100,
          archetypes: [
            { label: 'a', weight: 0, fields: {}, vary: {}, count: 48, cites: ['claim_total'] },
          ],
        },
      },
      [
        { id: 'claim_total', quote: '', kind: 'row_count', target: { surface: 'db', name: 'customers' }, expected: 50, tolerance: 5 },
      ],
    );
    const res = solveCounts(bp);
    expect(res.conflicts).toEqual([]);
  });

  it('handles claims with no citing archetypes (skipped, audit catches)', () => {
    const bp = makeBlueprint(
      { users: { count: 0, archetypes: [] } },
      [
        { id: 'claim_orphan', quote: '', kind: 'row_count', target: { surface: 'db', name: 'users' }, expected: 5 },
      ],
    );
    const res = solveCounts(bp);
    // No citer → no solver action, no conflict (silently skipped)
    expect(res.conflicts).toEqual([]);
  });

  it('resolves API archetypes the same way as DB archetypes', () => {
    const bp = makeBlueprint(
      {},
      [
        { id: 'claim_stripe', quote: '', kind: 'row_count', target: { surface: 'api', name: 'stripe.customer' }, expected: 1200 },
      ],
      {
        stripe: {
          customer: {
            count: 0,
            archetypes: [
              { label: 'stripe-starter', weight: 1, fields: {}, vary: {}, cites: ['claim_stripe'] },
            ],
          },
        },
      },
    );
    const res = solveCounts(bp);
    const op = res.patch.ops.find((o: any) => o.path.includes('stripe-starter'));
    expect(op).toBeDefined();
    expect((op as any).count).toBe(1200);
  });
});
