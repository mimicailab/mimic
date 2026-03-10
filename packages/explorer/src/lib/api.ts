const BASE = '/_api';

export interface ExplorerConfig {
  domain: string;
  personas: Array<{ name: string; description: string; blueprint?: string }>;
  llm: { provider: string; model: string };
  apis: Record<string, { adapter?: string; enabled?: boolean; port?: number; mcp?: boolean }>;
  databases: Record<string, { type: string; url?: string }>;
}

export interface AdapterInfo {
  id: string;
  name: string;
  description: string;
  type: string;
  basePath: string;
  versions: string[];
  endpoints: Array<{ method: string; path: string; description: string }>;
  enabled: boolean;
  port?: number;
}

export interface PersonaDataSummary {
  persona: string;
  tables: Record<string, number>;
  apis: Record<string, Record<string, number>>;
}

export interface DataResponse {
  persona: string;
  tables: Record<string, unknown[]>;
  apiResponses: Record<string, { responses: Record<string, unknown[]> }>;
  facts: Array<{ id: string; type: string; platform: string; severity: string; detail: string }>;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  getConfig: () => fetchJson<ExplorerConfig>('/config'),
  getAdapters: () => fetchJson<AdapterInfo[]>('/adapters'),
  getDataSummary: () => fetchJson<PersonaDataSummary[]>('/data'),
  getPersonaData: (persona: string) => fetchJson<DataResponse>(`/data/${persona}`),
  testEndpoint: (port: number, method: string, path: string, body?: unknown) =>
    fetch(`http://localhost:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).then(async (res) => ({
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: await res.json().catch(() => res.text()),
    })),
};
