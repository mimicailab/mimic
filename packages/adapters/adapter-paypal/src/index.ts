export { PayPalAdapter } from './paypal-adapter.js';
export { PayPalConfigSchema } from './config.js';
export type { PayPalConfig } from './config.js';
export {
  registerPayPalTools,
  createPayPalMcpServer,
  startPayPalMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'paypal',
  name: 'PayPal API',
  type: 'api-mock',
  description:
    'PayPal orders, payments, payouts, disputes, subscriptions, invoicing mock adapter',
  versions: ['v1', 'v2', 'v3'],
};
