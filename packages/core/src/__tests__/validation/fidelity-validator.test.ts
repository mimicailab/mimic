import { describe, it, expect } from 'vitest';
import { runFidelity } from '../../validation/fidelity-validator.js';
import { planCoverage } from '../../contract/coverage-planner.js';
import { lowerContract } from '../../contract/lowering.js';
import type { Clause } from '../../contract/clause-types.js';
import type { PersonaContract } from '../../contract/persona-contract.js';
import type { Blueprint } from '../../types/blueprint.js';
import type { ExpandedData } from '../../types/dataset.js';

function makeBlueprint(): Blueprint {
  return {
    version: '1.0',
    personaId: 't',
    domain: 't',
    generatedAt: '',
    generatedBy: '',
    checksum: '',
    persona: { name: 't', age: 30, occupation: '', location: '', description: '' },
    data: { entities: {}, patterns: [] },
  } as Blueprint;
}

function makeContract(clauses: Clause[]): PersonaContract {
  return {
    personaId: 't',
    domain: 't',
    persona: { name: 't', age: 30, occupation: '', location: '', description: '' },
    source: { name: 't', description: '' },
    clauses,
    anchors: [],
    compiledAt: '',
    compilerVersion: 'v4.5.0',
  };
}

function makeExpanded(
  apiResponses: Record<string, Record<string, unknown[]>> = {},
  tables: Record<string, Record<string, unknown>[]> = {},
): ExpandedData {
  const apiSet: ExpandedData['apiResponses'] = {};
  for (const [adapter, resources] of Object.entries(apiResponses)) {
    apiSet[adapter] = {
      adapterId: adapter,
      responses: {},
    };
    for (const [resource, bodies] of Object.entries(resources)) {
      apiSet[adapter]!.responses[resource] = bodies.map((b) => ({
        statusCode: 200,
        headers: {},
        body: b,
        personaId: 't',
      }));
    }
  }
  return {
    personaId: 't',
    blueprint: makeBlueprint(),
    tables,
    documents: {},
    apiResponses: apiSet,
    files: [],
    events: [],
    facts: [],
  };
}

describe('V4.5 fidelity validator', () => {
  it('passes when a hard count clause has the right number of matching rows', () => {
    const clauses: Clause[] = [
      {
        id: 'overdue',
        quote: '3 overdue invoices',
        family: 'count',
        strength: 'hard',
        target: { surface: 'api', name: 'stripe.invoice', filter: { status: 'overdue' } },
        expected: 3,
      },
    ];
    const coverage = planCoverage(clauses);
    const lowering = lowerContract(clauses, coverage);
    const expanded = makeExpanded({
      stripe: {
        invoice: [
          { id: 'a', status: 'overdue' },
          { id: 'b', status: 'overdue' },
          { id: 'c', status: 'overdue' },
          { id: 'd', status: 'paid' },
        ],
      },
    });
    const result = runFidelity(makeContract(clauses), coverage, {
      lowering,
      blueprint: makeBlueprint(),
      expanded,
    });
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('flags a hard count failure with the persona quote and source=generation', () => {
    const clauses: Clause[] = [
      {
        id: 'overdue',
        quote: '3 overdue invoices',
        family: 'count',
        strength: 'hard',
        target: { surface: 'api', name: 'stripe.invoice', filter: { status: 'overdue' } },
        expected: 3,
      },
    ];
    const coverage = planCoverage(clauses);
    const lowering = lowerContract(clauses, coverage);
    const expanded = makeExpanded({
      stripe: {
        invoice: [
          { id: 'a', status: 'overdue' },
          { id: 'b', status: 'overdue' },
        ],
      },
    });
    const result = runFidelity(makeContract(clauses), coverage, {
      lowering,
      blueprint: makeBlueprint(),
      expanded,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.quote).toBe('3 overdue invoices');
    expect(result.failures[0]!.source).toBe('generation');
  });

  it('evaluates semantic billing cohort counts without raw surface predicates', () => {
    const clauses: Clause[] = [
      {
        id: 'starter-customers',
        quote: '2 starter customers',
        family: 'count',
        strength: 'hard',
        semanticTarget: {
          kind: 'billing_customer_cohort',
          adapter: 'stripe',
          facets: { billingState: 'paying', tier: 'starter' },
        },
        expected: 2,
      },
    ];
    const coverage = planCoverage(clauses);
    const lowering = lowerContract(clauses, coverage);
    const expanded = makeExpanded({
      stripe: {
        subscription: [
          {
            id: 'sub_1',
            status: 'active',
            items: { data: [{ price: { lookup_key: 'starter-monthly' } }] },
          },
          {
            id: 'sub_2',
            status: 'trialing',
            items: { data: [{ price: { lookup_key: 'starter-annual' } }] },
          },
          {
            id: 'sub_3',
            status: 'active',
            items: { data: [{ price: { lookup_key: 'pro-monthly' } }] },
          },
        ],
      },
    });
    const result = runFidelity(makeContract(clauses), coverage, {
      lowering,
      blueprint: makeBlueprint(),
      expanded,
    });
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('checks semantic tier distributions via the helper path', () => {
    const clauses: Clause[] = [
      {
        id: 'paid-tier-mix',
        quote: '50% starter, 50% pro',
        family: 'distribution',
        strength: 'hard',
        semanticTarget: {
          kind: 'billing_customer_cohort',
          adapter: 'stripe',
          facets: { billingState: 'paying' },
        },
        semanticField: 'tier',
        field: 'plan_nickname',
        values: { starter: 50, pro: 50 },
      },
    ];
    const coverage = planCoverage(clauses);
    const lowering = lowerContract(clauses, coverage);
    const expanded = makeExpanded({
      stripe: {
        subscription: [
          {
            id: 'sub_1',
            status: 'active',
            items: { data: [{ price: { lookup_key: 'starter-monthly' } }] },
          },
          {
            id: 'sub_2',
            status: 'active',
            items: { data: [{ price: { lookup_key: 'pro-monthly' } }] },
          },
        ],
      },
    });
    const result = runFidelity(makeContract(clauses), coverage, {
      lowering,
      blueprint: makeBlueprint(),
      expanded,
    });
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('surfaces unsupported_blocking clauses as failures with source=extraction', () => {
    const clauses: Clause[] = [
      {
        id: 'mystery',
        quote: 'something the system cannot represent',
        family: 'count',
        strength: 'hard',
        target: undefined as any,
        expected: undefined as any,
      } as Clause,
    ];
    const coverage = planCoverage(clauses);
    const lowering = lowerContract(clauses, coverage);
    const result = runFidelity(makeContract(clauses), coverage, {
      lowering,
      blueprint: makeBlueprint(),
      expanded: makeExpanded(),
    });
    expect(result.passed).toBe(false);
    expect(result.failures[0]!.source).toBe('extraction');
    expect(result.failures[0]!.skipped).toBe(true);
  });

  it('skips soft clauses without affecting overall pass', () => {
    const clauses: Clause[] = [
      {
        id: 'tone',
        quote: 'friendly tone',
        family: 'narrative',
        strength: 'soft',
        note: 'friendly tone',
      },
    ];
    const coverage = planCoverage(clauses);
    const lowering = lowerContract(clauses, coverage);
    const result = runFidelity(makeContract(clauses), coverage, {
      lowering,
      blueprint: makeBlueprint(),
      expanded: makeExpanded(),
    });
    expect(result.passed).toBe(true);
    expect(result.evaluations[0]!.skipped).toBe(true);
  });
});
