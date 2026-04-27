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
      volumeHint: "entity",
      refs: ["thread","label"],
      fields: {
      "historyId": { type: "string", required: false, default: "", semanticType: "platform_id", description: "The ID of the last history record that modified this message." },
      "threadId": { type: "string", required: false, default: "", description: "The ID of the thread the message belongs to. To add a message or draft to a thread, the following criteria must be met: 1. The requested `threadId` must be specified on the `Message` or `Draft.Message` you supply with your request. 2. The `References` and `In-Reply-To` headers must be set in compliance with the [RFC 2822](https://tools.ietf.org/html/rfc2822) standard. 3. The `Subject` headers must match. " },
      "labelIds": { type: "array", required: false, default: [], description: "List of IDs of labels applied to this message." },
      "classificationLabelValues": { type: "array", required: false, default: [], description: "Classification Label values on the message. Available Classification Label schemas can be queried using the Google Drive Labels API. Each classification label ID must be unique. If duplicate IDs are provided, only one will be retained, and the selection is arbitrary. Only used for Google Workspace accounts." },
      "internalDate": { type: "string", required: false, default: "", timestamp: "unix_ms", description: "The internal message creation timestamp (epoch ms), which determines ordering in the inbox. For normal SMTP-received email, this represents the time the message was originally accepted by Google, which is more reliable than the `Date` header. However, for API-migrated mail, it can be configured by client to be based on the `Date` header." },
      "id": { type: "string", required: false, default: "", description: "The immutable ID of the message." },
      "snippet": { type: "string", required: false, default: "", description: "A short part of the message text." },
      "sizeEstimate": { type: "integer", required: false, default: 0, description: "Estimated size in bytes of the message." },
      "payload": { type: "object", required: false, default: null, description: "The parsed email structure in the message parts." },
      "raw": { type: "string", required: false, default: "", description: "The entire email message in an RFC 2822 formatted and base64url encoded string. Returned in `messages.get` and `drafts.get` responses when the `format=RAW` parameter is supplied." },
      },
    },
    "thread": {
      objectType: "thread",
      volumeHint: "entity",
      refs: ["message"],
      fields: {
      "id": { type: "string", required: false, default: "", description: "The unique ID of the thread." },
      "snippet": { type: "string", required: false, default: "", description: "A short part of the message text." },
      "historyId": { type: "string", required: false, default: "", semanticType: "platform_id", description: "The ID of the last history record that modified this thread." },
      "messages": { type: "array", required: false, default: [], description: "The list of messages in the thread." },
      },
    },
    "label": {
      objectType: "label",
      volumeHint: "reference",
      refs: [],
      fields: {
      "labelListVisibility": { type: "string", required: false, default: "labelShow", enum: ["labelShow","labelShowIfUnread","labelHide"], description: "The visibility of the label in the label list in the Gmail web interface." },
      "threadsTotal": { type: "integer", required: false, default: 0, description: "The total number of threads with the label." },
      "messagesUnread": { type: "integer", required: false, default: 0, description: "The number of unread messages with the label." },
      "messagesTotal": { type: "integer", required: false, default: 0, description: "The total number of messages with the label." },
      "threadsUnread": { type: "integer", required: false, default: 0, description: "The number of unread threads with the label." },
      "type": { type: "string", required: false, default: "system", enum: ["system","user"], description: "The owner type for the label. User labels are created by the user and can be modified and deleted by the user and can be applied to any message or thread. System labels are internally created and cannot be added, modified, or deleted. System labels may be able to be applied to or removed from messages and threads under some circumstances but this is not guaranteed. For example, users can apply and remove the `INBOX` and `UNREAD` labels from messages and threads, but cannot apply or remove the `DRAFTS` or `SENT` labels from messages or threads." },
      "color": { type: "object", required: false, default: null, description: "The color to assign to the label. Color is only available for labels that have their `type` set to `user`." },
      "messageListVisibility": { type: "string", required: false, default: "show", enum: ["show","hide"], description: "The visibility of messages with this label in the message list in the Gmail web interface." },
      "id": { type: "string", required: false, default: "", description: "The immutable ID of the label." },
      "name": { type: "string", required: false, default: "", description: "The display name of the label." },
      },
    },
    "draft": {
      objectType: "draft",
      volumeHint: "entity",
      refs: ["message"],
      fields: {
      "id": { type: "string", required: false, default: "", description: "The immutable ID of the draft." },
      "message": { type: "object", required: false, default: null, description: "The message content of the draft." },
      },
    },
    "profile": {
      objectType: "profile",
      volumeHint: "reference",
      refs: [],
      fields: {
      "messagesTotal": { type: "integer", required: false, default: 0, description: "The total number of messages in the mailbox." },
      "threadsTotal": { type: "integer", required: false, default: 0, description: "The total number of threads in the mailbox." },
      "historyId": { type: "string", required: false, default: "", semanticType: "platform_id", description: "The ID of the mailbox's current history record." },
      "emailAddress": { type: "string", required: false, default: "", semanticType: "email", description: "The user's email address." },
      },
    }
  },
};
