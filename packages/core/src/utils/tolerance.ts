/**
 * Numeric clauses accept either an absolute tolerance or a fractional
 * tolerance. Values strictly between 0 and 1 are interpreted as a ratio of
 * the expected magnitude, which matches the contract compiler's common
 * output (for example 0.05 = 5%).
 */
export function resolveNumericTolerance(expected: number, tolerance?: number): number {
  if (tolerance == null || !Number.isFinite(tolerance)) return 0;
  const magnitude = Math.abs(tolerance);
  if (magnitude > 0 && magnitude < 1) {
    return Math.abs(expected) * magnitude;
  }
  return magnitude;
}

export function maxResolvedTolerance(
  leftExpected: number,
  leftTolerance: number | undefined,
  rightExpected: number,
  rightTolerance: number | undefined,
): number {
  return Math.max(
    resolveNumericTolerance(leftExpected, leftTolerance),
    resolveNumericTolerance(rightExpected, rightTolerance),
  );
}