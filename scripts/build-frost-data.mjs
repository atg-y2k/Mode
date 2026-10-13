#!/usr/bin/env node
/**
 * Builds Mode's bundled frost-date table (committed under server/site/data/):
 *
 *   server/site/data/noaa-freeze-stations.json
 *     Every NOAA NCEI U.S. Climate Normals 1991–2020 station whose 32 °F
 *     freeze probabilities give the server an answer: median last spring /
 *     first fall freeze, the 1-in-10-years dates and the median freeze-free
 *     season, or "frost-free" (no freeze in a typical year: dates not
 *     computable, season 365 days). Stations without freeze normals, and
 *     stations too cold to compute dates (freezes possible in any month), are
 *     left out — the server skips them anyway and uses the next nearest one.
 *
 * Source (public domain, no key): the by-station annual/seasonal archive
 * (~54 MB tar.gz of ~15,600 CSV files, ~570 MB unpacked — streamed, never
 * written to disk). The server (server/site/profile.ts) uses this table
 * first and only falls back to its runtime path (station inventory + the NCEI
 * data service) when the table is missing or unreadable.
 *
 * Usage:
 *   node scripts/build-frost-data.mjs                          # download, write the table
 *   node scripts/build-frost-data.mjs --archive ./normals.tar.gz   # build from a local copy
 *
 * Needs Node 22+ (global fetch, zlib streams). No dependencies. Re-run when
 * NCEI republishes the 1991–2020 normals (or for the 2001–2030 normals).
 */
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createGunzip, gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_FILE = join(ROOT, 'server', 'site', 'data', 'noaa-freeze-stations.json');

export const NORMALS_ARCHIVE_URL =
  'https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/archive/us-climate-normals_1991-2020_v1.0.1_annualseasonal_multivariate_by-station_c20230404.tar.gz';

/** CSV columns read (same fields the server asks the data service for). */
export const FIELDS = {
  lastSpring50: 'ANN-TMIN-PRBLST-T32FP50',
  lastSpringLate: 'ANN-TMIN-PRBLST-T32FP10',
  firstFall50: 'ANN-TMIN-PRBFST-T32FP50',
  firstFallEarly: 'ANN-TMIN-PRBFST-T32FP10',
  season50: 'ANN-TMIN-PRBGSL-T32FP50',
};

/** Row layout of `stations` in the output. */
export const ROW_FIELDS = ['id', 'lat', 'lon', 'name', 'lastSpring50', 'lastSpring90', 'firstFall50', 'firstFall10', 'freeDays'];

/** Station coordinates: 4 decimals (~10 m) is what NCEI publishes. */
const COORD_DECIMALS = 4;

// ---------------------------------------------------------------------------
// tar (ustar / GNU): 512-byte headers, data padded to 512 bytes
// ---------------------------------------------------------------------------

function octal(buf, start, length) {
  const text = buf.toString('latin1', start, start + length).replace(/\0.*$/, '').trim();
  return text ? parseInt(text, 8) : 0;
}

/**
 * Yields { name, data } for every regular file in a tar byte stream (an async
 * iterable of Buffers). Files are buffered one at a time.
 */
export async function* readTar(chunks) {
  let buffer = Buffer.alloc(0);
  let pending = null; // { name, size, padded }
  let longName = null;
  for await (const chunk of chunks) {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
    for (;;) {
      if (!pending) {
        if (buffer.length < 512) break;
        const header = buffer.subarray(0, 512);
        buffer = buffer.subarray(512);
        if (header.every((b) => b === 0)) continue; // end-of-archive blocks
        const size = octal(header, 124, 12);
        const type = String.fromCharCode(header[156] || 48);
        const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '');
        const base = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
        const name = longName ?? (prefix ? `${prefix}/${base}` : base);
        longName = null;
        pending = { name, size, type, padded: Math.ceil(size / 512) * 512 };
      }
      if (buffer.length < pending.padded) break;
      const data = buffer.subarray(0, pending.size);
      buffer = buffer.subarray(pending.padded);
      const { name, type } = pending;
      pending = null;
      if (type === 'L') longName = data.toString('utf8').replace(/\0.*$/, '');
      else if (type === '0' || type === '7') yield { name, data: Buffer.from(data) };
    }
  }
}

// ---------------------------------------------------------------------------
// Station CSV (header row + one data row; quoted fields contain commas)
// ---------------------------------------------------------------------------

export function parseCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

/** "   04/09" → "04-09"; -9999 and other special values → null. */
export function monthDay(raw) {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\s*$/.exec(raw ?? '');
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function days(raw) {
  const n = Number(raw);
  return raw != null && String(raw).trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 366 ? Math.round(n) : null;
}

/**
 * One station's table row, or null when the server could not use it (no
 * freeze normals, too cold to compute dates, incomplete).
 *   dates:      [id, lat, lon, name, lastSpring50, lastSpring90, firstFall50, firstFall10, freeDays]
 *   frost-free: [id, lat, lon, name, null, null, null, null, 365]
 */
export function stationRow(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const header = parseCsvLine(lines[0]);
  const values = parseCsvLine(lines[1]);
  const get = (name) => {
    const i = header.indexOf(name);
    return i >= 0 ? values[i] : undefined;
  };
  if (get(FIELDS.lastSpring50) === undefined || get(FIELDS.firstFall50) === undefined) return null;
  const id = (get('STATION') ?? '').trim();
  const lat = Number(get('LATITUDE'));
  const lon = Number(get('LONGITUDE'));
  if (!/^[A-Z0-9]{11}$/.test(id) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const name = (get('NAME') ?? '').trim().replace(/\s+/g, ' ');
  const round = (v) => Math.round(v * 10 ** COORD_DECIMALS) / 10 ** COORD_DECIMALS;
  const lastSpring50 = monthDay(get(FIELDS.lastSpring50));
  const firstFall50 = monthDay(get(FIELDS.firstFall50));
  const season = days(get(FIELDS.season50));
  if (lastSpring50 && firstFall50) {
    return [id, round(lat), round(lon), name, lastSpring50, monthDay(get(FIELDS.lastSpringLate)), firstFall50, monthDay(get(FIELDS.firstFallEarly)), season];
  }
  if (season !== null && season >= 365) return [id, round(lat), round(lon), name, null, null, null, null, 365];
  return null; // too cold to compute (freezes in any month) or incomplete
}

/** The output document from `{ name, data }` CSV entries. */
export async function buildFreezeTable(entries) {
  const stations = [];
  let files = 0;
  for await (const { name, data } of entries) {
    if (!name.toLowerCase().endsWith('.csv')) continue;
    files++;
    const row = stationRow(data.toString('utf8'));
    if (row) stations.push(row);
  }
  stations.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    version: 1,
    source: NORMALS_ARCHIVE_URL,
    license: 'NOAA NCEI U.S. Climate Normals 1991–2020 — U.S. Government work, public domain',
    fields: ROW_FIELDS,
    notes:
      'lastSpring90 = PRBLST-T32FP10 (1 year in 10 has a 32 °F freeze after it); firstFall10 = PRBFST-T32FP10 (1 year in 10 before it); freeDays = PRBGSL-T32FP50. Frost-free stations have null dates and freeDays 365.',
    files,
    count: stations.length,
    frostFree: stations.filter((r) => r[4] === null).length,
    stations,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const archive = argValue(process.argv.slice(2), '--archive');
  let source;
  if (archive) {
    source = createReadStream(archive);
  } else {
    process.stdout.write(`↓ NCEI normals archive: ${NORMALS_ARCHIVE_URL}\n`);
    const res = await fetch(NORMALS_ARCHIVE_URL, { headers: { 'User-Agent': 'Mode frost-data builder (personal, offline use)' } });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} from ${NORMALS_ARCHIVE_URL}`);
    source = Readable.fromWeb(res.body);
  }
  const table = await buildFreezeTable(readTar(source.pipe(createGunzip())));
  if (table.files < 10_000 || table.count < 5_000) {
    throw new Error(`Only ${table.count} usable stations in ${table.files} files — the archive looks truncated; not writing the table.`);
  }
  const json = JSON.stringify(table);
  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, json);
  process.stdout.write(
    `✓ server/site/data/noaa-freeze-stations.json — ${table.count} stations (${table.frostFree} frost-free) from ${table.files} files, ` +
      `${(json.length / 1024).toFixed(0)} KB (${(gzipSync(json).length / 1024).toFixed(0)} KB gzipped)\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`✗ ${err.stack ?? err}\n`);
    process.exit(1);
  });
}
