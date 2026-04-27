export { GmailAdapter } from './gmail-adapter.js';
export { GmailConfigSchema } from './config.js';
export type { GmailConfig } from './config.js';
export {
  registerGmailTools,
  createGmailMcpServer,
  startGmailMcpServer,
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
