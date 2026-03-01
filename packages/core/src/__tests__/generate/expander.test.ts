import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../../generate/seed-random.js';

describe('SeededRandom', () => {
  it('should produce deterministic results with same seed', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);

    const values1 = Array.from({ length: 10 }, () => rng1.next());
    const values2 = Array.from({ length: 10 }, () => rng2.next());

    expect(values1).toEqual(values2);
  });

  it('should produce different results with different seeds', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(99);

    const v1 = rng1.next();
    const v2 = rng2.next();

    expect(v1).not.toBe(v2);
  });

  it('should generate integers in range', () => {
    const rng = new SeededRandom(42);
    for (let i = 0; i < 100; i++) {
      const val = rng.intBetween(10, 20);
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThanOrEqual(20);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it('should generate decimals in range', () => {
    const rng = new SeededRandom(42);
    for (let i = 0; i < 100; i++) {
      const val = rng.decimalBetween(1.0, 5.0, 2);
      expect(val).toBeGreaterThanOrEqual(1.0);
      expect(val).toBeLessThanOrEqual(5.0);
    }
  });

  it('should pick from array deterministically', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);
    const items = ['a', 'b', 'c', 'd', 'e'];

    const picks1 = Array.from({ length: 10 }, () => rng1.pick(items));
    const picks2 = Array.from({ length: 10 }, () => rng2.pick(items));

    expect(picks1).toEqual(picks2);
  });

  it('should shuffle deterministically', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    const shuffled1 = rng1.shuffle([...items]);
    const shuffled2 = rng2.shuffle([...items]);

    expect(shuffled1).toEqual(shuffled2);
  });

  it('should handle chance correctly', () => {
    const rng = new SeededRandom(42);
    let trueCount = 0;
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      if (rng.chance(0.5)) trueCount++;
    }

    expect(trueCount).toBeGreaterThan(400);
    expect(trueCount).toBeLessThan(600);
  });
});
