// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-granola generate
import type { AdapterResourceSpecs } from '@mimicai/core';

export const granolaResourceSpecs: AdapterResourceSpecs = {
  platform: {
    timestampFormat: 'iso8601',
    amountFormat: 'decimal_string',
  },
  resources: {
    "note": {
      objectType: "note",
      volumeHint: "reference",
      refs: ["user","folder","calendar_event"],
      fields: {
      "id": { type: "string", required: true, default: "" },
      "object": { type: "string", required: true, default: "note", enum: ["note"] },
      "title": { type: "string", required: false, nullable: true, default: null },
      "owner": { type: "object", required: true, default: null, description: "User who owns the note" },
      "created_at": { type: "string", required: true, default: "", timestamp: "iso8601" },
      "updated_at": { type: "string", required: true, default: "", timestamp: "iso8601" },
      "web_url": { type: "string", required: false, default: "", semanticType: "url" },
      "calendar_event": { type: "object", required: false, nullable: true, default: null },
      "summary": { type: "string", required: false, nullable: true, default: null },
      "transcript": { type: "array", required: false, default: [], description: "Only present when ?include=transcript" },
      "folder_id": { type: "string", required: false, nullable: true, default: null },
      },
    },
    "note_content": {
      objectType: "note_content",
      volumeHint: "entity",
      refs: [],
      fields: {
      "label": { type: "string", required: true, default: "" },
      "title": { type: "string", required: true, default: "" },
      "summary": { type: "string", required: true, default: "" },
      "body_markdown": { type: "string", required: false, default: "" },
      "owner_name": { type: "string", required: true, default: "" },
      "owner_email": { type: "string", required: true, default: "", semanticType: "email" },
      "meeting_title": { type: "string", required: true, default: "" },
      "meeting_start_time": { type: "string", required: true, default: "", timestamp: "iso8601" },
      "meeting_end_time": { type: "string", required: true, default: "", timestamp: "iso8601" },
      "attendee_emails": { type: "string", required: false, default: "" },
      "folder_name": { type: "string", required: false, default: "My notes" },
      "created_at": { type: "string", required: true, default: "", timestamp: "iso8601" },
      },
    },
    "folder": {
      objectType: "folder",
      volumeHint: "reference",
      refs: ["folder"],
      fields: {
      "id": { type: "string", required: true, default: "" },
      "object": { type: "string", required: true, default: "folder", enum: ["folder"] },
      "name": { type: "string", required: true, default: "" },
      "parent_folder_id": { type: "string", required: false, nullable: true, default: null },
      "created_at": { type: "string", required: true, default: "", timestamp: "iso8601" },
      },
    },
    "user": {
      objectType: "user",
      volumeHint: "reference",
      refs: [],
      fields: {
      "id": { type: "string", required: false, default: "" },
      "name": { type: "string", required: true, default: "" },
      "email": { type: "string", required: true, default: "", semanticType: "email" },
      },
    },
    "calendar_event": {
      objectType: "calendar_event",
      volumeHint: "reference",
      refs: ["user"],
      fields: {
      "id": { type: "string", required: false, default: "" },
      "title": { type: "string", required: false, default: "" },
      "start_time": { type: "string", required: true, default: "", timestamp: "iso8601" },
      "end_time": { type: "string", required: true, default: "", timestamp: "iso8601" },
      "invitees": { type: "array", required: false, default: [] },
      },
    },
    "transcript_entry": {
      objectType: "transcript_entry",
      volumeHint: "reference",
      refs: [],
      fields: {
      "speaker": { type: "object", required: true, default: null },
      "text": { type: "string", required: true, default: "" },
      "start_time": { type: "string", required: true, default: "", timestamp: "iso8601" },
      "end_time": { type: "string", required: true, default: "", timestamp: "iso8601" },
      },
    },
    "transcript_entry_content": {
      objectType: "transcript_entry_content",
      volumeHint: "entity",
      refs: ["note_content"],
      fields: {
      "note_label": { type: "string", required: true, default: "" },
      "speaker_name": { type: "string", required: true, default: "" },
      "speaker_email": { type: "string", required: true, default: "", semanticType: "email" },
      "text": { type: "string", required: true, default: "" },
      "start_time": { type: "string", required: true, default: "", timestamp: "iso8601" },
      "end_time": { type: "string", required: true, default: "", timestamp: "iso8601" },
      },
    }
  },
};
