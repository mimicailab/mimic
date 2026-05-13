import { describe, it, expect } from 'vitest';
import { rewriteBridgeTables, rewriteClaimsForBridges } from '../../generate/bridge-rewriter.js';
import type { Blueprint, SchemaMapping } from '../../types/blueprint.js';
import type { Claim } from '../../types/claim.js';

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

const MAPPING: SchemaMapping = {
  bridgeTables: ['users'],
  mappings: [
    { dbTable: 'users', dbColumn: 'external_id', adapterId: 'stripe', apiResource: 'customer', apiField: 'id', isBridgeTable: true, direction: 'mirror' },
    { dbTable: 'users', dbColumn: 'external_id', adapterId: 'paddle', apiResource: 'customer', apiField: 'id', isBridgeTable: true, direction: 'mirror' },
  ],
};

describe('bridge-rewriter', () => {
  it('strips DB archetypes whose billing_platform matches a bridge adapter', () => {
    const input = bp({
      entityArchetypes: {
        users: {
          count: 1400,
          archetypes: [
            { label: 'stripe-starter', weight: 0.5, fields: { billing_platform: 'stripe', plan: 'starter' }, vary: {} },
            { label: 'paddle-pro', weight: 0.4, fields: { billing_platform: 'paddle', plan: 'pro' }, vary: {} },
            { label: 'free-tier', weight: 0.1, fields: { plan: 'free' }, vary: {} },
          ],
        },
      },
    });
    const result = rewriteBridgeTables(input, MAPPING);
    expect(result.strippedArchetypes).toHaveLength(2);
    const labels = result.blueprint.data.entityArchetypes!.users!.archetypes.map((a) => a.label);
    expect(labels).toEqual(['free-tier']);
  });

  it('rewrites bridge-table row_count claims to API surface', () => {
    const input = bp({
      entityArchetypes: { users: { count: 100, archetypes: [] } },
      claims: [
        { id: 'c1', quote: '', kind: 'row_count', target: { surface: 'db', name: 'users', filter: { billing_platform: 'stripe' } }, expected: 1200 },
      ],
    });
    const result = rewriteBridgeTables(input, MAPPING);
    expect(result.rewrittenClaims).toHaveLength(1);
    expect(result.blueprint.data.claims![0]!.target.surface).toBe('api');
    expect(result.blueprint.data.claims![0]!.target.name).toBe('stripe.customer');
    expect(result.blueprint.data.claims![0]!.target.filter).toBeUndefined();
  });

  it('preserves non-platform claims on bridge tables (e.g. is_null filter)', () => {
    const input = bp({
      entityArchetypes: { users: { count: 100, archetypes: [] } },
      claims: [
        { id: 'c_orphans', quote: '', kind: 'row_count', target: { surface: 'db', name: 'users', filter: { billing_platform: { is_null: true } } }, expected: 34 },
        { id: 'c_inactive', quote: '', kind: 'row_count', target: { surface: 'db', name: 'users', filter: { plan: 'pro' } }, expected: 14 },
      ],
    });
    const result = rewriteBridgeTables(input, MAPPING);
    expect(result.rewrittenClaims).toHaveLength(0);
    expect(result.blueprint.data.claims![0]!.target.surface).toBe('db');
    expect(result.blueprint.data.claims![1]!.target.surface).toBe('db');
  });

  it('keeps non-bridge table archetypes untouched', () => {
    const input = bp({
      entityArchetypes: {
        events: {
          count: 100,
          archetypes: [
            { label: 'login', weight: 1, fields: { billing_platform: 'stripe', event_type: 'login' }, vary: {} },
          ],
        },
      },
    });
    const result = rewriteBridgeTables(input, MAPPING);
    expect(result.strippedArchetypes).toEqual([]);
    expect(result.blueprint.data.entityArchetypes!.events!.archetypes).toHaveLength(1);
  });

  it('returns blueprint unchanged when no schemaMapping provided', () => {
    const input = bp({
      entityArchetypes: { users: { count: 100, archetypes: [{ label: 'a', weight: 1, fields: { billing_platform: 'stripe' }, vary: {} }] } },
    });
    const result = rewriteBridgeTables(input, undefined);
    expect(result.strippedArchetypes).toEqual([]);
    expect(result.blueprint).toBe(input);
  });

  it('handles eq-form filter values (billing_platform: { eq: "stripe" })', () => {
    const input = bp({
      entityArchetypes: { users: { count: 100, archetypes: [] } },
      claims: [
        { id: 'c1', quote: '', kind: 'row_count', target: { surface: 'db', name: 'users', filter: { billing_platform: { eq: 'paddle' } } }, expected: 200 },
      ],
    });
    const result = rewriteBridgeTables(input, MAPPING);
    expect(result.rewrittenClaims).toHaveLength(1);
    expect(result.blueprint.data.claims![0]!.target.name).toBe('paddle.customer');
  });

  it('rewriteClaimsForBridges (V2) routes db.<bridge> with platform filter to api.<adapter>.<resource>', () => {
    const claims: Claim[] = [
      { id: 'c1', quote: '', kind: 'row_count', target: { surface: 'db', name: 'users', filter: { billing_platform: 'stripe' } }, expected: 1200 },
      { id: 'c2', quote: '', kind: 'row_count', target: { surface: 'db', name: 'users', filter: { plan: 'pro' } }, expected: 14 },
    ];
    const { claims: out, rewritten } = rewriteClaimsForBridges(claims, MAPPING);
    expect(rewritten).toHaveLength(1);
    expect(rewritten[0]!.claimId).toBe('c1');
    expect(out[0]!.target).toEqual({ surface: 'api', name: 'stripe.customer' });
    // Non-platform claim untouched
    expect(out[1]!.target.surface).toBe('db');
  });

  it('rewriteClaimsForBridges returns inputs unchanged when no mapping is provided', () => {
    const claims: Claim[] = [
      { id: 'c1', quote: '', kind: 'row_count', target: { surface: 'db', name: 'users', filter: { billing_platform: 'stripe' } }, expected: 100 },
    ];
    const { claims: out, rewritten } = rewriteClaimsForBridges(claims, undefined);
    expect(rewritten).toEqual([]);
    expect(out).toEqual(claims);
  });

  it('idempotent — running twice produces the same result', () => {
    const input = bp({
      entityArchetypes: {
        users: {
          count: 100,
          archetypes: [
            { label: 'stripe-x', weight: 1, fields: { billing_platform: 'stripe' }, vary: {} },
          ],
        },
      },
      claims: [
        { id: 'c1', quote: '', kind: 'row_count', target: { surface: 'db', name: 'users', filter: { billing_platform: 'stripe' } }, expected: 100 },
      ],
    });
    const once = rewriteBridgeTables(input, MAPPING);
    const twice = rewriteBridgeTables(once.blueprint, MAPPING);
    expect(twice.strippedArchetypes).toEqual([]); // already stripped first time
    expect(twice.rewrittenClaims).toEqual([]); // already rewritten
    expect(twice.blueprint.data.claims).toEqual(once.blueprint.data.claims);
  });
});
