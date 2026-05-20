import { describe, it, expect } from 'vitest';
import {
  constraintsForResource,
  constraintsForTable,
  renderConstraintsBlock,
  type PersonaConstraint,
} from '../../generate/persona-constraints.js';

function c(scope: PersonaConstraint['scope'], id = 'x'): PersonaConstraint {
  return {
    id,
    scope,
    description: 'd',
    instruction: 'i',
  };
}

describe('persona-constraints — filtering', () => {
  it('constraintsForResource matches adapter+resource exactly', () => {
    const all = [
      c({ adapter: 'stripe', resource: 'subscription' }, 'a'),
      c({ adapter: 'stripe', resource: 'invoice' }, 'b'),
      c({ adapter: 'paddle', resource: 'subscription' }, 'c'),
    ];
    const out = constraintsForResource(all, 'stripe', 'subscription');
    expect(out.map((x) => x.id)).toEqual(['a']);
  });

  it('constraintsForResource matches adapter-only constraints (any resource)', () => {
    const all = [
      c({ adapter: 'stripe' }, 'a'),
      c({ adapter: 'paddle' }, 'b'),
    ];
    expect(constraintsForResource(all, 'stripe', 'subscription').map((x) => x.id)).toEqual(['a']);
    expect(constraintsForResource(all, 'stripe', 'invoice').map((x) => x.id)).toEqual(['a']);
    expect(constraintsForResource(all, 'paddle', 'invoice').map((x) => x.id)).toEqual(['b']);
  });

  it('constraintsForResource excludes pure-table constraints', () => {
    const all = [c({ table: 'users' }, 'a'), c({ adapter: 'stripe' }, 'b')];
    expect(constraintsForResource(all, 'stripe', 'subscription').map((x) => x.id)).toEqual(['b']);
  });

  it('constraintsForTable matches the specific table only', () => {
    const all = [
      c({ table: 'users' }, 'a'),
      c({ table: 'orders' }, 'b'),
      c({ adapter: 'stripe' }, 'c'),
    ];
    expect(constraintsForTable(all, 'users').map((x) => x.id)).toEqual(['a']);
    expect(constraintsForTable(all, 'orders').map((x) => x.id)).toEqual(['b']);
    expect(constraintsForTable(all, 'unknown')).toEqual([]);
  });
});

describe('persona-constraints — rendering', () => {
  it('emits empty string when there are no constraints', () => {
    expect(renderConstraintsBlock([])).toBe('');
  });

  it('renders a heading + each constraint with id, description, instruction', () => {
    const out = renderConstraintsBlock([
      c({ adapter: 'chargebee', resource: 'invoice' }, 'chargebee-3-overdue'),
    ]);
    expect(out).toContain('PERSONA-PINNED REQUIREMENTS');
    expect(out).toContain('chargebee-3-overdue');
    expect(out).toContain('fieldOverrides');
    expect(out).toContain('vary.range');
  });
});
