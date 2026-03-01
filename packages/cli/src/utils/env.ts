/**
 * Resolve `$ENV_VAR` references in a string with actual environment values.
 *
 * Supports `$DATABASE_URL` style references (uppercase letters, digits, underscores).
 * Unresolved variables are replaced with an empty string.
 */
export function resolveEnvVars(value: string): string {
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name) => process.env[name] ?? '');
}
