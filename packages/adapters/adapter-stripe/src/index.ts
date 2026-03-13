export { StripeAdapter } from './stripe-adapter.js';
export { StripeConfigSchema } from './config.js';
export type { StripeConfig } from './config.js';
export { registerStripeTools, createStripeMcpServer, startStripeMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';
import meta from './adapter-meta.js';

export const manifest: AdapterManifest = {
  id: meta.id,
  name: meta.name,
  type: meta.type as AdapterManifest['type'],
  description: meta.description,
  versions: meta.versions,
};
