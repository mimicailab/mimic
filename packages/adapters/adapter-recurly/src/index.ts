export { RecurlyAdapter } from './recurly-adapter.js';
export { RecurlyConfigSchema } from './config.js';
export type { RecurlyConfig } from './config.js';
export { registerRecurlyTools, createRecurlyMcpServer, startRecurlyMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';
import meta from './adapter-meta.js';

export const manifest: AdapterManifest = {
  id: meta.id,
  name: meta.name,
  type: meta.type as AdapterManifest['type'],
  description: meta.description,
  versions: meta.versions,
};
