export { GranolaAdapter } from './granola-adapter.js';
export { GranolaConfigSchema } from './config.js';
export type { GranolaConfig } from './config.js';
export {
  registerGranolaTools,
  createGranolaMcpServer,
  startGranolaMcpServer,
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
