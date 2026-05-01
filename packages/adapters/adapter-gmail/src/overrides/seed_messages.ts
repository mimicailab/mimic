/**
 * Custom seeder for Gmail messages.
 *
 * Gmail's `Message` schema in Discovery declares every field optional, so
 * the persona generator left snippet/payload/id empty (47/47 messages were
 * empty shells). The codegen now declares a `message_email` pseudo-resource
 * with flat content fields (from_name, to_email, subject, body_text, …) the
 * LLM populates from persona narrative; this seeder wraps each entry into
 * the real Gmail wire shape — MIME-style payload with headers + base64url
 * body, plus an RFC 2822 `raw` blob — so clients calling `messages.get` see
 * exactly what real Gmail returns.
 *
 * Threading: messages with the same `thread_subject` (case- and prefix-
 * insensitive: "Re: foo" merges with "foo") collapse into one thread.
 * The first message's `id` becomes the `threadId`. This mirrors how Gmail
 * forms thread IDs in practice.
 */

import type { ExpandedData, StateStore } from '@mimicai/core';
import { generateId } from '@mimicai/adapter-sdk';
import { defaultMessage, defaultThread } from '../generated/schemas.js';

const NS_MESSAGES = 'gmail:messages';
const NS_THREADS = 'gmail:threads';

type Body = Record<string, unknown>;

export function seedGmailMessages(
  data: Map<string, ExpandedData>,
  store: StateStore,
): void {
  for (const [, expanded] of data) {
    const responses = expanded.apiResponses?.gmail?.responses;
    if (!responses) continue;
    const emails = responses.message_email;
    if (!emails || emails.length === 0) continue;

    // Group messages by normalised thread_subject so reply chains collapse.
    const threadGroups = new Map<string, Body[]>();
    for (const resp of emails) {
      const body = (resp.body ?? {}) as Body;
      const key = normaliseThreadKey(
        (body.thread_subject as string) || (body.subject as string) || 'Conversation',
      );
      const list = threadGroups.get(key) ?? [];
      list.push(body);
      threadGroups.set(key, list);
    }

    for (const [, group] of threadGroups) {
      // Stable order within thread by sent_at ascending
      group.sort((a, b) => Number(a.sent_at ?? 0) - Number(b.sent_at ?? 0));

      const threadId = generateId('t', 16);
      const messages: Record<string, unknown>[] = [];

      for (const body of group) {
        const messageId = generateId('m', 16);
        const msg = buildMessage(messageId, threadId, body);
        store.set(NS_MESSAGES, messageId, msg);
        messages.push(msg);
      }

      const head = messages[0];
      const thread = defaultThread({
        id: threadId,
        snippet: (head?.snippet as string) ?? '',
        historyId: (head?.historyId as string) ?? String(Date.now()),
        messages,
      });
      store.set(NS_THREADS, threadId, thread);
    }
  }
}

function normaliseThreadKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/^(re:|fwd?:|fw:)\s*/g, '')
    .trim();
}

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
  return Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildRfc2822(headers: Array<{ name: string; value: string }>, body: string): string {
  const headerBlock = headers.map((h) => `${h.name}: ${h.value}`).join('\r\n');
  return `${headerBlock}\r\n\r\n${body}`;
}
