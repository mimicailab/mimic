export { MollieAdapter } from './mollie-adapter.js';
export { MollieConfigSchema } from './config.js';
export type { MollieConfig } from './config.js';
export {
  registerMollieTools,
  createMollieMcpServer,
  startMollieMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'mollie',
  name: 'Mollie API',
  type: 'api-mock',
  description:
    'Mollie payments, refunds, orders, customers, subscriptions mock adapter',
  versions: ['v2'],
};
