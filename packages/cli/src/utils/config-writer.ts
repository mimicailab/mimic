import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CONFIG_FILE = 'mimic.json';

/**
 * Read the raw mimic.json as a mutable object.
 * Throws if the file doesn't exist.
 */
export async function readConfig(cwd: string): Promise<Record<string, unknown>> {
  const path = join(cwd, CONFIG_FILE);
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Write the config object back to mimic.json, preserving formatting.
 */
export async function writeConfig(cwd: string, config: Record<string, unknown>): Promise<void> {
  const path = join(cwd, CONFIG_FILE);
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
