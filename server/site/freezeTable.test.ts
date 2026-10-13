import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { buildFreezeTable, monthDay, readTar, stationRow } from '../../scripts/build-frost-data.mjs';
import { FREEZE_TABLE_FILE, FreezeTableFormatError, loadFreezeTable, parseFreezeTable } from './freezeTable';
import { NOAA_DATA_URL, NOAA_INVENTORY_URL } from './noaa';
import { createSiteProfileService } from './profile';
import { FIXTURE_POINTS, fixtureFetch, fixtureText, type FixturePoint } from './testing';

const ARCHIVE_IDS = ['USC00182325', 'USW00012839', 'USW00093009', 'USC00058501', 'USW00094728', 'AQC00914000'] as const;
const archiveCsv = (id: string) => fixtureText(`noaa-archive-${id}.csv`);

/** A minimal ustar archive (what the NCEI tarball is) of `files`. */
function tarOf(files: { name: string; data: Buffer }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const f of files) {
    const header = Buffer.alloc(512);
    header.write(f.name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 'latin1');
    header.write(`${f.data.length.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
    header.write('0', 156, 'latin1');
    header.write('ustar\0' + '00', 257, 'latin1');
    blocks.push(header, f.data, Buffer.alloc((512 - (f.data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

/** Splits a buffer into small chunks (exercises headers and files spanning chunk boundaries). */
function* chunked(buf: Buffer, size: number): Generator<Buffer> {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}

describe('build-frost-data (scripts/build-frost-data.mjs)', () => {
  it('reads the T32 freeze fields of a station CSV from the NCEI archive', () => {
    expect(stationRow(archiveCsv('USC00182325'))).toEqual(['USC00182325', 38.9386, -77.1133, 'DALECARLIA RSVR, MD US', '04-09', '04-26', '10-31', '10-16', 202]);
    // Frost-free: every date -9999, median season 365 days.
    expect(stationRow(archiveCsv('USW00012839'))).toEqual(['USW00012839', 25.7906, -80.3164, 'MIAMI INTL AP, FL US', null, null, null, null, 365]);
    // Too cold to compute dates (freezes in any month): left out, like the server skips it.
    expect(stationRow(archiveCsv('USW00093009'))).toBeNull();
    // No temperature normals at all.
    expect(stationRow(archiveCsv('AQC00914000'))).toBeNull();
    expect(stationRow('')).toBeNull();
    expect(monthDay(' -9999.0')).toBeNull();
    expect(monthDay('   1/5')).toBe('01-05');
  });

  it('streams a gzipped tar and keeps only usable stations, sorted by id', async () => {
    const tar = tarOf([...ARCHIVE_IDS].reverse().map((id) => ({ name: `${id}.csv`, data: Buffer.from(archiveCsv(id)) })));
    const unzipped = gunzipSync(gzipSync(tar));
    const table = await buildFreezeTable(readTar(chunked(unzipped, 700)));
    expect(table).toMatchObject({ version: 1, files: 6, count: 4, frostFree: 1 });
    expect(table.stations.map((r) => r[0])).toEqual(['USC00058501', 'USC00182325', 'USW00012839', 'USW00094728']);
    expect(table.stations[0]).toEqual(['USC00058501', 39.0942, -106.3506, 'TWIN LAKES RSVR, CO US', '06-16', '06-29', '09-10', '08-24', 85]);
  });
});

describe('bundled frost table (server/site/data)', async () => {
  const table = await loadFreezeTable();
  const dir = mkdtempSync(join(tmpdir(), 'mode-frost-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('loads the committed table: ~7,000 stations with dates, ~180 frost-free', () => {
    expect(table.stations.length).toBeGreaterThan(6_900);
    const frostFree = [...table.records.values()].filter((r) => r.lastSpring50 === null);
    expect(frostFree.length).toBeGreaterThan(100);
    expect(frostFree.every((r) => r.seasonDays === 365)).toBe(true);
    expect(table.records.get('USC00182325')).toMatchObject({ name: 'DALECARLIA RSVR, MD', lastSpring50: '04-09', firstFall50: '10-31', seasonDays: 202 });
  });

  it.each(['rockville', 'manhattan', 'miami', 'leadville', 'offshore'] as FixturePoint[])(
    'gives the same frost answer as NOAA’s live services (recorded) for %s',
    async (name) => {
      const p = FIXTURE_POINTS[name];
      const runtime = await createSiteProfileService({ fetch: fixtureFetch(), cacheDir: null, log: () => undefined, freezeTable: null }).profile(p.lat, p.lon);
      const fetch = fixtureFetch();
      const bundled = await createSiteProfileService({ fetch, cacheDir: null, log: () => undefined, freezeTable: table }).profile(p.lat, p.lon);
      expect(bundled.frost).toEqual(runtime.frost);
      // No NOAA request at all with the table.
      expect(fetch.calls.some((c) => c.url === NOAA_INVENTORY_URL || c.url.startsWith(NOAA_DATA_URL))).toBe(false);
    },
  );

  it('is the default source, and falls back to NOAA’s services when the file is unreadable', async () => {
    const p = FIXTURE_POINTS.rockville;
    const fetch = fixtureFetch();
    const byDefault = await createSiteProfileService({ fetch, cacheDir: null, log: () => undefined }).profile(p.lat, p.lon);
    expect(byDefault.frost?.station).toBe('DALECARLIA RSVR, MD');
    expect(fetch.calls.some((c) => c.url === NOAA_INVENTORY_URL)).toBe(false);

    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{"version": 9}');
    const logs: string[] = [];
    const fallbackFetch = fixtureFetch();
    const fallback = await createSiteProfileService({ fetch: fallbackFetch, cacheDir: null, log: (l) => logs.push(l), freezeTable: broken }).profile(p.lat, p.lon);
    expect(fallback.frost).toEqual(byDefault.frost);
    expect(fallbackFetch.calls.some((c) => c.url === NOAA_INVENTORY_URL)).toBe(true);
    expect(logs.some((l) => /bundled frost table unavailable/.test(l))).toBe(true);
    const missing = await createSiteProfileService({ fetch: fixtureFetch(), cacheDir: null, log: () => undefined, freezeTable: join(dir, 'nope.json') }).profile(p.lat, p.lon);
    expect(missing.frost).toEqual(byDefault.frost);
  });

  it('answers "no frost data" far from any station without asking NOAA', async () => {
    const fetch = fixtureFetch();
    const sea = await createSiteProfileService({ fetch, cacheDir: null, log: () => undefined, freezeTable: table, timeouts: { total: 2_000 } })
      .profile(FIXTURE_POINTS.offshore.lat, FIXTURE_POINTS.offshore.lon + 6) // open Atlantic, ~500 km from Nova Scotia
      .catch(() => null);
    expect(sea).not.toBeNull();
    expect(sea?.frost).toBeUndefined();
    expect(fetch.calls.some((c) => c.url.startsWith(NOAA_DATA_URL))).toBe(false);
  });

  it('validates the document and skips malformed rows', () => {
    const fields = ['id', 'lat', 'lon', 'name', 'lastSpring50', 'lastSpring90', 'firstFall50', 'firstFall10', 'freeDays'];
    expect(() => parseFreezeTable(null)).toThrow(FreezeTableFormatError);
    expect(() => parseFreezeTable({ version: 2, fields, stations: [] })).toThrow(FreezeTableFormatError);
    expect(() => parseFreezeTable({ version: 1, fields: ['id'], stations: [] })).toThrow(FreezeTableFormatError);
    expect(() => parseFreezeTable({ version: 1, fields, stations: [] })).toThrow(/no stations/);
    const parsed = parseFreezeTable({
      version: 1,
      fields,
      stations: [
        ['A', 1, 2, 'A, XX US', '04-01', null, '10-20', null, 200],
        ['B', 1, 2, 'B', null, null, null, null, 365],
        ['C', 1, 2, 'C', null, null, null, null, 52], // too cold: not usable
        ['D', 91, 2, 'D', '04-01', null, '10-20', null, 200], // bad latitude
        ['E', 1, 2, 'E', '4/1', null, '10-20', null, 200], // bad date
        ['A', 3, 4, 'dup', '04-01', null, '10-20', null, 200],
        'garbage',
      ],
    });
    expect(parsed.stations.map((s) => s.id)).toEqual(['A', 'B']);
    expect(parsed.records.get('A')).toMatchObject({ name: 'A, XX', lastSpringLate: null, seasonDays: 200 });
  });

  it('lives where the service looks for it', () => {
    expect(FREEZE_TABLE_FILE).toMatch(/server[\\/]site[\\/]data[\\/]noaa-freeze-stations\.json$/);
  });
});
