# @mimicai/adapter-slack

Slack Web API mock adapter for Mimic. 27 curated methods covering channels, messages, threads, users, reactions, pins, files, and search — all backed by an in-memory state store.

Targeted at AI agents that need to read internal communication context (e.g. the Briefing Agent's `#deals` mentions, channel sentiment, thread state) during testing without touching a real workspace.

## Install

```bash
npm install @mimicai/adapter-slack
```

## What it covers

| Surface | Methods |
|---------|---------|
| Auth & team | `auth.test`, `team.info` |
| Users | `users.list`, `users.info`, `users.lookupByEmail`, `users.profile.get` |
| Conversations | `conversations.list`, `conversations.history`, `conversations.replies`, `conversations.info`, `conversations.members`, `conversations.create`, `conversations.open` |
| Chat | `chat.postMessage`, `chat.postEphemeral`, `chat.update`, `chat.delete` |
| Reactions | `reactions.add`, `reactions.remove`, `reactions.get`, `reactions.list` |
| Pins | `pins.list`, `pins.add`, `pins.remove` |
| Files | `files.list`, `files.info` |
| Search | `search.messages` |

The Slack admin/enterprise surface (admin.*, apps.*, workflows.*, calls.*, sockets, OAuth flow, view modals) is intentionally out of scope. Methods Slack documents but doesn't include in its OpenAPI spec — bookmarks and `search.files` — are noted in the codegen as known gaps.

## Slack idioms the adapter implements

- **`{ ok: true|false }` envelope** — every response is wrapped via a Fastify `preSerialization` hook. Handlers return the inner payload; the wrapper adds `ok` and an `error` code on failure.
- **Cursor pagination** — `next_cursor` in `response_metadata`, opaque `c_<id>` token, empty string sentinel for last page.
- **Form-encoded bodies** — `@fastify/formbody` is registered conditionally (test helpers already register it).
- **Thread semantics** — top-level message `ts` equals its `thread_ts` when it has replies; `conversations.replies` returns parent + chronological replies; `conversations.history` returns only top-level messages.
- **Bot identity bootstrap** — `seedDefaultFixtures` creates a default workspace + bot user so `auth.test` succeeds without persona data.

## Auth

Real Slack uses OAuth bot tokens (`xoxb-…`) and user tokens (`xoxp-…`). For mock usage, `Bearer xoxb-<personaId>-…` (or `xoxp-`) resolves to that persona id.

## MCP tools (10)

`get_slack_team_info`, `lookup_slack_user_by_email`, `list_slack_users`, `list_slack_channels`, `get_slack_conversation_history`, `get_slack_thread_replies`, `search_slack_messages`, `post_slack_message`, `add_slack_reaction`, `list_slack_pins`.

`lookup_slack_user_by_email` is the high-value tool for the Briefing Agent — given a meeting attendee's email, find the matching workspace user.

## Running

Standalone MCP server (stdio):

```bash
npx -y @mimicai/adapter-slack mcp
```

Or via `mimic host`:

```json
{
  "apis": {
    "slack": { "enabled": true, "mcp": true }
  }
}
```

## Regenerating from spec

```bash
curl -fsSL https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json \
  -o packages/adapters/adapter-slack/slack-spec.json
pnpm --filter @mimicai/adapter-slack generate
```

The codegen (`scripts/slack-codegen.ts`) walks Slack's Swagger 2.0 spec, filters by an `INCLUDE_PATHS` whitelist, and emits routes/resource-specs/schemas with hand-tuned factory bodies preserved across regeneration.

## License

Apache 2.0
