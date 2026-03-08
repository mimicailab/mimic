export { DwollaAdapter } from './dwolla-adapter.js';
export { DwollaConfigSchema } from './config.js';
export type { DwollaConfig } from './config.js';
export {
  registerDwollaTools,
  createDwollaMcpServer,
  startDwollaMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';

export const manifest: AdapterManifest = {
  id: 'dwolla',
  name: 'Dwolla API',
  type: 'api-mock',
  description:
    'Dwolla ACH payment platform mock adapter — customers, funding sources, transfers, mass payments, events, webhooks',
  versions: ['v2'],
};
