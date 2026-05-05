import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultComment, defaultThread } from '../generated/schemas.js';
import { NS, buildId, getParam, nowIso, parseBody, send404, sendData, uuid } from './_shared.js';

/**
 * Attach seeded comments to their parent threads. Real Attio surfaces
 * comments through the parent thread's `comments` array, not via a
 * `GET /v2/comments` list endpoint. The auto-seeder writes comments to
 * `attio:comments` correctly but does not run the parent-attach logic that
 * `buildCreateHandler` uses on POST. This walks every seeded comment, finds
 * its parent thread by `thread_id`, and appends it.
 *
 * Idempotent: if a comment is already in its thread's `comments` array
 * (matched by `id.comment_id` for marshalled comments, or by flat `id`
 * string for seeded comments), it is not duplicated.
 */
export function hydrateThreadComments(store: StateStore): void {
  const comments = store.list<Record<string, unknown>>(NS.comments);
  for (const comment of comments) {
    const threadId = comment.thread_id as string | undefined;
    if (!threadId) continue;
    const thread = store.get<Record<string, unknown>>(NS.threads, threadId);
    if (!thread) continue;
    const existing = (thread.comments as unknown[] | undefined) ?? [];
    if (existing.some((c) => sameComment(c, comment))) continue;
    store.set(NS.threads, threadId, {
      ...thread,
      comments: [...existing, comment],
    });
  }
}

function sameComment(a: unknown, b: unknown): boolean {
  const aid = commentIdOf(a);
  const bid = commentIdOf(b);
  return aid !== undefined && aid === bid;
}

function commentIdOf(c: unknown): string | undefined {
  if (!c || typeof c !== 'object') return undefined;
  const id = (c as Record<string, unknown>).id;
  if (typeof id === 'string') return id;
  if (id && typeof id === 'object') {
    const cid = (id as Record<string, unknown>).comment_id;
    if (typeof cid === 'string') return cid;
  }
  return undefined;
}

export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;

    // If `thread_id` provided, attach to existing thread; otherwise create one.
    let threadId = (data.thread_id as string) ?? '';
    if (!threadId) {
      const newThread = defaultThread({
        id: buildId(undefined, 'thread_id'),
        created_at: nowIso(),
        comments: [],
      });
      threadId = (newThread.id as Record<string, string>).thread_id!;
      store.set(NS.threads, threadId, newThread);
    }

    const id = buildId(data.id as Record<string, string> | undefined, 'comment_id');
    const comment = defaultComment({
      ...data,
      id,
      thread_id: threadId,
      created_at: nowIso(),
    });
    store.set(NS.comments, id.comment_id!, comment);

    // Attach to thread.
    const thread = store.get<Record<string, unknown>>(NS.threads, threadId);
    if (thread) {
      const list = ((thread.comments as unknown[] | undefined) ?? []).slice();
      list.push(comment);
      store.set(NS.threads, threadId, { ...thread, comments: list });
    }

    return sendData(reply, comment);
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'comment_id');
    const comment = store.get<Record<string, unknown>>(NS.comments, id);
    if (!comment) return send404(reply, 'Comment', id);
    return sendData(reply, comment);
  };
}

export function buildDeleteHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'comment_id');
    const comment = store.get<Record<string, unknown>>(NS.comments, id);
    if (!comment) return send404(reply, 'Comment', id);
    store.delete(NS.comments, id);

    // Remove from parent thread's comments array
    const threadId = comment.thread_id as string | undefined;
    if (threadId) {
      const thread = store.get<Record<string, unknown>>(NS.threads, threadId);
      if (thread) {
        const list = ((thread.comments as Array<Record<string, unknown>> | undefined) ?? [])
          .filter((c) => (c.id as Record<string, string>).comment_id !== id);
        store.set(NS.threads, threadId, { ...thread, comments: list });
      }
    }

    return reply.code(200).send({});
  };
}

// Avoid unused export warning if generator imports change
void uuid;
