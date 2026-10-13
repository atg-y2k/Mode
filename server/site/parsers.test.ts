import { describe, expect, it } from 'vitest';
import { parseEcoregion, ecoregionUrl, EcoregionFormatError } from './ecoregion';
import {
  FREEZE_FIELDS,
  chooseFrostStation,
  distanceKm,
  formatStationName,
  frostFreeSection,
  frostSection,
  nearestStations,
  normalsUrl,
  parseMonthDay,
  parseNormalsResponse,
  parseStationInventory,
  type FreezeRecord,
  type NormalsStation,
} from './noaa';
import { SdaFormatError, parseSdaResponse, soilQuery, soilRequestBody, summarizeSoil, type SdaRow } from './soil';
import { looksLikeHtml } from './profile';
import { FIXTURE_POINTS, SDA_MAINTENANCE_HTML, fixtureJson, fixtureText } from './testing';

const inventory = parseStationInventory(fixtureText('noaa-inventory-excerpt.txt'));
const point = FIXTURE_POINTS;

function chooseFor(name: keyof typeof FIXTURE_POINTS) {
  const p = point[name];
  const candidates = nearestStations(inventory, Math.round(p.lat * 1000) / 1000, Math.round(p.lon * 1000) / 1000).slice(0, 25);
  const records = parseNormalsResponse(fixtureJson(`noaa-normals-${name}.json`));
  return { candidates, records, choice: chooseFrostStation(candidates, records) };
}

describe('NOAA station inventory', () => {
  it('parses the fixed-width inventory and drops precipitation-only CoCoRaHS stations', () => {
    expect(inventory.length).toBe(125); // 128 lines, 3 of them US1…
    expect(inventory.some((s) => s.id.startsWith('US1'))).toBe(false);
    expect(inventory.find((s) => s.id === 'USC00182325')).toEqual({ id: 'USC00182325', lat: 38.9386, lon: -77.1133, state: 'MD', name: 'DALECARLIA RSVR' });
  });

  it('skips malformed lines', () => {
    const text = [
      'USC00187705  39.1008  -77.1486  134.1 MD ROCKVILLE 1 NE                              ',
      'garbage',
      'USC0018770X  abc  -77.1486  134.1 MD BROKEN',
      'USC00999999  95.0000  -77.1486  134.1 MD OUT OF RANGE                              ',
      'CAW00064757  44.2325  -79.7811  246.0 ON EGBERT 1 W                                  ',
    ].join('\n');
    expect(parseStationInventory(text).map((s) => s.id)).toEqual(['USC00187705', 'CAW00064757']);
  });

  it('finds the nearest stations within the limit, nearest first', () => {
    const near = nearestStations(inventory, 38.997, -77.135);
    expect(near.length).toBeGreaterThan(20);
    expect(near[0].station.id).toBe('USC00182325');
    expect(near[0].km).toBeCloseTo(6.8, 1);
    for (let i = 1; i < near.length; i++) expect(near[i].km).toBeGreaterThanOrEqual(near[i - 1].km);
    expect(near.every((n) => n.km <= 200)).toBe(true);
    expect(nearestStations(inventory, 0, 0)).toEqual([]);
    expect(distanceKm(38.9, -77, 38.9, -77)).toBe(0);
    expect(distanceKm(40.758, -73.9855, 38.997, -77.135)).toBeCloseTo(329, -1);
  });

  it('asks the data service for the freeze fields of the candidate stations', () => {
    const url = new URL(normalsUrl(['USC00182325', 'USW00013743']));
    expect(url.origin + url.pathname).toBe('https://www.ncei.noaa.gov/access/services/data/v1');
    expect(url.searchParams.get('dataset')).toBe('normals-annualseasonal-1991-2020');
    expect(url.searchParams.get('stations')).toBe('USC00182325,USW00013743');
    expect(url.searchParams.get('dataTypes')?.split(',')).toEqual(Object.values(FREEZE_FIELDS));
    expect(url.searchParams.get('format')).toBe('json');
  });
});

describe('NOAA freeze normals', () => {
  it('reads month-day values and rejects special values', () => {
    expect(parseMonthDay('   04/01')).toBe('04-01');
    expect(parseMonthDay('12/31')).toBe('12-31');
    expect(parseMonthDay('4/1')).toBe('04-01');
    for (const bad of [' -9999.0', '-7777', '13/01', '00/10', '04/32', '', null, 401]) expect(parseMonthDay(bad)).toBeNull();
    expect(formatStationName('ROCKVILLE 1 NE, MD US')).toBe('ROCKVILLE 1 NE, MD');
    expect(formatStationName('  EGBERT 1 W, ON CA ')).toBe('EGBERT 1 W, ON CA');
    expect(formatStationName('TOA BAJA LEVITTOWN, PR RQ')).toBe('TOA BAJA LEVITTOWN, PR');
    expect(formatStationName('PAGO PAGO WSO AP, AS AQ')).toBe('PAGO PAGO WSO AP, AS');
    expect(formatStationName(undefined)).toBeNull();
  });

  it('parses the recorded answer, telling stations without freeze normals apart', () => {
    const records = parseNormalsResponse(fixtureJson('noaa-normals-rockville.json'));
    expect(records.get('USC00182325')).toEqual({
      id: 'USC00182325',
      name: 'DALECARLIA RSVR, MD',
      hasFields: true,
      lastSpring50: '04-09',
      lastSpringLate: '04-26',
      firstFall50: '10-31',
      firstFallEarly: '10-16',
      seasonDays: 202,
    });
    const withoutFields = [...records.values()].filter((r) => !r.hasFields);
    expect(withoutFields.length).toBeGreaterThan(0);
    expect(withoutFields.every((r) => r.lastSpring50 === null)).toBe(true);
    expect(parseNormalsResponse({ error: 'nope' }).size).toBe(0);
    expect(parseNormalsResponse([null, 5, { NAME: 'no id' }]).size).toBe(0);
  });

  it('picks the nearest station with dates (Rockville, Manhattan, offshore)', () => {
    const rockville = chooseFor('rockville').choice;
    expect(rockville.kind).toBe('dates');
    if (rockville.kind !== 'dates') return;
    expect(frostSection(rockville)).toEqual({
      station: 'DALECARLIA RSVR, MD',
      distanceKm: 6.8,
      lastSpring50: '04-09',
      lastSpring90: '04-26',
      firstFall50: '10-31',
      firstFall10: '10-16',
      freeDays: 202,
    });
    const nyc = chooseFor('manhattan').choice;
    expect(nyc.kind === 'dates' && frostSection(nyc)).toMatchObject({ station: 'NEW YORK CNTRL PK TWR, NY', lastSpring50: '03-30', firstFall50: '11-20' });
    const sea = chooseFor('offshore').choice;
    expect(sea.kind === 'dates' && frostSection(sea)).toMatchObject({ station: 'NANTUCKET MEM AP, MA', distanceKm: 144.2 });
  });

  it('reports a frost-free nearest station without dates (Miami)', () => {
    const { candidates, records, choice } = chooseFor('miami');
    expect(choice.kind).toBe('frost-free');
    // The recorded answer: every 32 °F date is -9999 and the median freeze-free season is 365 days.
    expect(records.get(candidates[0].station.id)).toMatchObject({ lastSpring50: null, firstFall50: null, seasonDays: 365 });
    if (choice.kind !== 'frost-free') return;
    expect(frostFreeSection(choice)).toEqual({ station: 'MIAMI BEACH, FL', distanceKm: 7.7, frostFree: true });
  });

  it('does not call a station frost-free without a 365-day season', () => {
    const s: NormalsStation = { id: 'X', lat: 0, lon: 0, state: 'HI', name: 'MAUNA' };
    const rec: FreezeRecord = { id: 'X', name: null, hasFields: true, lastSpring50: null, lastSpringLate: null, firstFall50: null, firstFallEarly: null, seasonDays: null };
    expect(chooseFrostStation([{ station: s, km: 1 }], new Map([['X', rec]]))).toEqual({ kind: 'none' });
    const free = chooseFrostStation([{ station: s, km: 1.26 }], new Map([['X', { ...rec, seasonDays: 365 }]]));
    expect(free.kind === 'frost-free' && frostFreeSection(free)).toEqual({ station: 'MAUNA, HI', distanceKm: 1.3, frostFree: true });
  });

  it('skips stations too cold to compute dates (Leadville → Twin Lakes)', () => {
    const { candidates, records, choice } = chooseFor('leadville');
    expect(records.get(candidates[0].station.id)?.lastSpring50).toBeNull();
    expect(choice.kind === 'dates' && frostSection(choice)).toMatchObject({
      station: 'TWIN LAKES RSVR, CO',
      distanceKm: 18.2,
      lastSpring50: '06-16',
      firstFall50: '09-10',
      freeDays: 85,
    });
  });

  it('decides only over stations it has answers for', () => {
    const s = (id: string): NormalsStation => ({ id, lat: 0, lon: 0, state: '', name: id });
    const rec = (id: string, over: Partial<FreezeRecord>): FreezeRecord => ({
      id,
      name: id,
      hasFields: true,
      lastSpring50: null,
      lastSpringLate: null,
      firstFall50: null,
      firstFallEarly: null,
      seasonDays: null,
      ...over,
    });
    const candidates = [
      { station: s('A'), km: 1 },
      { station: s('B'), km: 2 },
      { station: s('C'), km: 3 },
    ];
    const records = new Map([
      ['A', rec('A', { hasFields: false })],
      ['B', rec('B', { lastSpring50: '04-01' })], // incomplete: no fall date
      ['C', rec('C', { lastSpring50: '04-01', firstFall50: '10-20' })],
    ]);
    expect(chooseFrostStation(candidates, records)).toMatchObject({ kind: 'dates', station: { id: 'C' }, km: 3 });
    expect(chooseFrostStation(candidates.slice(0, 2), records)).toEqual({ kind: 'none' });
    const section = frostSection({ kind: 'dates', station: s('C'), km: 3.04, record: rec('C', { name: null, lastSpring50: '04-01', firstFall50: '10-20' }) });
    expect(section).toEqual({ station: 'C', distanceKm: 3, lastSpring50: '04-01', firstFall50: '10-20' });
  });
});

describe('USDA Soil Data Access', () => {
  it('builds the fixed SQL template from numbers only', () => {
    const sql = soilQuery(38.997, -77.135);
    expect(sql).toContain("SDA_Get_Mukey_from_intersection_with_WktWgs84('point(-77.135000 38.997000)')");
    expect(sql).toContain('ph1to1h2o_r');
    expect(sql).toContain('claytotal_r');
    expect(sql).toContain('drainagecl');
    expect(sql).toContain('hydgrp');
    expect(JSON.parse(soilRequestBody(38.997, -77.135))).toEqual({ query: sql, format: 'JSON+COLUMNNAME' });
    expect(() => soilQuery(Number.NaN, 0)).toThrow(RangeError);
    expect(() => soilQuery(10, 181)).toThrow(RangeError);
  });

  it('parses the recorded table (and "no map unit" as empty)', () => {
    const rows = parseSdaResponse(fixtureJson('sda-rockville.json'));
    expect(rows.length).toBe(10);
    expect(rows[0]).toEqual({
      mukey: '533581',
      muname: 'Brinklow-Blocktown channery silt loams, 15 to 25 percent slopes',
      cokey: '29184541',
      compname: 'Brinklow',
      compkind: 'Series',
      comppct: 50,
      major: true,
      drainage: 'Well drained',
      hydgrp: 'C',
      top: 0,
      bottom: 25,
      ph: 5.2,
      clay: 23,
    });
    expect(rows.find((r) => r.compname === 'GLENELG')?.major).toBe(false); // "No " with a trailing space
    expect(parseSdaResponse(fixtureJson('sda-offshore.json'))).toEqual([]);
    expect(() => parseSdaResponse('<html>')).toThrow(SdaFormatError);
    expect(() => parseSdaResponse({ Table: [] })).toThrow(SdaFormatError);
    expect(() => parseSdaResponse({ Table: [['foo']] })).toThrow(SdaFormatError);
  });

  it('summarises the dominant component over the 0–30 cm root zone', () => {
    // Brinklow 50 %: 0–25 cm pH 5.2 / clay 23, 25–64 cm pH 5.0 / clay 26 → 5.17 / 23.5.
    expect(summarizeSoil(parseSdaResponse(fixtureJson('sda-rockville.json')))).toEqual({
      mapUnit: 'Brinklow-Blocktown channery silt loams, 15 to 25 percent slopes',
      drainage: 'well drained',
      ph: 5.2,
      clayPct: 24,
      hydroGroup: 'C',
      disturbed: false,
    });
    expect(summarizeSoil(parseSdaResponse(fixtureJson('sda-leadville.json')))).toMatchObject({
      mapUnit: 'Leadville sandy loam, 3 to 35 percent slopes',
      drainage: 'well drained',
      hydroGroup: 'C',
      disturbed: false,
    });
  });

  it('flags urban land as disturbed without borrowing minor inclusions', () => {
    expect(summarizeSoil(parseSdaResponse(fixtureJson('sda-manhattan.json')))).toEqual({
      mapUnit: 'Urban land, till substratum, 0 to 3 percent slopes',
      disturbed: true,
    });
    expect(summarizeSoil(parseSdaResponse(fixtureJson('sda-miami.json')))).toMatchObject({ disturbed: true });
    expect(summarizeSoil([])).toBeNull();
  });

  it('falls back to the largest major component with data, skips empty horizons', () => {
    const row = (over: Partial<SdaRow>): SdaRow => ({
      mukey: '1',
      muname: 'Urban land-Udorthents complex',
      cokey: 'u',
      compname: 'Urban land',
      compkind: 'Miscellaneous area',
      comppct: 55,
      major: true,
      drainage: null,
      hydgrp: null,
      top: null,
      bottom: null,
      ph: null,
      clay: null,
      ...over,
    });
    const rows = [
      row({}),
      row({ cokey: 'd', compname: 'Udorthents', compkind: 'Taxon above family', comppct: 35, drainage: 'Moderately well drained', hydgrp: 'B/D', top: 0, bottom: 5, ph: null, clay: null }),
      row({ cokey: 'd', compname: 'Udorthents', compkind: 'Taxon above family', comppct: 35, drainage: 'Moderately well drained', hydgrp: 'B/D', top: 5, bottom: 50, ph: 6.8, clay: 31 }),
      row({ cokey: 'm', compname: 'Minor', comppct: 10, major: false, drainage: 'Poorly drained', top: 0, bottom: 30, ph: 4.5, clay: 10 }),
    ];
    expect(summarizeSoil(rows)).toEqual({
      mapUnit: 'Urban land-Udorthents complex',
      drainage: 'moderately well drained',
      ph: 6.8,
      clayPct: 31,
      hydroGroup: 'B/D',
      disturbed: true,
    });
  });
});

describe('EPA ecoregion', () => {
  it('builds the point query and reads the Level III name', () => {
    const url = new URL(ecoregionUrl(38.997, -77.135));
    expect(url.searchParams.get('geometry')).toBe('-77.135000,38.997000');
    expect(url.searchParams.get('outFields')).toBe('US_L3NAME');
    expect(parseEcoregion(fixtureJson('epa-rockville.json'))).toBe('Northern Piedmont');
    expect(parseEcoregion(fixtureJson('epa-miami.json'))).toBe('Southern Florida Coastal Plain');
    expect(parseEcoregion(fixtureJson('epa-offshore.json'))).toBeNull();
    expect(() => parseEcoregion({ error: { code: 500, message: 'Unable to complete operation.' } })).toThrow(EcoregionFormatError);
    expect(() => parseEcoregion('nope')).toThrow(EcoregionFormatError);
  });
});

describe('HTML instead of JSON (SDA maintenance window)', () => {
  it('trusts JSON content types and flags HTML pages', () => {
    expect(looksLikeHtml('application/json; charset=utf-8', '{"Table":[]}')).toBe(false);
    expect(looksLikeHtml('application/geo+json', '{}')).toBe(false);
    expect(looksLikeHtml('text/html; charset=utf-8', SDA_MAINTENANCE_HTML)).toBe(true);
    expect(looksLikeHtml('TEXT/HTML', '')).toBe(true);
    // No or vague content type: judged by the body.
    expect(looksLikeHtml('', '  \n<!DOCTYPE html><html></html>')).toBe(true);
    expect(looksLikeHtml('text/plain', '[{"STATION":"X"}]')).toBe(false);
  });
});
