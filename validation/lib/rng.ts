/**
 * Seeded PRNG.
 *
 * Every number in the validation report has to be reproducible by a third party
 * — that is the whole point of publishing it — so nothing here may touch
 * `Math.random()`. Same seed in, same report out.
 */

/** mulberry32: small, fast, good enough for Monte-Carlo over 10^5 draws. */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** Uniform in [min, max). */
    range: (min, max) => min + next() * (max - min),
    /** True with probability p. */
    bernoulli: (p) => next() < p,
    /** Standard normal via Box-Muller, clamped to keep tails from exploding. */
    normal: (mean, sd) => {
      const u1 = Math.max(next(), 1e-12);
      const u2 = next();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return mean + sd * Math.max(-4, Math.min(4, z));
    },
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    /** Fisher-Yates on a copy; the input is never mutated. */
    shuffle: <T>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}

export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  bernoulli(p: number): boolean;
  normal(mean: number, sd: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
}
