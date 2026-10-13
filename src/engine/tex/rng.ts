/**
 * Deterministic randomness for texture generation: a seeded PRNG (mulberry32)
 * for sequential draws and stateless integer hashes for lattice / per-pixel
 * noise. Everything is 32-bit integer math so results are identical across
 * engines.
 */

/** Mixes an arbitrary JS number (spec.seed may be any finite number) into a uint32. */
export function seedToUint32(seed: number): number {
  if (!Number.isFinite(seed)) return 0x9e3779b9;
  // Fold fractional and large values in deterministically.
  const hi = Math.floor(seed / 4294967296);
  const lo = Math.floor(seed) >>> 0;
  const frac = Math.floor((seed - Math.floor(seed)) * 65536);
  return hash3(lo, hi | 0, frac);
}

/** Stateless 3-input integer hash (murmur3 finalizer style). Returns uint32. */
export function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Seeded PRNG (mulberry32) with a few convenience draws. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Standard normal (Box–Muller), clamped to ±4σ so outliers stay sane. */
  normal(): number {
    const u = Math.max(1e-12, this.next());
    const v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.max(-4, Math.min(4, z));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** A fresh, independent generator derived from this one (stable sub-streams). */
  fork(tag: number): Rng {
    return new Rng(hash3(this.state, tag, 0x51ed270b));
  }
}
