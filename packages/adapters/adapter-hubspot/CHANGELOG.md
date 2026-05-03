# @mimicai/adapter-hubspot

## 0.12.0

### Minor Changes

- [#155](https://github.com/mimicailab/mimic/pull/155) [`95da585`](https://github.com/mimicailab/mimic/commit/95da585d0d986dc005eb2275dd0187bd3d1f83cc) Thanks [@ada-raj](https://github.com/ada-raj)! - feat(adapter): add HubSpot mock adapter (full coverage, 1054 routes)

  Multi-spec adapter that merges all 105 product specs from the
  [HubSpot public API spec collection](https://github.com/HubSpot/HubSpot-public-api-spec-collection)
  into a unified route table — the largest API mock in the Mimic suite.
  Spans CRM (537 routes across 60+ products), CMS (220), Marketing (111),
  Conversations (32), Webhooks (35), Automation (30), Files (18), Settings,
  Events, Account, Auth, Communication Preferences, Data Studio, Scheduler,
  Meta and Business Units. Latest-stable version per product (`2026-03`
  where available, fallback to v4/v3/v1).

  Implements HubSpot's universal idioms once at the adapter level:
  `{ results, paging.next.after }` list envelope, `?limit&after` cursor
  pagination, deep-merging PATCH semantics on the `properties` bag,
  soft-delete via DELETE → 204 with `archived: true`, and the standard
  error envelope `{ status, message, correlationId, category, errors? }`.

  Generic search and batch overrides are auto-registered for every spec
  route matching the well-known shapes (`*/search` and `*/batch/<verb>`).
  The unified CRM Objects API and the per-type typed APIs (Contacts,
  Deals, Tickets, etc.) both route through the same set of handlers,
  which extract the object type from `:objectType` path params or by URL
  parsing — keeping per-type StateStore namespacing isolated.

  Specific overrides for: OAuth token exchange (authorization_code +
  refresh_token grants returning `pat-na1-*` Bearer tokens), `/account-info`
  flat envelope, and CRM Pipelines (codegen mis-classifies the trailing
  `{objectType}` as retrieve — the override returns the correct
  filtered list).

  13 MCP tools designed for the Briefing Agent's flow plus general-purpose
  HubSpot lookups: `find_hubspot_contact_by_email` is Step 1 (paired with
  the Attio version), then deal/notes/tasks/calls/meetings/emails search
  for steps 2-4, plus pipelines/owners/properties/account-info. 25 tests
  covering CRUD, filterGroups search with CONTAINS_TOKEN/sorts, batch
  create/read/upsert with idProperty matching, OAuth grants, error
  envelopes, pipelines stages, and the end-to-end briefing-agent flow.
