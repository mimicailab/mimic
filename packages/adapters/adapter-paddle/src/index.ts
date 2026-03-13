export { PaddleAdapter } from './paddle-adapter.js';
export { PaddleConfigSchema } from './config.js';
export type { PaddleConfig } from './config.js';
export { registerPaddleTools, createPaddleMcpServer, startPaddleMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';
import meta from './adapter-meta.js';

export const manifest: AdapterManifest = {
  id: meta.id,
  name: meta.name,
  type: meta.type as AdapterManifest['type'],
  description: meta.description,
  versions: meta.versions,
};
