/**
 * In-memory sliding-window rate limiter for AI calls (per client IP).
 * Single-process by design: Mode's server is one Node process.
 */

export type RateLimitDecision =
  | { ok: true; remaining: number; limit: number }
  | { ok: false; retryAfterSec: number; limit: number };

export interface RateLimiter {
  /** Records one call for `key` if allowed. */
  consume(key: string): RateLimitDecision;
  /** Number of tracked keys (for tests / diagnostics). */
  size(): number;
}

export interface RateLimiterOptions {
  /** Max calls per window; 0 or less disables limiting. */
  limit: number;
  windowMs: number;
  now?: () => number;
}

/** Sweep idle keys at most this often. */
const SWEEP_EVERY_MS = 60_000;

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  let lastSweep = now();

  function prune(list: number[], cutoff: number): number[] {
    let i = 0;
    while (i < list.length && list[i] <= cutoff) i++;
    return i === 0 ? list : list.slice(i);
  }

  function sweep(t: number): void {
    if (t - lastSweep < SWEEP_EVERY_MS) return;
    lastSweep = t;
    const cutoff = t - opts.windowMs;
    for (const [key, list] of hits) {
      if (!list.length || list[list.length - 1] <= cutoff) hits.delete(key);
    }
  }

  return {
    consume(key) {
      const limit = opts.limit;
      if (limit <= 0) return { ok: true, remaining: Number.POSITIVE_INFINITY, limit };
      const t = now();
      sweep(t);
      const list = prune(hits.get(key) ?? [], t - opts.windowMs);
      if (list.length >= limit) {
        hits.set(key, list);
        const retryAfterMs = list[0] + opts.windowMs - t;
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)), limit };
      }
      list.push(t);
      hits.set(key, list);
      return { ok: true, remaining: limit - list.length, limit };
    },
    size() {
      return hits.size;
    },
  };
}
