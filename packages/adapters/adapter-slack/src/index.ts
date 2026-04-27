export { SlackAdapter } from './slack-adapter.js';
export { SlackConfigSchema } from './config.js';
export type { SlackConfig } from './config.js';
export {
  registerSlackTools,
  createSlackMcpServer,
  startSlackMcpServer,
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
