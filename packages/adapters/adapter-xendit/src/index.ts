export { XenditAdapter } from './xendit-adapter.js';
export { XenditConfigSchema } from './config.js';
export type { XenditConfig } from './config.js';
export {
  registerXenditTools,
  createXenditMcpServer,
  startXenditMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'xendit',
  name: 'Xendit API',
  type: 'api-mock',
  description:
    'Xendit payment requests, invoices, payouts, refunds, customers, payment methods, and balance mock adapter',
  versions: ['v3', 'v2'],
};
