import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { PersonaDataSummary, DataResponse } from '@/lib/api';
import { JsonViewer } from '@/components/explorer/json-viewer';

interface DataViewProps {
  persona: string;
  source?: string;
  resource?: string;
  dataSummary: PersonaDataSummary[];
  loadPersonaData: (persona: string) => Promise<DataResponse>;
}

export function DataView({ persona, dataSummary, loadPersonaData }: DataViewProps) {
  const [data, setData] = useState<DataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedResource, setSelectedResource] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    loadPersonaData(persona).then((d) => {
      setData(d);
      setLoading(false);
    });
  }, [persona]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-muted-foreground">Loading data...</span>
      </div>
    );
  }

  if (!data) return null;

  // Build navigation tree
  const sources: Array<{
    id: string;
    label: string;
    type: 'table' | 'api';
    resources: Array<{ id: string; label: string; count: number }>;
  }> = [];

  // DB tables
  if (Object.keys(data.tables).length > 0) {
    sources.push({
      id: 'database',
      label: 'Database',
      type: 'table',
      resources: Object.entries(data.tables).map(([name, rows]) => ({
        id: name,
        label: name,
        count: (rows as unknown[]).length,
      })),
    });
  }

  // API adapters
  for (const [adapterId, responseSet] of Object.entries(data.apiResponses)) {
    const resources = Object.entries(responseSet.responses)
      .filter(([, arr]) => (arr as unknown[]).length > 0)
      .map(([resource, arr]) => ({
        id: resource,
        label: resource,
        count: (arr as unknown[]).length,
      }));
    if (resources.length > 0) {
      sources.push({ id: adapterId, label: adapterId, type: 'api', resources });
    }
  }

  const activeSource = selectedSource ?? sources[0]?.id ?? null;
  const sourceObj = sources.find((s) => s.id === activeSource);
  const activeResource = selectedResource ?? sourceObj?.resources[0]?.id ?? null;

  const getActiveData = (): unknown[] => {
    if (!sourceObj || !activeResource) return [];
    if (sourceObj.type === 'table') {
      return (data.tables[activeResource] as unknown[]) ?? [];
    }
    return (data.apiResponses[activeSource!]?.responses[activeResource] as unknown[]) ?? [];
  };

  const activeData = getActiveData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{persona}</h1>
        <p className="text-muted-foreground mt-1">
          Generated data for this persona across all configured surfaces.
        </p>
      </div>

      {/* Facts */}
      {data.facts && data.facts.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Facts ({data.facts.length})</h2>
          <div className="grid grid-cols-2 gap-3">
            {data.facts.map((fact) => (
              <div
                key={fact.id}
                className={cn(
                  'rounded-lg border p-3',
                  fact.severity === 'critical' && 'border-red-500/30 bg-red-500/5',
                  fact.severity === 'warn' && 'border-amber-500/30 bg-amber-500/5',
                  fact.severity === 'info' && 'border-blue-500/30 bg-blue-500/5',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn(
                      'text-xs font-medium rounded px-1.5 py-0.5',
                      fact.severity === 'critical' && 'bg-red-500/10 text-red-500',
                      fact.severity === 'warn' && 'bg-amber-500/10 text-amber-500',
                      fact.severity === 'info' && 'bg-blue-500/10 text-blue-500',
                    )}
                  >
                    {fact.severity}
                  </span>
                  <span className="text-xs text-muted-foreground">{fact.platform}</span>
                  <span className="text-xs text-muted-foreground">{fact.type}</span>
                </div>
                <p className="text-sm">{fact.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Source / Resource navigation + data viewer */}
      <div className="flex gap-4 min-h-[500px]">
        {/* Source tree */}
        <div className="w-56 shrink-0 space-y-2">
          {sources.map((source) => (
            <div key={source.id}>
              <div
                className={cn(
                  'px-2 py-1 text-xs font-semibold uppercase tracking-wider cursor-pointer rounded',
                  activeSource === source.id
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => {
                  setSelectedSource(source.id);
                  setSelectedResource(source.resources[0]?.id ?? null);
                }}
              >
                {source.label}
                <span className="ml-1.5 font-normal normal-case">
                  ({source.type === 'api' ? 'api' : 'db'})
                </span>
              </div>
              {activeSource === source.id && (
                <div className="ml-2 mt-1 space-y-0.5">
                  {source.resources.map((res) => (
                    <button
                      key={res.id}
                      onClick={() => setSelectedResource(res.id)}
                      className={cn(
                        'flex w-full items-center justify-between rounded px-2 py-1 text-sm transition-colors',
                        activeResource === res.id
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50',
                      )}
                    >
                      <span className="truncate">{res.label}</span>
                      <span className="text-xs font-mono">{res.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Data panel */}
        <div className="flex-1 rounded-lg border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
            <span className="text-sm font-medium">
              {activeResource ?? 'Select a resource'}
            </span>
            <span className="text-xs text-muted-foreground">
              {activeData.length} {activeData.length === 1 ? 'record' : 'records'}
            </span>
          </div>
          <div className="overflow-auto max-h-[600px] p-4">
            {activeData.length > 0 ? (
              <JsonViewer data={activeData} />
            ) : (
              <div className="text-center text-muted-foreground py-12">
                No data available
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
