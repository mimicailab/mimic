export { MercadoPagoAdapter } from './mercadopago-adapter.js';
export { MercadoPagoConfigSchema } from './config.js';
export type { MercadoPagoConfig } from './config.js';
export {
  registerMercadoPagoTools,
  createMercadoPagoMcpServer,
  startMercadoPagoMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'mercadopago',
  name: 'Mercado Pago API',
  type: 'api-mock',
  description:
    'Mercado Pago payments, refunds, preferences, customers, cards, subscriptions, plans, merchant orders mock adapter',
  versions: ['v1'],
};
