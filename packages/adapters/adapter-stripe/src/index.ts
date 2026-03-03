export { StripeAdapter } from './stripe-adapter.js';
export { StripeConfigSchema } from './config.js';
export type { StripeConfig } from './config.js';
export { createStripeMcpServer, startStripeMcpServer } from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'stripe',
  name: 'Stripe API',
  type: 'api-mock',
  description: 'Stripe payments, billing, subscriptions mock adapter',
  versions: ['2025-03-31.basil', '2025-09-30.clover', '2026-02-25.clover'],
};
