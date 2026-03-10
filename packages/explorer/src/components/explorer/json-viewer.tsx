import { useState } from 'react';
import { cn } from '@/lib/utils';

interface JsonViewerProps {
  data: unknown;
  initialExpanded?: boolean;
}

export function JsonViewer({ data, initialExpanded = true }: JsonViewerProps) {
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    return <TableView data={data as Record<string, unknown>[]}/>;
  }
  return (
    <pre className="text-sm font-mono leading-relaxed">
      <JsonNode value={data} depth={0} initialExpanded={initialExpanded} />
    </pre>
  );
}

function TableView({ data }: { data: Record<string, unknown>[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  // Get column keys from first few items
  const allKeys = new Set<string>();
  data.slice(0, 10).forEach((item) => Object.keys(item).forEach((k) => allKeys.add(k)));
  const columns = Array.from(allKeys).slice(0, 8);
  const hasMore = allKeys.size > 8;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground w-8">#</th>
              {columns.map((col) => (
                <th key={col} className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">
                  {col}
                </th>
              ))}
              {hasMore && (
                <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">...</th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <>
                <tr
                  key={i}
                  onClick={() => setExpanded(expanded === i ? null : i)}
                  className={cn(
                    'cursor-pointer transition-colors border-b border-border/50',
                    'hover:bg-muted/30',
                    expanded === i && 'bg-muted/50',
                  )}
                >
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                  {columns.map((col) => (
                    <td key={col} className="px-2 py-1.5 font-mono text-xs max-w-[200px] truncate">
                      <CellValue value={row[col]} />
                    </td>
                  ))}
                  {hasMore && <td className="px-2 py-1.5 text-xs text-muted-foreground">...</td>}
                </tr>
                {expanded === i && (
                  <tr key={`${i}-expanded`}>
                    <td colSpan={columns.length + (hasMore ? 2 : 1)} className="p-3 bg-muted/20">
                      <pre className="text-xs font-mono whitespace-pre-wrap">
                        <JsonNode value={row} depth={0} initialExpanded={true} />
                      </pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
      {data.length > 100 && (
        <div className="text-xs text-muted-foreground text-center py-2">
          Showing all {data.length} records
        </div>
      )}
    </div>
  );
}

/**
 * Full pretty-printed JSON with syntax highlighting — used for API responses.
 */
export function RawJsonViewer({ data }: { data: unknown }) {
  const json = JSON.stringify(data, null, 2) ?? '';
  return (
    <pre className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-all">
      {json.split('\n').map((line, i) => (
        <span key={i}>
          {highlightJsonLine(line)}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

function highlightJsonLine(line: string): React.ReactNode {
  // Match key-value patterns in JSON
  const kvMatch = line.match(/^(\s*)"([^"]+)":\s*(.*)/);
  if (kvMatch) {
    const [, indent, key, rest] = kvMatch;
    return (
      <>
        {indent}<span className="json-key">"{key}"</span>: {highlightValue(rest)}
      </>
    );
  }
  // Standalone value (array element)
  const valMatch = line.match(/^(\s*)(.*)/);
  if (valMatch) {
    const [, indent, val] = valMatch;
    return <>{indent}{highlightValue(val)}</>;
  }
  return line;
}

function highlightValue(val: string): React.ReactNode {
  const trimmed = val.replace(/,\s*$/, '');
  const comma = val.endsWith(',') ? ',' : '';

  if (trimmed === 'null') return <><span className="json-null">null</span>{comma}</>;
  if (trimmed === 'true' || trimmed === 'false') return <><span className="json-boolean">{trimmed}</span>{comma}</>;
  if (/^-?\d/.test(trimmed)) return <><span className="json-number">{trimmed}</span>{comma}</>;
  if (trimmed.startsWith('"')) return <><span className="json-string">{trimmed}</span>{comma}</>;
  return <>{val}</>;
}

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="json-null">null</span>;
  }
  if (typeof value === 'boolean') {
    return <span className="json-boolean">{String(value)}</span>;
  }
  if (typeof value === 'number') {
    return <span className="json-number">{value}</span>;
  }
  if (typeof value === 'string') {
    if (value.length > 40) return <span className="json-string" title={value}>{value.slice(0, 37)}...</span>;
    return <span className="json-string">{value}</span>;
  }
  if (typeof value === 'object') {
    return <span className="text-muted-foreground">{Array.isArray(value) ? `[${value.length}]` : '{...}'}</span>;
  }
  return <span>{String(value)}</span>;
}

function JsonNode({
  value,
  depth,
  initialExpanded,
}: {
  value: unknown;
  depth: number;
  initialExpanded: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded && depth < 4);

  if (value === null) return <span className="json-null">null</span>;
  if (value === undefined) return <span className="json-null">undefined</span>;
  if (typeof value === 'boolean') return <span className="json-boolean">{String(value)}</span>;
  if (typeof value === 'number') return <span className="json-number">{value}</span>;
  if (typeof value === 'string') return <span className="json-string">"{value}"</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span>{'[]'}</span>;
    const indent = '  '.repeat(depth);
    const childIndent = '  '.repeat(depth + 1);

    return (
      <span>
        <span
          className="cursor-pointer hover:text-primary"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? '[' : `[${value.length} items]`}
        </span>
        {isExpanded && (
          <>
            {'\n'}
            {value.map((item, i) => (
              <span key={i}>
                {childIndent}
                <JsonNode value={item} depth={depth + 1} initialExpanded={initialExpanded} />
                {i < value.length - 1 ? ',' : ''}
                {'\n'}
              </span>
            ))}
            {indent}]
          </>
        )}
      </span>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span>{'{}'}</span>;
    const indent = '  '.repeat(depth);
    const childIndent = '  '.repeat(depth + 1);

    return (
      <span>
        <span
          className="cursor-pointer hover:text-primary"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? '{' : `{${entries.length} keys}`}
        </span>
        {isExpanded && (
          <>
            {'\n'}
            {entries.map(([key, val], i) => (
              <span key={key}>
                {childIndent}
                <span className="json-key">"{key}"</span>
                {': '}
                <JsonNode value={val} depth={depth + 1} initialExpanded={initialExpanded} />
                {i < entries.length - 1 ? ',' : ''}
                {'\n'}
              </span>
            ))}
            {indent}
            {'}'}
          </>
        )}
      </span>
    );
  }

  return <span>{String(value)}</span>;
}
