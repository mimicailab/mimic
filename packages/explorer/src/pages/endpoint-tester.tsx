import { useMemo, useState } from 'react';
import type { AdapterInfo } from '@/lib/api';
import { groupEndpoints } from '@/lib/group-endpoints';
import { FormattedPath } from '@/components/formatted-path';
import { JsonView } from '@/components/json-view';

interface EndpointTesterProps {
  adapter: AdapterInfo;
  initialEndpoint?: { method: string; path: string };
}

interface SelectedEp {
  group: string;
  method: string;
  path: string;
}

interface ResponseState {
  status: number;
  statusText: string;
  ms: number;
  bytes: number;
  body: unknown;
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

export function EndpointTester({ adapter, initialEndpoint }: EndpointTesterProps) {
  const groups = useMemo(
    () => groupEndpoints(adapter.endpoints, adapter.basePath),
    [adapter],
  );

  const initial: SelectedEp = useMemo(() => {
    if (initialEndpoint) {
      const g = groups.find((g) =>
        g.endpoints.some(
          (e) => e.method === initialEndpoint.method && e.path === initialEndpoint.path,
        ),
      );
      if (g) {
        return { group: g.label, method: initialEndpoint.method, path: initialEndpoint.path };
      }
    }
    const g = groups[0];
    if (g && g.endpoints[0]) {
      return { group: g.label, method: g.endpoints[0].method, path: g.endpoints[0].path };
    }
    return { group: '', method: 'GET', path: '/' };
  }, [groups, initialEndpoint]);

  const [sel, setSel] = useState<SelectedEp>(initial);
  const [query, setQuery] = useState('');
  const [body, setBody] = useState('{\n  \n}');
  const [sending, setSending] = useState(false);
  const [resp, setResp] = useState<ResponseState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [g.label, g.label === initial.group])),
  );

  const send = async () => {
    if (!adapter.port) return;
    setSending(true);
    setError(null);
    setResp(null);
    const start = performance.now();
    try {
      const init: RequestInit = {
        method: sel.method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (sel.method !== 'GET' && sel.method !== 'DELETE' && body.trim()) {
        init.body = body;
      }
      const r = await fetch(`http://localhost:${adapter.port}${sel.path}`, init);
      const text = await r.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // keep as string
      }
      const ms = Math.round(performance.now() - start);
      setResp({
        status: r.status,
        statusText: STATUS_TEXT[r.status] ?? r.statusText ?? '',
        ms,
        bytes: new Blob([text]).size,
        body: parsed,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed. Is mimic host running?');
    } finally {
      setSending(false);
    }
  };

  const lineCount = body.split('\n').length;
  const hasBody = sel.method !== 'GET' && sel.method !== 'DELETE';

  return (
    <div className="content-inner" style={{ paddingBottom: 32 }}>
      <div className="page-eyebrow"><span className="dash" /> tester</div>
      <h1 className="display">Probe</h1>
      <p className="lede">
        Send real requests at the running mock on{' '}
        <span className="mono" style={{ color: 'var(--stripe)' }}>
          localhost:{adapter.port ?? '—'}
        </span>
        . Responses come from the persona's generated data.
      </p>

      <div className="tester2" style={{ marginTop: 40 }}>
        <div className="t-list">
          <div className="t-search">
            <span className="muted">⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter endpoints…"
            />
            <span className="muted">/</span>
          </div>
          <div className="t-list-scroll">
            {groups.map((g) => {
              const filt = g.endpoints.filter(
                (e) =>
                  !query ||
                  e.path.toLowerCase().includes(query.toLowerCase()) ||
                  e.method.toLowerCase().includes(query.toLowerCase()),
              );
              if (filt.length === 0) return null;
              return (
                <div key={g.label} className="t-group">
                  <button
                    className="t-group-head"
                    onClick={() => setOpen({ ...open, [g.label]: !open[g.label] })}
                  >
                    <span>{g.label}</span>
                    <span className="c">{filt.length}</span>
                  </button>
                  {open[g.label] &&
                    filt.map((e, i) => {
                      const id = `${g.label}::${e.method} ${e.path}`;
                      const selId = `${sel.group}::${sel.method} ${sel.path}`;
                      return (
                        <button
                          key={i}
                          className={'t-ep ' + (selId === id ? 'active' : '')}
                          onClick={() => {
                            setSel({ group: g.label, method: e.method, path: e.path });
                            setResp(null);
                            setError(null);
                          }}
                        >
                          <span className={'method ' + e.method}>{e.method}</span>
                          <span className="path">
                            <FormattedPath p={e.path} />
                          </span>
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>

        <div className="t-main">
          <div className="t-bar">
            <span
              className={'method ' + sel.method}
              style={{
                fontSize: 13,
                padding: '6px 10px',
                border: '1px solid currentColor',
              }}
            >
              {sel.method}
            </span>
            <div className="t-url">
              <span className="host">localhost:{adapter.port}</span>
              <span className="path">
                <FormattedPath p={sel.path} />
              </span>
            </div>
            <button className="btn-send" onClick={send} disabled={sending || !adapter.port}>
              {sending ? 'Sending' : 'Send'}
            </button>
          </div>

          <div className="t-pane">
            <div className="t-col">
              <div className="t-col-head">
                <span>Request body</span>
                <span className="right">
                  <span className="mono">{sel.group}</span>
                </span>
              </div>
              <div className="t-col-body">
                {hasBody ? (
                  <div className="t-editor">
                    <div className="gutter">
                      {Array.from({ length: lineCount }).map((_, i) => (
                        <div key={i}>{i + 1}</div>
                      ))}
                    </div>
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                ) : (
                  <div style={{ padding: 24, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    No body for {sel.method} requests.
                  </div>
                )}
              </div>
            </div>

            <div className="t-col">
              {resp && (
                <div className={'t-status-strip ' + (resp.status >= 400 ? 'err' : '')}>
                  <span className="code">{resp.status}</span>
                  <span className="text">{resp.statusText}</span>
                  <span className="timings">
                    <span>
                      <span className="k">time </span>
                      {resp.ms}ms
                    </span>
                    <span>
                      <span className="k">size </span>
                      {resp.bytes}b
                    </span>
                  </span>
                </div>
              )}
              <div className="t-col-head">
                <span>Response</span>
                <span className="right">application/json</span>
              </div>
              <div className="t-col-body">
                {error && (
                  <div style={{ padding: 24, color: 'var(--critical)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {error}
                  </div>
                )}
                {!error && !resp && (
                  <div style={{ padding: 24, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    Send a request to see the response.
                  </div>
                )}
                {resp && <JsonView data={resp.body} />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
