import { cn } from '@/lib/utils';
import type { ExplorerConfig, AdapterInfo, PersonaDataSummary } from '@/lib/api';
import type { Page } from '@/App';

interface SidebarProps {
  config: ExplorerConfig;
  adapters: AdapterInfo[];
  dataSummary: PersonaDataSummary[];
  page: Page;
  onNavigate: (page: Page) => void;
}

export function Sidebar({ config, adapters, dataSummary, page, onNavigate }: SidebarProps) {
  return (
    <aside className="flex w-64 flex-col border-r bg-card">
      {/* Logo */}
      <div
        className="flex h-14 items-center gap-2 border-b px-4 cursor-pointer"
        onClick={() => onNavigate({ type: 'dashboard' })}
      >
        <span className="text-xl font-bold tracking-tight">mimic</span>
        <span className="text-xs text-muted-foreground font-mono">explorer</span>
      </div>

      <nav className="flex-1 overflow-auto p-3 space-y-6">
        {/* Adapters */}
        <div>
          <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            API Adapters
          </div>
          <div className="space-y-0.5">
            {adapters.map((adapter) => (
              <button
                key={adapter.id}
                onClick={() => onNavigate({ type: 'adapter', adapterId: adapter.id })}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  page.type === 'adapter' && page.adapterId === adapter.id
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground',
                )}
              >
                <span className="truncate">{adapter.name}</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">{adapter.endpoints.length}</span>
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      adapter.enabled ? 'bg-emerald-500' : 'bg-zinc-500',
                    )}
                  />
                </span>
              </button>
            ))}
            {adapters.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                No adapters configured
              </div>
            )}
          </div>
        </div>

        {/* Persona Data */}
        <div>
          <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Persona Data
          </div>
          <div className="space-y-0.5">
            {dataSummary.map((ps) => {
              const totalEntities = Object.values(ps.tables).reduce((s, n) => s + n, 0)
                + Object.values(ps.apis).reduce(
                    (s, resources) => s + Object.values(resources).reduce((s2, n) => s2 + n, 0),
                    0,
                  );

              return (
                <button
                  key={ps.persona}
                  onClick={() => onNavigate({ type: 'data', persona: ps.persona })}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    page.type === 'data' && page.persona === ps.persona
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  <span className="truncate">{ps.persona}</span>
                  <span className="text-xs text-muted-foreground">{totalEntities}</span>
                </button>
              );
            })}
            {dataSummary.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                No data generated yet. Run <code className="bg-muted px-1 rounded">mimic run</code>
              </div>
            )}
          </div>
        </div>

        {/* Databases */}
        {config.databases && Object.keys(config.databases).length > 0 && (
          <div>
            <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Databases
            </div>
            <div className="space-y-0.5">
              {Object.entries(config.databases).map(([name, db]) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-muted-foreground"
                >
                  <span className="truncate">{name}</span>
                  <span className="text-xs font-mono">{db.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t p-3">
        <div className="text-xs text-muted-foreground">
          <div>{config.llm.provider} / {config.llm.model}</div>
          <div className="mt-0.5">{config.domain}</div>
        </div>
      </div>
    </aside>
  );
}
