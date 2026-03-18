import type { MimicMcpServer } from '../mcp/server.js';

export interface McpTransportConfig {
  type: 'stdio' | 'http';
  port?: number;
}

/**
 * Attach MCP transport to the mock server ecosystem.
 *
 * The actual MCP server lives in `../mcp/server.ts`; this module provides
 * lifecycle management for MCP transport when running alongside the
 * Fastify mock server.
 */
export async function attachMcpTransport(
  mcpServer: MimicMcpServer,
  config: McpTransportConfig,
): Promise<void> {
  await mcpServer.start(config.type, config.port);
}

export async function detachMcpTransport(
  mcpServer: MimicMcpServer,
): Promise<void> {
  await mcpServer.stop();
}
