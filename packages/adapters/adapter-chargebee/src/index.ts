export { ChargebeeAdapter } from './chargebee-adapter.js';
export { ChargebeeConfigSchema } from './config.js';
export type { ChargebeeConfig } from './config.js';
export { registerChargebeeTools, createChargebeeMcpServer, startChargebeeMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';
import meta from './adapter-meta.js';

export const manifest: AdapterManifest = {
  id: meta.id,
  name: meta.name,
  type: meta.type as AdapterManifest['type'],
  description: meta.description,
  versions: meta.versions,
};
