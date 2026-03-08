export { RazorpayAdapter } from './razorpay-adapter.js';
export { RazorpayConfigSchema } from './config.js';
export type { RazorpayConfig } from './config.js';
export {
  registerRazorpayTools,
  createRazorpayMcpServer,
  startRazorpayMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'razorpay',
  name: 'Razorpay API',
  type: 'api-mock',
  description:
    'Razorpay orders, payments, refunds, customers, subscriptions, invoices, payment links, settlements, virtual accounts, QR codes, fund accounts, payouts mock adapter',
  versions: ['v1'],
};
