import { useEffect, useState } from 'react';
import type { FactRecord } from './fact-row';

interface StatusBarProps {
  session?: string;
  facts: FactRecord[];
  drift?: { count: number; surfaces: number };
}

export function StatusBar({ session, facts, drift }: StatusBarProps) {
  const [time, setTime] = useState(() => formatUtc());
  useEffect(() => {
    const id = setInterval(() => setTime(formatUtc()), 1000);
    return () => clearInterval(id);
  }, []);

  const sev = facts.reduce<Record<string, number>>((a, f) => {
    const k = (f.severity || 'info').toLowerCase();
    a[k] = (a[k] || 0) + 1;
    return a;
  }, {});

  return (
    <div className="status-bar">
      <span className="item">
        <span className="k">session</span>{' '}
        <span className="v">{session ?? '—'}</span>
      </span>
      {drift && drift.count > 0 && (
        <>
          <span className="sep">·</span>
          <span className="item">
            <span className="k">drift</span>{' '}
            <span className="drift">
              +{drift.count} across {drift.surfaces} surfaces
            </span>
          </span>
        </>
      )}
      <span className="sep">·</span>
      <span className="item">
        <span className="k">facts</span>{' '}
        <span className="v">{facts.length}</span>{' '}
        <span className="muted">
          ({sev.critical || 0} critical · {sev.warn || 0} warn · {sev.info || 0} info)
        </span>
      </span>
      <div className="right">
        <span className="item">
          <span className="k">{time} UTC</span>
        </span>
        <span className="item">⌘K</span>
      </div>
    </div>
  );
}

function formatUtc(): string {
  const d = new Date();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
