import type { AdapterManifest } from '@mimicai/core';

export { ZuoraAdapter } from './zuora-adapter.js';
export { ZuoraConfigSchema, type ZuoraConfig } from './config.js';
export { registerZuoraTools, createZuoraMcpServer, startZuoraMcpServer } from './mcp.js';

export const manifest: AdapterManifest = {
  id: 'zuora',
  name: 'Zuora API',
  type: 'api-mock',
  description: 'Zuora API mock adapter for enterprise subscription management, orders, billing, invoicing, revenue recognition',
  versions: ['v1'],
};
