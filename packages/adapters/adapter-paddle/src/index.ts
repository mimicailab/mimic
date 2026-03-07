export { PaddleAdapter } from './paddle-adapter.js';
export { PaddleConfigSchema } from './config.js';
export type { PaddleConfig } from './config.js';
export { registerPaddleTools, createPaddleMcpServer, startPaddleMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'paddle',
  name: 'Paddle API',
  type: 'api-mock',
  description: 'Paddle payments, subscriptions, billing mock adapter (merchant of record)',
  versions: ['1'],
};
