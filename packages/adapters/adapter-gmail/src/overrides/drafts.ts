import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultDraft, defaultMessage, defaultThread } from '../generated/schemas.js';
import { gmailNotFound } from '../gmail-errors.js';

const NS_DRAFTS = 'gmail:drafts';
const NS_MESSAGES = 'gmail:messages';
const NS_THREADS = 'gmail:threads';

interface DraftBody {
  id?: string;
  message?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// users.drafts.create — POST /gmail/v1/users/:userId/drafts
// Gmail nests the message under `message`; the base CRUD handler doesn't know
// to materialise both Draft and Message records in lockstep.
// ---------------------------------------------------------------------------

export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = (req.body ?? {}) as DraftBody;
    const message = defaultMessage({
      ...(body.message ?? {}),
      labelIds: ['DRAFT'],
    });
    const draft = defaultDraft({ message });
    store.set(NS_MESSAGES, message.id as string, message);
    store.set(NS_DRAFTS, draft.id as string, draft);
    return reply.code(200).send(draft);
  };
}

// ---------------------------------------------------------------------------
// users.drafts.update — PUT /gmail/v1/users/:userId/drafts/:id
// Replaces the draft's message contents.
// ---------------------------------------------------------------------------

export function buildUpdateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = store.get<Record<string, unknown>>(NS_DRAFTS, id);
    if (!existing) return reply.code(404).send(gmailNotFound('Draft', id));

    const body = (req.body ?? {}) as DraftBody;
    const oldMessage = (existing.message as Record<string, unknown> | undefined) ?? {};
    const oldMsgId = oldMessage.id as string | undefined;

    const newMessage = defaultMessage({
      ...(body.message ?? {}),
      // Preserve the existing message id so callers tracking it stay valid
      id: oldMsgId,
      labelIds: ['DRAFT'],
    });
    const updatedDraft = { ...existing, message: newMessage };

    if (oldMsgId) store.set(NS_MESSAGES, oldMsgId, newMessage);
    store.set(NS_DRAFTS, id, updatedDraft);
    return reply.code(200).send(updatedDraft);
  };
}

// ---------------------------------------------------------------------------
// users.drafts.send — POST /gmail/v1/users/:userId/drafts/send
// Promotes the draft's message to a sent message and removes the draft.
// ---------------------------------------------------------------------------

export function buildSendHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = (req.body ?? {}) as DraftBody;
    if (!body.id) {
      return reply
        .code(400)
        .send({ error: { code: 400, message: 'draft id is required', errors: [], status: 'INVALID_ARGUMENT' } });
    }
    const draft = store.get<Record<string, unknown>>(NS_DRAFTS, body.id);
    if (!draft) return reply.code(404).send(gmailNotFound('Draft', body.id));

    const draftMessage = (draft.message as Record<string, unknown> | undefined) ?? defaultMessage({});
    const sent = defaultMessage({
      ...draftMessage,
      labelIds: ['SENT'],
    });

    // Establish (or reuse) the thread
    const threadId = (sent.threadId as string | undefined) ?? (sent.id as string);
    sent.threadId = threadId;
    let thread = store.get<Record<string, unknown>>(NS_THREADS, threadId);
    if (!thread) {
      thread = defaultThread({ id: threadId, snippet: sent.snippet, messages: [sent] });
    } else {
      thread.messages = [...((thread.messages as unknown[]) ?? []), sent];
    }
    store.set(NS_THREADS, threadId, thread);
    store.set(NS_MESSAGES, sent.id as string, sent);

    // Remove the draft + its message
    const oldMsgId = draftMessage.id as string | undefined;
    if (oldMsgId) store.delete(NS_MESSAGES, oldMsgId);
    store.delete(NS_DRAFTS, body.id);

    return reply.code(200).send(sent);
  };
}
