export { AttioAdapter } from './attio-adapter.js';
export { AttioConfigSchema } from './config.js';
export type { AttioConfig } from './config.js';
export {
  registerAttioTools,
  createAttioMcpServer,
  startAttioMcpServer,
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
