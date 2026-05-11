import { useEffect, useState } from 'react';
import {
  api,
  type ExplorerConfig,
  type AdapterInfo,
  type PersonaDataSummary,
  type DataResponse,
} from './lib/api';
import { Rail } from './components/rail';
import { StatusBar } from './components/status-bar';
import { Dashboard } from './pages/dashboard';
import { AdapterView } from './pages/adapter-view';
import { DataView } from './pages/data-view';
import { EndpointTester } from './pages/endpoint-tester';

export type Page =
  | { type: 'dashboard' }
  | { type: 'adapter'; adapterId: string }
  | { type: 'data'; persona: string; source?: string; resource?: string }
  | { type: 'tester'; adapterId: string; endpoint?: { method: string; path: string } };

export function App() {
  const [config, setConfig] = useState<ExplorerConfig | null>(null);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [dataSummary, setDataSummary] = useState<PersonaDataSummary[]>([]);
  const [personaData, setPersonaData] = useState<Record<string, DataResponse>>({});
  const [page, setPage] = useState<Page>({ type: 'dashboard' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getConfig(), api.getAdapters(), api.getDataSummary()])
      .then(async ([cfg, adp, data]) => {
        setConfig(cfg);
        setAdapters(adp);
        setDataSummary(data);
        // Eager-load first persona's data so the dashboard can show facts + reconciliation drift.
        const first = cfg.personas[0]?.name;
        if (first) {
          try {
            const pd = await api.getPersonaData(first);
            setPersonaData({ [first]: pd });
          } catch {
            // ignore — dashboard handles empty
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const loadPersonaData = async (persona: string) => {
    if (personaData[persona]) return personaData[persona];
    const data = await api.getPersonaData(persona);
    setPersonaData((prev) => ({ ...prev, [persona]: data }));
    return data;
  };

  const navigate = (p: Page) => {
    setPage(p);
    setTimeout(() => {
      const el = document.querySelector('.content');
      if (el) el.scrollTop = 0;
    }, 0);
  };

  if (loading) {
    return (
      <div className="full-center">
        <div className="stack">
          <div className="glyph">mimic</div>
          <div className="msg">loading explorer</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="full-center">
        <div className="stack">
          <div className="glyph err">error</div>
          <div className="msg">{error}</div>
          <div className="hint">
            Make sure <code>mimic host</code> is running first.
          </div>
        </div>
      </div>
    );
  }

  const activePersona =
    page.type === 'data' ? page.persona : config!.personas[0]?.name;
  const activePersonaData = activePersona ? personaData[activePersona] : undefined;
  const sessionFacts = activePersonaData?.facts ?? [];

  // Drift on dashboard = pg-only + st-only entity counts in first persona's data
  let driftInfo: { count: number; surfaces: number } | undefined;
  if (page.type === 'dashboard' && activePersonaData) {
    const tableKeys = Object.keys(activePersonaData.tables);
    const firstApi = Object.keys(activePersonaData.apiResponses)[0];
    if (tableKeys.length > 0 && firstApi) {
      const apiKeys = Object.keys(activePersonaData.apiResponses[firstApi].responses);
      const norm = (s: string) => s.toLowerCase().replace(/^.*\//, '').replace(/s$/, '');
      const tableNorms = new Set(tableKeys.map(norm));
      const apiNorms = new Set(apiKeys.map(norm));
      let diff = 0;
      for (const n of tableNorms) if (!apiNorms.has(n)) diff++;
      for (const n of apiNorms) if (!tableNorms.has(n)) diff++;
      if (diff > 0) driftInfo = { count: diff, surfaces: 2 };
    }
  }

  return (
    <div className="app">
      <Rail
        config={config!}
        adapters={adapters}
        dataSummary={dataSummary}
        page={page}
        onNavigate={navigate}
      />
      <main className="main">
        <StatusBar session={activePersona} facts={sessionFacts} drift={driftInfo} />
        <div className="content">
          {page.type === 'dashboard' && (
            <Dashboard
              config={config!}
              adapters={adapters}
              dataSummary={dataSummary}
              personaData={activePersonaData}
              onNavigate={navigate}
            />
          )}
          {page.type === 'adapter' &&
            (adapters.find((a) => a.id === page.adapterId) ? (
              <AdapterView
                adapter={adapters.find((a) => a.id === page.adapterId)!}
                onNavigate={navigate}
              />
            ) : (
              <div className="content-inner">
                <div className="page-eyebrow"><span className="dash" /> adapter</div>
                <h1 className="display">not found</h1>
                <p className="lede">No adapter with id <span className="mono dim">{page.adapterId}</span>.</p>
              </div>
            ))}
          {page.type === 'data' && (
            <DataView
              persona={page.persona}
              source={page.source}
              resource={page.resource}
              dataSummary={dataSummary}
              loadPersonaData={loadPersonaData}
            />
          )}
          {page.type === 'tester' &&
            (adapters.find((a) => a.id === page.adapterId) ? (
              <EndpointTester
                adapter={adapters.find((a) => a.id === page.adapterId)!}
                initialEndpoint={page.endpoint}
              />
            ) : (
              <div className="content-inner">
                <div className="page-eyebrow"><span className="dash" /> tester</div>
                <h1 className="display">not found</h1>
                <p className="lede">No adapter with id <span className="mono dim">{page.adapterId}</span>.</p>
              </div>
            ))}
        </div>
      </main>
    </div>
  );
}
