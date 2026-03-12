import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Resolve `$ENV_VAR` references in a string with actual environment values.
 *
 * Supports `$DATABASE_URL` style references (uppercase letters, digits, underscores).
 * Unresolved variables are replaced with an empty string.
 */
export function resolveEnvVars(value: string): string {
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name) => process.env[name] ?? '');
}

/**
 * Load a `.env` file from the given directory into `process.env`.
 * Does NOT override variables that are already set.
 * Silently skips if the file doesn't exist.
 */
export function loadEnvFile(dir: string): void {
  const envPath = resolve(dir, '.env');
  let content: string;
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch {
    return;
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Don't override existing env vars
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
