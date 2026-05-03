import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { gmailNotFound } from '../gmail-errors.js';

const NS_MESSAGES = 'gmail:messages';
const NS_THREADS = 'gmail:threads';

interface ModifyBody {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

function applyLabelMods(
  current: string[] | undefined,
  add?: string[],
  remove?: string[],
): string[] {
  const set = new Set(current ?? []);
  for (const id of add ?? []) set.add(id);
  for (const id of remove ?? []) set.delete(id);
  return [...set];
}

/** Apply label additions/removals to every message in the thread, return updated thread. */
function mutateThreadAndMessages(
  store: StateStore,
  threadId: string,
  add?: string[],
  remove?: string[],
): Record<string, unknown> | null {
  const thread = store.get<Record<string, unknown>>(NS_THREADS, threadId);
  if (!thread) return null;

  const messageIds = Array.isArray(thread.messages)
    ? (thread.messages as Array<Record<string, unknown> | string>).map((m) =>
        typeof m === 'string' ? m : (m.id as string),
      )
    : [];

  const updatedMessages: Record<string, unknown>[] = [];
  for (const mid of messageIds) {
    const msg = store.get<Record<string, unknown>>(NS_MESSAGES, mid);
    if (!msg) continue;
    const labelIds = applyLabelMods(msg.labelIds as string[] | undefined, add, remove);
    const updated = { ...msg, labelIds };
    store.set(NS_MESSAGES, mid, updated);
    updatedMessages.push(updated);
  }

  const updatedThread = { ...thread, messages: updatedMessages };
  store.set(NS_THREADS, threadId, updatedThread);
  return updatedThread;
}

// ---------------------------------------------------------------------------
// users.threads.modify — POST /gmail/v1/users/:userId/threads/:id/modify
// ---------------------------------------------------------------------------

export function buildModifyHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as ModifyBody;
    const updated = mutateThreadAndMessages(store, id, body.addLabelIds, body.removeLabelIds);
    if (!updated) return reply.code(404).send(gmailNotFound('Thread', id));
    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// users.threads.trash — POST /gmail/v1/users/:userId/threads/:id/trash
// ---------------------------------------------------------------------------

export function buildTrashHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { id } = req.params as { id: string };
    const updated = mutateThreadAndMessages(store, id, ['TRASH'], ['INBOX']);
    if (!updated) return reply.code(404).send(gmailNotFound('Thread', id));
    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// users.threads.untrash — POST /gmail/v1/users/:userId/threads/:id/untrash
// ---------------------------------------------------------------------------

export function buildUntrashHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { id } = req.params as { id: string };
    const updated = mutateThreadAndMessages(store, id, ['INBOX'], ['TRASH']);
    if (!updated) return reply.code(404).send(gmailNotFound('Thread', id));
    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// users.threads.list — GET /gmail/v1/users/:userId/threads
// Same labelIds + q + spam/trash filtering as messages.list.
// ---------------------------------------------------------------------------

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, string | string[]>;
    const threads = store.list<Record<string, unknown>>(NS_THREADS);

    const matchesLabels = (thread: Record<string, unknown>, wanted: string[]): boolean => {
      const messages = (thread.messages as Array<Record<string, unknown>>) ?? [];
      // A thread matches if any message in it carries all the wanted labels
      return messages.some((m) => {
        const have = (m.labelIds as string[] | undefined) ?? [];
        return wanted.every((l) => have.includes(l));
      });
    };

    let filtered = threads;
    if (query.labelIds) {
      const wanted = Array.isArray(query.labelIds) ? query.labelIds : String(query.labelIds).split(',');
      filtered = filtered.filter((t) => matchesLabels(t, wanted));
    }
    if (typeof query.q === 'string' && query.q.trim() !== '') {
      const needle = query.q.toLowerCase();
      filtered = filtered.filter((t) => String(t.snippet ?? '').toLowerCase().includes(needle));
    }
    const includeSpamTrash = String(query.includeSpamTrash ?? '') === 'true';
    if (!includeSpamTrash) {
      filtered = filtered.filter((t) => {
        const messages = (t.messages as Array<Record<string, unknown>>) ?? [];
        // Hide threads where every message is in SPAM/TRASH
        return messages.some((m) => {
          const labels = (m.labelIds as string[] | undefined) ?? [];
          return !labels.includes('SPAM') && !labels.includes('TRASH');
        });
      });
    }

    const maxResults = Math.min(parseInt(String(query.maxResults ?? '100'), 10) || 100, 500);
    const pageToken = typeof query.pageToken === 'string' ? query.pageToken : undefined;
    let startIdx = 0;
    if (pageToken && pageToken.startsWith('pt_')) {
      const afterId = pageToken.slice(3);
      const idx = filtered.findIndex((t) => t.id === afterId);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = filtered.slice(startIdx, startIdx + maxResults);
    const hasMore = startIdx + maxResults < filtered.length;

    const sparse = page.map((t) => ({
      id: t.id,
      snippet: t.snippet,
      historyId: t.historyId,
    }));
    const out: Record<string, unknown> = {
      threads: sparse,
      resultSizeEstimate: filtered.length,
    };
    if (hasMore) out.nextPageToken = `pt_${page[page.length - 1]?.id}`;
    return reply.code(200).send(out);
  };
}
