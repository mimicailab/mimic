import { describe, it, expect } from 'vitest';
import { DataValidator } from '../../generate/data-validator.js';
import type { ExpandedData, ApiResponse } from '../../types/dataset.js';
import type { PromptContext } from '../../types/adapter.js';

function makeCtx(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    resources: [],
    amountFormat: 'integer cents',
    relationships: [],
    requiredFields: {},
    notes: '',
    ...overrides,
  };
}

function makeData(adapterId: string, responsesByResource: Record<string, Array<Record<string, unknown>>>): ExpandedData {
  const responses: Record<string, ApiResponse[]> = {};
  for (const [resource, bodies] of Object.entries(responsesByResource)) {
    responses[resource] = bodies.map((body) => ({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body,
      personaId: 'test-persona',
    }));
  }
  return {
    personaId: 'test-persona',
    blueprint: {} as never,
    tables: {},
    documents: {},
    apiResponses: {
      [adapterId]: { adapterId, responses },
    },
    files: [],
    events: [],
    facts: [],
  };
}

function bodyOf(resp: ApiResponse): Record<string, unknown> {
  return resp.body as Record<string, unknown>;
}

function responsesOf(data: ExpandedData, adapterId: string, resource: string): ApiResponse[] {
  const set = data.apiResponses[adapterId];
  if (!set) throw new Error(`adapter ${adapterId} not in test data`);
  const arr = set.responses[resource];
  if (!arr) throw new Error(`resource ${resource} not in test data`);
  return arr;
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

    const channels = responsesOf(data, 'slack', 'channel');
    const ids = channels.map((r) => bodyOf(r).id);

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

    const tasks = responsesOf(data, 'attio', 'task');
    for (const t of tasks) {
      expect(String(bodyOf(t).id)).toMatch(/^gen_x5ojsnps/);
    }
    expect(new Set(tasks.map((t) => bodyOf(t).id)).size).toBe(3);
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

    const ids = responsesOf(data, 'hubspot', 'contact').map((r) => bodyOf(r).id);
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

    expect(bodyOf(responsesOf(data, 'attio', 'task')[0]!).id).toBe('X');
    expect(bodyOf(responsesOf(data, 'attio', 'note')[0]!).id).toBe('X');
    expect(stats.idsRepaired).toBe(0);
  });
});
