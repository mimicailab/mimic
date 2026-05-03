import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData, PromptContext, StateStore } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec } from '@mimicai/core';
import { OpenApiMockAdapter } from '@mimicai/adapter-sdk';
import type { DefaultFactory, Marshaller, NotFoundError, OverrideHandler } from '@mimicai/adapter-sdk';

import meta from './adapter-meta.js';
import type { AttioConfig } from './config.js';
import { registerAttioTools } from './mcp.js';
import { attioNotFoundAsBase } from './attio-errors.js';

import { attioResourceSpecs } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';
import type { GeneratedRoute, RouteMethod } from './generated/routes.js';

import * as selfHandlers from './overrides/self.js';
import * as recordHandlers from './overrides/records.js';
import * as listHandlers from './overrides/lists.js';
import * as listEntryHandlers from './overrides/list_entries.js';
import * as attributeHandlers from './overrides/attributes.js';
import * as objectHandlers from './overrides/objects.js';
import * as noteHandlers from './overrides/notes.js';
import * as taskHandlers from './overrides/tasks.js';
import * as threadHandlers from './overrides/threads.js';
import * as commentHandlers from './overrides/comments.js';
import * as meetingHandlers from './overrides/meetings.js';
import * as callRecordingHandlers from './overrides/call_recordings.js';
import * as fileHandlers from './overrides/files.js';
import * as webhookHandlers from './overrides/webhooks.js';
import * as workspaceMemberHandlers from './overrides/workspace_members.js';
import * as scimHandlers from './overrides/scim.js';
import { seedDefaultFixtures } from './overrides/fixtures.js';
import { buildAttioRecordMarshallers } from './overrides/marshallers.js';

/**
 * StateStore namespace conventions for Attio. Most resources are namespaced
 * with at least one dynamic axis (object slug, list id, target+identifier),
 * because Attio is a meta-CRM where the same route handler serves people,
 * companies, deals, etc.
 *
 *   attio:self                                      — workspace identity
 *   attio:objects                                   — object schema list
 *   attio:object_views:{object}                     — views per object
 *   attio:records:{object}                          — records of an object type
 *   attio:record_entries:{object}:{record_id}       — record activity timeline
 *   attio:lists                                     — list schemas
 *   attio:list_views:{list}                         — views per list
 *   attio:list_entries:{list}                       — entries in list
 *   attio:attributes:{target}:{identifier}          — attribute schemas
 *   attio:select_options:{target}:{id}:{attribute}  — select options
 *   attio:statuses:{target}:{id}:{attribute}        — statuses
 *   attio:notes                                     — notes (filtered at query time)
 *   attio:tasks                                     — tasks
 *   attio:comments                                  — comments
 *   attio:threads                                   — threads
 *   attio:meetings                                  — meetings
 *   attio:call_recordings:{meeting_id}              — recordings per meeting
 *   attio:files                                     — files
 *   attio:webhooks                                  — webhooks
 *   attio:workspace_members                         — members
 *   attio:scim_users / attio:scim_groups / attio:scim_schemas
 */
function ns(resource: string): string {
  return `attio:${resource}`;
}

export class AttioAdapter extends OpenApiMockAdapter<AttioConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;
  readonly resourceSpecs = attioResourceSpecs;

  /** @deprecated Required by base class — use resourceSpecs instead. */
  readonly promptContext: PromptContext = derivePromptContext(attioResourceSpecs);

  /** @deprecated Required by base class — use resourceSpecs instead. */
  readonly dataSpec: DataSpec = deriveDataSpec(attioResourceSpecs);

  protected readonly generatedRoutes: GeneratedRoute[] = GENERATED_ROUTES;
  protected readonly defaultFactories: Record<string, DefaultFactory> = SCHEMA_DEFAULTS;

  /**
   * Polymorphic record envelope is wrapped declaratively. See
   * `overrides/marshallers.ts` for the per-type value builders.
   */
  protected override get marshallers(): readonly Marshaller[] {
    return buildAttioRecordMarshallers(this.config?.workspaceId);
  }

  /**
   * Attio responses use one of three shapes depending on the endpoint:
   *
   *   - Resource endpoints:  `{ data: {...} }` (single) or `{ data: [...] }` (list)
   *   - `/v2/self`:          flat top-level fields (`active`, `scope`, ...)
   *   - SCIM endpoints:      SCIM 2.0 envelope (`schemas`, `Resources`, `totalResults`)
   *   - Errors:              flat `{ status_code, type, code, message }`
   *
   * Rather than wrap with a global hook (which would mis-wrap self/SCIM),
   * each override handler emits the wire shape directly. Helpers in
   * `_shared.ts` keep the call sites short.
   */
  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    seedDefaultFixtures(store, this.config);
    this.mountOverrides(store);
    await this.registerGeneratedRoutes(server, data, store, ns);
  }

  getEndpoints(): EndpointDefinition[] {
    return this.endpointsFromRoutes();
  }

  /**
   * Attio uses standard OAuth2 Bearer tokens. For Mimic test usage we accept
   * tokens of the form `Bearer test_<persona>_<rest>` (matching the Stripe
   * convention so all adapters share the persona-extraction pattern).
   */
  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+test_([a-z0-9-]+)_/i);
    return match ? (match[1] ?? null) : null;
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerAttioTools(mcpServer, mockBaseUrl);
  }

  // ---------------------------------------------------------------------------
  // Response/error overrides
  // ---------------------------------------------------------------------------

  protected override notFoundError(resource: string, id: string): NotFoundError {
    return attioNotFoundAsBase(resource, id);
  }

  /** Attio uses limit/offset (default limit 500 for records, varies per resource). */
  protected override paginate(
    items: Record<string, unknown>[],
    query: Record<string, string>,
  ): { data: Record<string, unknown>[]; hasMore: boolean } {
    const limit = Math.min(parseInt(query.limit ?? '500', 10) || 500, 1000);
    const offset = Math.max(parseInt(query.offset ?? '0', 10) || 0, 0);
    const page = items.slice(offset, offset + limit);
    return { data: page, hasMore: offset + limit < items.length };
  }

  /** Attio list envelope: `{ data: [...] }` — no `object`/`has_more`/`url` fields. */
  protected override wrapList(data: unknown[]): unknown {
    return { data };
  }

  /** Attio DELETE returns 200 with an empty body for most resources. */
  protected override deleteResponse(): unknown {
    return {};
  }

  // ---------------------------------------------------------------------------
  // Override registration
  //
  // Many Attio routes need explicit handlers because (a) records/list_entries
  // namespace by a dynamic path param (object slug, list id), (b) query/search
  // routes are POST-with-body rather than GET-with-query, or (c) the resource
  // has compound IDs that don't fit the base CRUD scaffolding's single-id model.
  // ---------------------------------------------------------------------------

  private mountOverrides(store: StateStore): void {
    const reg = (method: RouteMethod, path: string, fn: OverrideHandler) =>
      this.registerOverride(method, path, fn);

    // Workspace identity
    reg('GET', '/v2/self', selfHandlers.buildSelfHandler(store));

    // Objects (object schema directory)
    reg('GET', '/v2/objects', objectHandlers.buildListHandler(store));
    reg('POST', '/v2/objects', objectHandlers.buildCreateHandler(store));
    reg('GET', '/v2/objects/:object', objectHandlers.buildRetrieveHandler(store));
    reg('PATCH', '/v2/objects/:object', objectHandlers.buildUpdateHandler(store));
    reg('GET', '/v2/objects/:object/views', objectHandlers.buildListViewsHandler(store));

    // Records (the heart of Attio — contact / deal / company lookup)
    reg('POST', '/v2/objects/:object/records/query', recordHandlers.buildQueryHandler(store));
    reg('POST', '/v2/objects/:object/records', recordHandlers.buildCreateHandler(store));
    reg('PUT', '/v2/objects/:object/records', recordHandlers.buildAssertHandler(store));
    reg('GET', '/v2/objects/:object/records/:record_id', recordHandlers.buildRetrieveHandler(store));
    reg('PATCH', '/v2/objects/:object/records/:record_id', recordHandlers.buildUpdateAppendHandler(store));
    reg('PUT', '/v2/objects/:object/records/:record_id', recordHandlers.buildUpdateOverwriteHandler(store));
    reg('DELETE', '/v2/objects/:object/records/:record_id', recordHandlers.buildDeleteHandler(store));
    reg('GET', '/v2/objects/:object/records/:record_id/attributes/:attribute/values', recordHandlers.buildListAttributeValuesHandler(store));
    reg('GET', '/v2/objects/:object/records/:record_id/entries', recordHandlers.buildListEntriesHandler(store));
    reg('POST', '/v2/objects/records/search', recordHandlers.buildSearchHandler(store));

    // Lists (pipelines)
    reg('GET', '/v2/lists', listHandlers.buildListHandler(store));
    reg('POST', '/v2/lists', listHandlers.buildCreateHandler(store));
    reg('GET', '/v2/lists/:list', listHandlers.buildRetrieveHandler(store));
    reg('PATCH', '/v2/lists/:list', listHandlers.buildUpdateHandler(store));
    reg('GET', '/v2/lists/:list/views', listHandlers.buildListViewsHandler(store));

    // List entries (deals in a pipeline)
    reg('POST', '/v2/lists/:list/entries/query', listEntryHandlers.buildQueryHandler(store));
    reg('POST', '/v2/lists/:list/entries', listEntryHandlers.buildCreateHandler(store));
    reg('PUT', '/v2/lists/:list/entries', listEntryHandlers.buildAssertHandler(store));
    reg('GET', '/v2/lists/:list/entries/:entry_id', listEntryHandlers.buildRetrieveHandler(store));
    reg('PATCH', '/v2/lists/:list/entries/:entry_id', listEntryHandlers.buildUpdateAppendHandler(store));
    reg('PUT', '/v2/lists/:list/entries/:entry_id', listEntryHandlers.buildUpdateOverwriteHandler(store));
    reg('DELETE', '/v2/lists/:list/entries/:entry_id', listEntryHandlers.buildDeleteHandler(store));
    reg('GET', '/v2/lists/:list/entries/:entry_id/attributes/:attribute/values', listEntryHandlers.buildListAttributeValuesHandler(store));

    // Attributes / options / statuses (per-object schema)
    reg('GET', '/v2/:target/:identifier/attributes', attributeHandlers.buildListHandler(store));
    reg('POST', '/v2/:target/:identifier/attributes', attributeHandlers.buildCreateHandler(store));
    reg('GET', '/v2/:target/:identifier/attributes/:attribute', attributeHandlers.buildRetrieveHandler(store));
    reg('PATCH', '/v2/:target/:identifier/attributes/:attribute', attributeHandlers.buildUpdateHandler(store));
    reg('GET', '/v2/:target/:identifier/attributes/:attribute/options', attributeHandlers.buildListOptionsHandler(store));
    reg('POST', '/v2/:target/:identifier/attributes/:attribute/options', attributeHandlers.buildCreateOptionHandler(store));
    reg('PATCH', '/v2/:target/:identifier/attributes/:attribute/options/:option', attributeHandlers.buildUpdateOptionHandler(store));
    reg('GET', '/v2/:target/:identifier/attributes/:attribute/statuses', attributeHandlers.buildListStatusesHandler(store));
    reg('POST', '/v2/:target/:identifier/attributes/:attribute/statuses', attributeHandlers.buildCreateStatusHandler(store));
    reg('PATCH', '/v2/:target/:identifier/attributes/:attribute/statuses/:status', attributeHandlers.buildUpdateStatusHandler(store));

    // Workspace members
    reg('GET', '/v2/workspace_members', workspaceMemberHandlers.buildListHandler(store));
    reg('GET', '/v2/workspace_members/:workspace_member_id', workspaceMemberHandlers.buildRetrieveHandler(store));

    // Notes / tasks / threads / comments
    reg('GET', '/v2/notes', noteHandlers.buildListHandler(store));
    reg('POST', '/v2/notes', noteHandlers.buildCreateHandler(store));
    reg('GET', '/v2/notes/:note_id', noteHandlers.buildRetrieveHandler(store));
    reg('DELETE', '/v2/notes/:note_id', noteHandlers.buildDeleteHandler(store));

    reg('GET', '/v2/tasks', taskHandlers.buildListHandler(store));
    reg('POST', '/v2/tasks', taskHandlers.buildCreateHandler(store));
    reg('GET', '/v2/tasks/:task_id', taskHandlers.buildRetrieveHandler(store));
    reg('PATCH', '/v2/tasks/:task_id', taskHandlers.buildUpdateHandler(store));
    reg('DELETE', '/v2/tasks/:task_id', taskHandlers.buildDeleteHandler(store));

    reg('GET', '/v2/threads', threadHandlers.buildListHandler(store));
    reg('GET', '/v2/threads/:thread_id', threadHandlers.buildRetrieveHandler(store));

    reg('POST', '/v2/comments', commentHandlers.buildCreateHandler(store));
    reg('GET', '/v2/comments/:comment_id', commentHandlers.buildRetrieveHandler(store));
    reg('DELETE', '/v2/comments/:comment_id', commentHandlers.buildDeleteHandler(store));

    // Meetings / call recordings / transcripts
    reg('GET', '/v2/meetings', meetingHandlers.buildListHandler(store));
    reg('POST', '/v2/meetings', meetingHandlers.buildCreateHandler(store));
    reg('GET', '/v2/meetings/:meeting_id', meetingHandlers.buildRetrieveHandler(store));

    reg('GET', '/v2/meetings/:meeting_id/call_recordings', callRecordingHandlers.buildListHandler(store));
    reg('POST', '/v2/meetings/:meeting_id/call_recordings', callRecordingHandlers.buildCreateHandler(store));
    reg('GET', '/v2/meetings/:meeting_id/call_recordings/:call_recording_id', callRecordingHandlers.buildRetrieveHandler(store));
    reg('DELETE', '/v2/meetings/:meeting_id/call_recordings/:call_recording_id', callRecordingHandlers.buildDeleteHandler(store));
    reg('GET', '/v2/meetings/:meeting_id/call_recordings/:call_recording_id/transcript', callRecordingHandlers.buildTranscriptHandler(store));

    // Files
    reg('GET', '/v2/files', fileHandlers.buildListHandler(store));
    reg('POST', '/v2/files', fileHandlers.buildCreateFolderHandler(store));
    reg('POST', '/v2/files/upload', fileHandlers.buildUploadHandler(store));
    reg('GET', '/v2/files/:file_id', fileHandlers.buildRetrieveHandler(store));
    reg('DELETE', '/v2/files/:file_id', fileHandlers.buildDeleteHandler(store));
    reg('GET', '/v2/files/:file_id/download', fileHandlers.buildDownloadHandler(store));

    // Webhooks
    reg('GET', '/v2/webhooks', webhookHandlers.buildListHandler(store));
    reg('POST', '/v2/webhooks', webhookHandlers.buildCreateHandler(store));
    reg('GET', '/v2/webhooks/:webhook_id', webhookHandlers.buildRetrieveHandler(store));
    reg('PATCH', '/v2/webhooks/:webhook_id', webhookHandlers.buildUpdateHandler(store));
    reg('DELETE', '/v2/webhooks/:webhook_id', webhookHandlers.buildDeleteHandler(store));

    // SCIM
    reg('GET', '/scim/v2/Schemas', scimHandlers.buildListSchemasHandler(store));
    reg('GET', '/scim/v2/Users', scimHandlers.buildListUsersHandler(store));
    reg('POST', '/scim/v2/Users', scimHandlers.buildCreateUserHandler(store));
    reg('GET', '/scim/v2/Users/:user_id', scimHandlers.buildRetrieveUserHandler(store));
    reg('PATCH', '/scim/v2/Users/:user_id', scimHandlers.buildPatchUserHandler(store));
    reg('PUT', '/scim/v2/Users/:user_id', scimHandlers.buildReplaceUserHandler(store));
    reg('DELETE', '/scim/v2/Users/:user_id', scimHandlers.buildDeleteUserHandler(store));
    reg('GET', '/scim/v2/Groups', scimHandlers.buildListGroupsHandler(store));
    reg('POST', '/scim/v2/Groups', scimHandlers.buildCreateGroupHandler(store));
    reg('GET', '/scim/v2/Groups/:workspace_team_id', scimHandlers.buildRetrieveGroupHandler(store));
    reg('PATCH', '/scim/v2/Groups/:workspace_team_id', scimHandlers.buildPatchGroupHandler(store));
    reg('PUT', '/scim/v2/Groups/:workspace_team_id', scimHandlers.buildReplaceGroupHandler(store));
    reg('DELETE', '/scim/v2/Groups/:workspace_team_id', scimHandlers.buildDeleteGroupHandler(store));
  }
}
