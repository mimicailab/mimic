type Endpoint = { method: string; path: string; description: string };

export interface EndpointGroup {
  label: string;
  endpoints: Endpoint[];
}

/**
 * Groups endpoints by their top-level resource segment.
 * e.g. /stripe/v1/customers/:id → "customers"
 *      /stripe/v1/accounts/:account/bank_accounts → "accounts"
 */
export function groupEndpoints(endpoints: Endpoint[], basePath: string): EndpointGroup[] {
  const map = new Map<string, Endpoint[]>();

  for (const ep of endpoints) {
    // Strip the basePath prefix, then extract the first segment
    let rest = ep.path;
    if (rest.startsWith(basePath)) {
      rest = rest.slice(basePath.length);
    }
    // Remove leading slash and version prefix (e.g. "v1/")
    rest = rest.replace(/^\//, '').replace(/^v\d+\//, '');
    // First segment is the resource group
    const seg = rest.split('/')[0] || 'other';
    const key = seg.replace(/^:/, '');

    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(ep);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, endpoints]) => ({ label, endpoints }));
}
