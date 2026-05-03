import type { StateStore } from '@mimicai/core';

const NS_LABELS = 'gmail:labels';

/**
 * Gmail's eight always-on system labels. Real Gmail also exposes CATEGORY_*,
 * CHAT, and a few more — they're omitted here for the MVP.
 */
const SYSTEM_LABELS: Array<Record<string, unknown>> = [
  { id: 'INBOX', name: 'INBOX', type: 'system', messageListVisibility: 'show', labelListVisibility: 'labelShow' },
  { id: 'SENT', name: 'SENT', type: 'system', messageListVisibility: 'hide', labelListVisibility: 'labelHide' },
  { id: 'DRAFT', name: 'DRAFT', type: 'system', messageListVisibility: 'hide', labelListVisibility: 'labelHide' },
  { id: 'TRASH', name: 'TRASH', type: 'system', messageListVisibility: 'hide', labelListVisibility: 'labelHide' },
  { id: 'SPAM', name: 'SPAM', type: 'system', messageListVisibility: 'hide', labelListVisibility: 'labelHide' },
  { id: 'STARRED', name: 'STARRED', type: 'system', messageListVisibility: 'show', labelListVisibility: 'labelShow' },
  { id: 'IMPORTANT', name: 'IMPORTANT', type: 'system', messageListVisibility: 'show', labelListVisibility: 'labelShow' },
  { id: 'UNREAD', name: 'UNREAD', type: 'system', messageListVisibility: 'show', labelListVisibility: 'labelShow' },
];

/**
 * Idempotently seed the system labels into the store. Called once during
 * `mountOverrides` so a freshly-built adapter has them available even before
 * any persona data is loaded.
 */
export function seedSystemLabels(store: StateStore): void {
  for (const label of SYSTEM_LABELS) {
    const existing = store.get(NS_LABELS, label.id as string);
    if (!existing) {
      store.set(NS_LABELS, label.id as string, {
        ...label,
        messagesTotal: 0,
        messagesUnread: 0,
        threadsTotal: 0,
        threadsUnread: 0,
      });
    }
  }
}
