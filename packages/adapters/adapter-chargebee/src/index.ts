export { ChargebeeAdapter } from './chargebee-adapter.js';
export { ChargebeeConfigSchema } from './config.js';
export type { ChargebeeConfig } from './config.js';
export { registerChargebeeTools, createChargebeeMcpServer, startChargebeeMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'chargebee',
  name: 'Chargebee API',
  type: 'api-mock',
  description: 'Chargebee subscriptions, invoicing, billing, product catalog mock adapter',
  versions: ['2'],
};
