# `@mimicai/adapter-attio`

Mimic mock adapter for the [Attio API](https://developers.attio.com/reference)
v2 — covers the full public surface (records, lists, list entries, notes,
tasks, meetings, call recordings, comments, threads, files, webhooks, workspace
members, attribute/option/status configuration, and SCIM 2.0 provisioning).

Built primarily to power the **Briefing Agent** flagship demo: `attio_find_contact_by_email`
plus deal-context lookup form Steps 1–2 of the briefing skill (see
`private/briefing-agent.md`).

## Install

```bash
npm install @mimicai/adapter-attio
```

## Coverage

| Surface | Routes | Notes |
|---------|--------|-------|
| `/v2/self` | 1 | Workspace identity (top-level fields, no `data` wrap) |
| `/v2/objects` | 4 | Object schema directory; `people`/`companies`/`deals`/`workspaces`/`users` seeded |
| `/v2/objects/{object}/records/*` | 8 | Records — query (POST-as-list), create, assert (PUT upsert), retrieve, PATCH (append) / PUT (overwrite), delete, attribute values, entries timeline, global search |
| `/v2/lists/*` | 4 | List directory + per-list views |
| `/v2/lists/{list}/entries/*` | 7 | Pipeline entries — query, create, assert, retrieve, PATCH/PUT, delete, attribute values |
| `/v2/{target}/{identifier}/attributes/*` | 6 | Attributes for objects + lists |
| `/v2/{target}/{identifier}/attributes/{attribute}/options` | 3 | Select options |
| `/v2/{target}/{identifier}/attributes/{attribute}/statuses` | 3 | Statuses |
| `/v2/notes` | 4 | List/create/retrieve/delete; filter by `parent_object`/`parent_record_id` |
| `/v2/tasks` | 5 | List/create/retrieve/PATCH/delete; filter by `linked_record_id`, `assignee`, `is_completed` |
| `/v2/threads` + `/v2/comments` | 5 | Thread directory + comment CRUD; comment-without-thread auto-creates a thread |
| `/v2/meetings` + `/v2/meetings/{id}/call_recordings` + transcript | 8 | Native meeting intel — list, idempotent find-or-create, recordings, transcript |
| `/v2/files` | 6 | List, create folder, upload, retrieve, delete, signed download URL |
| `/v2/webhooks` | 5 | Standard CRUD |
| `/v2/workspace_members` | 2 | List + retrieve |
| `/scim/v2/Schemas` | 1 | Static schema list |
| `/scim/v2/Users` | 6 | SCIM 2.0 user CRUD with PATCH/PUT replace |
| `/scim/v2/Groups` | 6 | SCIM 2.0 group CRUD |
| **Total** | **87** | All 49 paths × HTTP methods from the spec — full coverage |

## Attio idioms the adapter implements

| Idiom | How |
|-------|-----|
| **Compound IDs** | Every resource carries `{ workspace_id, [object_id\|list_id\|...], <resource>_id }`. The default factories build them from partial inputs and back-fill UUIDs for missing pieces. |
| **`{ data: ... }` envelope** | Most endpoints return `{ data: {...} }` (single) or `{ data: [...] }` (list). `/v2/self` and SCIM use top-level fields instead. The adapter emits the right shape per route — there's no global wrapper hook. |
| **Flat error envelope** | Errors are `{ status_code, type, code, message }` — no nested `error: { ... }`. SCIM uses its own error shape (`{ schemas, status, detail }`). |
| **POST-as-list** | `POST /records/query`, `POST /entries/query`, `POST /records/search` are all listing operations. The codegen classifies them as `operation: "list"` and overrides parse the filter from the request body. |
| **PUT vs PATCH** | `PATCH /records/:id` appends to multiselect attributes; `PUT /records/:id` overwrites them. `PUT` on the *collection* is "assert" (upsert by `matching_attribute`). |
| **Filter language** | The mock supports the common subset: flat equality, `eq`/`not_eq`/`contains`/`starts_with`/`ends_with`/`in`/`greater_than`/`less_than`/`is_empty`, plus `$or` / `$and`. Filter resolution traverses `record.values.<attr>[].{value\|email_address\|phone_number\|...}` — the canonical attio attribute shape. |
| **Dynamic object types** | Records of `people` and `companies` live in separate StateStore namespaces (`attio:records:people` vs `attio:records:companies`). Routes register once with `:object` as a Fastify path param. |

## Auth

Standard OAuth2 Bearer tokens. For Mimic test traffic, encode the persona id
in the token: `Authorization: Bearer test_<persona-id>_<rest>`.

```bash
curl https://localhost:4100/v2/self \
  -H "Authorization: Bearer test_northwind-priya_aaaaaaaaaaaa"
```

## MCP tools (13)

Designed for the Briefing Agent's pre-call synthesis flow:

1. `find_attio_contact_by_email` — **Step 1 of the briefing skill.** Maps a meeting attendee email to a CRM record.
2. `get_attio_record` — Fetch a record by `(object, record_id)`.
3. `query_attio_records` — Filter + sort with Attio's filter language.
4. `search_attio_records` — Global free-text search across multiple object types.
5. `list_attio_lists` — Discover pipelines / segments.
6. `list_attio_list_entries` — Stage progression for a pipeline (with optional stage filter).
7. `list_attio_notes_for_record` — "What was last said about this account."
8. `list_attio_tasks_for_record` — Open follow-ups, optionally filtered by assignee.
9. `list_attio_meetings_for_record` — Call timeline for a deal/person.
10. `get_attio_meeting_transcript` — Pull transcript text for a specific recording.
11. `list_attio_call_recordings` — Discover recording IDs for a meeting.
12. `list_attio_workspace_members` — Resolve `owner` UUIDs to people.
13. `get_attio_self` — Workspace identity / scopes.

## Running

### Standalone

```bash
# Start the mock API + MCP server
pnpm --filter @mimicai/adapter-attio build
node dist/bin/mcp.js
```

### With `mimic host`

```yaml
# mimic.json
apis:
  attio:
    enabled: true
    mcp: true
```

## Regeneration

The OpenAPI spec is gitignored (it's ~750 KB and changes frequently). To
regenerate after a spec update:

```bash
curl -fsSL https://api.attio.com/openapi/api \
  -o packages/adapters/adapter-attio/attio-spec.json

pnpm --filter @mimicai/adapter-attio generate
pnpm --filter @mimicai/adapter-attio test
```

The codegen rewrites `src/generated/{routes,resource-specs,schemas,meta}.ts`
in place; everything else (overrides, MCP tools, error helpers, fixtures) is
hand-written.
