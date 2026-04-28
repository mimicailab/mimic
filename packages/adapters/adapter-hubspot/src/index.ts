export { HubSpotAdapter } from './hubspot-adapter.js';
export { HubSpotConfigSchema } from './config.js';
export type { HubSpotConfig } from './config.js';
export {
  registerHubSpotTools,
  createHubSpotMcpServer,
  startHubSpotMcpServer,
} from './mcp.js';

import type { AdapterManifest } from '@mimicai/adapter-sdk';
import meta from './adapter-meta.js';

export const manifest: AdapterManifest = {
  id: meta.id,
  name: meta.name,
  type: meta.type as AdapterManifest['type'],
  description: meta.description,
  versions: meta.versions,
};
