export { GoCardlessAdapter } from './gocardless-adapter.js';
export { GoCardlessConfigSchema } from './config.js';
export type { GoCardlessConfig } from './config.js';
export { registerGoCardlessTools, createGoCardlessMcpServer, startGoCardlessMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';
import meta from './adapter-meta.js';

export const manifest: AdapterManifest = {
  id: meta.id,
  name: meta.name,
  type: meta.type as AdapterManifest['type'],
  description: meta.description,
  versions: meta.versions,
};
