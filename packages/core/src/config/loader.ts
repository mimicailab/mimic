import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { MimicConfigSchema, type MimicConfig } from '../types/config.js';
import { ConfigNotFoundError, ConfigInvalidError } from '../utils/errors.js';
import { fileExists } from '../utils/fs.js';

const ENV_VAR_PATTERN = /^\$([A-Z_][A-Z0-9_]*)$/;

/**
 * Resolve `$ENV_VAR` references in config values. When `lazy` is true,
 * unresolved variables are kept as-is (e.g. `$DATABASE_URL` stays in the
 * config) so commands that don't need them won't fail at load time.
 */
function resolveEnvVars(value: unknown, lazy = false): unknown {
  if (typeof value === 'string') {
    const match = value.match(ENV_VAR_PATTERN);
    if (match) {
      const envValue = process.env[match[1]];
      if (envValue === undefined) {
        if (lazy) return value; // keep $VAR as-is for deferred resolution
        throw new ConfigInvalidError(
          `Environment variable ${match[1]} is not set`,
          `Set the ${match[1]} environment variable or replace $${match[1]} with a literal value in mimic.json`,
        );
      }
      return envValue;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(v => resolveEnvVars(v, lazy));
  }
  if (value !== null && typeof value === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolveEnvVars(v, lazy);
    }
    return resolved;
  }
  return value;
}

/**
 * Resolve a single config value that may contain a `$VAR` reference.
 * Throws with a clear error if the variable is not set.
 */
export function resolveConfigEnvVar(value: string, context?: string): string {
  const match = value.match(ENV_VAR_PATTERN);
  if (match) {
    const envValue = process.env[match[1]];
    if (envValue === undefined) {
      const ctx = context ? ` (needed for ${context})` : '';
      throw new ConfigInvalidError(
        `Environment variable ${match[1]} is not set${ctx}`,
        `Set ${match[1]} in your .env file or environment, or replace $${match[1]} with a literal value in mimic.json`,
      );
    }
    return envValue;
  }
  return value;
}

export async function loadConfig(cwd?: string): Promise<MimicConfig> {
  const dir = cwd ?? process.cwd();
  const configPath = resolve(dir, 'mimic.json');

  if (!(await fileExists(configPath))) {
    throw new ConfigNotFoundError(configPath);
  }

  let raw: unknown;
  try {
    const content = await readFile(configPath, 'utf-8');
    raw = JSON.parse(content);
  } catch (err) {
    throw new ConfigInvalidError(
      `Failed to parse mimic.json: ${err instanceof Error ? err.message : String(err)}`,
      'Ensure mimic.json contains valid JSON',
    );
  }

  // Resolve env vars lazily — unresolved $VARs stay as-is so commands
  // that don't need e.g. DATABASE_URL won't fail at config load time.
  const resolved = resolveEnvVars(raw, true);

  const result = MimicConfigSchema.safeParse(resolved);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigInvalidError(
      `Invalid mimic.json:\n${issues}`,
      'Check the configuration reference at https://github.com/mimicailab/mimic',
    );
  }

  return result.data;
}
