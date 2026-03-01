import seedrandom from 'seedrandom';

// ---------------------------------------------------------------------------
// SeededRandom
// ---------------------------------------------------------------------------

/**
 * Thin, deterministic PRNG wrapper around `seedrandom`.
 *
 * Every method is fully deterministic given the same seed, which guarantees
 * reproducible data-set expansion across runs.
 */
export class SeededRandom {
  private readonly rng: seedrandom.PRNG;

  constructor(seed: number | string) {
    this.rng = seedrandom(String(seed));
  }

  // -----------------------------------------------------------------------
  // Primitives
  // -----------------------------------------------------------------------

  /** Return a float in [0, 1). */
  next(): number {
    return this.rng();
  }

  /** Return an integer in [min, max] (inclusive). */
  intBetween(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Return a decimal in [min, max] rounded to `decimals` places. */
  decimalBetween(min: number, max: number, decimals: number = 2): number {
    const raw = this.next() * (max - min) + min;
    const factor = 10 ** decimals;
    return Math.round(raw * factor) / factor;
  }

  // -----------------------------------------------------------------------
  // Collection helpers
  // -----------------------------------------------------------------------

  /** Pick a single random element from an array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('Cannot pick from an empty array');
    }
    return arr[this.intBetween(0, arr.length - 1)]!;
  }

  /** Return a shuffled shallow copy of the array (Fisher-Yates). */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.intBetween(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  // -----------------------------------------------------------------------
  // Probability
  // -----------------------------------------------------------------------

  /** Return `true` with the given probability (0..1). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  // -----------------------------------------------------------------------
  // Date helpers
  // -----------------------------------------------------------------------

  /** Return a random Date between `start` and `end` (inclusive). */
  dateBetween(start: Date, end: Date): Date {
    const ms = this.intBetween(start.getTime(), end.getTime());
    return new Date(ms);
  }
}
