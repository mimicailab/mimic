/**
 * GET /v1/folders — List folders, sorted alphabetically, cursor pagination.
 *
 * Response shape: `{ folders: [...], hasMore: boolean, cursor: string | null }`.
 */

import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { getQuery, NS, paginateByCursor } from './_shared.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

interface Folder {
  id: string;
  object: string;
  name: string;
  parent_folder_id: string | null;
  created_at: string;
  [key: string]: unknown;
}

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = getQuery(req);
    const items = store.list<Folder>(NS.folders);

    // Granola docs say folders are returned alphabetically.
    items.sort((a, b) => a.name.localeCompare(b.name));

    const pageSize = Math.min(parseInt(q.page_size ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const { page, hasMore, nextCursor } = paginateByCursor(items, q.cursor, pageSize);

    return reply.code(200).send({
      folders: page,
      hasMore,
      cursor: nextCursor,
    });
  };
}
