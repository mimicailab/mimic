import { useMemo, useState } from 'react';
import type { AdapterInfo } from '@/lib/api';
import type { Page } from '@/App';
import { groupEndpoints } from '@/lib/group-endpoints';
import { FormattedPath } from '@/components/formatted-path';

interface AdapterViewProps {
  adapter: AdapterInfo;
  onNavigate: (page: Page) => void;
}

export function AdapterView({ adapter, onNavigate }: AdapterViewProps) {
  const groups = useMemo(
    () => groupEndpoints(adapter.endpoints, adapter.basePath),
    [adapter],
  );
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g, i) => [g.label, i < 3])),
  );

  const stats: Array<[string, string]> = [
    ['endpoints', String(adapter.endpoints.length)],
    ['port', adapter.port ? `:${adapter.port}` : '—'],
    ['version', adapter.versions[0] ?? '—'],
    ['package', `@mimicai/adapter-${adapter.id}`],
  ];

  return (
    <div className="content-inner">
      <div className="page-eyebrow">
        <span className="dash" /> adapter
      </div>
      <h1 className="display">{adapter.name}</h1>
      <p className="lede">{adapter.description}</p>

      <div className="stat-grid">
        {stats.map(([k, v]) => (
          <div key={k} className="stat-cell">
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>

      <div className="sec">
        <div className="sec-label">Endpoints</div>
        <div className="sec-rule" />
        <div className="sec-meta">
          {groups.length} resource groups · {adapter.endpoints.length} total
        </div>
      </div>

      <div className="endpoints">
        {groups.map((g) => (
          <div key={g.label} className="eg-section">
            <button
              className="eg-section-header"
              onClick={() => setOpen({ ...open, [g.label]: !open[g.label] })}
            >
              <div className="h">{g.label}</div>
              <div className="c">{g.endpoints.length} endpoints</div>
              <div className="chev">{open[g.label] ? '—' : '+'}</div>
            </button>
            {open[g.label] &&
              g.endpoints.map((e, i) => (
                <button
                  key={i}
                  className="ep-row"
                  onClick={() =>
                    onNavigate({
                      type: 'tester',
                      adapterId: adapter.id,
                      endpoint: { method: e.method, path: e.path },
                    })
                  }
                >
                  <span className={'method ' + e.method}>{e.method}</span>
                  <span className="path">
                    <FormattedPath p={e.path} />
                  </span>
                  <span className="try">Try →</span>
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
