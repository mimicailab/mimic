import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultMessage, defaultThread } from '../generated/schemas.js';
import { gmailNotFound, gmailInvalidArgument } from '../gmail-errors.js';

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

/**
 * Substring-match `needle` against a stored Gmail message — snippet, every
 * `payload.headers` value (From/To/Cc/Subject/Date/...), and the decoded
 * body. Approximates real Gmail's `q=` semantics for the common bare-keyword
 * and bare-email cases. Operator syntax (`from:`, `to:`, `subject:`) is not
 * yet parsed; the operator literals fall through as substring matches.
 */
function matchesQuery(message: Record<string, unknown>, needle: string): boolean {
  if (String(message.snippet ?? '').toLowerCase().includes(needle)) return true;

  const payload = message.payload as
    | { headers?: Array<{ name: string; value: string }>; body?: { data?: string } }
    | null
    | undefined;
  if (!payload) return false;

  for (const h of payload.headers ?? []) {
    if (typeof h.value === 'string' && h.value.toLowerCase().includes(needle)) return true;
  }

  // Decode base64url body once and substring-match.
  const data = payload.body?.data;
  if (typeof data === 'string' && data.length > 0) {
    try {
      const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const decoded = Buffer.from(padded, 'base64').toString('utf-8').toLowerCase();
      if (decoded.includes(needle)) return true;
    } catch {
      // Malformed base64 — skip body match.
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// users.messages.send — POST /gmail/v1/users/:userId/messages/send
// ---------------------------------------------------------------------------

export function buildSendHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const threadId = (body.threadId as string | undefined) ?? undefined;

    // Real Gmail always tags sent mail with SENT, but may include additional
    // caller-provided labels (e.g. INBOX for self-addressed mail). Merge rather
    // than overwrite so tests can seed messages with arbitrary label combos.
    const requestedLabels = Array.isArray(body.labelIds) ? (body.labelIds as string[]) : [];
    const labelIds = requestedLabels.includes('SENT') ? requestedLabels : ['SENT', ...requestedLabels];

    const message = defaultMessage({
      ...body,
      labelIds,
      threadId: threadId ?? undefined,
    });
    if (!threadId) {
      // New thread — create it alongside the message
      const thread = defaultThread({
        id: message.id,
        snippet: message.snippet,
        messages: [message],
      });
      store.set(NS_THREADS, thread.id as string, thread);
      message.threadId = thread.id;
    } else {
      const thread = store.get<Record<string, unknown>>(NS_THREADS, threadId);
      if (thread) {
        thread.messages = [...((thread.messages as unknown[]) ?? []), message];
        store.set(NS_THREADS, threadId, thread);
      }
    }
    store.set(NS_MESSAGES, message.id as string, message);
    return reply.code(200).send(message);
  };
}

// ---------------------------------------------------------------------------
// users.messages.modify — POST /gmail/v1/users/:userId/messages/:id/modify
// ---------------------------------------------------------------------------

export function buildModifyHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = store.get<Record<string, unknown>>(NS_MESSAGES, id);
    if (!existing) return reply.code(404).send(gmailNotFound('Message', id));

    const body = (req.body ?? {}) as ModifyBody;
    const updated = {
      ...existing,
      labelIds: applyLabelMods(existing.labelIds as string[] | undefined, body.addLabelIds, body.removeLabelIds),
    };
    store.set(NS_MESSAGES, id, updated);
    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// users.messages.trash — POST /gmail/v1/users/:userId/messages/:id/trash
// ---------------------------------------------------------------------------

export function buildTrashHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = store.get<Record<string, unknown>>(NS_MESSAGES, id);
    if (!existing) return reply.code(404).send(gmailNotFound('Message', id));

    const labelIds = applyLabelMods(existing.labelIds as string[] | undefined, ['TRASH'], ['INBOX']);
    const updated = { ...existing, labelIds };
    store.set(NS_MESSAGES, id, updated);
    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// users.messages.untrash — POST /gmail/v1/users/:userId/messages/:id/untrash
// ---------------------------------------------------------------------------

export function buildUntrashHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = store.get<Record<string, unknown>>(NS_MESSAGES, id);
    if (!existing) return reply.code(404).send(gmailNotFound('Message', id));

    const labelIds = applyLabelMods(existing.labelIds as string[] | undefined, ['INBOX'], ['TRASH']);
    const updated = { ...existing, labelIds };
    store.set(NS_MESSAGES, id, updated);
    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// users.messages.batchModify — POST /gmail/v1/users/:userId/messages/batchModify
// ---------------------------------------------------------------------------

export function buildBatchModifyHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = (req.body ?? {}) as { ids?: string[] } & ModifyBody;
    if (!body.ids || body.ids.length === 0) {
      return reply.code(400).send(gmailInvalidArgument('ids must be a non-empty array'));
    }
    for (const id of body.ids) {
      const existing = store.get<Record<string, unknown>>(NS_MESSAGES, id);
      if (!existing) continue;
      const labelIds = applyLabelMods(existing.labelIds as string[] | undefined, body.addLabelIds, body.removeLabelIds);
      store.set(NS_MESSAGES, id, { ...existing, labelIds });
    }
    return reply.code(204).send();
  };
}

// ---------------------------------------------------------------------------
// users.messages.batchDelete — POST /gmail/v1/users/:userId/messages/batchDelete
// ---------------------------------------------------------------------------

export function buildBatchDeleteHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = (req.body ?? {}) as { ids?: string[] };
    if (!body.ids || body.ids.length === 0) {
      return reply.code(400).send(gmailInvalidArgument('ids must be a non-empty array'));
    }
    for (const id of body.ids) {
      store.delete(NS_MESSAGES, id);
    }
    return reply.code(204).send();
  };
}

// ---------------------------------------------------------------------------
// users.messages.list — GET /gmail/v1/users/:userId/messages
// Override the base list handler so `labelIds` array-membership filtering and
// `q` substring matching against the snippet work the way agents expect.
// ---------------------------------------------------------------------------

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, string | string[]>;
    const items = store.list<Record<string, unknown>>(NS_MESSAGES);

    // labelIds filter — every requested label must be present on the message
    let filtered = items;
    if (query.labelIds) {
      const wanted = Array.isArray(query.labelIds) ? query.labelIds : String(query.labelIds).split(',');
      filtered = filtered.filter((m) => {
        const have = (m.labelIds as string[] | undefined) ?? [];
        return wanted.every((l) => have.includes(l));
      });
    }

    // q — substring match across snippet, header values, and decoded body. Real
    // Gmail's `q=` searches all of these (plus operator syntax like `from:` /
    // `to:` / `subject:` we don't yet parse). Snippet-only matched too few
    // messages — `q=<email>` rarely appears in the snippet text but always in
    // From/To headers.
    if (typeof query.q === 'string' && query.q.trim() !== '') {
      const needle = query.q.toLowerCase();
      filtered = filtered.filter((m) => matchesQuery(m, needle));
    }

    // includeSpamTrash — default is false (exclude SPAM/TRASH)
    const includeSpamTrash = String(query.includeSpamTrash ?? '') === 'true';
    if (!includeSpamTrash) {
      filtered = filtered.filter((m) => {
        const labels = (m.labelIds as string[] | undefined) ?? [];
        return !labels.includes('SPAM') && !labels.includes('TRASH');
      });
    }

    const maxResults = Math.min(parseInt(String(query.maxResults ?? '100'), 10) || 100, 500);
    const pageToken = typeof query.pageToken === 'string' ? query.pageToken : undefined;
    let startIdx = 0;
    if (pageToken && pageToken.startsWith('pt_')) {
      const afterId = pageToken.slice(3);
      const idx = filtered.findIndex((m) => m.id === afterId);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = filtered.slice(startIdx, startIdx + maxResults);
    const hasMore = startIdx + maxResults < filtered.length;

    // List response intentionally returns sparse messages (id + threadId only) —
    // matches Gmail's documented behaviour. Callers fetch full message via .get.
    const sparse = page.map((m) => ({ id: m.id, threadId: m.threadId }));

    const out: Record<string, unknown> = {
      messages: sparse,
      resultSizeEstimate: filtered.length,
    };
    if (hasMore) out.nextPageToken = `pt_${page[page.length - 1]?.id}`;
    return reply.code(200).send(out);
  };
}
