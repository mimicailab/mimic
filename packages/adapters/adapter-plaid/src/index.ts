export { PlaidAdapter } from './plaid-adapter.js';
export { plaidConfigSchema } from './config.js';
export type { PlaidConfig } from './config.js';
export { registerPlaidTools, createPlaidMcpServer, startPlaidMcpServer } from './mcp.js';
export { plaidResourceSpecs } from './generated/resource-specs.js';

// Re-export adapter manifest for dynamic discovery
import { PlaidAdapter } from './plaid-adapter.js';
import { plaidConfigSchema } from './config.js';
import meta from './adapter-meta.js';

export const manifest = {
  id: meta.id,
  name: meta.name,
  description: meta.description,
  type: meta.type as 'api-mock',
  createAdapter: () => new PlaidAdapter(),
  configSchema: plaidConfigSchema,
};
