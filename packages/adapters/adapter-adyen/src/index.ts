export { AdyenAdapter } from './adyen-adapter.js';
export { AdyenConfigSchema } from './config.js';
export type { AdyenConfig } from './config.js';
export {
  registerAdyenTools,
  createAdyenMcpServer,
  startAdyenMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'adyen',
  name: 'Adyen API',
  type: 'api-mock',
  description:
    'Adyen checkout, captures, refunds, tokenization, payment links mock adapter',
  versions: ['v70', 'v71'],
};
