import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildInvasives, buildZones, parseCsv, parsePrismZipCsv, readZipEntry } from '../../scripts/build-site-data.mjs';

/** Minimal ZIP archive writer (local headers + central directory) for the reader test. */
function makeZip(files: { name: string; data: Buffer; deflate: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const body = f.deflate ? deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(f.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const HEADER =
  '﻿locality,scientificName,scientificNameAuthorship,vernacularName,taxonRank,establishmentMeans,degreeOfEstablishment,isHybrid,kingdom,taxonRemarks';
const CSV = [
  HEADER,
  'L48,Berberis thunbergii,DC.,Japanese barberry,Species,introduced,widespread invasive (category E),FALSE,Plantae,',
  'HI,Lonicera japonica,Thunb.,Japanese honeysuckle,Species,introduced,widespread invasive (category E),FALSE,Plantae,',
  'L48,Lonicera japonica,Thunb.,Japanese honeysuckle,Species,introduced,invasive (category D2),FALSE,Plantae,',
  'L48,Cenchrus setaceus,"(Forssk.) Morrone","Crimson fountaingrass, purple",Species,introduced,widespread invasive (category E),FALSE,Plantae,"Other name(s): Pennisetum setaceum; too numerous to list"',
  'AK,Achillea ptarmica,L.,Sneezeweed,Species,introduced,established (category C3),FALSE,Plantae,',
  'L48,Sus scrofa,L.,Wild pig,Species,introduced,widespread invasive (category E),FALSE,Animalia,',
].join('\r\n');

describe('build-site-data', () => {
  it('parses quoted CSV fields with commas, quotes and newlines', () => {
    expect(parseCsv('a,"b, c","d ""q"""\n1,"two\nlines",3\n')).toEqual([
      ['a', 'b, c', 'd "q"'],
      ['1', 'two\nlines', '3'],
    ]);
  });

  it('reads stored and deflated entries from a ZIP archive', () => {
    const zip = makeZip([
      { name: '__MACOSX/._list.csv', data: Buffer.from('junk'), deflate: false },
      { name: 'list.csv', data: Buffer.from('x'.repeat(5000)), deflate: true },
      { name: 'readme.txt', data: Buffer.from('hello'), deflate: false },
    ]);
    expect(readZipEntry(zip, 'list.csv').toString()).toBe('x'.repeat(5000));
    expect(readZipEntry(zip, 'readme.txt').toString()).toBe('hello');
    expect(() => readZipEntry(zip, 'missing.csv')).toThrow(/not found/);
  });

  it('compacts phzmapi all.json to zip → [zone, lat, lon]', () => {
    const out = buildZones({
      source_vintage: '2023',
      zipcodes: {
        '20817': { zone: '7B', coordinates: { lat: 38.996842, lon: -77.13519 } },
        '00601': { zone: '11b', coordinates: { lat: '18.180103', lon: '-66.74947' } },
        bad: { zone: '7a', coordinates: { lat: 1, lon: 2 } },
        '11111': { zone: '', coordinates: { lat: 1, lon: 2 } },
      },
    });
    expect(out.zips).toEqual({ '20817': ['7b', 38.997, -77.135], '00601': ['11b', 18.18, -66.749] });
    expect(out.count).toBe(2);
    expect(out.skipped).toBe(2);
    expect(out.source).toMatch(/not the official USDA map/);
  });

  it('adds zone-only rows for ZIPs only the PRISM ZIP tables list (C12)', () => {
    const prism = parsePrismZipCsv(
      'zipcode,zone,trange,zonetitle\r\n02455,6b,-5 to 0,6b: -5 to 0\r\n20817,7b,5 to 10,7b: 5 to 10\r\n1234,6a,x,x\r\n',
      '\uFEFFzipcode,zone,trange,zonetitle\n99501,5a,-20 to -15,5a: -20 to -15\n02455,9a,,\n',
    );
    expect(prism).toEqual({ '02455': '6b', '20817': '7b', '01234': '6a', '99501': '5a' });
    const out = buildZones({ zipcodes: { '20817': { zone: '7b', coordinates: { lat: 38.996842, lon: -77.13519 } } } }, prism);
    expect(out.zips).toEqual({ '01234': ['6a'], '02455': ['6b'], '20817': ['7b', 38.997, -77.135], '99501': ['5a'] });
    expect(out).toMatchObject({ count: 4, withCentroid: 1, zoneOnly: 3, zoneMismatch: 0 });
    expect(out.source).toMatch(/PRISM ZIP-code tables; not the official USDA map/);
    expect(() => parsePrismZipCsv('zip,zone\n1,2')).toThrow(/zipcode/);
  });

  it('keeps plants only, merges localities per name and collects synonyms', () => {
    const out = buildInvasives(CSV);
    expect(out.sourceRows).toBe(5);
    expect(out.rows).toEqual([
      ['Achillea ptarmica', 'Sneezeweed', '010'],
      ['Berberis thunbergii', 'Japanese barberry', '300'],
      ['Cenchrus setaceus', 'Crimson fountaingrass, purple', '300', 'Pennisetum setaceum'],
      ['Lonicera japonica', 'Japanese honeysuckle', '203'],
    ]);
    expect(out.license).toMatch(/CC0/);
  });

  it('refuses unknown establishment categories', () => {
    expect(() => buildInvasives(`${HEADER}\nL48,Foo bar,,Foo,Species,introduced,mystery,FALSE,Plantae,`)).toThrow(/unknown degreeOfEstablishment/);
  });
});
