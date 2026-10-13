import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FreezeTable } from './freezeTable';
import { NOAA_INVENTORY_URL } from './noaa';
import { ECOREGION_GRACE_MS, ECOREGION_RETRY_MS, PARTIAL_TTL_MS, SiteUpstreamError, createSiteProfileService, roundedPoint } from './profile';
import { FIXTURE_POINTS, fixtureFetch, type FixtureFetchOptions } from './testing';

let dir: string;
let clock: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mode-site-'));
  clock = 1_800_000_000_000;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A service on the recorded answers. Frost from NOAA's runtime services unless a frost table is given. */
function service(opts: FixtureFetchOptions = {}, cacheDir: string | null = dir, freezeTable: FreezeTable | string | null = null) {
  const fetch = fixtureFetch(opts);
  const logs: string[] = [];
  const svc = createSiteProfileService({ fetch, cacheDir, now: () => clock, log: (l) => logs.push(l), freezeTable });
  return { svc, fetch, logs };
}

const ROCKVILLE = {
  coordsSource: 'zip',
  updatedAt: 1_800_000_000_000,
  frost: { station: 'DALECARLIA RSVR, MD', distanceKm: 6.8, lastSpring50: '04-09', lastSpring90: '04-26', firstFall50: '10-31', firstFall10: '10-16', freeDays: 202 },
  soil: {
    mapUnit: 'Brinklow-Blocktown channery silt loams, 15 to 25 percent slopes',
    drainage: 'well drained',
    ph: 5.2,
    clayPct: 24,
    hydroGroup: 'C',
    disturbed: false,
  },
  ecoregion: 'Northern Piedmont',
};

describe('site profile service', () => {
  it('combines NOAA, USDA and EPA for the rounded point', async () => {
    const { svc, fetch } = service();
    const p = FIXTURE_POINTS.rockville;
    expect(await svc.profile(p.lat, p.lon)).toEqual(ROCKVILLE);
    const urls = fetch.calls.map((c) => c.url);
    expect(urls).toContain(NOAA_INVENTORY_URL);
    const sda = fetch.calls.find((c) => c.url.includes('sdmdataaccess'));
    expect(sda?.method).toBe('POST');
    // The precise coordinates never leave the server: upstream sees the ~100 m rounded point.
    expect(JSON.parse(sda?.body ?? '{}').query).toContain("point(-77.135000 38.997000)");
    expect(urls.find((u) => u.includes('geodata.epa.gov'))).toContain('geometry=-77.135000%2C38.997000');
    expect(urls.some((u) => u.includes('38.9968') || u.includes('77.1352'))).toBe(false);
  });

  it('labels the coordinate source and rounds keys to 3 decimals', async () => {
    const { svc, fetch } = service();
    const a = await svc.profile(38.9968, -77.1352, 'photo-gps');
    const b = await svc.profile(38.99681, -77.13519, 'address');
    expect(a.coordsSource).toBe('photo-gps');
    expect(b.coordsSource).toBe('address');
    expect(b.frost).toEqual(a.frost);
    expect(fetch.calls.filter((c) => c.url.includes('sdmdataaccess'))).toHaveLength(1);
    expect(roundedPoint(-0.0001, 10.0004)).toEqual({ lat: 0, lon: 10, key: '0.000,10.000' });
  });

  it('caches on disk: a new process answers without any network call', async () => {
    const p = FIXTURE_POINTS.rockville;
    await service().svc.profile(p.lat, p.lon);
    expect(readdirSync(dir).sort()).toEqual(['noaa-normals-stations-v1.json', 'profile_38.997,-77.135.json']);
    const second = service();
    expect(await second.svc.profile(p.lat, p.lon)).toEqual(ROCKVILLE);
    expect(second.fetch.calls).toHaveLength(0);
    // The station inventory is reused for another point.
    const m = FIXTURE_POINTS.manhattan;
    await second.svc.profile(m.lat, m.lon);
    expect(second.fetch.calls.map((c) => c.url)).not.toContain(NOAA_INVENTORY_URL);
  });

  it('shares one lookup between concurrent requests', async () => {
    const { svc, fetch } = service({}, null);
    const p = FIXTURE_POINTS.manhattan;
    const [a, b] = await Promise.all([svc.profile(p.lat, p.lon), svc.profile(p.lat, p.lon)]);
    expect(a).toEqual(b);
    expect(fetch.calls.filter((c) => c.url.includes('sdmdataaccess'))).toHaveLength(1);
    expect(a).toMatchObject({
      frost: { station: 'NEW YORK CNTRL PK TWR, NY', distanceKm: 2.7 },
      soil: { mapUnit: 'Urban land, till substratum, 0 to 3 percent slopes', disturbed: true },
      ecoregion: 'Northeastern Coastal Zone',
    });
  });

  it('handles frost-free, too-cold and offshore spots', async () => {
    const { svc } = service({}, null);
    const miami = await svc.profile(FIXTURE_POINTS.miami.lat, FIXTURE_POINTS.miami.lon);
    // Frost-free: the station and distance, no dates (not "no frost data").
    expect(miami.frost).toEqual({ station: 'MIAMI BEACH, FL', distanceKm: 7.7, frostFree: true });
    expect(miami).toMatchObject({ soil: { mapUnit: 'Urban land, 0 to 2 percent slopes', disturbed: true }, ecoregion: 'Southern Florida Coastal Plain' });
    const leadville = await svc.profile(FIXTURE_POINTS.leadville.lat, FIXTURE_POINTS.leadville.lon);
    expect(leadville.frost).toMatchObject({ station: 'TWIN LAKES RSVR, CO', lastSpring50: '06-16', firstFall50: '09-10' });
    const sea = await svc.profile(FIXTURE_POINTS.offshore.lat, FIXTURE_POINTS.offshore.lon);
    expect(sea.soil).toBeUndefined();
    expect(sea.ecoregion).toBeUndefined();
    expect(sea.frost?.station).toBe('NANTUCKET MEM AP, MA');
  });

  it('degrades to a partial profile when NOAA fails, and retries it soon', async () => {
    const { svc, fetch, logs } = service({ fail: { noaa: 503 } });
    const p = FIXTURE_POINTS.rockville;
    const partial = await svc.profile(p.lat, p.lon);
    expect(partial.frost).toBeUndefined();
    expect(partial.soil).toEqual(ROCKVILLE.soil);
    expect(partial.ecoregion).toBe('Northern Piedmont');
    expect(logs.some((l) => /frost dates unavailable: NOAA normals: HTTP 503/.test(l))).toBe(true);
    expect(existsSync(join(dir, 'profile_38.997,-77.135.json'))).toBe(false);
    const callsBefore = fetch.calls.length;
    await svc.profile(p.lat, p.lon); // still within the short memory window
    expect(fetch.calls.length).toBe(callsBefore);
    clock += PARTIAL_TTL_MS + 1;
    await svc.profile(p.lat, p.lon);
    expect(fetch.calls.length).toBeGreaterThan(callsBefore);
  });

  it('also degrades when the inventory or the soil service is unreachable', async () => {
    const noInventory = await service({ fail: { inventory: 'throw' } }, null).svc.profile(FIXTURE_POINTS.rockville.lat, FIXTURE_POINTS.rockville.lon);
    expect(noInventory.frost).toBeUndefined();
    expect(noInventory.soil?.mapUnit).toBeTruthy();
    const noSoil = await service({ fail: { sda: 500 } }, null).svc.profile(FIXTURE_POINTS.rockville.lat, FIXTURE_POINTS.rockville.lon);
    expect(noSoil.soil).toBeUndefined();
    expect(noSoil.frost?.station).toBe('DALECARLIA RSVR, MD');
  });

  it('treats the SDA maintenance page (HTTP 200, HTML) as a temporary failure', async () => {
    const { svc, fetch, logs } = service({ fail: { sda: 'html' } });
    const p = FIXTURE_POINTS.rockville;
    const first = await svc.profileWithStatus?.(p.lat, p.lon);
    expect(first?.unavailable).toEqual(['soil']);
    expect(first?.profile.soil).toBeUndefined();
    expect(first?.profile.frost).toEqual(ROCKVILLE.frost);
    expect(first?.profile.ecoregion).toBe('Northern Piedmont');
    expect(logs.some((l) => /soil unavailable: USDA Soil Data Access: temporarily unavailable \(HTML page/.test(l))).toBe(true);
    // Not cached as "no soil here": nothing on disk, asked again after the short window.
    expect(existsSync(join(dir, 'profile_38.997,-77.135.json'))).toBe(false);
    const sdaCalls = () => fetch.calls.filter((c) => c.url.includes('sdmdataaccess')).length;
    await svc.profile(p.lat, p.lon);
    expect(sdaCalls()).toBe(1);
    clock += PARTIAL_TTL_MS + 1;
    await svc.profile(p.lat, p.lon);
    expect(sdaCalls()).toBe(2);
  });

  it('fails only when every service fails', async () => {
    const { svc } = service({ fail: { inventory: 'throw', sda: 'throw', epa: 502 } });
    await expect(svc.profile(40, -75)).rejects.toBeInstanceOf(SiteUpstreamError);
  });

  it('caches a profile whose optional ecoregion failed and fills it in later', async () => {
    const p = FIXTURE_POINTS.rockville;
    const first = service({ fail: { epa: 'throw' } });
    const profile = await first.svc.profile(p.lat, p.lon);
    expect(profile.ecoregion).toBeUndefined();
    expect(profile.frost).toBeDefined();
    expect(existsSync(join(dir, 'profile_38.997,-77.135.json'))).toBe(true);

    const later = service();
    expect((await later.svc.profile(p.lat, p.lon)).ecoregion).toBeUndefined();
    expect(later.fetch.calls).toHaveLength(0); // not yet due for a retry
    clock += ECOREGION_RETRY_MS + 1;
    await later.svc.profile(p.lat, p.lon); // answers from cache, retries EPA in the background
    expect(later.fetch.calls.map((c) => c.url).every((u) => u.includes('geodata.epa.gov'))).toBe(true);
    let filled: string | undefined;
    for (let i = 0; i < 50 && !filled; i++) {
      await new Promise((r) => setTimeout(r, 10));
      filled = (await later.svc.profile(p.lat, p.lon)).ecoregion;
    }
    expect(filled).toBe('Northern Piedmont');
    expect((await service().svc.profile(p.lat, p.lon)).ecoregion).toBe('Northern Piedmont'); // persisted
  });

  it("doesn't wait long for a slow ecoregion service; the late answer still fills the cache", async () => {
    const p = FIXTURE_POINTS.rockville;
    const { svc } = service({ delayMs: { epa: ECOREGION_GRACE_MS + 300 } });
    const started = Date.now();
    const first = await svc.profile(p.lat, p.lon);
    expect(Date.now() - started).toBeLessThan(ECOREGION_GRACE_MS + 250);
    expect(first.frost).toBeDefined();
    expect(first.ecoregion).toBeUndefined();
    await new Promise((r) => setTimeout(r, 450));
    expect((await svc.profile(p.lat, p.lon)).ecoregion).toBe('Northern Piedmont');
    expect((await service().svc.profile(p.lat, p.lon)).ecoregion).toBe('Northern Piedmont'); // on disk too
  });

  it('keeps working when the cache folder is not writable', async () => {
    const blocked = join(dir, 'file-not-folder');
    await import('node:fs/promises').then((fs) => fs.writeFile(blocked, 'x'));
    const { svc, logs } = service({}, join(blocked, 'site'));
    const p = FIXTURE_POINTS.rockville;
    expect((await svc.profile(p.lat, p.lon)).frost?.station).toBe('DALECARLIA RSVR, MD');
    expect(logs.filter((l) => l.includes('continuing without the disk cache'))).toHaveLength(1);
  });
});
