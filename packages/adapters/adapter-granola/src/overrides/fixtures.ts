/**
 * Default fixtures seeded into the StateStore on adapter start. Provides a
 * default workspace folder so `/v1/folders` returns at least one entry
 * before any persona data is loaded.
 *
 * Real persona data flows in via `seedExpandedData()` (run by the base
 * class before mountOverrides), which adds notes, transcripts, and any
 * additional folders.
 */

import type { StateStore } from '@mimicai/core';
import type { GranolaConfig } from '../config.js';
import { defaultFolder } from '../generated/schemas.js';
import { NS } from './_shared.js';

const DEFAULT_FOLDER_ID = 'fol_default00000';

export function seedDefaultFixtures(store: StateStore, _config?: GranolaConfig): void {
  if (!store.get(NS.folders, DEFAULT_FOLDER_ID)) {
    store.set(
      NS.folders,
      DEFAULT_FOLDER_ID,
      defaultFolder({
        id: DEFAULT_FOLDER_ID,
        name: 'My notes',
        parent_folder_id: null,
        created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
      }),
    );
  }
}
