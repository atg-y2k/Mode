import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

describe('createRateLimiter', () => {
  it('allows up to the limit within the window, then reports when to retry', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });
    expect(limiter.consume('a')).toMatchObject({ ok: true, remaining: 2 });
    now = 10_000;
    expect(limiter.consume('a')).toMatchObject({ ok: true, remaining: 1 });
    expect(limiter.consume('a')).toMatchObject({ ok: true, remaining: 0 });
    const denied = limiter.consume('a');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.retryAfterSec).toBe(50); // first hit at t=0 expires at t=60s
  });

  it('slides the window', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
    limiter.consume('k');
    now = 500;
    limiter.consume('k');
    expect(limiter.consume('k').ok).toBe(false);
    now = 1001; // first hit expired
    expect(limiter.consume('k').ok).toBe(true);
    expect(limiter.consume('k').ok).toBe(false);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect(limiter.consume('a').ok).toBe(true);
    expect(limiter.consume('a').ok).toBe(false);
    expect(limiter.consume('b').ok).toBe(true);
  });

  it('does not record denied calls', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });
    limiter.consume('a');
    for (now = 100; now < 1000; now += 100) expect(limiter.consume('a').ok).toBe(false);
    now = 1000;
    expect(limiter.consume('a').ok).toBe(true);
  });

  it('is disabled with a limit of 0', () => {
    const limiter = createRateLimiter({ limit: 0, windowMs: 1000 });
    for (let i = 0; i < 100; i++) expect(limiter.consume('a').ok).toBe(true);
    expect(limiter.size()).toBe(0);
  });

  it('sweeps idle keys', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 5, windowMs: 1000, now: () => now });
    for (let i = 0; i < 50; i++) limiter.consume(`ip-${i}`);
    expect(limiter.size()).toBe(50);
    now = 120_000;
    limiter.consume('fresh');
    expect(limiter.size()).toBe(1);
  });
});
