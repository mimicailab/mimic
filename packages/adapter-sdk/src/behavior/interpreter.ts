/**
 * Behavior DSL interpreter.
 *
 * Compiles a declarative ActionSpec into a Fastify override handler that
 * executes against the StateStore. This is the generic engine that replaces
 * per-adapter hand-written state-machine overrides.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { StateStore } from '@mimicai/core';
import { generateId } from '@mimicai/core';
import { unixNow } from '../format-helpers.js';
import { evalBool, resolveTemplate } from './expr.js';
import type {
  ActionSpec, BehaviorPack, Effect, EmitSpec, ErrorSpec, TargetRef,
} from './types.js';

/** Builds the platform-specific error envelope from an ErrorSpec. */
export type ErrorFactory = (spec: { code: string; message: string; kind?: string; param?: string }) => unknown;

/** Sink for webhook emits produced by behavior actions. */
export type EmitSink = (event: { type: string; data: unknown }) => void;

export interface BehaviorContext {
  store: StateStore;
  /** Produces the response body for an error (platform envelope). */
  errorFactory: ErrorFactory;
  /** Optional webhook emit sink (wired to the delivery engine). */
  emitSink?: EmitSink;
  /** Default id length for generated ids. */
  idLength?: number;
}

/** Internal signal used to abort effect execution with an error response. */
class BehaviorAbort {
  constructor(public readonly spec: ErrorSpec) {}
}

function buildScope(req: FastifyRequest): Record<string, unknown> {
  return {
    body: (req.body ?? {}) as Record<string, unknown>,
    params: (req.params ?? {}) as Record<string, unknown>,
    query: (req.query ?? {}) as Record<string, unknown>,
    now: unixNow(),                       // unix seconds (Stripe-style)
    nowIso: new Date().toISOString(),     // ISO-8601 string (Recurly-style)
  };
}

function loadTarget(target: TargetRef, scope: Record<string, unknown>, store: StateStore): Record<string, unknown> | undefined {
  const id = String(resolveTemplate(target.id, scope));
  return store.get<Record<string, unknown>>(target.namespace, id);
}

function runEffect(effect: Effect, scope: Record<string, unknown>, ctx: BehaviorContext, defaultLen: number): void {
  if ('error' in effect) {
    throw new BehaviorAbort(effect.error);
  }

  if ('when' in effect) {
    if (evalBool(effect.when, scope)) {
      for (const e of effect.then) runEffect(e, scope, ctx, defaultLen);
    } else if (effect.else) {
      for (const e of effect.else) runEffect(e, scope, ctx, defaultLen);
    }
    return;
  }

  if ('var' in effect) {
    for (const [name, tpl] of Object.entries(effect.var)) {
      scope[name] = resolveTemplate(tpl, scope);
    }
    return;
  }

  if ('create' in effect) {
    const id = generateId(effect.idPrefix, effect.idLength ?? defaultLen);
    // Bind the new id BEFORE resolving fields so `fields.id` and later
    // references can use it.
    if (effect.bind) scope[effect.bind] = id;
    const obj = resolveTemplate(effect.fields, scope) as Record<string, unknown>;
    obj.id = id;
    ctx.store.set(effect.namespace, id, obj);
    return;
  }

  if ('update' in effect) {
    const id = String(resolveTemplate(effect.update.id, scope));
    const existing = ctx.store.get<Record<string, unknown>>(effect.update.namespace, id);
    if (existing) {
      const patch = resolveTemplate(effect.update.set, scope) as Record<string, unknown>;
      ctx.store.set(effect.update.namespace, id, { ...existing, ...patch });
    }
    return;
  }

  if ('set' in effect) {
    const self = scope.self as Record<string, unknown>;
    const patch = resolveTemplate(effect.set, scope) as Record<string, unknown>;
    Object.assign(self, patch);
    return;
  }

  if ('merge' in effect) {
    const self = scope.self as Record<string, unknown>;
    const obj = resolveTemplate(effect.merge, scope);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      Object.assign(self, obj as Record<string, unknown>);
    }
    return;
  }
}

function runEmits(emits: EmitSpec[], scope: Record<string, unknown>, ctx: BehaviorContext): void {
  if (!ctx.emitSink) return;
  for (const emit of emits) {
    if (emit.when && !evalBool(emit.when, scope)) continue;
    const data = emit.data != null ? resolveTemplate(emit.data, scope) : scope.self;
    ctx.emitSink({ type: emit.event, data });
  }
}

/** Compile one ActionSpec into a Fastify handler. */
export function buildActionHandler(action: ActionSpec, ctx: BehaviorContext) {
  const defaultLen = ctx.idLength ?? 14;

  return async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const scope = buildScope(req);

    // Load the target resource (mutated in place, then re-stored).
    if (action.target) {
      const found = loadTarget(action.target, scope, ctx.store);
      if (!found) {
        if (action.notFound) {
          const s = action.notFound;
          return reply.code(s.status).send(ctx.errorFactory({
            code: s.code, kind: s.kind, param: s.param,
            message: String(resolveTemplate(s.message, scope)),
          }));
        }
        return reply.code(404).send(ctx.errorFactory({ code: 'resource_missing', message: 'Not found' }));
      }
      // Work on a copy so a guard failure leaves the store untouched.
      scope.self = { ...found };
    }

    // Guard.
    if (action.guard && !evalBool(action.guard, scope)) {
      const s = action.guardError ?? { status: 400, code: 'invalid_request', message: 'Invalid state' };
      return reply.code(s.status).send(ctx.errorFactory({
        code: s.code, kind: s.kind, param: s.param,
        message: String(resolveTemplate(s.message, scope)),
      }));
    }

    // Effects.
    try {
      for (const effect of action.effects ?? []) runEffect(effect, scope, ctx, defaultLen);
    } catch (err) {
      if (err instanceof BehaviorAbort) {
        const s = err.spec;
        return reply.code(s.status).send(ctx.errorFactory({
          code: s.code, kind: s.kind, param: s.param,
          message: String(resolveTemplate(s.message, scope)),
        }));
      }
      throw err;
    }

    // Persist (or delete) the target.
    if (action.target) {
      const id = String(resolveTemplate(action.target.id, scope));
      if (action.delete) {
        ctx.store.delete(action.target.namespace, id);
      } else {
        ctx.store.set(action.target.namespace, id, scope.self);
      }
    }

    // Emits (post-effect).
    if (action.emit) runEmits(action.emit, scope, ctx);

    // Response.
    const bodyOut = action.respond != null ? resolveTemplate(action.respond, scope) : scope.self;
    return reply.code(action.status ?? 200).send(bodyOut);
  };
}

/** Registration callback signature matching `OpenApiMockAdapter.registerOverride`. */
export type RegisterOverrideFn = (
  method: ActionSpec['method'],
  path: string,
  handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) => void;

/**
 * Mount every action in a behavior pack onto an adapter via its
 * `registerOverride` mechanism.
 */
export function mountBehaviorPack(pack: BehaviorPack, register: RegisterOverrideFn, ctx: BehaviorContext): void {
  const merged: BehaviorContext = { ...ctx, idLength: ctx.idLength ?? pack.idLength };
  for (const action of pack.actions) {
    register(action.method, action.path, buildActionHandler(action, merged));
  }
}
