export { RevenueCatAdapter } from './revenuecat-adapter.js';
export { RevenueCatConfigSchema } from './config.js';
export type { RevenueCatConfig } from './config.js';
export { registerRevenueCatTools, createRevenueCatMcpServer, startRevenueCatMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';
import meta from './adapter-meta.js';

export const manifest: AdapterManifest = {
  id: meta.id,
  name: meta.name,
  type: meta.type as AdapterManifest['type'],
  description: meta.description,
  versions: meta.versions,
};
