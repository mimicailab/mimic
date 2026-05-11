export interface FactRecord {
  id: string | number;
  severity: 'critical' | 'warn' | 'info' | string;
  platform: string;
  type: string;
  detail: string;
}

/** Heuristic: database-flavored platforms get the postgres tint, everything else stripe. */
function platformSide(platform: string): 'pg' | 'st' {
  const p = (platform || '').toLowerCase();
  if (
    p === 'database' ||
    p === 'db' ||
    p === 'postgres' ||
    p === 'postgresql' ||
    p === 'mysql' ||
    p === 'sqlite'
  ) {
    return 'pg';
  }
  return 'st';
}

export function FactRow({ fact, idx }: { fact: FactRecord; idx: number }) {
  const side = platformSide(fact.platform);
  const sev = (fact.severity || 'info').toLowerCase();
  return (
    <div className={`fact ${sev}`}>
      <div className="fact-gutter">
        <div className={`sev ${sev}`}>{sev}</div>
        <div className="num">fact / {String(idx + 1).padStart(2, '0')}</div>
      </div>
      <div className="fact-body">{fact.detail}</div>
      <div className="fact-side">
        <div>
          <span className="k">surface</span>
        </div>
        <div>
          <span className={`v ${side}`}>{fact.platform || '—'}</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <span className="k">topic</span>
        </div>
        <div>
          <span className="v">{fact.type || '—'}</span>
        </div>
      </div>
    </div>
  );
}
