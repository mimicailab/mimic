import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { gmailInvalidArgument } from '../gmail-errors.js';

const NS_MESSAGES = 'gmail:messages';

/**
 * `users.history.list` — GET /gmail/v1/users/:userId/history
 *
 * The mock doesn't track a real history journal yet; we synthesise a single
 * `messageAdded` record per message whose `historyId > startHistoryId`. That's
 * enough for an agent to verify "is there anything new since last poll?" and
 * to exercise our route shape, while leaving room for a future, faithful
 * implementation backed by a change-log.
 */
export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, string>;
    if (!query.startHistoryId) {
      return reply.code(400).send(gmailInvalidArgument('startHistoryId is required'));
    }
    const start = BigInt(query.startHistoryId);
    const labelFilter = query.labelId;

    const messages = store.list<Record<string, unknown>>(NS_MESSAGES);
    const records = messages
      .filter((m) => {
        const hid = m.historyId ? BigInt(String(m.historyId)) : 0n;
        if (hid <= start) return false;
        if (labelFilter) {
          const labels = (m.labelIds as string[] | undefined) ?? [];
          if (!labels.includes(labelFilter)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ha = BigInt(String(a.historyId ?? '0'));
        const hb = BigInt(String(b.historyId ?? '0'));
        return ha < hb ? -1 : ha > hb ? 1 : 0;
      })
      .map((m) => ({
        id: m.historyId,
        messages: [{ id: m.id, threadId: m.threadId, labelIds: m.labelIds }],
        messagesAdded: [
          {
            message: { id: m.id, threadId: m.threadId, labelIds: m.labelIds },
          },
        ],
      }));

    const last = records[records.length - 1];
    return reply.code(200).send({
      history: records,
      historyId: String(last?.id ?? query.startHistoryId),
    });
  };
}
