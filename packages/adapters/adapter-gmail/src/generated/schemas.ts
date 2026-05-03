// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-gmail generate
import { generateId } from '@mimicai/adapter-sdk';
import type { DefaultFactory } from '@mimicai/adapter-sdk';

/**
 * Hand-tuned default factories. Codegen rewrites this file but the factory
 * bodies are preserved across regeneration (templates live in scripts/gmail-codegen.ts).
 */

export function defaultMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = generateId('m', 16);
  const now = Date.now();
  return {
    id,
    threadId: id,
    labelIds: ['INBOX', 'UNREAD'],
    snippet: '',
    historyId: String(now),
    internalDate: String(now),
    sizeEstimate: 0,
    payload: {
      partId: '',
      mimeType: 'text/plain',
      filename: '',
      headers: [],
      body: { size: 0, data: '' },
      parts: [],
    },
    raw: '',
    classificationLabelValues: [],
    ...overrides,
  };
}

export function defaultThread(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId('t', 16),
    snippet: '',
    historyId: String(Date.now()),
    messages: [],
    ...overrides,
  };
}

export function defaultLabel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId('Label', 12),
    name: 'New Label',
    type: 'user',
    messageListVisibility: 'show',
    labelListVisibility: 'labelShow',
    messagesTotal: 0,
    messagesUnread: 0,
    threadsTotal: 0,
    threadsUnread: 0,
    color: undefined,
    ...overrides,
  };
}

export function defaultDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId('r', 18),
    message: defaultMessage({ labelIds: ['DRAFT'] }),
    ...overrides,
  };
}

export function defaultProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    emailAddress: 'user@example.com',
    messagesTotal: 0,
    threadsTotal: 0,
    historyId: String(Date.now()),
    ...overrides,
  };
}

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
  "message": defaultMessage,
  "messages": defaultMessage,
  "thread": defaultThread,
  "threads": defaultThread,
  "label": defaultLabel,
  "labels": defaultLabel,
  "draft": defaultDraft,
  "drafts": defaultDraft,
  "profile": defaultProfile,
  "profiles": defaultProfile,
};
