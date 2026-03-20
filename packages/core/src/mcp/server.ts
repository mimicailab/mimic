/**
 * Mimic MCP Server
 *
 * Exposes the generated database as a set of MCP tools that an AI agent can
 * call to query data. Supports two transports:
 *
 *  - **stdio**            — for local development / CLI piping
 *  - **streamable-http**  — HTTP Streamable HTTP transport (MCP spec 2025-03-26+)
 *                           Used by Stripe, GitHub, and all current official MCP servers.
 *                           Replaces the deprecated SSE transport.
 *
 * The server auto-generates tools from the schema, validates every query
 * against the schema whitelist, and returns JSON results.
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { SchemaModel, TableInfo, MimicConfig } from '../types/index.js';
import { McpServerError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { generateTools, type McpToolDefinition } from './tool-generator.js';
import { QueryBuilder, type QueryMode } from './query-builder.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a table name lookup from the schema for O(1) access. */
function buildTableMap(schema: SchemaModel): Map<string, TableInfo> {
  const map = new Map<string, TableInfo>();
  for (const table of schema.tables) {
    map.set(table.name, table);
  }
  return map;
}

/**
 * Determine the execution mode from a tool name.
 * Tools ending in `_summary` run as aggregates; everything else is a select.
 */
function modeFromToolName(name: string): QueryMode {
  return name.endsWith('_summary') ? 'aggregate' : 'select';
}

/**
 * Extract the table name from a tool name.
 *
 *  - `get_orders`         → `orders`
 *  - `get_orders_summary` → `orders`
 */
function tableNameFromToolName(toolName: string): string {
  // Strip the leading "get_"
  let rest = toolName.slice(4);
  // Strip trailing "_summary" if present
  if (rest.endsWith('_summary')) {
    rest = rest.slice(0, -8);
  }
  return rest;
}

/**
 * Convert a McpToolDefinition's inputSchema properties into a Zod schema
 * object suitable for `server.tool()`.
 *
 * The MCP SDK v1.x expects a Record<string, ZodType> for the input shape.
 */
function inputSchemaToZod(
  def: McpToolDefinition,
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(def.inputSchema.properties)) {
    let schema: z.ZodTypeAny;

    switch (prop.type) {
      case 'integer':
        schema = z.number().int().describe(prop.description);
        if (prop.minimum !== undefined) schema = (schema as z.ZodNumber).min(prop.minimum);
        break;

      case 'number':
        schema = z.number().describe(prop.description);
        if (prop.minimum !== undefined) schema = (schema as z.ZodNumber).min(prop.minimum);
        break;

      case 'boolean':
        schema = z.boolean().describe(prop.description);
        break;

      case 'string':
      default:
        if (prop.enum && prop.enum.length > 0) {
          schema = z
            .enum(prop.enum as [string, ...string[]])
            .describe(prop.description);
        } else {
          schema = z.string().describe(prop.description);
        }
        break;
    }

    // All filter parameters are optional — only limit/offset have defaults,
    // and even those are optional in the tool call.
    schema = schema.optional();

    shape[key] = schema;
  }

  return shape;
}

// ---------------------------------------------------------------------------
// MimicMcpServer
// ---------------------------------------------------------------------------

/**
 * The Mimic MCP Server.
 *
 * Usage:
 * ```ts
 * const server = new MimicMcpServer(schema, pool, config);
 * await server.start('stdio');
 * ```
 */
export class MimicMcpServer {
  private readonly mcpServer: McpServer;
  private readonly queryBuilder: QueryBuilder | null;
  private readonly tableMap: Map<string, TableInfo>;
  private httpServer: HttpServer | null = null;
  private sessions: Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }> = new Map();
  private readonly externalRegistrars: Array<(mcpServer: McpServer) => void> = [];

  constructor(
    private readonly schema?: SchemaModel,
    private readonly pool?: Pool,
    private readonly config?: MimicConfig,
  ) {
    this.mcpServer = new McpServer({
      name: 'mimic',
      version: '0.1.0',
    });

    if (schema && pool) {
      this.queryBuilder = new QueryBuilder(pool);
      this.tableMap = buildTableMap(schema);
      this.registerTools();
    } else {
      this.queryBuilder = null;
      this.tableMap = new Map();
    }
  }

  /**
   * Create a fresh McpServer with all tools registered.
   * Each Streamable HTTP session needs its own McpServer instance
   * because the MCP SDK only allows one transport per protocol instance.
   */
  private createSessionServer(): McpServer {
    const server = new McpServer({ name: 'mimic', version: '0.1.0' });
    this.registerToolsOn(server);
    for (const registrar of this.externalRegistrars) {
      registrar(server);
    }
    return server;
  }

  /**
   * Allow external code (e.g. API adapters with mcp: true) to register
   * additional tools on the underlying MCP server.
   */
  registerExternalTools(registrar: (mcpServer: McpServer) => void): void {
    registrar(this.mcpServer);
    this.externalRegistrars.push(registrar);
  }

  // -----------------------------------------------------------------------
  // Tool registration
  // -----------------------------------------------------------------------

  private registerTools(): void {
    this.registerToolsOn(this.mcpServer);
  }

  /** Register database tools on any McpServer instance. */
  private registerToolsOn(server: McpServer): void {
    if (!this.schema) return;
    const tools = generateTools(this.schema);

    for (const tool of tools) {
      const zodShape = inputSchemaToZod(tool);

      server.tool(
        tool.name,
        tool.description,
        zodShape,
        async (args: Record<string, unknown>) => {
          return this.handleToolCall(tool.name, args);
        },
      );
    }

    logger.debug(`Registered ${tools.length} MCP tools`);
  }

  // -----------------------------------------------------------------------
  // Tool call handler
  // -----------------------------------------------------------------------

  private async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const tableName = tableNameFromToolName(toolName);
    const tableInfo = this.tableMap.get(tableName);

    if (!tableInfo) {
      throw new McpServerError(
        `Unknown table "${tableName}" for tool "${toolName}"`,
        'The schema may have changed since the server was started — restart the MCP server',
      );
    }

    const mode = modeFromToolName(toolName);

    try {
      const rows = await this.queryBuilder!.execute(
        tableName,
        tableInfo,
        args,
        mode,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(rows, null, 2),
          },
        ],
      };
    } catch (error) {
      if (error instanceof McpServerError) throw error;

      throw new McpServerError(
        `Tool "${toolName}" failed: ${error instanceof Error ? error.message : String(error)}`,
        'Check the database connection and schema',
        error instanceof Error ? error : undefined,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Transport lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the MCP server on the specified transport.
   *
   * @param transport - `'stdio'` for stdin/stdout or `'http'` for Streamable HTTP.
   * @param port      - HTTP port when using Streamable HTTP (defaults to 3100).
   */
  async start(
    transport: 'stdio' | 'http',
    port?: number,
  ): Promise<void> {
    if (transport === 'stdio') {
      await this.startStdio();
    } else {
      await this.startStreamableHttp(port ?? 3100);
    }
  }

  /** Start the stdio transport (blocks until the process closes stdin). */
  private async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    logger.debug('MCP server started on stdio transport');
  }

  /**
   * Start the Streamable HTTP transport on an HTTP server.
   *
   * Implements the MCP Streamable HTTP transport (spec 2025-03-26+), which is
   * the standard used by Stripe's remote MCP server and all current official
   * MCP servers. Replaces the deprecated SSE transport.
   *
   * Endpoints:
   *  - `POST /mcp`   — send tool calls, receive responses (optionally SSE-streamed)
   *  - `GET  /mcp`   — SSE stream for server-initiated notifications (optional)
   *  - `DELETE /mcp` — explicit session termination
   *  - `GET /health` — simple health check
   *
   * Agent configuration example (Claude Desktop, Cursor, etc.):
   * ```json
   * { "url": "http://localhost:3100/mcp" }
   * ```
   */
  private async startStreamableHttp(port: number): Promise<void> {
    this.httpServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);

      // ── Health check ──────────────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', tools: this.tableMap.size }));
        return;
      }

      // ── Streamable HTTP MCP endpoint ──────────────────────────────────
      if (url.pathname === '/mcp') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        // DELETE — explicit session termination
        if (req.method === 'DELETE') {
          if (sessionId) {
            const session = this.sessions.get(sessionId);
            if (session) {
              this.sessions.delete(sessionId);
              await session.server.close().catch(() => {});
            }
          }
          res.writeHead(204);
          res.end();
          return;
        }

        // GET — SSE stream for server-initiated notifications
        if (req.method === 'GET') {
          if (!sessionId || !this.sessions.has(sessionId)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid or missing mcp-session-id' }));
            return;
          }
          await this.sessions.get(sessionId)!.transport.handleRequest(req, res);
          return;
        }

        // POST — tool calls / session initialisation
        if (req.method === 'POST') {
          if (sessionId && this.sessions.has(sessionId)) {
            // Resume existing session
            await this.sessions.get(sessionId)!.transport.handleRequest(req, res);
            return;
          }

          // New session — each session gets its own McpServer instance
          // because the MCP SDK only allows one transport per protocol instance.
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              this.sessions.set(id, { transport, server: sessionServer });
            },
          });

          transport.onclose = () => {
            if (transport.sessionId) this.sessions.delete(transport.sessionId);
          };

          const sessionServer = this.createSessionServer();
          await sessionServer.connect(transport);
          await transport.handleRequest(req, res);
          return;
        }
      }

      // ── 404 ───────────────────────────────────────────────────────────
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.on('error', reject);
      this.httpServer!.listen(port, () => {
        logger.step(`MCP server listening on http://localhost:${port}/mcp`);
        resolve();
      });
    });
  }

  /**
   * Gracefully shut down the MCP server and release resources.
   */
  async stop(): Promise<void> {
    // Close all active Streamable HTTP sessions
    for (const { transport, server } of this.sessions.values()) {
      try {
        await transport.close();
      } catch {
        // Best-effort cleanup
      }
      try {
        await server.close();
      } catch {
        // Best-effort cleanup
      }
    }
    this.sessions.clear();

    // Close the HTTP server if running
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.httpServer = null;
    }

    // Close the MCP server
    try {
      await this.mcpServer.close();
    } catch {
      // Best-effort cleanup
    }

    logger.debug('MCP server stopped');
  }
}
