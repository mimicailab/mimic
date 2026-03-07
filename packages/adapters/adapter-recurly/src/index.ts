export { RecurlyAdapter } from './recurly-adapter.js';
export { RecurlyConfigSchema } from './config.js';
export type { RecurlyConfig } from './config.js';
export { registerRecurlyTools, createRecurlyMcpServer, startRecurlyMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'recurly',
  name: 'Recurly API',
  type: 'api-mock',
  description: 'Recurly subscription management, recurring billing, revenue recognition mock adapter',
  versions: ['v2021-02-25'],
};
