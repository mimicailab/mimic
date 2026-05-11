import { useEffect, useMemo, useState } from 'react';
import type { PersonaDataSummary, DataResponse } from '@/lib/api';
import { JsonView } from '@/components/json-view';
import { FactRow } from '@/components/fact-row';

interface DataViewProps {
  persona: string;
  source?: string;
  resource?: string;
  dataSummary: PersonaDataSummary[];
  loadPersonaData: (persona: string) => Promise<DataResponse>;
}

type Tab =
  | { kind: 'facts' }
  | { kind: 'db' }
  | { kind: 'api'; adapterId: string };

const SURFACE_COLOR: Record<string, string> = {
  postgres: 'var(--postgres)',
  postgresql: 'var(--postgres)',
  mysql: 'var(--postgres)',
  sqlite: 'var(--postgres)',
  stripe: 'var(--stripe)',
};

function tabKey(t: Tab): string {
  if (t.kind === 'facts') return 'facts';
  if (t.kind === 'db') return 'db';
  return `api:${t.adapterId}`;
}

export function DataView({ persona, source, resource, loadPersonaData }: DataViewProps) {
  const [data, setData] = useState<DataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>({ kind: 'facts' });
  const [selectedResource, setSelectedResource] = useState<string | null>(resource ?? null);

  useEffect(() => {
    setLoading(true);
    loadPersonaData(persona).then((d) => {
      setData(d);
      setLoading(false);
      // pick initial tab/resource from props if provided
      if (source) {
        if (source === 'facts') setTab({ kind: 'facts' });
        else if (Object.keys(d.tables).includes(source) || source === 'db') {
          setTab({ kind: 'db' });
        } else if (d.apiResponses[source]) {
          setTab({ kind: 'api', adapterId: source });
        } else {
          setTab(initialTab(d));
        }
      } else {
        setTab(initialTab(d));
      }
    });
  }, [persona]);

  if (loading || !data) {
    return (
      <div className="content-inner">
        <div className="page-eyebrow"><span className="dash" /> persona data</div>
        <h1 className="display">{persona}</h1>
        <p className="lede">Loading…</p>
      </div>
    );
  }

  const totalDb = Object.values(data.tables).reduce((a, b) => a + (b as unknown[]).length, 0);
  const apiTotals: Array<[string, number]> = Object.entries(data.apiResponses).map(
    ([id, set]) => [
      id,
      Object.values(set.responses).reduce((a, b) => a + (b as unknown[]).length, 0),
    ],
  );

  const activeResources: Array<{ key: string; label: string; count: number }> =
    tab.kind === 'db'
      ? Object.entries(data.tables).map(([name, rows]) => ({
          key: name,
          label: name,
          count: (rows as unknown[]).length,
        }))
      : tab.kind === 'api'
        ? Object.entries(data.apiResponses[tab.adapterId]?.responses ?? {})
            .filter(([, arr]) => (arr as unknown[]).length > 0)
            .map(([name, arr]) => ({
              key: name,
              label: name,
              count: (arr as unknown[]).length,
            }))
        : [];

  const currentKey =
    activeResources.find((r) => r.key === selectedResource)?.key ??
    activeResources[0]?.key ??
    null;
  const currentRows =
    tab.kind === 'db' && currentKey
      ? (data.tables[currentKey] as unknown[])
      : tab.kind === 'api' && currentKey
        ? ((data.apiResponses[tab.adapterId]?.responses[currentKey] ?? []) as unknown[])
        : [];

  return (
    <div className="content-inner">
      <div className="page-eyebrow"><span className="dash" /> persona data</div>
      <h1 className="display">{persona}</h1>
      <p className="lede">
        {(totalDb + apiTotals.reduce((a, [, n]) => a + n, 0)).toLocaleString()} entities across{' '}
        {(totalDb > 0 ? 1 : 0) + apiTotals.length} surface
        {(totalDb > 0 ? 1 : 0) + apiTotals.length === 1 ? '' : 's'}, persisted to{' '}
        <span className="mono dim">.mimic/data/{persona}.json</span>.
      </p>

      <div className="tabs-row">
        <button
          className={'tab ' + (tab.kind === 'facts' ? 'active' : '')}
          onClick={() => setTab({ kind: 'facts' })}
        >
          Facts <span className="c">{data.facts.length}</span>
        </button>
        {totalDb > 0 && (
          <button
            className={'tab ' + (tab.kind === 'db' ? 'active' : '')}
            onClick={() => {
              setTab({ kind: 'db' });
              setSelectedResource(null);
            }}
          >
            <span style={{ color: 'var(--postgres)' }}>Database</span>{' '}
            <span className="c">{totalDb}</span>
          </button>
        )}
        {apiTotals.map(([id, n]) => (
          <button
            key={id}
            className={
              'tab ' + (tab.kind === 'api' && tab.adapterId === id ? 'active' : '')
            }
            onClick={() => {
              setTab({ kind: 'api', adapterId: id });
              setSelectedResource(null);
            }}
          >
            <span style={{ color: SURFACE_COLOR[id] ?? 'var(--ink-2)' }}>{id}</span>{' '}
            <span className="c">{n}</span>
          </button>
        ))}
      </div>

      {tab.kind === 'facts' && (
        <div className="factlog" style={{ borderTop: 'none' }}>
          {data.facts.map((f, i) => (
            <FactRow key={f.id} fact={f} idx={i} />
          ))}
          {data.facts.length === 0 && (
            <div style={{ padding: '64px 0', color: 'var(--ink-4)', textAlign: 'center' }}>
              No facts generated for this persona.
            </div>
          )}
        </div>
      )}

      {tab.kind !== 'facts' && (
        <div className="dataview2" key={tabKey(tab)}>
          <div className="dataview2-left">
            <div className="dv-group">
              {tab.kind === 'db' ? 'Tables' : 'Resources'}
            </div>
            {activeResources.map((r) => (
              <button
                key={r.key}
                className={'dv-item ' + (currentKey === r.key ? 'active' : '')}
                onClick={() => setSelectedResource(r.key)}
              >
                <span>{r.label}</span>
                <span className="n">{r.count}</span>
              </button>
            ))}
            {activeResources.length === 0 && (
              <div className="dv-item" style={{ color: 'var(--ink-4)', cursor: 'default' }}>
                <span>no data</span>
              </div>
            )}
          </div>
          <div className="dataview2-right">
            <div className="dv-detail-head">
              <div className="dv-detail-title">{currentKey ?? 'Select a resource'}</div>
              <div className="dv-detail-meta">
                {currentRows.length.toLocaleString()} record
                {currentRows.length === 1 ? '' : 's'} · {tab.kind === 'db' ? 'database' : tab.adapterId}
              </div>
            </div>
            <div className="dv-detail-body">
              <ResourceBody rows={currentRows} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function initialTab(d: DataResponse): Tab {
  if (d.facts.length > 0) return { kind: 'facts' };
  if (Object.keys(d.tables).length > 0) return { kind: 'db' };
  const firstApi = Object.keys(d.apiResponses)[0];
  if (firstApi) return { kind: 'api', adapterId: firstApi };
  return { kind: 'facts' };
}

function ResourceBody({ rows }: { rows: unknown[] }) {
  const shape = useMemo(() => detectShape(rows), [rows]);
  if (rows.length === 0) {
    return (
      <div style={{ padding: 64, color: 'var(--ink-4)', textAlign: 'center' }}>
        No records.
      </div>
    );
  }
  if (shape === 'table') {
    return <DataTable rows={rows as Record<string, unknown>[]} />;
  }
  return <JsonView data={rows} />;
}

function detectShape(rows: unknown[]): 'table' | 'json' {
  if (rows.length === 0) return 'json';
  const first = rows[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) return 'json';
  // Use table view when first item is a flat-ish object
  const entries = Object.entries(first as Record<string, unknown>);
  if (entries.length === 0) return 'json';
  return 'table';
}

function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  const allKeys = new Set<string>();
  rows.slice(0, 20).forEach((r) => Object.keys(r).forEach((k) => allKeys.add(k)));
  const columns = Array.from(allKeys).slice(0, 8);
  const hasMore = allKeys.size > 8;

  return (
    <table className="dtable">
      <thead>
        <tr>
          <th className="n">#</th>
          {columns.map((c) => (
            <th key={c}>{c}</th>
          ))}
          {hasMore && <th>…</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td className="n">{i + 1}</td>
            {columns.map((c) => (
              <td key={c} className={isIdCol(c) ? 'id' : row[c] === null ? 'null' : ''}>
                {renderCell(row[c])}
              </td>
            ))}
            {hasMore && <td className="muted">…</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function isIdCol(c: string): boolean {
  return c === 'id' || c.endsWith('_id');
}

function renderCell(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object') return Array.isArray(v) ? `[${v.length}]` : '{…}';
  return String(v);
}
