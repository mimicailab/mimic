/**
 * Behavior pack loader — parses YAML behavior packs into BehaviorPack objects.
 *
 * Adapters compile their `behavior/*.yaml` into a single JSON module at build
 * time (see each adapter's behavior codegen) so no YAML parsing happens at
 * runtime. This loader is used by that codegen and by tests.
 */

import { parse as parseYaml } from 'yaml';
import type { BehaviorPack } from './types.js';

/** Parse a YAML string into a BehaviorPack. */
export function loadBehaviorPack(yamlSource: string): BehaviorPack {
  const pack = parseYaml(yamlSource) as BehaviorPack;
  if (!pack || !Array.isArray(pack.actions)) {
    throw new Error('Invalid behavior pack: missing "actions" array');
  }
  return pack;
}
