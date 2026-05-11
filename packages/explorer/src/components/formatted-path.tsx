export function FormattedPath({ p }: { p: string }) {
  const parts = p.split(/(:[a-zA-Z_][a-zA-Z0-9_]*)/g);
  return (
    <>
      {parts.map((s, i) =>
        s.startsWith(':') ? (
          <span key={i} className="param">{s}</span>
        ) : (
          <span key={i}>{s}</span>
        ),
      )}
    </>
  );
}
