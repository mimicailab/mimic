export { BraintreeAdapter } from './braintree-adapter.js';
export { BraintreeConfigSchema } from './config.js';
export type { BraintreeConfig } from './config.js';
export {
  registerBraintreeTools,
  createBraintreeMcpServer,
  startBraintreeMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'braintree',
  name: 'Braintree API',
  type: 'api-mock',
  description:
    'Braintree transactions, customers, payment methods, subscriptions, disputes mock adapter',
  versions: ['rest', 'graphql'],
};
