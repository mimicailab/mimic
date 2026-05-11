import { Fragment } from 'react';

function JsonNode({
  value,
  indent = 0,
  k = null,
  last = true,
}: {
  value: unknown;
  indent?: number;
  k?: string | null;
  last?: boolean;
}) {
  const pad = '  '.repeat(indent);
  const keyEl =
    k != null ? (
      <>
        <span className="j-key">"{k}"</span>
        <span className="j-punct">: </span>
      </>
    ) : null;

  if (value === null || value === undefined) {
    return (
      <div>
        {pad}
        {keyEl}
        <span className="j-null">null</span>
        {!last && <span className="j-punct">,</span>}
      </div>
    );
  }
  if (typeof value === 'string') {
    return (
      <div>
        {pad}
        {keyEl}
        <span className="j-string">"{value}"</span>
        {!last && <span className="j-punct">,</span>}
      </div>
    );
  }
  if (typeof value === 'number') {
    return (
      <div>
        {pad}
        {keyEl}
        <span className="j-number">{value}</span>
        {!last && <span className="j-punct">,</span>}
      </div>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <div>
        {pad}
        {keyEl}
        <span className="j-bool">{String(value)}</span>
        {!last && <span className="j-punct">,</span>}
      </div>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div>
          {pad}
          {keyEl}
          <span className="j-punct">[]</span>
          {!last && <span className="j-punct">,</span>}
        </div>
      );
    }
    return (
      <>
        <div>
          {pad}
          {keyEl}
          <span className="j-punct">[</span>
        </div>
        {value.map((v, i) => (
          <JsonNode key={i} value={v} indent={indent + 1} last={i === value.length - 1} />
        ))}
        <div>
          {pad}
          <span className="j-punct">]</span>
          {!last && <span className="j-punct">,</span>}
        </div>
      </>
    );
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return (
      <div>
        {pad}
        {keyEl}
        <span className="j-punct">{'{}'}</span>
        {!last && <span className="j-punct">,</span>}
      </div>
    );
  }
  return (
    <>
      <div>
        {pad}
        {keyEl}
        <span className="j-punct">{'{'}</span>
      </div>
      {keys.map((kk, i) => (
        <JsonNode
          key={kk}
          value={obj[kk]}
          k={kk}
          indent={indent + 1}
          last={i === keys.length - 1}
        />
      ))}
      <div>
        {pad}
        <span className="j-punct">{'}'}</span>
        {!last && <span className="j-punct">,</span>}
      </div>
    </>
  );
}

export function JsonView({ data }: { data: unknown }) {
  return (
    <div className="json-view">
      <Fragment>
        <JsonNode value={data} />
      </Fragment>
    </div>
  );
}
