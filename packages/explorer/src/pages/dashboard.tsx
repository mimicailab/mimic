import type {
  ExplorerConfig,
  AdapterInfo,
  PersonaDataSummary,
  DataResponse,
} from '@/lib/api';
import type { Page } from '@/App';
import { FactRow } from '@/components/fact-row';

interface DashboardProps {
  config: ExplorerConfig;
  adapters: AdapterInfo[];
  dataSummary: PersonaDataSummary[];
  personaData?: DataResponse;
  onNavigate: (page: Page) => void;
}

interface LedgerRow {
  label: string;
  pg?: number;
  st?: number;
  pgKey?: string;
  stKey?: string;
}

interface ReconciliationResult {
  shared: LedgerRow[];
  pgOnly: LedgerRow[];
  stOnly: LedgerRow[];
  driftCount: number;
  pgLabel: string;
  stLabel: string;
}

/** Normalize names so customers ↔ customer ↔ customers matches across surfaces. */
function normName(s: string): string {
  return s.toLowerCase().replace(/^.*\//, '').replace(/s$/, '');
}

function reconcile(
  tables: Record<string, number>,
  apiResources: Record<string, number>,
  pgLabel: string,
  stLabel: string,
): ReconciliationResult {
  const pgByNorm = new Map<string, { key: string; count: number }>();
  for (const [k, c] of Object.entries(tables)) pgByNorm.set(normName(k), { key: k, count: c });

  const stByNorm = new Map<string, { key: string; count: number }>();
  for (const [k, c] of Object.entries(apiResources)) stByNorm.set(normName(k), { key: k, count: c });

  const shared: LedgerRow[] = [];
  const pgOnly: LedgerRow[] = [];
  const stOnly: LedgerRow[] = [];

  const seen = new Set<string>();
  for (const [norm, { key, count }] of pgByNorm) {
    if (stByNorm.has(norm)) {
      const st = stByNorm.get(norm)!;
      shared.push({ label: key, pg: count, st: st.count, pgKey: key, stKey: st.key });
      seen.add(norm);
    } else {
      pgOnly.push({ label: key, pg: count, pgKey: key });
    }
  }
  for (const [norm, { key, count }] of stByNorm) {
    if (!seen.has(norm)) stOnly.push({ label: key, st: count, stKey: key });
  }

  const driftCount = shared.filter((r) => (r.st ?? 0) !== (r.pg ?? 0)).length;
  return { shared, pgOnly, stOnly, driftCount, pgLabel, stLabel };
}

export function Dashboard({
  config,
  adapters,
  dataSummary,
  personaData,
  onNavigate,
}: DashboardProps) {
  const persona = config.personas[0];
  if (!persona) {
    return (
      <div className="content-inner">
        <div className="page-eyebrow"><span className="dash" /> empty</div>
        <h1 className="display">no personas</h1>
        <p className="lede">Configure a persona in <span className="mono dim">mimic.config.ts</span>, then run <span className="mono dim">mimic run</span>.</p>
      </div>
    );
  }

  const summary = dataSummary.find((s) => s.persona === persona.name);
  const firstApi = Object.keys(summary?.apis ?? {})[0];
  const apiResources = firstApi ? summary!.apis[firstApi] : {};
  const tables = summary?.tables ?? {};
  const firstDb = Object.entries(config.databases ?? {})[0];

  const hasBothSurfaces = firstApi && firstDb && Object.keys(tables).length > 0;
  const recon = hasBothSurfaces
    ? reconcile(tables, apiResources, firstDb![1].type, firstApi!)
    : null;

  const facts = personaData?.facts ?? [];

  // Editorial lede: first sentence of config.domain. The full domain is often
  // a paragraph; we let the brief-prose carry the persona's longer description.
  const ledeMatch = config.domain.match(/^(.+?\.)(\s|$)/);
  const lede = ledeMatch ? ledeMatch[1] : config.domain;

  return (
    <div className="content-inner">
      <div className="page-eyebrow">
        <span className="dash" /> persona · investigation
      </div>
      <h1 className="display">{persona.name}</h1>
      <p className="lede">{lede}</p>

      <div className="brief">
        <div className="brief-meta">
          <div>
            <div className="k">Personas</div>
            <div className="v">{config.personas.length}</div>
          </div>
          <div>
            <div className="k">Surfaces</div>
            <div className="v">
              {Object.keys(config.databases ?? {}).length} db · {adapters.length} api
            </div>
          </div>
          {persona.blueprint && (
            <div>
              <div className="k">Blueprint</div>
              <div className="v">{persona.blueprint}</div>
            </div>
          )}
          <div>
            <div className="k">LLM</div>
            <div className="v">{config.llm.provider} / {config.llm.model}</div>
          </div>
        </div>
        <div className="brief-prose">{persona.description}</div>
      </div>

      {recon && (
        <>
          <div className="sec">
            <div className="sec-label">Reconciliation</div>
            <div className="sec-rule" />
            <div className="sec-meta">
              {recon.driftCount > 0
                ? `drift detected · ${recon.driftCount} entit${recon.driftCount === 1 ? 'y' : 'ies'} across ${recon.shared.length} shared types`
                : `all ${recon.shared.length} shared types reconcile`}
            </div>
          </div>

          <div className="ledger">
            <div className="ledger-head-row">
              <div className="ledger-head lhs">
                <div>
                  <div className="side side-pg">{recon.pgLabel}</div>
                  <div className="role">internal source of truth</div>
                </div>
              </div>
              <div className="ledger-head gap" />
              <div className="ledger-head rhs">
                <div>
                  <div className="side side-st">{recon.stLabel}</div>
                  <div className="role">
                    external · {adapters.find((a) => a.id === firstApi)?.port
                      ? `:${adapters.find((a) => a.id === firstApi)?.port}`
                      : 'adapter'}
                  </div>
                </div>
              </div>
            </div>

            <div className="row section-divider">
              <div className="cell lhs">shared</div>
              <div className="cell delta" />
              <div className="cell rhs">shared</div>
            </div>
            {recon.shared.map((r) => {
              const delta = (r.st ?? 0) - (r.pg ?? 0);
              const drift = delta !== 0;
              return (
                <div key={r.label} className={'row ' + (drift ? 'drift' : 'match')}>
                  <div className="cell lhs">
                    <div className="num pg">{r.pg}</div>
                    <div className="label">{r.pgKey}</div>
                    <div className="sublabel">{recon.pgLabel}.{r.pgKey}</div>
                  </div>
                  <div className="cell delta">
                    <div className="v">{drift ? (delta > 0 ? '+' : '') + delta : '='}</div>
                    <div className="k">{drift ? 'differs' : 'match'}</div>
                  </div>
                  <div className="cell rhs">
                    <div className="num st">{r.st}</div>
                    <div className="label">{r.stKey}</div>
                    <div className="sublabel">{recon.stLabel}/{r.stKey}</div>
                  </div>
                </div>
              );
            })}

            {(recon.pgOnly.length > 0 || recon.stOnly.length > 0) && (
              <>
                <div className="row section-divider">
                  <div className="cell lhs">{recon.pgLabel} only</div>
                  <div className="cell delta" />
                  <div className="cell rhs">{recon.stLabel} only</div>
                </div>
                {Array.from({ length: Math.max(recon.pgOnly.length, recon.stOnly.length) }).map(
                  (_, i) => {
                    const l = recon.pgOnly[i];
                    const r = recon.stOnly[i];
                    return (
                      <div key={i} className="row empty">
                        <div className="cell lhs">
                          {l ? (
                            <>
                              <div className="num pg">{l.pg}</div>
                              <div className="label">{l.pgKey}</div>
                            </>
                          ) : (
                            <div className="sublabel">—</div>
                          )}
                        </div>
                        <div className="cell delta">
                          <div className="v" style={{ color: 'var(--ink-4)' }}>·</div>
                        </div>
                        <div className="cell rhs">
                          {r ? (
                            <>
                              <div className="num st">{r.st}</div>
                              <div className="label">{r.stKey}</div>
                            </>
                          ) : (
                            <div className="sublabel">—</div>
                          )}
                        </div>
                      </div>
                    );
                  },
                )}
              </>
            )}
          </div>
        </>
      )}

      {facts.length > 0 && (
        <>
          <div className="sec">
            <div className="sec-label">Investigation</div>
            <div className="sec-rule" />
            <div className="sec-meta">
              {facts.length} facts ·{' '}
              <span style={{ color: 'var(--critical)' }}>
                {facts.filter((f) => f.severity === 'critical').length} crit
              </span>{' '}
              ·{' '}
              <span style={{ color: 'var(--warn)' }}>
                {facts.filter((f) => f.severity === 'warn').length} warn
              </span>{' '}
              ·{' '}
              <span style={{ color: 'var(--info)' }}>
                {facts.filter((f) => f.severity === 'info').length} info
              </span>
            </div>
          </div>
          <div className="factlog">
            {facts.map((f, i) => (
              <FactRow key={f.id} fact={f} idx={i} />
            ))}
          </div>
        </>
      )}

      <div className="sec">
        <div className="sec-label">Adapters</div>
        <div className="sec-rule" />
        <div className="sec-meta">
          {adapters.length} configured · {adapters.filter((a) => a.enabled).length} live
        </div>
      </div>
      {adapters.map((a) => (
        <button
          key={a.id}
          className="adapter-row"
          onClick={() => onNavigate({ type: 'adapter', adapterId: a.id })}
        >
          <div className="name">{a.name}</div>
          <div className="desc">{a.description}</div>
          <div className="meta">
            <b>{a.endpoints.length}</b> endpoints
          </div>
          <div className="meta">{a.port ? `:${a.port}` : '—'}</div>
          <div className={'status ' + (a.enabled ? '' : 'disabled')}>
            {a.enabled ? 'active' : 'off'}
          </div>
        </button>
      ))}
    </div>
  );
}
