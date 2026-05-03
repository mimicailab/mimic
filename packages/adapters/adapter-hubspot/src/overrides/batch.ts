/**
 * Generic batch handlers. HubSpot exposes 5 batch verbs across every CRM
 * object type:
 *
 *   POST /<resource>/batch/create   — body { inputs: [{ properties }] } → create N
 *   POST /<resource>/batch/read     — body { inputs: [{ id }], properties } → fetch N
 *   POST /<resource>/batch/update   — body { inputs: [{ id, properties }] } → patch N
 *   POST /<resource>/batch/upsert   — body { inputs: [{ idProperty, id, properties }] } → match-or-create
 *   POST /<resource>/batch/archive  — body { inputs: [{ id }] } → archive N (returns 204)
 *
 * Response shape: `{ status: "COMPLETE", results: [...], startedAt, completedAt }`.
 */

import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import type { DefaultFactory } from '@mimicai/adapter-sdk';
import { generateId } from '@mimicai/adapter-sdk';
import { hubspotNotFound } from '../hubspot-errors.js';
import { parseBody } from './_shared.js';

interface BatchEnvelope {
  status: 'COMPLETE';
  results: unknown[];
  startedAt: string;
  completedAt: string;
}

function envelope(results: unknown[]): BatchEnvelope {
  const now = new Date().toISOString();
  return { status: 'COMPLETE', results, startedAt: now, completedAt: now };
}

/** Build a "batch create" handler bound to a namespace + factory. */
export function buildBatchCreateHandler(store: StateStore, ns: string, factory: DefaultFactory): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const inputs = (body.inputs as Array<Record<string, unknown>> | undefined) ?? [];
    const results: unknown[] = [];
    for (const input of inputs) {
      const obj = factory({
        id: (input.id as string) ?? generateId('', 18),
        ...input,
      });
      store.set(ns, obj.id as string, obj);
      results.push(obj);
    }
    return reply.code(201).send(envelope(results));
  };
}

/** Build a "batch read" handler bound to a namespace. */
export function buildBatchReadHandler(store: StateStore, ns: string): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const inputs = (body.inputs as Array<{ id: string }> | undefined) ?? [];
    const results: unknown[] = [];
    const errors: Array<Record<string, unknown>> = [];
    for (const input of inputs) {
      const obj = store.get<Record<string, unknown>>(ns, input.id);
      if (obj) {
        results.push(obj);
      } else {
        errors.push({ status: 'error', category: 'OBJECT_NOT_FOUND', message: `Unable to find resource with id "${input.id}"` });
      }
    }
    const env = envelope(results) as BatchEnvelope & { numErrors?: number; errors?: unknown[] };
    if (errors.length > 0) {
      env.numErrors = errors.length;
      env.errors = errors;
    }
    return reply.code(200).send(env);
  };
}

/** Build a "batch update" handler bound to a namespace. */
export function buildBatchUpdateHandler(store: StateStore, ns: string): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const inputs = (body.inputs as Array<{ id: string; properties: Record<string, unknown> }> | undefined) ?? [];
    const results: unknown[] = [];
    const errors: Array<Record<string, unknown>> = [];
    for (const input of inputs) {
      const existing = store.get<Record<string, unknown>>(ns, input.id);
      if (!existing) {
        errors.push({ status: 'error', category: 'OBJECT_NOT_FOUND', message: `Unable to find resource with id "${input.id}"` });
        continue;
      }
      const updated = {
        ...existing,
        properties: { ...(existing.properties as Record<string, unknown>), ...input.properties },
        updatedAt: new Date().toISOString(),
      };
      store.set(ns, input.id, updated);
      results.push(updated);
    }
    const env = envelope(results) as BatchEnvelope & { numErrors?: number; errors?: unknown[] };
    if (errors.length > 0) {
      env.numErrors = errors.length;
      env.errors = errors;
    }
    return reply.code(200).send(env);
  };
}

/** Build a "batch upsert" handler bound to a namespace + factory. */
export function buildBatchUpsertHandler(store: StateStore, ns: string, factory: DefaultFactory): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const inputs = (body.inputs as Array<{ id?: string; idProperty?: string; properties: Record<string, unknown> }> | undefined) ?? [];
    const results: unknown[] = [];
    for (const input of inputs) {
      let existing: Record<string, unknown> | undefined;
      if (input.idProperty && input.properties[input.idProperty] !== undefined) {
        const matchValue = input.properties[input.idProperty];
        existing = store
          .list<Record<string, unknown>>(ns)
          .find((item) => (item.properties as Record<string, unknown> | undefined)?.[input.idProperty!] === matchValue);
      } else if (input.id) {
        existing = store.get<Record<string, unknown>>(ns, input.id);
      }

      if (existing) {
        const updated = {
          ...existing,
          properties: { ...(existing.properties as Record<string, unknown>), ...input.properties },
          updatedAt: new Date().toISOString(),
        };
        store.set(ns, existing.id as string, updated);
        results.push(updated);
      } else {
        const obj = factory({
          id: input.id ?? generateId('', 18),
          properties: input.properties,
        });
        store.set(ns, obj.id as string, obj);
        results.push(obj);
      }
    }
    return reply.code(200).send(envelope(results));
  };
}

/** Build a "batch archive" handler bound to a namespace. Archive = soft delete (`archived: true`). */
export function buildBatchArchiveHandler(store: StateStore, ns: string): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const inputs = (body.inputs as Array<{ id: string }> | undefined) ?? [];
    for (const input of inputs) {
      const existing = store.get<Record<string, unknown>>(ns, input.id);
      if (existing) {
        store.set(ns, input.id, { ...existing, archived: true, updatedAt: new Date().toISOString() });
      }
    }
    // Real HubSpot returns 204 No Content for archive
    return reply.code(204).send();
  };
}

/** Generic 404 response for batch endpoints when the resource doesn't exist. */
export function buildBatchNotFoundHandler(resource: string): OverrideHandler {
  return async (req, reply) => {
    void req;
    return reply.code(404).send(hubspotNotFound(resource, 'batch'));
  };
}
