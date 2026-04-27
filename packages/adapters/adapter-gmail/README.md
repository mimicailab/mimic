# @mimicai/adapter-gmail

Gmail API mock adapter for Mimic. Provides 34 Gmail v1 routes covering messages, threads, labels, drafts, history, and the user profile — all backed by an in-memory state store and seeded with realistic, persona-consistent data.

Built for AI agents that need to read mailbox state during testing without hitting real Google infrastructure: pre-call briefing agents, customer-success automations, anything that "reads the inbox".

## Install

```bash
npm install @mimicai/adapter-gmail
```

## What it covers

| Resource | Operations |
|----------|-----------|
| `users.getProfile` | `GET /users/{userId}/profile` |
| `users.watch` / `users.stop` | Push notifications stubs |
| `users.messages` | list, get, send, modify, trash, untrash, batchModify, batchDelete, insert, import, delete |
| `users.messages.attachments` | get |
| `users.threads` | list, get, modify, trash, untrash, delete |
| `users.labels` | list, get, create, update, patch, delete (8 system labels seeded automatically) |
| `users.drafts` | list, get, create, update, send, delete |
| `users.history` | list (incremental sync via `startHistoryId`) |

The Gmail Settings surface (vacation responder, IMAP/POP, filters, sendAs, delegates, CSE) is intentionally deferred — see [issue #150](https://github.com/mimicailab/mimic/issues/150).

## Auth

Real Gmail uses OAuth 2.0 / service-account delegation. For mock usage, requests with the auth header `Bearer mimic_<personaId>_*` resolve to the persona id `<personaId>`. The userId path segment is conventionally `me`.

## Response shapes

- **List endpoints** wrap items under the resource key Gmail uses (`messages`, `threads`, `labels`, `drafts`, `history`) plus `resultSizeEstimate` and an opaque `nextPageToken` when paginated.
- **Errors** match Google's standard JSON error envelope:
  ```json
  { "error": { "code": 404, "message": "...", "errors": [...], "status": "NOT_FOUND" } }
  ```
- **Pagination** uses `pageToken` + `maxResults` (default 100, max 500), matching Gmail.

## MCP tools

The adapter ships 10 MCP tools (`get_gmail_profile`, `list_gmail_messages`, `get_gmail_message`, `send_gmail_message`, `modify_gmail_message_labels`, `list_gmail_threads`, `get_gmail_thread`, `list_gmail_labels`, `list_gmail_drafts`, `list_gmail_history`). Names and descriptions are tuned for LLM consumption.

## Running

Standalone MCP server (stdio):

```bash
npx -y @mimicai/adapter-gmail mcp
```

Or via `mimic host` after configuring it in `mimic.json`:

```json
{
  "apis": {
    "gmail": { "enabled": true, "mcp": true }
  }
}
```

## Regenerating from spec

Routes, resource specs, and default factories are produced from Google's Gmail Discovery doc:

```bash
curl -fsSL "https://gmail.googleapis.com/\$discovery/rest?version=v1" \
  -o packages/adapters/adapter-gmail/gmail-discovery.json
pnpm --filter @mimicai/adapter-gmail generate
```

The codegen script (`scripts/gmail-codegen.ts`) walks the discovery doc, skips `users.settings.*` (deferred), and writes four files into `src/generated/`. The default-factory bodies are hand-tuned templates inside the codegen script — preserved across regeneration.

## License

Apache 2.0
