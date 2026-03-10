import { cn } from '@/lib/utils';
import type { ExplorerConfig, AdapterInfo, PersonaDataSummary } from '@/lib/api';
import type { Page } from '@/App';

interface DashboardProps {
  config: ExplorerConfig;
  adapters: AdapterInfo[];
  dataSummary: PersonaDataSummary[];
  onNavigate: (page: Page) => void;
}

export function Dashboard({ config, adapters, dataSummary, onNavigate }: DashboardProps) {
  const totalEndpoints = adapters.reduce((s, a) => s + a.endpoints.length, 0);
  const totalEntities = dataSummary.reduce(
    (s, ps) =>
      s +
      Object.values(ps.tables).reduce((s2, n) => s2 + n, 0) +
      Object.values(ps.apis).reduce(
        (s2, resources) => s2 + Object.values(resources).reduce((s3, n) => s3 + n, 0),
        0,
      ),
    0,
  );

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Adapters" value={adapters.length} />
        <StatCard label="Endpoints" value={totalEndpoints} />
        <StatCard label="Personas" value={dataSummary.length} />
        <StatCard label="Total Entities" value={totalEntities} />
      </div>

      {/* Adapters grid */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">API Adapters</h2>
        <div className="grid grid-cols-3 gap-4">
          {adapters.map((adapter) => (
            <button
              key={adapter.id}
              onClick={() => onNavigate({ type: 'adapter', adapterId: adapter.id })}
              className={cn(
                'rounded-lg border bg-card p-4 text-left transition-colors',
                'hover:border-primary/30 hover:bg-accent',
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold">{adapter.name}</span>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                    adapter.enabled
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : 'bg-zinc-500/10 text-zinc-500',
                  )}
                >
                  {adapter.enabled ? 'active' : 'disabled'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                {adapter.description}
              </p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{adapter.endpoints.length} endpoints</span>
                {adapter.port && <span>:{adapter.port}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Persona data overview */}
      {dataSummary.length > 0 && (
        <div>
          <h2 className="mb-4 text-lg font-semibold">Persona Data</h2>
          <div className="grid grid-cols-2 gap-4">
            {dataSummary.map((ps) => (
              <button
                key={ps.persona}
                onClick={() => onNavigate({ type: 'data', persona: ps.persona })}
                className={cn(
                  'rounded-lg border bg-card p-4 text-left transition-colors',
                  'hover:border-primary/30 hover:bg-accent',
                )}
              >
                <div className="font-semibold mb-3">{ps.persona}</div>

                {Object.keys(ps.tables).length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Database Tables</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(ps.tables).map(([table, count]) => (
                        <span key={table} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                          <span className="text-muted-foreground">{table}</span>
                          <span className="font-mono font-medium">{count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {Object.keys(ps.apis).length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">API Resources</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(ps.apis).map(([adapterId, resources]) =>
                        Object.entries(resources).map(([resource, count]) => (
                          <span key={`${adapterId}-${resource}`} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                            <span className="text-muted-foreground">{adapterId}/{resource}</span>
                            <span className="font-mono font-medium">{count}</span>
                          </span>
                        )),
                      )}
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-bold tracking-tight">{value}</div>
    </div>
  );
}
