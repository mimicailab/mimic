// ── Adapter ────────────────────────────────────────────────────────────────
export { PlaidAdapter } from './plaid-adapter.js';

// ── Config ─────────────────────────────────────────────────────────────────
export { PlaidConfigSchema } from './config.js';
export type { PlaidConfig } from './config.js';

// ── Formatters ─────────────────────────────────────────────────────────────
export { formatPlaidAccount, formatPlaidTransaction } from './formatters.js';

// ── Errors ─────────────────────────────────────────────────────────────────
export { plaidError } from './plaid-errors.js';

// ── MCP ───────────────────────────────────────────────────────────────────
export { registerPlaidTools, createPlaidMcpServer, startPlaidMcpServer } from './mcp.js';

// ── Manifest ───────────────────────────────────────────────────────────────
import type { AdapterManifest } from '@mimicai/adapter-sdk';
import { PlaidConfigSchema } from './config.js';

export const manifest: AdapterManifest = {
  id: 'plaid',
  name: 'Plaid API',
  type: 'api-mock',
  description: 'Plaid API mock adapter — bank accounts, transactions, identity, auth',
  versions: ['2020-09-14'],
  configSchema: PlaidConfigSchema,
};
