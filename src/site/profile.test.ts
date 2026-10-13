import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_PATHS } from '../../shared/api';
import { clearSiteProfileCache, fetchSiteProfile, parseSiteProfile } from './profile';

const FULL = {
  coordsSource: 'zip',
  frost: { station: 'ROCKVILLE 1 NE, MD', distanceKm: 6.2, lastSpring50: '04-12', lastSpring90: '04-28', firstFall50: '10-21', firstFall10: '10-06', freeDays: 191 },
  soil: { mapUnit: 'Glenelg silt loam, 3 to 8 percent slopes', drainage: 'well drained', ph: 5.6, clayPct: 18, hydroGroup: 'B', disturbed: false },
  ecoregion: 'Northern Piedmont',
  updatedAt: 1_700_000_000_000,
};

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearSiteProfileCache();
});

describe('parseSiteProfile', () => {
  it('keeps valid sections and drops malformed ones', () => {
    expect(parseSiteProfile(FULL)).toEqual(FULL);
    const partial = parseSiteProfile({ frost: { station: 'X' }, soil: { ...FULL.soil, ph: null }, updatedAt: 5 });
    expect(partial).toEqual({ coordsSource: 'zip', soil: { ...FULL.soil, ph: undefined }, updatedAt: 5 });
    expect(partial?.frost).toBeUndefined();
    expect(parseSiteProfile('nope')).toBeNull();
    expect(parseSiteProfile({}, 'photo-gps')?.coordsSource).toBe('photo-gps');
  });

  it('keeps a frost-free section (no dates) from a frost-free station', () => {
    const p = parseSiteProfile({ coordsSource: 'zip', frost: { station: 'HILO INTL AP, HI', distanceKm: 2.4, frostFree: true }, updatedAt: 1 });
    expect(p?.frost).toEqual({ station: 'HILO INTL AP, HI', distanceKm: 2.4, frostFree: true });
    // a dated section without its dates is still malformed
    expect(parseSiteProfile({ frost: { station: 'X', distanceKm: 3, frostFree: false } })?.frost).toBeUndefined();
  });
});

describe('fetchSiteProfile', () => {
  it('posts rounded coordinates to the server and labels the source', async () => {
    const fn = mockFetch(200, FULL);
    const p = await fetchSiteProfile(38.996842, -77.13519, undefined, { coordsSource: 'photo-gps' });
    expect(p.frost?.lastSpring50).toBe('04-12');
    expect(p.coordsSource).toBe('photo-gps');
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe(API_PATHS.siteProfile);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ lat: 38.9968, lon: -77.1352 });
  });

  it('caches per rounded coordinate', async () => {
    const fn = mockFetch(200, FULL);
    await fetchSiteProfile(38.9968, -77.1352);
    await fetchSiteProfile(38.99681, -77.13519);
    expect(fn).toHaveBeenCalledTimes(1);
    await fetchSiteProfile(38.9968, -77.1352, undefined, { force: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not cache an empty profile', async () => {
    const fn = mockFetch(200, { coordsSource: 'zip', updatedAt: 1 });
    await fetchSiteProfile(40, -75);
    await fetchSiteProfile(40, -75);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('explains a server without the endpoint', async () => {
    mockFetch(404, 'Not found');
    await expect(fetchSiteProfile(40, -75)).rejects.toThrow(/can't look up frost dates and soil yet/);
  });

  it('passes through the server error message', async () => {
    mockFetch(502, { error: { code: 'upstream_error', message: 'NOAA is not responding.' } });
    await expect(fetchSiteProfile(40, -75)).rejects.toMatchObject({ code: 'upstream_error', message: 'NOAA is not responding.' });
  });

  it('reports an unreachable server and cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(fetchSiteProfile(40, -75)).rejects.toThrow(/Can't reach the Mode server/);
    const c = new AbortController();
    c.abort();
    await expect(fetchSiteProfile(40, -75, c.signal)).rejects.toMatchObject({ aborted: true });
  });

  it('rejects invalid coordinates without a request', async () => {
    const fn = mockFetch(200, FULL);
    await expect(fetchSiteProfile(Number.NaN, 0)).rejects.toThrow(/not valid/);
    await expect(fetchSiteProfile(91, 0)).rejects.toThrow(/not valid/);
    expect(fn).not.toHaveBeenCalled();
  });
});
