export { FlutterwaveAdapter } from './flutterwave-adapter.js';
export { FlutterwaveConfigSchema } from './config.js';
export type { FlutterwaveConfig } from './config.js';
export {
  registerFlutterwaveTools,
  createFlutterwaveMcpServer,
  startFlutterwaveMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'flutterwave',
  name: 'Flutterwave API',
  type: 'api-mock',
  description:
    'Flutterwave payments, charges, transfers, subscriptions, virtual accounts, bills, settlements, chargebacks mock adapter',
  versions: ['v3'],
};
