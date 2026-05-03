// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-gmail generate
import type { AdapterResourceSpecs } from '@mimicai/core';

export const gmailResourceSpecs: AdapterResourceSpecs = {
  platform: {
    timestampFormat: 'unix_ms',
    amountFormat: 'decimal_string',
  },
  resources: {
    "message": {
      objectType: "message",
      volumeHint: "reference",
      refs: ["thread","label"],
      fields: {
      "id": { type: "string", required: true, default: "" },
      "threadId": { type: "string", required: true, default: "" },
      "labelIds": { type: "array", required: false, default: [] },
      "snippet": { type: "string", required: false, default: "" },
      "historyId": { type: "string", required: false, default: "", semanticType: "platform_id" },
      "internalDate": { type: "string", required: false, default: "", timestamp: "unix_ms" },
      "sizeEstimate": { type: "integer", required: false, default: 0 },
      "payload": { type: "object", required: false, default: null },
      "raw": { type: "string", required: false, default: "" },
      },
    },
    "message_email": {
      objectType: "message_email",
      volumeHint: "entity",
      refs: [],
      fields: {
      "from_name": { type: "string", required: true, default: "" },
      "from_email": { type: "string", required: true, default: "", semanticType: "email" },
      "to_email": { type: "string", required: true, default: "", semanticType: "email" },
      "cc_emails": { type: "array", required: false, default: [] },
      "subject": { type: "string", required: true, default: "" },
      "body_text": { type: "string", required: true, default: "" },
      "thread_subject": { type: "string", required: true, default: "" },
      "label_ids": { type: "array", required: false, default: [] },
      "sent_at": { type: "string", required: true, default: "", timestamp: "unix_ms" },
      },
    },
    "thread": {
      objectType: "thread",
      volumeHint: "reference",
      refs: ["message"],
      fields: {
      "id": { type: "string", required: true, default: "" },
      "snippet": { type: "string", required: false, default: "" },
      "historyId": { type: "string", required: false, default: "", semanticType: "platform_id" },
      "messages": { type: "array", required: false, default: [] },
      },
    },
    "label": {
      objectType: "label",
      volumeHint: "reference",
      refs: [],
      fields: {
      "id": { type: "string", required: true, default: "" },
      "name": { type: "string", required: true, default: "" },
      "type": { type: "string", required: false, default: "system", enum: ["system","user"] },
      "labelListVisibility": { type: "string", required: false, default: "labelShow", enum: ["labelShow","labelShowIfUnread","labelHide"] },
      "messageListVisibility": { type: "string", required: false, default: "show", enum: ["show","hide"] },
      "threadsTotal": { type: "integer", required: false, default: 0 },
      "messagesTotal": { type: "integer", required: false, default: 0 },
      "messagesUnread": { type: "integer", required: false, default: 0 },
      "threadsUnread": { type: "integer", required: false, default: 0 },
      "color": { type: "object", required: false, default: null },
      },
    },
    "draft": {
      objectType: "draft",
      volumeHint: "entity",
      refs: ["message"],
      fields: {
      "id": { type: "string", required: true, default: "" },
      "message": { type: "object", required: false, default: null },
      },
    },
    "profile": {
      objectType: "profile",
      volumeHint: "reference",
      refs: [],
      fields: {
      "emailAddress": { type: "string", required: true, default: "", semanticType: "email" },
      "messagesTotal": { type: "integer", required: false, default: 0 },
      "threadsTotal": { type: "integer", required: false, default: 0 },
      "historyId": { type: "string", required: false, default: "", semanticType: "platform_id" },
      },
    }
  },
};
