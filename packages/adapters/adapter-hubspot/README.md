# `@mimicai/adapter-hubspot`

Mimic mock adapter for the [HubSpot API](https://developers.hubspot.com/docs/api-reference/latest/overview).
**Full coverage** of HubSpot's published OpenAPI specs — 105 product specs
merged into a unified route table with **1054 routes** spanning CRM, CMS,
Marketing, Conversations, Files, Auth, Settings, Webhooks, Automation, Events,
Account, and more.

Built primarily to power the **Briefing Agent** flagship demo, where it pairs
with Attio for the dual-CRM-mismatch persona — but the surface is broad enough
for any HubSpot integration testing.

## Install

```bash
npm install @mimicai/adapter-hubspot
```

## Coverage

| Area | Routes | What's in it |
|---|---:|---|
| **CRM** | 537 | Contacts, Companies, Deals, Tickets, Notes, Tasks, Calls, Meetings, Emails, Line Items, Products, Quotes, Invoices, Orders, Carts, Subscriptions, Discounts, Fees, Taxes, Custom Objects, Owners, Pipelines, Properties, Lists, Associations, Schemas, Imports, Exports, Goal Targets, Forecasts, Leads, Feedback Submissions, Calling Extensions, Object Library, Public App CRM Cards, Communications, Postal Mail, Listings, Courses, Services, Appointments, Contracts, Deal Splits, App Uninstalls, Property Validations, Limits Tracking, Partner Clients, Partner Services, Subscription Lifecycle, Timeline, Transcriptions, Users, Video Conferencing Extension |
| **CMS** | 220 | Pages, Posts, Tags, Authors, Domains, HubDB, Site Search, Source Code, URL Mappings, Media Bridge, Blog Settings, Cms Content Audit, Performance |
| **Marketing** | 111 | Marketing Emails (v3 + 2026-03), Forms, Campaigns, Marketing Events, Single-Send, Transactional, Sequences |
| **Conversations** | 32 | Conversations, Inbox & Messages, Custom Channels |
| **Webhooks** | 35 | Subscriptions, Settings, Throttling |
| **Automation** | 30 | Workflows V4, Actions V4, Sequences |
| **Files** | 18 | Folders + files (with `:folderId` / `:folderPath` collision dedup) |
| **Settings** | 24 | Currencies, Multi-currency, User Provisioning, Tax Rates, Audit Logs |
| **Conversations / Events / Communication Preferences / Account / Auth / Meta / Scheduler / Data Studio / Business Units** | 100+ | Everything else HubSpot publishes a 2026-03 spec for |
| **Total** | **1054** | All 105 specs at the latest stable version (2026-03 where available, falls back to v3/v4/v1) |

After dedup of cross-spec exact-duplicates (163 routes) and Fastify-shape
collisions like `:folderId` vs `:folderPath` (2 routes) at the same path.

## HubSpot idioms the adapter implements

| Idiom | How |
|---|---|
| **Universal CRM object shape** | Every CRM record is `{ id, properties: {...}, createdAt, updatedAt, archived }`. Properties bag is flat string→value (HubSpot stringifies even numeric values). |
| **List envelope** | `{ results: [...], paging?: { next: { after } } }` for collections — implemented in `wrapList()`. |
| **Cursor pagination** | `?limit=N&after=<id>` query params; response sets `paging.next.after` when more results exist. Default limit 10, max 100. |
| **Search-as-list (POST)** | `POST /<resource>/search` with `{ filterGroups: [{ filters: [...] }], query, sorts, limit, after }`. Implemented as a generic override that registers on every `*/search` route across all specs. Supports operators EQ, NEQ, LT/LTE/GT/GTE, BETWEEN, IN, NOT_IN, HAS_PROPERTY, NOT_HAS_PROPERTY, CONTAINS_TOKEN, NOT_CONTAINS_TOKEN. filterGroups OR; filters within a group AND. |
| **Batch operations** | `POST /<resource>/batch/{create\|read\|update\|upsert\|archive}` returning `{ status: "COMPLETE", results, startedAt, completedAt, numErrors?, errors? }`. Auto-registered for every batch route in every spec. Upsert matches on `idProperty` (e.g. email). |
| **Unified vs typed CRM Objects** | `/crm/objects/2026-03/{objectType}` (unified, from the Objects spec) AND `/crm/objects/2026-03/contacts` etc. (typed, from per-product specs) both work. The override extracts the object type from `req.params.objectType` if present, else parses it from the URL path. Per-type StateStore namespacing keeps contacts/companies/deals/tickets isolated. |
| **PATCH semantics** | Deep-merges the `properties` bag and stamps `updatedAt`. Other fields shallow-merge. |
| **Archive (soft delete)** | DELETE returns 204 No Content; subsequent GET still finds the record with `archived: true`. |
| **Error envelope** | `{ status: "error", message, correlationId, category, errors? }` with categories like `OBJECT_NOT_FOUND`, `VALIDATION_ERROR`, `BAD_REQUEST`, `UNAUTHORIZED`, `RATE_LIMITS`, `MISSING_SCOPES`. |
| **OAuth flow** | `/oauth/2026-03/token` accepts `authorization_code` and `refresh_token` grants and returns `pat-na1-<rand>` access/refresh tokens with 1800s expiry. `/token/introspect` and `/token/revoke` routes are registered. |
| **Pipelines + stages** | `/crm/pipelines/<version>/{objectType}` returns pipelines filtered by object type (deals/tickets); each pipeline has `stages` with `displayOrder` + `metadata.isClosed` so stage names can be resolved from `dealstage` ids. |
| **Date-based versioning** | Paths use `2026-03` as the current stable version. v3 (legacy numeric) endpoints are present for products that haven't migrated yet. |

## Auth

Standard OAuth2 Bearer tokens. For Mimic test traffic, encode the persona id
in the token: `Authorization: Bearer pat-test-<persona-id>-<rest>`.

```bash
curl http://localhost:4100/account-info/2026-03/details \
  -H "Authorization: Bearer pat-test-northwind-priya-aaaaaaaaaaaa"
```

The mock accepts any Bearer token (real HubSpot enforces validity); persona
extraction matches `pat-test-<persona>-*` or `test_<persona>_*`.

## MCP tools (13)

Designed for the Briefing Agent's pre-call synthesis flow:

1. **`find_hubspot_contact_by_email`** — Step 1 of the briefing skill (paired with `find_attio_contact_by_email`).
2. **`get_hubspot_record`** — Fetch a record by `(object_type, record_id)`.
3. **`search_hubspot_records`** — Full filterGroups search with sorts/properties projection.
4. **`list_hubspot_deals_for_contact`** — Deals associated with a contact (`associations.contact = id`).
5. **`list_hubspot_notes_for_record`** — Newest-first notes attached to any record.
6. **`list_hubspot_tasks_for_record`** — Open follow-ups (`hs_task_status` filter).
7. **`list_hubspot_meetings_for_record`** — Meeting timeline.
8. **`list_hubspot_calls_for_record`** — Call engagements.
9. **`list_hubspot_emails_for_record`** — Email thread state.
10. **`list_hubspot_pipelines`** — Pipelines with stage names + isClosed flags.
11. **`list_hubspot_owners`** — Workspace owners (resolve `hubspot_owner_id`).
12. **`list_hubspot_properties`** — Custom-field catalog (e.g. MEDDPICC).
13. **`get_hubspot_account_info`** — Portal identity + scopes.

## Running

### Standalone

```bash
pnpm --filter @mimicai/adapter-hubspot build
node dist/bin/mcp.js
```

### With `mimic host`

```yaml
# mimic.json
apis:
  hubspot:
    enabled: true
    mcp: true
```

## Regeneration

The 105 OpenAPI specs are gitignored (~7 MB). Re-fetch them from HubSpot's
[official spec collection](https://github.com/HubSpot/HubSpot-public-api-spec-collection)
when HubSpot publishes a new version:

```bash
# Refresh inventory
gh api 'repos/HubSpot/HubSpot-public-api-spec-collection/git/trees/main?recursive=1' \
  | jq -r '.tree[] | select(.path | endswith(".json")) | .path' \
  | grep "PublicApiSpecs/" > /tmp/all-specs.txt

# Pick latest stable per product (priority: 2026-03 > v4 > v3 > v1; skip 2026-09*)
# (See scripts/inventory.sh in this package for the full selection logic.)

# Download in parallel
cat /tmp/selected.txt | xargs -n2 -P 16 curl -fsSL -o ...

# Regenerate
pnpm --filter @mimicai/adapter-hubspot generate
pnpm --filter @mimicai/adapter-hubspot test
```

## Why so big?

HubSpot's "everything" surface really is 105 distinct product specs. The Mimic
philosophy is "swap the URL, not the code" — that requires URL-level fidelity
across whatever the platform publishes. The codegen handles spec growth
mechanically: pull new specs, regenerate, route table updates. The 13 MCP
tools cover the briefing agent's hot path; the remaining 1041 routes are
available for any general HubSpot integration testing without code changes.

Behaviorally the long tail relies on base CRUD scaffolding — same trade-off
as the other Mimic adapters: CRUD path and search are faithful, exotic
operators / scope enforcement / webhook delivery / OAuth code-grant flows are
permissive (see the "Where we diverged" section pattern from `adapter-attio`'s
README for the general framing).
