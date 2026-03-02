export { BaseAdapter } from './base.js';
export {
  AdapterRegistry,
  registerAdapter,
  getAdapter,
  getManifest,
  listAdapters,
  clearRegistry,
} from './registry.js';
export { loadExternalAdapter } from './loader.js';
export type { LoadedAdapter } from './loader.js';
export { registerDefaults } from './defaults.js';
