# @mimicai/adapter-attio

## 0.12.0

### Minor Changes

- [#155](https://github.com/mimicailab/mimic/pull/155) [`94cb29e`](https://github.com/mimicailab/mimic/commit/94cb29e4a023dbe4080465d7ed0c269003958782) Thanks [@ada-raj](https://github.com/ada-raj)! - feat(adapter): add Attio CRM mock adapter

  Full coverage of all 49 Attio API paths (87 routes once HTTP methods are
  expanded), generated from the public OpenAPI spec at
  https://api.attio.com/openapi/api. Surfaces records (with dynamic `{object}`
  namespacing for people/companies/deals), lists and list entries, notes,
  tasks, threads, comments, meetings + call recordings + transcripts, files,
  webhooks, workspace members, attribute / option / status configuration, and
  SCIM 2.0 user/group provisioning.

  Includes 13 MCP tools designed for the Briefing Agent demo —
  `find_attio_contact_by_email` is Step 1 of the briefing skill — plus deal
  lookup, activity timeline, meeting transcript retrieval, and pipeline
  inspection. 23 tests covering CRUD, error envelopes (Attio's flat
  `{ status_code, type, code, message }`), POST-as-list query semantics,
  PATCH-vs-PUT multiselect merge, and the SCIM envelope.
