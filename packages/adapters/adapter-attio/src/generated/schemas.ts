// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-attio generate
import { generateId } from '@mimicai/adapter-sdk';
import type { DefaultFactory } from '@mimicai/adapter-sdk';

/**
 * Hand-tuned default factories. Every Attio resource id is a compound
 * `{ workspace_id, [object_id|list_id|...], <resource>_id }` envelope, so
 * factories accept partial id overrides and fill in UUIDs for missing pieces.
 *
 * The factory bodies live in scripts/attio-codegen.ts and are re-emitted on
 * every `pnpm generate`.
 */

export const DEFAULT_WORKSPACE_ID = '14beef7a-99f7-4534-a87e-70b564330a4c';

/** Generate an RFC 4122 v4-style id using the SDK's generateId (deterministic in tests). */
function generateUuid(): string {
  // Format like: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` (32 hex chars regrouped).
  const hex = generateId('', 32).replace(/[^a-f0-9]/gi, '0').padEnd(32, '0').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    '8' + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

export function defaultRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      object_id: (idIn.object_id as string) ?? generateUuid(),
      record_id: (idIn.record_id as string) ?? generateUuid(),
    },
    created_at: (o.created_at as string) ?? now,
    web_url: (o.web_url as string) ?? '',
    values: (o.values as Record<string, unknown>) ?? {},
    ...overrides,
  };
}

export function defaultList(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      list_id: (idIn.list_id as string) ?? generateUuid(),
    },
    api_slug: (o.api_slug as string) ?? 'default-list',
    name: (o.name as string) ?? 'Default list',
    parent_object: (o.parent_object as string[]) ?? [],
    workspace_access: (o.workspace_access as string) ?? 'read-and-write',
    workspace_member_access: (o.workspace_member_access as unknown[]) ?? [],
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}

export function defaultListEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      list_id: (idIn.list_id as string) ?? generateUuid(),
      entry_id: (idIn.entry_id as string) ?? generateUuid(),
    },
    parent_record_id: (o.parent_record_id as string) ?? generateUuid(),
    parent_object: (o.parent_object as string) ?? '',
    created_at: (o.created_at as string) ?? now,
    entry_values: (o.entry_values as Record<string, unknown>) ?? {},
    ...overrides,
  };
}

export function defaultNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      note_id: (idIn.note_id as string) ?? generateUuid(),
    },
    parent_object: (o.parent_object as string) ?? '',
    parent_record_id: (o.parent_record_id as string) ?? '',
    title: (o.title as string) ?? '',
    content_plaintext: (o.content_plaintext as string) ?? '',
    content_markdown: (o.content_markdown as string) ?? '',
    tags: (o.tags as unknown[]) ?? [],
    created_at: (o.created_at as string) ?? now,
    created_by_actor: (o.created_by_actor as Record<string, unknown> | null) ?? null,
    ...overrides,
  };
}

export function defaultTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      task_id: (idIn.task_id as string) ?? generateUuid(),
    },
    content_plaintext: (o.content_plaintext as string) ?? '',
    deadline_at: (o.deadline_at as string | null) ?? null,
    is_completed: (o.is_completed as boolean) ?? false,
    linked_records: (o.linked_records as unknown[]) ?? [],
    assignees: (o.assignees as unknown[]) ?? [],
    created_at: (o.created_at as string) ?? now,
    created_by_actor: (o.created_by_actor as Record<string, unknown> | null) ?? null,
    ...overrides,
  };
}

export function defaultMeeting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      meeting_id: (idIn.meeting_id as string) ?? generateUuid(),
    },
    title: (o.title as string) ?? '',
    start_time: (o.start_time as string | null) ?? null,
    end_time: (o.end_time as string | null) ?? null,
    attendees: (o.attendees as unknown[]) ?? [],
    linked_records: (o.linked_records as unknown[]) ?? [],
    notes: (o.notes as unknown[]) ?? [],
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}

export function defaultCallRecording(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      call_recording_id: (idIn.call_recording_id as string) ?? generateUuid(),
    },
    meeting_id: (o.meeting_id as string) ?? generateUuid(),
    url: (o.url as string) ?? '',
    transcript: (o.transcript as string) ?? '',
    duration_seconds: (o.duration_seconds as number) ?? 0,
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}

export function defaultComment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      comment_id: (idIn.comment_id as string) ?? generateUuid(),
    },
    thread_id: (o.thread_id as string) ?? generateUuid(),
    content_plaintext: (o.content_plaintext as string) ?? '',
    entity: (o.entity as Record<string, unknown> | null) ?? null,
    author: (o.author as Record<string, unknown> | null) ?? null,
    resolved_at: (o.resolved_at as string | null) ?? null,
    resolved_by: (o.resolved_by as Record<string, unknown> | null) ?? null,
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}

export function defaultThread(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      thread_id: (idIn.thread_id as string) ?? generateUuid(),
    },
    comments: (o.comments as unknown[]) ?? [],
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}

export function defaultWorkspaceMember(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      workspace_member_id: (idIn.workspace_member_id as string) ?? generateUuid(),
    },
    first_name: (o.first_name as string) ?? '',
    last_name: (o.last_name as string) ?? '',
    avatar_url: (o.avatar_url as string) ?? '',
    email_address: (o.email_address as string) ?? '',
    access_level: (o.access_level as string) ?? 'member',
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}

export function defaultObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      object_id: (idIn.object_id as string) ?? generateUuid(),
    },
    api_slug: (o.api_slug as string) ?? '',
    singular_noun: (o.singular_noun as string) ?? '',
    plural_noun: (o.plural_noun as string) ?? '',
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}

export function defaultAttribute(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      object_id: (idIn.object_id as string) ?? generateUuid(),
      attribute_id: (idIn.attribute_id as string) ?? generateUuid(),
    },
    api_slug: (o.api_slug as string) ?? '',
    title: (o.title as string) ?? '',
    description: (o.description as string) ?? '',
    type: (o.type as string) ?? 'text',
    is_required: (o.is_required as boolean) ?? false,
    is_unique: (o.is_unique as boolean) ?? false,
    is_multiselect: (o.is_multiselect as boolean) ?? false,
    is_writable: (o.is_writable as boolean) ?? true,
    is_default_value_enabled: (o.is_default_value_enabled as boolean) ?? false,
    default_value: (o.default_value as Record<string, unknown> | null) ?? null,
    is_archived: (o.is_archived as boolean) ?? false,
    relationship: (o.relationship as Record<string, unknown> | null) ?? null,
    config: (o.config as Record<string, unknown>) ?? {},
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}

export function defaultSelectOption(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      object_id: (idIn.object_id as string) ?? generateUuid(),
      attribute_id: (idIn.attribute_id as string) ?? generateUuid(),
      option_id: (idIn.option_id as string) ?? generateUuid(),
    },
    title: (o.title as string) ?? '',
    is_archived: (o.is_archived as boolean) ?? false,
    ...overrides,
  };
}

export function defaultStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      object_id: (idIn.object_id as string) ?? generateUuid(),
      attribute_id: (idIn.attribute_id as string) ?? generateUuid(),
      status_id: (idIn.status_id as string) ?? generateUuid(),
    },
    title: (o.title as string) ?? '',
    celebration_enabled: (o.celebration_enabled as boolean) ?? false,
    target_time_in_status: (o.target_time_in_status as string | null) ?? null,
    is_archived: (o.is_archived as boolean) ?? false,
    ...overrides,
  };
}

export function defaultFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      file_id: (idIn.file_id as string) ?? generateUuid(),
    },
    file_url: (o.file_url as string) ?? '',
    filename: (o.filename as string) ?? 'untitled',
    content_type: (o.content_type as string) ?? 'application/octet-stream',
    size: (o.size as number) ?? 0,
    is_writable: (o.is_writable as boolean) ?? false,
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}

export function defaultWebhook(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  const idIn = (o.id ?? {}) as Record<string, unknown>;
  return {
    id: {
      workspace_id: (idIn.workspace_id as string) ?? DEFAULT_WORKSPACE_ID,
      webhook_id: (idIn.webhook_id as string) ?? generateUuid(),
    },
    target_url: (o.target_url as string) ?? '',
    subscriptions: (o.subscriptions as unknown[]) ?? [],
    status: (o.status as string) ?? 'active',
    created_at: (o.created_at as string) ?? now,
    ...overrides,
  };
}

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
  "record": defaultRecord,
  "list": defaultList,
  "list_entry": defaultListEntry,
  "note": defaultNote,
  "task": defaultTask,
  "meeting": defaultMeeting,
  "call_recording": defaultCallRecording,
  "comment": defaultComment,
  "thread": defaultThread,
  "workspace_member": defaultWorkspaceMember,
  "object": defaultObject,
  "attribute": defaultAttribute,
  "select_option": defaultSelectOption,
  "status": defaultStatus,
  "file": defaultFile,
  "webhook": defaultWebhook,
  "records": defaultRecord,
  "record_entries": defaultRecord,
  "record_attribute_values": defaultRecord,
  "lists": defaultList,
  "list_entries": defaultListEntry,
  "list_entry_attribute_values": defaultListEntry,
  "list_views": defaultList,
  "object_views": defaultObject,
  "objects": defaultObject,
  "notes": defaultNote,
  "tasks": defaultTask,
  "threads": defaultThread,
  "comments": defaultComment,
  "meetings": defaultMeeting,
  "call_recordings": defaultCallRecording,
  "files": defaultFile,
  "workspace_members": defaultWorkspaceMember,
  "webhooks": defaultWebhook,
  "attributes": defaultAttribute,
  "select_options": defaultSelectOption,
  "statuses": defaultStatus,
  "people": defaultRecord,
  "companies": defaultRecord,
  "deals": defaultRecord,
  "workspaces": defaultRecord,
  "users": defaultRecord,
};
