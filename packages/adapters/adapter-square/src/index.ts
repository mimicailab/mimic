export { SquareAdapter } from './square-adapter.js';
export { SquareConfigSchema } from './config.js';
export type { SquareConfig } from './config.js';
export {
  registerSquareTools,
  createSquareMcpServer,
  startSquareMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'square',
  name: 'Square API',
  type: 'api-mock',
  description:
    'Square POS payments, orders, catalog, inventory, subscriptions, invoices, bookings, loyalty, gift cards mock adapter',
  versions: ['2025-10-16'],
};
