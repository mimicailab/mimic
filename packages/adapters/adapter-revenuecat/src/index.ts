export { RevenueCatAdapter } from './revenuecat-adapter.js';
export { RevenueCatConfigSchema } from './config.js';
export type { RevenueCatConfig } from './config.js';
export { registerRevenueCatTools, createRevenueCatMcpServer, startRevenueCatMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'revenuecat',
  name: 'RevenueCat API',
  type: 'api-mock',
  description: 'RevenueCat mobile subscriptions, in-app purchases, entitlements, offerings mock adapter',
  versions: ['v2'],
};
