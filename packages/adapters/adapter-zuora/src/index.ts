export { ZuoraAdapter } from './zuora-adapter.js';
export { ZuoraConfigSchema } from './config.js';
export type { ZuoraConfig } from './config.js';
export { registerZuoraTools, createZuoraMcpServer, startZuoraMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'zuora',
  name: 'Zuora API',
  type: 'api-mock',
  description: 'Zuora enterprise subscription management, orders, billing, invoicing, revenue recognition mock adapter',
  versions: ['v1'],
};
