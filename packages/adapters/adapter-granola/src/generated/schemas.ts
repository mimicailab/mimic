// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-granola generate
import { generateId } from '@mimicai/adapter-sdk';
import type { DefaultFactory } from '@mimicai/adapter-sdk';

/**
 * Hand-tuned default factories. Granola IDs use prefixes `not_` (notes)
 * and `fol_` (folders), each followed by 14 alphanumeric chars.
 */

export function defaultNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    id: (o.id as string) ?? `not_${generateId('', 14)}`,
    object: 'note',
    title: (o.title as string | null | undefined) ?? null,
    owner: (o.owner as Record<string, unknown> | null) ?? null,
    created_at: (o.created_at as string) ?? now,
    updated_at: (o.updated_at as string) ?? now,
    web_url: (o.web_url as string) ?? `https://notes.granola.ai/d/${(o.id as string) ?? generateId('', 14)}`,
    calendar_event: (o.calendar_event as Record<string, unknown> | null) ?? null,
    summary: (o.summary as string | null | undefined) ?? null,
    transcript: (o.transcript as unknown[]) ?? [],
    folder_id: (o.folder_id as string | null | undefined) ?? null,
    ...overrides,
  };
}

export function defaultFolder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    id: (o.id as string) ?? `fol_${generateId('', 14)}`,
    object: 'folder',
    name: (o.name as string) ?? 'Untitled folder',
    parent_folder_id: (o.parent_folder_id as string | null | undefined) ?? null,
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
  "note": defaultNote,
  "notes": defaultNote,
  "folder": defaultFolder,
  "folders": defaultFolder,
};
