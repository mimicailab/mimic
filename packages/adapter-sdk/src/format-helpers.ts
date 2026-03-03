/** Current Unix timestamp in seconds. */
export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** Normalize a value to an ISO date string (YYYY-MM-DD). */
export function toDateStr(val: unknown): string {
  if (!val) return new Date().toISOString().slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const str = String(val);
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return d.toISOString().slice(0, 10);
}

/** Capitalize the first letter of a string. */
export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
