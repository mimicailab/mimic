import { join } from 'node:path';
import { readdir, rm } from 'node:fs/promises';
import type { Blueprint } from '../types/index.js';
import { fileExists, readJson, writeJson, ensureDir } from '../utils/fs.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// BlueprintCache
// ---------------------------------------------------------------------------

/**
 * Filesystem-backed blueprint cache.
 *
 * Blueprints are stored as individual JSON files keyed by their SHA-256 cache
 * key inside the configured cache directory (typically `.mimic/blueprints/`).
 */
export class BlueprintCache {
  private readonly cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Check whether a blueprint with the given cache key exists on disk. */
  async has(key: string): Promise<boolean> {
    return fileExists(this.keyPath(key));
  }

  /** Read a cached blueprint.  Returns `null` if not present. */
  async get(key: string): Promise<Blueprint | null> {
    const path = this.keyPath(key);
    if (!(await fileExists(path))) {
      return null;
    }

    try {
      const blueprint = await readJson<Blueprint>(path);
      logger.debug(`Blueprint cache hit: ${key}`);
      return blueprint;
    } catch (error) {
      logger.debug(
        `Blueprint cache read error for ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** Write a blueprint to the cache, creating directories as needed. */
  async set(key: string, blueprint: Blueprint): Promise<void> {
    await ensureDir(this.cacheDir);
    await writeJson(this.keyPath(key), blueprint);
    logger.debug(`Blueprint cached: ${key}`);
  }

  /** Delete a single cached blueprint. */
  async delete(key: string): Promise<boolean> {
    const path = this.keyPath(key);
    if (!(await fileExists(path))) {
      return false;
    }
    await rm(path);
    logger.debug(`Blueprint cache entry removed: ${key}`);
    return true;
  }

  /** Remove all cached blueprints from the cache directory. */
  async clear(): Promise<number> {
    if (!(await fileExists(this.cacheDir))) {
      return 0;
    }

    let removed = 0;
    try {
      const entries = await readdir(this.cacheDir);
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          await rm(join(this.cacheDir, entry));
          removed++;
        }
      }
    } catch {
      // Directory may not exist or be unreadable — acceptable
    }

    logger.debug(`Blueprint cache cleared: ${removed} entries removed`);
    return removed;
  }

  /** List all cache keys currently stored. */
  async keys(): Promise<string[]> {
    if (!(await fileExists(this.cacheDir))) {
      return [];
    }

    try {
      const entries = await readdir(this.cacheDir);
      return entries
        .filter((e) => e.endsWith('.json'))
        .map((e) => e.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  /** Return the resolved cache directory path. */
  getDirectory(): string {
    return this.cacheDir;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private keyPath(key: string): string {
    // Sanitise the key to prevent path traversal
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.cacheDir, `${safe}.json`);
  }
}
