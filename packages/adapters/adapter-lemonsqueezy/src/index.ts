export { LemonSqueezyAdapter } from './lemonsqueezy-adapter.js';
export { LemonSqueezyConfigSchema } from './config.js';
export type { LemonSqueezyConfig } from './config.js';
export { registerLemonSqueezyTools, createLemonSqueezyMcpServer, startLemonSqueezyMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'lemonsqueezy',
  name: 'Lemon Squeezy API',
  type: 'api-mock',
  description: 'Lemon Squeezy payments, subscriptions, license keys, and checkouts mock adapter',
  versions: ['1'],
};
