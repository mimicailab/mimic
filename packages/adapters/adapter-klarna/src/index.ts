export { KlarnaAdapter } from './klarna-adapter.js';
export { KlarnaConfigSchema } from './config.js';
export type { KlarnaConfig } from './config.js';
export {
  registerKlarnaTools,
  createKlarnaMcpServer,
  startKlarnaMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'klarna',
  name: 'Klarna API',
  type: 'api-mock',
  description:
    'Klarna BNPL, payments, order management, checkout, customer tokens, HPP mock adapter',
  versions: ['payments/v1', 'ordermanagement/v1', 'checkout/v3', 'customer-token/v1', 'hpp/v1', 'settlements/v1'],
};
