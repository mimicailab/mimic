export { DLocalAdapter } from './dlocal-adapter.js';
export { DLocalConfigSchema } from './config.js';
export type { DLocalConfig } from './config.js';
export {
  registerDlocalTools,
  createDlocalMcpServer,
  startDlocalMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'dlocal',
  name: 'dLocal API',
  type: 'api-mock',
  description:
    'dLocal payments, refunds, payouts, chargebacks, local payment methods (PIX, SPEI, UPI, Boleto, OXXO, mPesa) mock adapter',
  versions: ['2.1'],
};
