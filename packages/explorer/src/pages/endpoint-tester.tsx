import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { AdapterInfo } from '@/lib/api';
import { RawJsonViewer } from '@/components/explorer/json-viewer';
import { groupEndpoints } from '@/lib/group-endpoints';

interface EndpointTesterProps {
  adapter: AdapterInfo;
  initialEndpoint?: { method: string; path: string };
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  POST: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
  PUT: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  PATCH: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  DELETE: 'bg-red-500/10 text-red-500 border-red-500/30',
};

export function EndpointTester({ adapter, initialEndpoint }: EndpointTesterProps) {
  const [selectedEndpoint, setSelectedEndpoint] = useState(
    initialEndpoint ?? adapter.endpoints[0] ?? null,
  );
  const [requestBody, setRequestBody] = useState('{}');
  const [response, setResponse] = useState<{
    status: number;
    headers: Record<string, string>;
    body: unknown;
    duration: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => groupEndpoints(adapter.endpoints, adapter.basePath), [adapter]);

  // Find which group the initial/selected endpoint belongs to, keep that expanded
  const initialGroup = useMemo(() => {
    if (!selectedEndpoint) return null;
    return groups.find((g) =>
      g.endpoints.some((ep) => ep.method === selectedEndpoint.method && ep.path === selectedEndpoint.path),
    )?.label ?? null;
  }, []);

  // Start with all groups collapsed except the one containing the selected endpoint
  const [sidebarInited] = useState(() => {
    const init: Record<string, boolean> = {};
    for (const g of groups) {
      init[g.label] = g.label !== initialGroup;
    }
    return init;
  });

  const getCollapsed = (label: string) => sidebarCollapsed[label] ?? sidebarInited[label] ?? true;
  const toggleSidebar = (label: string) =>
    setSidebarCollapsed((prev) => ({ ...prev, [label]: !getCollapsed(label) }));

  const handleSend = async () => {
    if (!selectedEndpoint || !adapter.port) return;

    setLoading(true);
    setError(null);
    setResponse(null);

    const start = performance.now();
    try {
      const res = await fetch(`http://localhost:${adapter.port}${selectedEndpoint.path}`, {
        method: selectedEndpoint.method,
        headers: { 'Content-Type': 'application/json' },
        ...(selectedEndpoint.method !== 'GET' && requestBody.trim()
          ? { body: requestBody }
          : {}),
      });
      const duration = Math.round(performance.now() - start);
      const body = await res.json().catch(() => null);
      setResponse({
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body,
        duration,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Request failed. Is mimic host running?',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{adapter.name} — Endpoint Tester</h1>
        <p className="mt-1 text-muted-foreground">
          Send requests to the running mock server on port {adapter.port ?? 'N/A'}
        </p>
      </div>

      <div className="flex gap-6">
        {/* Endpoint list (grouped) */}
        <div className="w-72 shrink-0 space-y-0.5 overflow-y-auto max-h-[calc(100vh-12rem)]">
          {groups.map(({ label, endpoints }) => {
            const isCollapsed = getCollapsed(label);
            const hasSelected = endpoints.some(
              (ep) => ep.method === selectedEndpoint?.method && ep.path === selectedEndpoint?.path,
            );
            return (
              <div key={label}>
                <button
                  onClick={() => toggleSidebar(label)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent',
                    hasSelected && isCollapsed && 'text-accent-foreground',
                  )}
                >
                  <span className={cn('text-[10px] text-muted-foreground transition-transform', !isCollapsed && 'rotate-90')}>
                    ▶
                  </span>
                  <span className="font-medium truncate">{label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{endpoints.length}</span>
                </button>
                {!isCollapsed &&
                  endpoints.map((ep, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSelectedEndpoint(ep);
                        setResponse(null);
                        setError(null);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 pl-6 py-1.5 text-sm transition-colors',
                        'hover:bg-accent',
                        selectedEndpoint?.path === ep.path && selectedEndpoint?.method === ep.method
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold',
                          METHOD_COLORS[ep.method] ?? 'bg-muted',
                        )}
                      >
                        {ep.method}
                      </span>
                      <span className="truncate font-mono text-xs">{ep.path}</span>
                    </button>
                  ))}
              </div>
            );
          })}
        </div>

        {/* Request / Response */}
        <div className="flex-1 space-y-4">
          {selectedEndpoint && (
            <>
              {/* Request bar */}
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'shrink-0 rounded border px-3 py-1.5 text-sm font-bold',
                    METHOD_COLORS[selectedEndpoint.method] ?? 'bg-muted',
                  )}
                >
                  {selectedEndpoint.method}
                </span>
                <div className="flex-1 rounded-md border bg-muted/50 px-3 py-1.5 font-mono text-sm">
                  http://localhost:{adapter.port}{selectedEndpoint.path}
                </div>
                <button
                  onClick={handleSend}
                  disabled={loading || !adapter.port}
                  className={cn(
                    'rounded-md bg-primary px-6 py-1.5 text-sm font-medium text-primary-foreground',
                    'hover:bg-primary/90 transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  {loading ? 'Sending...' : 'Send'}
                </button>
              </div>

              {/* Request body (for POST/PUT/PATCH) */}
              {selectedEndpoint.method !== 'GET' &&
                selectedEndpoint.method !== 'DELETE' && (
                  <div>
                    <div className="mb-2 text-xs font-medium text-muted-foreground">
                      Request Body
                    </div>
                    <textarea
                      value={requestBody}
                      onChange={(e) => setRequestBody(e.target.value)}
                      className="w-full rounded-md border bg-muted/30 p-3 font-mono text-sm resize-y min-h-[100px] focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder="{}"
                    />
                  </div>
                )}

              {/* Error */}
              {error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-500">
                  {error}
                </div>
              )}

              {/* Response */}
              {response && (
                <div className="space-y-3">
                  <div className="flex items-center gap-4">
                    <span
                      className={cn(
                        'rounded px-2 py-0.5 text-sm font-bold',
                        response.status < 300
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : response.status < 500
                            ? 'bg-amber-500/10 text-amber-500'
                            : 'bg-red-500/10 text-red-500',
                      )}
                    >
                      {response.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {response.duration}ms
                    </span>
                  </div>
                  <div className="rounded-lg border bg-card overflow-auto max-h-[600px] p-4">
                    <RawJsonViewer data={response.body} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
