import { describe, it, expect } from 'vitest';
import { DataValidator } from '../../generate/data-validator.js';
import type { ExpandedData } from '../../types/dataset.js';
import type { PromptContext } from '../../types/adapter.js';

function makeCtx(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    resources: {},
    amountFormat: 'integer cents',
    relationships: [],
    requiredFields: {},
    notes: '',
    ...overrides,
  };
}

function makeData(adapterId: string, responsesByResource: Record<string, Array<Record<string, unknown>>>): ExpandedData {
  const responses: Record<string, Array<{ statusCode: number; headers: Record<string, string>; body: Record<string, unknown> }>> = {};
  for (const [resource, bodies] of Object.entries(responsesByResource)) {
    responses[resource] = bodies.map((body) => ({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body,
    }));
  }
  return {
    personaId: 'test-persona',
    blueprint: {} as never,
    tables: {},
    documents: [],
    apiResponses: {
      [adapterId]: { adapterId, responses },
    },
    files: [],
    events: [],
    facts: [],
  } as unknown as ExpandedData;
}

describe('DataValidator — duplicate id repair', () => {
  it('renames duplicate ids within a single resource', () => {
    const data = makeData('slack', {
      channel: [
        { id: 'C123', name: 'deals' },
        { id: 'C123', name: 'general' },
      ],
    });

    const validator = new DataValidator({ slack: makeCtx() });
    const stats = validator.validateAndRepair(data);

    const channels = data.apiResponses.slack!.responses.channel!;
    const ids = channels.map((r) => r.body.id);

    expect(ids[0]).toBe('C123');
    expect(ids[1]).not.toBe('C123');
    expect(new Set(ids).size).toBe(2);
    expect(stats.idsRepaired).toBeGreaterThanOrEqual(1);
  });

  it('preserves the original id as a recognisable prefix', () => {
    const data = makeData('attio', {
      task: [
        { id: 'gen_x5ojsnps', content: 'a' },
        { id: 'gen_x5ojsnps', content: 'b' },
        { id: 'gen_x5ojsnps', content: 'c' },
      ],
    });

    const validator = new DataValidator({ attio: makeCtx() });
    validator.validateAndRepair(data);

    const tasks = data.apiResponses.attio!.responses.task!;
    for (const t of tasks) {
      expect(String(t.body.id)).toMatch(/^gen_x5ojsnps/);
    }
    expect(new Set(tasks.map((t) => t.body.id)).size).toBe(3);
  });

  it('does not rename when ids are already unique', () => {
    const data = makeData('hubspot', {
      contact: [
        { id: 'c_1', email: 'a@x.com' },
        { id: 'c_2', email: 'b@x.com' },
      ],
    });

    const validator = new DataValidator({ hubspot: makeCtx() });
    const stats = validator.validateAndRepair(data);

    const ids = data.apiResponses.hubspot!.responses.contact!.map((r) => r.body.id);
    expect(ids).toEqual(['c_1', 'c_2']);
    expect(stats.idsRepaired).toBe(0);
  });

  it('handles missing or empty ids without crashing', () => {
    const data = makeData('granola', {
      note: [
        { title: 'a' },
        { id: '', title: 'b' },
        { id: 'n_1', title: 'c' },
      ],
    });

    const validator = new DataValidator({ granola: makeCtx() });
    expect(() => validator.validateAndRepair(data)).not.toThrow();
  });

  it('treats different resource types as independent id namespaces', () => {
    const data = makeData('attio', {
      task: [{ id: 'X', content: 'a' }],
      note: [{ id: 'X', content: 'b' }],
    });

    const validator = new DataValidator({ attio: makeCtx() });
    const stats = validator.validateAndRepair(data);

    expect(data.apiResponses.attio!.responses.task![0]!.body.id).toBe('X');
    expect(data.apiResponses.attio!.responses.note![0]!.body.id).toBe('X');
    expect(stats.idsRepaired).toBe(0);
  });
});
