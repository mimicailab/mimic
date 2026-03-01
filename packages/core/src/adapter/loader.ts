import type { Adapter, AdapterManifest } from '../types/adapter.js';
import { AdapterNotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface LoadedAdapter {
  adapter: Adapter;
  manifest: AdapterManifest;
}

/**
 * Dynamically load an adapter from an npm package.
 *
 * The package must export either a default class or an `adapter` named export,
 * plus a `manifest` export describing the adapter.
 */
export async function loadExternalAdapter(packageName: string): Promise<LoadedAdapter> {
  logger.debug(`Loading external adapter: ${packageName}`);

  try {
    const mod = await import(packageName);
    const AdapterClass = mod.default || mod.adapter;

    if (!AdapterClass) {
      throw new Error(`Module "${packageName}" does not export a default adapter class`);
    }

    const adapter: Adapter =
      typeof AdapterClass === 'function' ? new AdapterClass() : AdapterClass;
    const manifest: AdapterManifest = mod.manifest;

    if (!manifest) {
      throw new Error(`Module "${packageName}" does not export a manifest`);
    }

    return { adapter, manifest };
  } catch (err) {
    if (err instanceof AdapterNotFoundError) throw err;

    throw new AdapterNotFoundError(packageName);
  }
}
