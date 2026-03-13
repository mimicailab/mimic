import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { AdapterInfo } from '@/lib/api';
import type { Page } from '@/App';
import { groupEndpoints } from '@/lib/group-endpoints';

interface AdapterViewProps {
  adapter: AdapterInfo;
  onNavigate: (page: Page) => void;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-blue-500/10 text-blue-500',
  POST: 'bg-emerald-500/10 text-emerald-500',
  PUT: 'bg-amber-500/10 text-amber-500',
  PATCH: 'bg-orange-500/10 text-orange-500',
  DELETE: 'bg-red-500/10 text-red-500',
};

export function AdapterView({ adapter, onNavigate }: AdapterViewProps) {
  const groups = useMemo(() => groupEndpoints(adapter.endpoints, adapter.basePath), [adapter]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (group: string) =>
    setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{adapter.name}</h1>
          <p className="mt-1 text-muted-foreground">{adapter.description}</p>
          <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
            <span className="font-mono">@mimicai/adapter-{adapter.id}</span>
            {adapter.port && <span>Port: {adapter.port}</span>}
            {adapter.versions.length > 0 && (
              <span>Versions: {adapter.versions.join(', ')}</span>
            )}
          </div>
        </div>
        <button
          onClick={() => onNavigate({ type: 'tester', adapterId: adapter.id })}
          className={cn(
            'rounded-md border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
            'hover:bg-primary/90 transition-colors',
          )}
        >
          Test Endpoints
        </button>
      </div>

      {/* Endpoints grouped */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">
          Endpoints ({adapter.endpoints.length})
        </h2>
        <div className="space-y-2">
          {groups.map(({ label, endpoints }) => {
            const isCollapsed = collapsed[label] ?? false;
            return (
              <div key={label} className="rounded-lg border">
                <button
                  onClick={() => toggle(label)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
                >
                  <span className={cn(
                    'text-muted-foreground transition-transform text-xs',
                    isCollapsed ? '' : 'rotate-90',
                  )}>
                    ▶
                  </span>
                  <span className="font-medium text-sm">{label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {endpoints.length} endpoint{endpoints.length !== 1 ? 's' : ''}
                  </span>
                </button>
                {!isCollapsed && (
                  <table className="w-full">
                    <tbody>
                      {endpoints.map((ep, i) => (
                        <tr
                          key={i}
                          className={cn(
                            'transition-colors hover:bg-muted/30 border-t',
                          )}
                        >
                          <td className="px-4 py-2.5 w-24">
                            <span
                              className={cn(
                                'inline-block rounded px-2 py-0.5 text-xs font-bold',
                                METHOD_COLORS[ep.method] ?? 'bg-muted text-muted-foreground',
                              )}
                            >
                              {ep.method}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-sm">{ep.path}</td>
                          <td className="px-4 py-2.5 text-sm text-muted-foreground">
                            {ep.description}
                          </td>
                          <td className="px-4 py-2.5 text-right w-20">
                            <button
                              onClick={() =>
                                onNavigate({
                                  type: 'tester',
                                  adapterId: adapter.id,
                                  endpoint: { method: ep.method, path: ep.path },
                                })
                              }
                              className="text-xs text-primary hover:underline"
                            >
                              Try it
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
