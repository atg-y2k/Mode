import { readFileSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import sample from './__fixtures__/zones.sample.json';
import { localityForZip, lookupZip, normalizeZip, parsePhzmZip, parseZipTable, setZipTable, zipFromTable, type ZipTable } from './zip';

const ZONES_PATH = new URL('../../public/data/zones.json', import.meta.url);

afterEach(() => setZipTable(null));

describe('normalizeZip', () => {
  it('accepts 5-digit ZIPs and ZIP+4', () => {
    expect(normalizeZip('20817')).toBe('20817');
    expect(normalizeZip(' 20817-1234 ')).toBe('20817');
    expect(normalizeZip('208171234')).toBe('20817');
  });
  it('rejects anything else', () => {
    for (const bad of ['2081', '208177', 'abcde', '', '20817-12', undefined, null]) expect(normalizeZip(bad)).toBeNull();
  });
});

describe('localityForZip', () => {
  it('maps Alaska and Hawaii prefixes, everything else to the lower 48', () => {
    expect(localityForZip('99501')).toBe('AK');
    expect(localityForZip('96813')).toBe('HI');
    expect(localityForZip('20817')).toBe('L48');
    expect(localityForZip('nope')).toBeNull();
  });
});

describe('lookupZip (fixture subset)', () => {
  it('returns zone and centroid from the bundled table', async () => {
    setZipTable(parseZipTable(sample));
    expect(await lookupZip('20817')).toEqual({ zip: '20817', zone: '7b', lat: 38.997, lon: -77.135, source: 'table' });
    expect(await lookupZip('02134-5555')).toMatchObject({ zip: '02134', zone: '6b' });
    expect((await lookupZip('96813'))?.zone).toBe('12b');
  });

  it('returns null for unknown or invalid ZIPs (no network in node)', async () => {
    setZipTable(parseZipTable(sample));
    expect(await lookupZip('12345')).toBeNull();
    expect(await lookupZip('hello')).toBeNull();
  });

  it('returns null when the table cannot be loaded in node', async () => {
    expect(await lookupZip('20817', { online: false })).toBeNull();
  });

  it('ignores malformed rows', () => {
    const t = { '11111': ['99z', 1, 2], '22222': ['7a', Number.NaN, 2], '33333': ['7a', 40, -75] } as unknown as ZipTable;
    expect(zipFromTable(t, '11111')).toBeNull();
    expect(zipFromTable(t, '22222')).toBeNull();
    expect(zipFromTable(t, '33333')?.zone).toBe('7a');
  });

  it('rejects a file without a zips table', () => {
    expect(() => parseZipTable({})).toThrow();
    expect(() => parseZipTable(null)).toThrow();
  });
});

describe('parsePhzmZip (online fallback format)', () => {
  it('parses string coordinates and normalizes the zone', () => {
    expect(parsePhzmZip('20817', { zone: '7B', coordinates: { lat: '38.996842', lon: '-77.13519' } })).toEqual({
      zip: '20817',
      zone: '7b',
      lat: 38.997,
      lon: -77.135,
      source: 'online',
    });
    expect(parsePhzmZip('20817', { zone: 'n/a' })).toBeNull();
  });
});

describe('bundled public/data/zones.json', () => {
  it('covers ~40k ZIPs in under 2 MB with valid rows', () => {
    const bytes = statSync(ZONES_PATH).size;
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
    const json = JSON.parse(readFileSync(ZONES_PATH, 'utf8')) as { zips: ZipTable; source: string };
    const table = parseZipTable(json);
    const zips = Object.keys(table);
    expect(zips.length).toBeGreaterThan(39_000);
    expect(json.source).toMatch(/not the official USDA map/);
    // Spot checks (PRISM 2023 zones).
    expect(zipFromTable(table, '20817')?.zone).toBe('7b');
    expect(zipFromTable(table, '55401')?.zone).toBe('5a');
    expect(zipFromTable(table, '33139')?.zone).toBe('11a');
    // Every row is well formed.
    const bad = zips.filter((z) => !zipFromTable(table, z));
    expect(bad).toEqual([]);
  });
});
