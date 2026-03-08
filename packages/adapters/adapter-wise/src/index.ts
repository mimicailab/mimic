export { WiseAdapter } from './wise-adapter.js';
export { WiseConfigSchema } from './config.js';
export type { WiseConfig } from './config.js';
export {
  registerWiseTools,
  createWiseMcpServer,
  startWiseMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'wise',
  name: 'Wise API',
  type: 'api-mock',
  description:
    'Wise profiles, quotes, recipients, transfers, balances, exchange rates mock adapter',
  versions: ['v4', 'v3', 'v2', 'v1'],
};
