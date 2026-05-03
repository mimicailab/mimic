/**
 * Marshalling for Gmail's message + thread envelope.
 *
 * Gmail is the one adapter where one body's wrap output legitimately depends
 * on knowing about other bodies — `message.threadId` is a function of the
 * *group* that shares a normalised `thread_subject`. So we use the
 * adapter-level `precomputeMarshalContext` hook to do the heavy lifting:
 *
 *   1. Walk `responses.message_email`, normalise each `thread_subject`
 *      (strip `Re:` / `Fwd:`, trim, lowercase), group by that key.
 *   2. For each group, assign a `threadId`, wrap every message into Gmail's
 *      MIME-shaped envelope (payload.headers, base64url body, RFC 2822 raw),
 *      and synthesise a thread entity that contains the wrapped messages.
 *   3. Write the thread directly to `gmail:threads`. Stash the per-body
 *      wrap result in `ctx.extras` so the standalone marshaller's `wrap`
 *      can return it without recomputing.
 *
 * The standalone marshaller for `message_email` then writes each wrapped
 * message to `gmail:messages`. Default `storageKey` (`wrapped.id`) lands
 * each message under its assigned messageId.
 */

import type { Body, Marshaller, PrecomputeMarshalContext } from '@mimicai/adapter-sdk';
import { generateId } from '@mimicai/adapter-sdk';
import { defaultMessage, defaultThread } from '../generated/schemas.js';

const NS_MESSAGES = 'gmail:messages';
const NS_THREADS = 'gmail:threads';
const EXTRAS_KEY = 'wrappedByBody';

export function buildGmailMessageMarshallers(): Marshaller[] {
  return [
    {
      kind: 'standalone',
      contentResource: 'message_email',
      namespace: NS_MESSAGES,
      // The real messageId is assigned during precompute and lives on the
      // wrapped object; this placeholder is unused (default storageKey reads
      // `wrapped.id`).
      generateId: () => 'precomputed',
      wrap: (body, _id, ctx) => {
        const map = ctx.extras.get(EXTRAS_KEY) as Map<Body, Record<string, unknown>> | undefined;
        const wrapped = map?.get(body);
        if (!wrapped) {
          throw new Error('Gmail message marshaller: precompute should have wrapped every message_email body');
        }
        return wrapped;
      },
    },
  ];
}

/** Adapter-level precompute hook — runs once per persona between pass 1 and pass 2. */
export const gmailPrecompute: PrecomputeMarshalContext = (responses, ctx, store) => {
  const emails = responses.message_email ?? [];
  if (emails.length === 0) return;

  const wrappedByBody = new Map<Body, Record<string, unknown>>();

  // Group by normalised thread_subject so reply chains collapse onto one thread.
  const groups = new Map<string, Body[]>();
  for (const resp of emails) {
    const body = (resp.body ?? {}) as Body;
    const subject = (body.thread_subject as string) || (body.subject as string) || 'Conversation';
    const key = normaliseThreadKey(subject);
    const list = groups.get(key) ?? [];
    list.push(body);
    groups.set(key, list);
  }

  for (const [, group] of groups) {
    // Stable order within thread by sent_at ascending.
    group.sort((a, b) => parseSentAt(a.sent_at) - parseSentAt(b.sent_at));

    const threadId = generateId('t', 16);
    const wrappedMessages: Record<string, unknown>[] = [];
    for (const body of group) {
      const messageId = generateId('m', 16);
      const msg = buildMessage(messageId, threadId, body);
      wrappedMessages.push(msg);
      wrappedByBody.set(body, msg);
    }

    const head = wrappedMessages[0];
    const thread = defaultThread({
      id: threadId,
      snippet: (head?.snippet as string) ?? '',
      historyId: (head?.historyId as string) ?? String(Date.now()),
      messages: wrappedMessages,
    });
    store.set(NS_THREADS, threadId, thread);
  }

  ctx.extras.set(EXTRAS_KEY, wrappedByBody);
};

// ---------------------------------------------------------------------------
// Per-message MIME wrap — same logic as the previous seed_messages.ts.
// ---------------------------------------------------------------------------

function buildMessage(messageId: string, threadId: string, b: Body): Record<string, unknown> {
  const fromName = (b.from_name as string) || '';
  const fromEmail = (b.from_email as string) || '';
  const toEmail = (b.to_email as string) || '';
  const ccEmails = (b.cc_emails as string[] | undefined) ?? [];
  const subject = (b.subject as string) || '';
  const bodyText = (b.body_text as string) || '';
  const labelIds = ((b.label_ids as string[] | undefined) ?? []).length > 0
    ? (b.label_ids as string[])
    : ['INBOX'];

  const sentAtMs = parseSentAt(b.sent_at);
  const internalDate = String(sentAtMs);

  const headers: Array<{ name: string; value: string }> = [
    { name: 'From', value: fromName ? `${fromName} <${fromEmail}>` : fromEmail },
    { name: 'To', value: toEmail },
  ];
  if (ccEmails.length) headers.push({ name: 'Cc', value: ccEmails.join(', ') });
  headers.push(
    { name: 'Subject', value: subject },
    { name: 'Date', value: new Date(sentAtMs).toUTCString() },
    { name: 'Message-ID', value: `<${messageId}@mimic.test>` },
    { name: 'Content-Type', value: 'text/plain; charset="UTF-8"' },
  );

  const bodyData = base64UrlEncode(bodyText);
  const snippet = bodyText.slice(0, 200).replace(/\s+/g, ' ').trim();
  const raw = base64UrlEncode(buildRfc2822(headers, bodyText));

  return defaultMessage({
    id: messageId,
    threadId,
    labelIds,
    snippet,
    historyId: internalDate,
    internalDate,
    sizeEstimate: bodyText.length + subject.length + 200,
    payload: {
      partId: '',
      mimeType: 'text/plain',
      filename: '',
      headers,
      body: { size: bodyText.length, data: bodyData },
      parts: [],
    },
    raw,
  });
}

function normaliseThreadKey(s: string): string {
  return s.toLowerCase().replace(/^(re:|fwd?:|fw:)\s*/g, '').trim();
}

function parseSentAt(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
    const d = Date.parse(v);
    if (Number.isFinite(d)) return d;
  }
  return Date.now();
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildRfc2822(headers: Array<{ name: string; value: string }>, body: string): string {
  const headerBlock = headers.map((h) => `${h.name}: ${h.value}`).join('\r\n');
  return `${headerBlock}\r\n\r\n${body}`;
}
