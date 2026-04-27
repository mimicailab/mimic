import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, DataSpec, ExpandedData, PromptContext, StateStore } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec } from '@mimicai/core';
import { OpenApiMockAdapter } from '@mimicai/adapter-sdk';
import type { DefaultFactory, NotFoundError, OverrideHandler } from '@mimicai/adapter-sdk';

import meta from './adapter-meta.js';
import type { GranolaConfig } from './config.js';
import { registerGranolaTools } from './mcp.js';
import { granolaNotFoundAsBase } from './granola-errors.js';

import { granolaResourceSpecs } from './generated/resource-specs.js';
import { SCHEMA_DEFAULTS } from './generated/schemas.js';
import { GENERATED_ROUTES } from './generated/routes.js';
import type { GeneratedRoute, RouteMethod } from './generated/routes.js';

import * as noteHandlers from './overrides/notes.js';
import * as folderHandlers from './overrides/folders.js';
import { seedDefaultFixtures } from './overrides/fixtures.js';

/**
 * StateStore namespaces:
 *   granola:notes   — meeting notes (with transcript)
 *   granola:folders — workspace folders
 */
function ns(resource: string): string {
  return `granola:${resource}`;
}

export class GranolaAdapter extends OpenApiMockAdapter<GranolaConfig> {
  readonly id = meta.id;
  readonly name = meta.name;
  readonly basePath = meta.basePath;
  readonly versions = meta.versions;
  readonly resourceSpecs = granolaResourceSpecs;

  /** @deprecated Required by base class — use resourceSpecs instead. */
  readonly promptContext: PromptContext = derivePromptContext(granolaResourceSpecs);

  /** @deprecated Required by base class — use resourceSpecs instead. */
  readonly dataSpec: DataSpec = deriveDataSpec(granolaResourceSpecs);

  protected readonly generatedRoutes: GeneratedRoute[] = GENERATED_ROUTES;
  protected readonly defaultFactories: Record<string, DefaultFactory> = SCHEMA_DEFAULTS;

  /**
   * Granola has 3 read-only routes; all are implemented as explicit
   * overrides because (a) the list response has its own envelope shape
   * (`{ notes|folders, hasMore, cursor }`) that doesn't match the base
   * class default, and (b) `?include=transcript` toggles a heavy field
   * that base CRUD scaffolding wouldn't know about.
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
   * Granola tokens are formatted `grn_<key>`. For Mimic test traffic, encode
   * the persona id between underscores: `Bearer grn_<persona-id>_<rest>`.
   */
  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+grn_([a-z0-9-]+)_/i);
    return match ? (match[1] ?? null) : null;
  }

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerGranolaTools(mcpServer, mockBaseUrl);
  }

  protected override notFoundError(resource: string, id: string): NotFoundError {
    return granolaNotFoundAsBase(resource, id);
  }

  // ---------------------------------------------------------------------------
  // Override registration
  // ---------------------------------------------------------------------------

  private mountOverrides(store: StateStore): void {
    const reg = (method: RouteMethod, path: string, fn: OverrideHandler) =>
      this.registerOverride(method, path, fn);

    reg('GET', '/v1/notes', noteHandlers.buildListHandler(store));
    reg('GET', '/v1/notes/:note_id', noteHandlers.buildRetrieveHandler(store));
    reg('GET', '/v1/folders', folderHandlers.buildListHandler(store));
  }
}
