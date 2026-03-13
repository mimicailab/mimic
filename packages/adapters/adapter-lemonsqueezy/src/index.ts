export { LemonSqueezyAdapter } from './lemonsqueezy-adapter.js';
export { LemonSqueezyConfigSchema } from './config.js';
export type { LemonSqueezyConfig } from './config.js';
export { registerLemonSqueezyTools, createLemonSqueezyMcpServer, startLemonSqueezyMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';
import meta from './adapter-meta.js';

export const manifest: AdapterManifest = {
  id: meta.id,
  name: meta.name,
  type: meta.type as AdapterManifest['type'],
  description: meta.description,
  versions: meta.versions,
};
