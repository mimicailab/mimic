export { CheckoutComAdapter } from './checkout-com-adapter.js';
export { CheckoutComConfigSchema } from './config.js';
export type { CheckoutComConfig } from './config.js';
export {
  registerCheckoutComTools,
  createCheckoutComMcpServer,
  startCheckoutComMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'checkout',
  name: 'Checkout.com API',
  type: 'api-mock',
  description:
    'Checkout.com payments, tokens, instruments, customers, disputes, hosted payments mock adapter',
  versions: ['default'],
};
