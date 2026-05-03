import { describe, it, expect } from 'vitest';
import { StateStore } from '@mimicai/core';
import type { ApiResponse, ApiResponseSet, ExpandedData } from '@mimicai/core';
import { runMarshallers } from '../marshalling.js';
import type { Marshaller } from '../marshalling.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function response(body: Record<string, unknown>): ApiResponse {
  return { statusCode: 200, headers: {}, body, personaId: 'p1' };
}

function dataFor(
  personaId: string,
  responses: Record<string, ApiResponse[]>,
): [string, ExpandedData] {
  const apiResponses: Record<string, ApiResponseSet> = {
    test: { adapterId: 'test', responses },
  };
  const ed: ExpandedData = {
    personaId,
    blueprint: { id: personaId } as any,
    tables: {},
    documents: {},
    apiResponses,
    files: [],
    events: [],
    facts: [],
  };
  return [personaId, ed];
}

// ---------------------------------------------------------------------------
// Bug-regression tests — these encode the failure modes from the briefing-agent
// run that the marshaller layer exists to make structurally impossible.
// ---------------------------------------------------------------------------

describe('runMarshallers — label collision', () => {
  it('throws with persona, contentResource, and label in the message', async () => {
    const store = new StateStore();
    const marshallers: Marshaller[] = [
      {
        kind: 'standalone',
        contentResource: 'note_content',
        namespace: 'test:notes',
        labelField: 'label',
        generateId: () => crypto.randomUUID(),
        wrap: (body, id) => ({ id, ...body }),
      },
    ];
    const data = new Map<string, ExpandedData>([
      dataFor('persona-alpha', {
        note_content: [
          response({ label: 'morning_standup', title: 'A' }),
          response({ label: 'morning_standup', title: 'B' }),
        ],
      }),
    ]);

    await expect(
      runMarshallers({ marshallers, data, store, adapterId: 'test' }),
    ).rejects.toThrow(/persona-alpha.*note_content.*morning_standup/s);
  });
});

describe('runMarshallers — orphan embedded children', () => {
  it('silently skips an embedded body whose parent label was never registered', async () => {
    const store = new StateStore();
    const marshallers: Marshaller[] = [
      {
        kind: 'standalone',
        contentResource: 'note_content',
        namespace: 'test:notes',
        labelField: 'label',
        generateId: () => 'note_real_id',
        wrap: (body, id) => ({ id, ...body, transcript: [] }),
      },
      {
        kind: 'embedded',
        contentResource: 'transcript_entry_content',
        parentResource: 'note_content',
        parentLabelField: 'note_label',
        arrayField: 'transcript',
        wrap: (body) => ({ ...body }),
      },
    ];
    const data = new Map<string, ExpandedData>([
      dataFor('p1', {
        note_content: [response({ label: 'real_note', title: 'Real' })],
        transcript_entry_content: [
          response({ note_label: 'real_note', text: 'attached' }),
          response({ note_label: 'ghost_note', text: 'orphan, should be skipped' }),
        ],
      }),
    ]);

    await expect(
      runMarshallers({ marshallers, data, store, adapterId: 'test' }),
    ).resolves.toBeUndefined();

    const note = store.get<{ transcript: Array<{ text: string }> }>(
      'test:notes',
      'note_real_id',
    );
    expect(note?.transcript.map((e) => e.text)).toEqual(['attached']);
  });
});

describe('runMarshallers — multi-persona isolation', () => {
  it('two personas may register the same label without colliding', async () => {
    const store = new StateStore();
    let counter = 0;
    const marshallers: Marshaller[] = [
      {
        kind: 'standalone',
        contentResource: 'note_content',
        namespace: 'test:notes',
        labelField: 'label',
        generateId: () => `note_${++counter}`,
        wrap: (body, id) => ({ id, persona: body.persona, label: body.label }),
      },
    ];
    const data = new Map<string, ExpandedData>([
      dataFor('persona-a', {
        note_content: [response({ label: 'shared', persona: 'a' })],
      }),
      dataFor('persona-b', {
        note_content: [response({ label: 'shared', persona: 'b' })],
      }),
    ]);

    await runMarshallers({ marshallers, data, store, adapterId: 'test' });

    const notes = store.list<{ id: string; persona: string }>('test:notes');
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((n) => n.id)).size).toBe(2);
    expect(new Set(notes.map((n) => n.persona))).toEqual(new Set(['a', 'b']));
  });
});

describe('runMarshallers — embedded declared before its standalone parent', () => {
  it('still resolves parent labels because all standalone labels register before any embedded resolves', async () => {
    const store = new StateStore();
    const marshallers: Marshaller[] = [
      // Embedded comes FIRST in the array; the runner must still register the
      // parent's labels (pass 1) before resolving embeddeds (pass 3).
      {
        kind: 'embedded',
        contentResource: 'transcript_entry_content',
        parentResource: 'note_content',
        parentLabelField: 'note_label',
        arrayField: 'transcript',
        wrap: (body) => ({ ...body }),
      },
      {
        kind: 'standalone',
        contentResource: 'note_content',
        namespace: 'test:notes',
        labelField: 'label',
        generateId: () => 'note_p1',
        wrap: (body, id) => ({ id, ...body, transcript: [] }),
      },
    ];
    const data = new Map<string, ExpandedData>([
      dataFor('p1', {
        note_content: [response({ label: 'demo_note', title: 'Demo' })],
        transcript_entry_content: [
          response({ note_label: 'demo_note', text: 'one' }),
          response({ note_label: 'demo_note', text: 'two' }),
        ],
      }),
    ]);

    await runMarshallers({ marshallers, data, store, adapterId: 'test' });

    const note = store.get<{ transcript: Array<{ text: string }> }>(
      'test:notes',
      'note_p1',
    );
    expect(note?.transcript.map((e) => e.text)).toEqual(['one', 'two']);
  });
});

describe('runMarshallers — uniqueness of contentResource', () => {
  it('throws at runner entry if two marshallers declare the same contentResource', async () => {
    const store = new StateStore();
    const marshallers: Marshaller[] = [
      {
        kind: 'standalone',
        contentResource: 'note_content',
        namespace: 'test:notes',
        wrap: (body, id) => ({ id, ...body }),
      },
      {
        kind: 'standalone',
        contentResource: 'note_content',
        namespace: 'test:other',
        wrap: (body, id) => ({ id, ...body }),
      },
    ];
    await expect(
      runMarshallers({ marshallers, data: new Map(), store, adapterId: 'test' }),
    ).rejects.toThrow(/note_content.*more than one marshaller/);
  });
});

describe('runMarshallers — precomputeMarshalContext hook', () => {
  it('runs once per persona between pass 1 and pass 2 with labels already registered', async () => {
    const store = new StateStore();
    const calls: Array<{ personaId: string; canResolve: boolean }> = [];
    const marshallers: Marshaller[] = [
      {
        kind: 'standalone',
        contentResource: 'note_content',
        namespace: 'test:notes',
        labelField: 'label',
        generateId: () => `note_${calls.length + 1}`,
        wrap: (body, id, ctx) => ({
          id,
          ...body,
          extra: ctx.extras.get('marker'),
        }),
      },
    ];
    const data = new Map<string, ExpandedData>([
      dataFor('p1', {
        note_content: [response({ label: 'L1', title: 'a' })],
      }),
    ]);

    await runMarshallers({
      marshallers,
      data,
      store,
      adapterId: 'test',
      precompute: (_responses, ctx) => {
        calls.push({
          personaId: ctx.personaId,
          canResolve: ctx.lookupId('note_content', 'L1') !== undefined,
        });
        ctx.extras.set('marker', 'precomputed');
      },
    });

    expect(calls).toEqual([{ personaId: 'p1', canResolve: true }]);
    const notes = store.list<{ extra: string }>('test:notes');
    expect(notes[0]?.extra).toBe('precomputed');
  });
});

describe('runMarshallers — default storageKey', () => {
  it('uses wrapped.id when storageKey is not provided', async () => {
    const store = new StateStore();
    const marshallers: Marshaller[] = [
      {
        kind: 'standalone',
        contentResource: 'thing',
        namespace: 'test:things',
        generateId: () => 'gen_xyz',
        wrap: (body, id) => ({ id, name: body.name }),
      },
    ];
    const data = new Map<string, ExpandedData>([
      dataFor('p1', { thing: [response({ name: 'one' })] }),
    ]);

    await runMarshallers({ marshallers, data, store, adapterId: 'test' });

    expect(store.get('test:things', 'gen_xyz')).toEqual({ id: 'gen_xyz', name: 'one' });
  });

  it('uses storageKey when provided (composite-key case)', async () => {
    const store = new StateStore();
    const marshallers: Marshaller[] = [
      {
        kind: 'standalone',
        contentResource: 'message',
        namespace: 'test:messages',
        generateId: () => 'msg_gen',
        wrap: (body, id) => ({ id, channel: body.channel, ts: body.ts }),
        storageKey: (wrapped) => `${wrapped.channel}:${wrapped.ts}`,
      },
    ];
    const data = new Map<string, ExpandedData>([
      dataFor('p1', {
        message: [response({ channel: 'C123', ts: '1700.0001' })],
      }),
    ]);

    await runMarshallers({ marshallers, data, store, adapterId: 'test' });

    expect(store.get('test:messages', 'C123:1700.0001')).toBeDefined();
    expect(store.get('test:messages', 'msg_gen')).toBeUndefined();
  });
});

describe('runMarshallers — namespace as function', () => {
  it('per-body namespace fn routes to different stores by discriminator', async () => {
    const store = new StateStore();
    let counter = 0;
    const marshallers: Marshaller[] = [
      {
        kind: 'standalone',
        contentResource: 'record',
        namespace: (body) => `test:records:${body.kind}`,
        generateId: () => `rec_${++counter}`,
        wrap: (body, id) => ({ id, ...body }),
      },
    ];
    const data = new Map<string, ExpandedData>([
      dataFor('p1', {
        record: [
          response({ kind: 'people', name: 'Sarah' }),
          response({ kind: 'companies', name: 'Northwind' }),
        ],
      }),
    ]);

    await runMarshallers({ marshallers, data, store, adapterId: 'test' });

    expect(store.list('test:records:people')).toHaveLength(1);
    expect(store.list('test:records:companies')).toHaveLength(1);
  });
});
