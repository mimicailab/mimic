import { describe, it, expect } from 'vitest';
import {
  generateId,
  paginate,
  filterByDate,
  resolvePersonaFromBearer,
  resolvePersonaFromBody,
} from '../../mock/utils.js';

// ---------------------------------------------------------------------------
// generateId
// ---------------------------------------------------------------------------

describe('generateId', () => {
  it('should produce a prefixed ID', () => {
    const id = generateId('cus');
    expect(id).toMatch(/^cus_[a-z0-9_-]{14}$/);
  });

  it('should respect custom length', () => {
    const id = generateId('pi', 8);
    expect(id.startsWith('pi_')).toBe(true);
    // prefix (2) + underscore (1) + random (8) = 11
    expect(id.length).toBe(11);
  });

  it('should produce unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId('sub')));
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// paginate
// ---------------------------------------------------------------------------

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ id: i }));

  it('should return the first page when no cursor is provided', () => {
    const result = paginate(items, undefined, 10);
    expect(result.data).toHaveLength(10);
    expect(result.data[0]).toEqual({ id: 0 });
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('9');
    expect(result.totalCount).toBe(25);
  });

  it('should return the second page using a cursor', () => {
    const result = paginate(items, '9', 10);
    expect(result.data).toHaveLength(10);
    expect(result.data[0]).toEqual({ id: 10 });
    expect(result.hasMore).toBe(true);
  });

  it('should return the last page', () => {
    const result = paginate(items, '19', 10);
    expect(result.data).toHaveLength(5);
    expect(result.data[0]).toEqual({ id: 20 });
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });

  it('should clamp limit to max 100', () => {
    const result = paginate(items, undefined, 200);
    expect(result.data).toHaveLength(25);
  });

  it('should clamp limit to min 1', () => {
    const result = paginate(items, undefined, 0);
    expect(result.data).toHaveLength(1);
  });

  it('should handle empty items', () => {
    const result = paginate([], undefined, 10);
    expect(result.data).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.totalCount).toBe(0);
  });

  it('should handle invalid cursor gracefully', () => {
    const result = paginate(items, 'not-a-number', 10);
    expect(result.data).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterByDate
// ---------------------------------------------------------------------------

describe('filterByDate', () => {
  const items = [
    { id: 1, createdAt: '2024-01-15T00:00:00Z' },
    { id: 2, createdAt: '2024-03-01T00:00:00Z' },
    { id: 3, createdAt: '2024-06-15T00:00:00Z' },
    { id: 4, createdAt: '2024-12-01T00:00:00Z' },
  ];

  it('should filter items within a date range', () => {
    const result = filterByDate(items, 'createdAt', '2024-02-01', '2024-07-01');
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual([2, 3]);
  });

  it('should return all items when no bounds are given', () => {
    const result = filterByDate(items, 'createdAt');
    expect(result).toHaveLength(4);
  });

  it('should filter with only start date', () => {
    const result = filterByDate(items, 'createdAt', '2024-06-01');
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual([3, 4]);
  });

  it('should filter with only end date', () => {
    const result = filterByDate(items, 'createdAt', undefined, '2024-04-01');
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual([1, 2]);
  });

  it('should handle items with null date fields', () => {
    const withNull = [...items, { id: 5, createdAt: null as unknown as string }];
    const result = filterByDate(withNull, 'createdAt', '2024-01-01');
    expect(result).toHaveLength(4);
  });

  it('should handle empty array', () => {
    const result = filterByDate([], 'createdAt', '2024-01-01', '2024-12-31');
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// resolvePersonaFromBearer
// ---------------------------------------------------------------------------

describe('resolvePersonaFromBearer', () => {
  it('should extract persona from Bearer token', () => {
    expect(resolvePersonaFromBearer('Bearer young-professional')).toBe('young-professional');
  });

  it('should be case-insensitive for "Bearer"', () => {
    expect(resolvePersonaFromBearer('bearer freelancer')).toBe('freelancer');
  });

  it('should return null for missing header', () => {
    expect(resolvePersonaFromBearer(undefined)).toBeNull();
  });

  it('should return null for empty header', () => {
    expect(resolvePersonaFromBearer('')).toBeNull();
  });

  it('should return null for non-Bearer auth', () => {
    expect(resolvePersonaFromBearer('Basic abc123')).toBeNull();
  });

  it('should return null for Bearer with no token', () => {
    expect(resolvePersonaFromBearer('Bearer ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolvePersonaFromBody
// ---------------------------------------------------------------------------

describe('resolvePersonaFromBody', () => {
  it('should extract persona from a body field', () => {
    const result = resolvePersonaFromBody({ personaId: 'college-student' }, 'personaId');
    expect(result).toBe('college-student');
  });

  it('should return null for missing field', () => {
    const result = resolvePersonaFromBody({ other: 'value' }, 'personaId');
    expect(result).toBeNull();
  });

  it('should return null for non-string value', () => {
    const result = resolvePersonaFromBody({ personaId: 123 }, 'personaId');
    expect(result).toBeNull();
  });

  it('should return null for empty string value', () => {
    const result = resolvePersonaFromBody({ personaId: '' }, 'personaId');
    expect(result).toBeNull();
  });

  it('should return null for null body', () => {
    const result = resolvePersonaFromBody(null as unknown as Record<string, unknown>, 'personaId');
    expect(result).toBeNull();
  });
});
