import type { ExplorerConfig, AdapterInfo, PersonaDataSummary } from '@/lib/api';
import type { Page } from '@/App';

interface RailProps {
  config: ExplorerConfig;
  adapters: AdapterInfo[];
  dataSummary: PersonaDataSummary[];
  page: Page;
  hostPort?: number;
  onNavigate: (page: Page) => void;
}

const SURFACE_COLOR: Record<string, string> = {
  postgres: 'var(--postgres)',
  postgresql: 'var(--postgres)',
  mysql: 'var(--postgres)',
  sqlite: 'var(--postgres)',
  stripe: 'var(--stripe)',
};

function entityCount(s?: PersonaDataSummary): number {
  if (!s) return 0;
  return (
    Object.values(s.tables).reduce((a, b) => a + b, 0) +
    Object.values(s.apis).reduce(
      (a, res) => a + Object.values(res).reduce((x, y) => x + y, 0),
      0,
    )
  );
}

export function Rail({ config, adapters, dataSummary, page, hostPort, onNavigate }: RailProps) {
  const firstPersona = config.personas[0]?.name;
  const firstAdapter = adapters[0];
  const totalEntities = dataSummary.reduce((a, s) => a + entityCount(s), 0);

  const activePersona =
    page.type === 'data' ? page.persona : firstPersona;

  return (
    <aside className="rail">
      <div className="rail-mark" onClick={() => onNavigate({ type: 'dashboard' })}>
        <span className="rail-mark-glyph">mimic</span>
        <span className="rail-mark-tag">explorer</span>
      </div>

      <div className="rail-tabs">
        <button
          className={'rail-tab ' + (page.type === 'dashboard' ? 'active' : '')}
          onClick={() => onNavigate({ type: 'dashboard' })}
        >
          <span className="num">01</span>
          <span>Reconcile</span>
          <span className="badge-count">—</span>
        </button>
        <button
          className={'rail-tab ' + (page.type === 'adapter' ? 'active' : '')}
          onClick={() =>
            firstAdapter && onNavigate({ type: 'adapter', adapterId: firstAdapter.id })
          }
        >
          <span className="num">02</span>
          <span>Adapters</span>
          <span className="badge-count">{adapters.length}</span>
        </button>
        <button
          className={'rail-tab ' + (page.type === 'data' ? 'active' : '')}
          onClick={() =>
            firstPersona && onNavigate({ type: 'data', persona: firstPersona })
          }
        >
          <span className="num">03</span>
          <span>Data</span>
          <span className="badge-count">{totalEntities.toLocaleString()}</span>
        </button>
        <button
          className={'rail-tab ' + (page.type === 'tester' ? 'active' : '')}
          onClick={() =>
            firstAdapter && onNavigate({ type: 'tester', adapterId: firstAdapter.id })
          }
        >
          <span className="num">04</span>
          <span>Tester</span>
          <span className="badge-count">{firstAdapter?.endpoints.length ?? 0}</span>
        </button>
      </div>

      <div className="rail-sec">
        <div className="rail-sec-label">Persona</div>
        {config.personas.map((p) => {
          const summary = dataSummary.find((s) => s.persona === p.name);
          return (
            <button
              key={p.name}
              className={'rail-item ' + (activePersona === p.name ? 'active' : '')}
              onClick={() => onNavigate({ type: 'data', persona: p.name })}
            >
              <span className="name">{p.name}</span>
              <span className="meta">{entityCount(summary).toLocaleString()}</span>
            </button>
          );
        })}
        {config.personas.length === 0 && (
          <div className="rail-item" style={{ color: 'var(--ink-4)', cursor: 'default' }}>
            <span className="name">none</span>
          </div>
        )}
      </div>

      <div className="rail-sec">
        <div className="rail-sec-label">Surfaces</div>
        {Object.entries(config.databases ?? {}).map(([name, db]) => (
          <div key={name} className="rail-item" style={{ cursor: 'default' }}>
            <span className="name" style={{ color: SURFACE_COLOR[db.type] ?? 'var(--ink-2)' }}>
              {db.type}
            </span>
            <span className="meta">{name}</span>
          </div>
        ))}
        {adapters.map((a) => (
          <button
            key={a.id}
            className="rail-item"
            onClick={() => onNavigate({ type: 'adapter', adapterId: a.id })}
          >
            <span className="name" style={{ color: SURFACE_COLOR[a.id] ?? 'var(--ink-2)' }}>
              {a.id}
            </span>
            <span className="meta">
              {a.port ? `:${a.port}` : ''}
              {a.enabled ? ' ● live' : ' ○ off'}
            </span>
          </button>
        ))}
      </div>

      <div className="rail-foot">
        <div className="rail-foot-row">
          <span>host</span>
          <span>:{hostPort ?? 7879}</span>
        </div>
        <div className="rail-foot-row">
          <span>llm</span>
          <span>{config.llm.provider}</span>
        </div>
        <div className="rail-foot-row">
          <span>model</span>
          <span>{config.llm.model}</span>
        </div>
      </div>
    </aside>
  );
}
