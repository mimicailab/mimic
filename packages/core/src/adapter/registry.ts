import type { Adapter, AdapterManifest } from '../types/adapter.js';
import { AdapterNotFoundError } from '../utils/errors.js';

export class AdapterRegistry {
  private adapters = new Map<string, Adapter>();
  private manifests = new Map<string, AdapterManifest>();

  /** Register a built-in adapter */
  register(adapter: Adapter, manifest: AdapterManifest): void {
    this.adapters.set(adapter.id, adapter);
    this.manifests.set(adapter.id, manifest);
  }

  /** Dynamically load an adapter from npm */
  async loadExternal(packageName: string): Promise<Adapter> {
    try {
      const mod = await import(packageName);
      const AdapterClass = mod.default || mod.adapter;
      if (!AdapterClass) {
        throw new Error(`Module "${packageName}" does not export a default adapter class`);
      }
      const adapter: Adapter =
        typeof AdapterClass === 'function' ? new AdapterClass() : AdapterClass;
      const manifest: AdapterManifest = mod.manifest;
      if (manifest) {
        this.register(adapter, manifest);
      }
      return adapter;
    } catch (err) {
      if (err instanceof AdapterNotFoundError) throw err;
      throw new AdapterNotFoundError(packageName);
    }
  }

  /** Get adapter by ID, loading from npm if needed */
  async resolve(id: string, npmPackage?: string): Promise<Adapter> {
    if (this.adapters.has(id)) return this.adapters.get(id)!;
    if (npmPackage) return this.loadExternal(npmPackage);

    // Convention: @mimicai/adapter-{id}
    return this.loadExternal(`@mimicai/adapter-${id}`);
  }

  getAdapter(id: string): Adapter | undefined {
    return this.adapters.get(id);
  }

  getManifest(id: string): AdapterManifest | undefined {
    return this.manifests.get(id);
  }

  /** List all registered adapters */
  list(): AdapterManifest[] {
    return [...this.manifests.values()];
  }

  clear(): void {
    this.adapters.clear();
    this.manifests.clear();
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible module-level functions using a default singleton
// ---------------------------------------------------------------------------

const defaultRegistry = new AdapterRegistry();

export function registerAdapter(adapter: Adapter, manifest: AdapterManifest): void {
  defaultRegistry.register(adapter, manifest);
}

export function getAdapter(id: string): Adapter | undefined {
  return defaultRegistry.getAdapter(id);
}

export function getManifest(id: string): AdapterManifest | undefined {
  return defaultRegistry.getManifest(id);
}

export function listAdapters(): AdapterManifest[] {
  return defaultRegistry.list();
}

export function clearRegistry(): void {
  defaultRegistry.clear();
}
