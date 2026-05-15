import type {
  Adapter,
  AdapterManifest,
  ApiMockAdapter,
} from '../types/adapter.js';
import {
  registerProjectorHints,
  type ProjectorHints,
} from '../projection/projector-hints.js';
import { AdapterNotFoundError } from '../utils/errors.js';

export class AdapterRegistry {
  private adapters = new Map<string, Adapter>();
  private manifests = new Map<string, AdapterManifest>();

  /** Register a built-in adapter */
  register(adapter: Adapter, manifest: AdapterManifest): void {
    this.adapters.set(adapter.id, adapter);
    this.manifests.set(adapter.id, manifest);
    // Also publish the adapter's projector hints so the core projector can
    // mint surface-formatted IDs without reaching back into the adapter.
    const hints = deriveProjectorHints(adapter);
    if (hints) registerProjectorHints(hints);
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
// Projector hint derivation
// ---------------------------------------------------------------------------

/**
 * Build a ProjectorHints record from an adapter's resourceSpecs / promptContext.
 *
 * Resolution:
 *   - platform-level `idPrefix` (resourceSpecs.platform.idPrefix or
 *     promptContext.idPrefix) becomes the adapter-level default.
 *   - per-resource `id.idPrefix` becomes the resource-keyed override.
 *   - required, defaulted fields on each resource become the resource's
 *     `requiredDefaults` so the projector can fill them when the canonical
 *     entity does not carry the field.
 *
 * Returns undefined when the adapter carries no prefix or defaults at all —
 * DB adapters, for instance, don't need hints; the default-prefix fallback
 * in the projectors handles them.
 */
export function deriveProjectorHints(adapter: Adapter): ProjectorHints | undefined {
  if (adapter.type !== 'api-mock') return undefined;
  const api = adapter as ApiMockAdapter;

  const idPrefixes: Record<string, string> = {};
  let adapterIdPrefix: string | undefined;
  let requiredDefaults: Record<string, Record<string, unknown>> | undefined;

  if (api.resourceSpecs) {
    adapterIdPrefix = api.resourceSpecs.platform.idPrefix;
    for (const [resource, spec] of Object.entries(api.resourceSpecs.resources)) {
      const idField = spec.fields.id;
      if (idField?.idPrefix) idPrefixes[resource] = idField.idPrefix;

      const defaults: Record<string, unknown> = {};
      for (const [fieldName, fieldSpec] of Object.entries(spec.fields)) {
        if (
          fieldName !== 'id' &&
          fieldSpec.required &&
          fieldSpec.default !== undefined
        ) {
          defaults[fieldName] = fieldSpec.default;
        }
      }
      if (Object.keys(defaults).length > 0) {
        if (!requiredDefaults) requiredDefaults = {};
        requiredDefaults[resource] = defaults;
      }
    }
  } else if (api.promptContext) {
    adapterIdPrefix = api.promptContext.idPrefix;
  }

  if (!adapterIdPrefix && Object.keys(idPrefixes).length === 0 && !requiredDefaults) {
    return undefined;
  }

  return {
    adapterId: adapter.id,
    idPrefix: adapterIdPrefix,
    idPrefixes: Object.keys(idPrefixes).length > 0 ? idPrefixes : undefined,
    requiredDefaults,
    surface: adapter.id,
  };
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
