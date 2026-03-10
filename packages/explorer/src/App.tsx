import { useEffect, useState } from 'react';
import { api, type ExplorerConfig, type AdapterInfo, type PersonaDataSummary, type DataResponse } from './lib/api';
import { Sidebar } from './components/layout/sidebar';
import { Header } from './components/layout/header';
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
      .then(([cfg, adp, data]) => {
        setConfig(cfg);
        setAdapters(adp);
        setDataSummary(data);
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

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-4xl font-bold tracking-tight">mimic</div>
          <div className="text-muted-foreground">Loading explorer...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center max-w-md">
          <div className="mb-4 text-4xl font-bold tracking-tight text-destructive">Error</div>
          <div className="text-muted-foreground mb-4">{error}</div>
          <div className="text-sm text-muted-foreground">
            Make sure <code className="bg-muted px-1 py-0.5 rounded">mimic host</code> is running first.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        config={config!}
        adapters={adapters}
        dataSummary={dataSummary}
        page={page}
        onNavigate={setPage}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header config={config!} page={page} onNavigate={setPage} />
        <main className="flex-1 overflow-auto p-6">
          {page.type === 'dashboard' && (
            <Dashboard
              config={config!}
              adapters={adapters}
              dataSummary={dataSummary}
              onNavigate={setPage}
            />
          )}
          {page.type === 'adapter' && (
            <AdapterView
              adapter={adapters.find((a) => a.id === page.adapterId)!}
              onNavigate={setPage}
            />
          )}
          {page.type === 'data' && (
            <DataView
              persona={page.persona}
              source={page.source}
              resource={page.resource}
              dataSummary={dataSummary}
              loadPersonaData={loadPersonaData}
            />
          )}
          {page.type === 'tester' && (
            <EndpointTester
              adapter={adapters.find((a) => a.id === page.adapterId)!}
              initialEndpoint={page.endpoint}
            />
          )}
        </main>
      </div>
    </div>
  );
}
