import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { StateStore } from '@mimicai/core';
import { evalExpr, evalBool, resolveTemplate } from '../behavior/expr.js';
import { buildActionHandler, mountBehaviorPack } from '../behavior/interpreter.js';
import { loadBehaviorPack } from '../behavior/loader.js';
import type { BehaviorContext } from '../behavior/interpreter.js';

describe('behavior expression evaluator', () => {
  const scope = {
    self: { status: 'requires_capture', amount: 10000, capture_method: 'manual' },
    body: { amount_to_capture: null },
    params: { intent: 'pi_123' },
    now: 1700000000,
  };

  it('evaluates literals and member paths', () => {
    expect(evalExpr('42', {})).toBe(42);
    expect(evalExpr("'hi'", {})).toBe('hi');
    expect(evalExpr('self.amount', scope)).toBe(10000);
    expect(evalExpr('body.missing.deep', scope)).toBeUndefined();
  });

  it('handles the `!= null` nullish idiom (null and undefined equal)', () => {
    expect(evalBool('body.amount_to_capture != null', scope)).toBe(false);
    expect(evalBool('body.nope != null', scope)).toBe(false);
    expect(evalBool('self.amount != null', scope)).toBe(true);
    expect(evalBool('self.amount == null', scope)).toBe(false);
  });

  it('handles in / not-in, ternary, logical, arithmetic', () => {
    expect(evalBool("self.status in ['succeeded', 'canceled']", scope)).toBe(false);
    expect(evalBool("!(self.status in ['succeeded', 'canceled'])", scope)).toBe(true);
    expect(evalExpr("self.capture_method == 'manual' ? 'requires_capture' : 'succeeded'", scope)).toBe('requires_capture');
    expect(evalExpr('self.amount + 5', scope)).toBe(10005);
    expect(evalBool('self.amount > 9999 && self.amount < 20000', scope)).toBe(true);
  });

  it('resolves templates (whole-expression keeps type; interpolation stringifies)', () => {
    expect(resolveTemplate('{{ self.amount }}', scope)).toBe(10000);
    expect(resolveTemplate('id={{ params.intent }}', scope)).toBe('id=pi_123');
    expect(resolveTemplate({ a: '{{ self.amount }}', b: 'x' }, scope)).toEqual({ a: 10000, b: 'x' });
    expect(resolveTemplate('{{ body.amount_to_capture != null ? body.amount_to_capture : self.amount }}', scope)).toBe(10000);
  });
});

describe('behavior interpreter end-to-end', () => {
  const pack = loadBehaviorPack(`
adapter: test
idLength: 8
actions:
  - method: POST
    path: /things/:id/advance
    target: { namespace: 'test:things', id: '{{ params.id }}' }
    notFound: { status: 404, code: not_found, message: "No such thing: '{{ params.id }}'" }
    guard: "self.status != 'done'"
    guardError: { status: 400, code: bad_state, message: "status is '{{ self.status }}'" }
    effects:
      - create: child
        namespace: test:children
        idPrefix: ch_
        bind: child
        fields: { object: child, parent: '{{ params.id }}', amount: '{{ self.amount }}' }
      - set: { status: done, child: '{{ child }}' }
    emit:
      - when: "self.status == 'done'"
        event: thing.done
`);

  async function build() {
    const server = Fastify({ logger: false });
    await server.register(formbody);
    const store = new StateStore();
    const emitted: Array<{ type: string; data: unknown }> = [];
    const ctx: BehaviorContext = {
      store,
      errorFactory: (e) => ({ error: { code: e.code, message: e.message } }),
      emitSink: (ev) => emitted.push(ev),
    };
    mountBehaviorPack(pack, (m, p, h) => server.route({ method: m, url: p, handler: h }), ctx);
    await server.ready();
    return { server, store, emitted };
  }

  it('404s when the target is missing', async () => {
    const { server } = await build();
    const res = await server.inject({ method: 'POST', url: '/things/x/advance' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe("No such thing: 'x'");
  });

  it('runs guard, effects, side-effect create, and emit', async () => {
    const { server, store, emitted } = await build();
    store.set('test:things', 't1', { id: 't1', status: 'pending', amount: 500 });

    const res = await server.inject({ method: 'POST', url: '/things/t1/advance' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('done');
    expect(body.child).toMatch(/^ch_/);

    // side-effect child persisted with derived fields
    const child = store.get<Record<string, unknown>>('test:children', body.child);
    expect(child).toMatchObject({ object: 'child', parent: 't1', amount: 500 });

    // webhook emit fired
    expect(emitted).toEqual([{ type: 'thing.done', data: expect.objectContaining({ status: 'done' }) }]);
  });

  it('rejects an illegal transition via guard and leaves state untouched', async () => {
    const { server, store } = await build();
    store.set('test:things', 't2', { id: 't2', status: 'done', amount: 1 });
    const res = await server.inject({ method: 'POST', url: '/things/t2/advance' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_state');
    // unchanged
    expect(store.get('test:things', 't2')).toMatchObject({ status: 'done' });
  });
});
