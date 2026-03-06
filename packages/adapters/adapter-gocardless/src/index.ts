export { GoCardlessAdapter } from './gocardless-adapter.js';
export { GoCardlessConfigSchema } from './config.js';
export type { GoCardlessConfig } from './config.js';
export { registerGoCardlessTools, createGoCardlessMcpServer, startGoCardlessMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'gocardless',
  name: 'GoCardless API',
  type: 'api-mock',
  description: 'GoCardless Direct Debit payments, mandates, and subscriptions mock adapter',
  versions: ['2015-07-06'],
};
