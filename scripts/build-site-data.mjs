#!/usr/bin/env node
/**
 * Builds Mode's bundled, offline site data (committed under public/data/):
 *
 *   public/data/zones.json      ZIP → [USDA hardiness zone, centroid lat, centroid lon]
 *                               from phzmapi.org all.json (PRISM 2023 map, MIT code).
 *   public/data/invasives.json  US-RIIS v2.0 plants (USGS, CC0): scientific name, common
 *                               name, status per locality (L48 / AK / HI), synonyms.
 *
 * Usage:
 *   node scripts/build-site-data.mjs                 # download both sources, write both files
 *   node scripts/build-site-data.mjs --only zones    # or --only invasives
 *   node scripts/build-site-data.mjs --phzm ./all.json --riis ./USRIISv2csvFormat.zip
 *                                                    # build from local copies (offline)
 *
 * Needs Node 22+ (global fetch, zlib). No dependencies: the ZIP archive and the
 * CSV are parsed here. Re-run when phzmapi.org or US-RIIS publish a new version
 * and commit the outputs together with public/data/ATTRIBUTION.md.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data');

export const PHZM_URL = 'https://phzmapi.org/all.json';
/** ScienceBase item "United States Register of Introduced and Invasive Species (US-RIIS) (ver. 2.0, November 2022)". */
export const RIIS_ITEM_URL = 'https://www.sciencebase.gov/catalog/item/62d59ae5d34e87fffb2dda99';
/** The item's "USRIISv2csvFormat.zip" file (resolved from the item JSON at build time; this is the fallback). */
const RIIS_CSV_ZIP_FALLBACK =
  'https://www.sciencebase.gov/catalog/file/get/62d59ae5d34e87fffb2dda99?f=__disk__06%2Ff5%2Fb7%2F06f5b79a08d36e997d3f66a9063eab371e314c9a';
const RIIS_MASTER_CSV = 'USRIISv2_MasterList.csv';

/** Coordinates are ZIP centroids: 3 decimals (~110 m) is plenty and keeps the table small. */
const COORD_DECIMALS = 3;

/** US-RIIS degreeOfEstablishment → status code stored in invasives.json. */
export const RIIS_STATUS = {
  'established (category C3)': 1,
  'invasive (category D2)': 2,
  'widespread invasive (category E)': 3,
};
export const LOCALITIES = ['L48', 'AK', 'HI'];

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

async function download(url, what) {
  process.stdout.write(`↓ ${what}: ${url}\n`);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mode site-data builder (personal, offline use)' } });
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} from ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function resolveRiisZipUrl() {
  try {
    const item = JSON.parse((await download(`${RIIS_ITEM_URL}?format=json`, 'US-RIIS item metadata')).toString('utf8'));
    const file = (item.files ?? []).find((f) => /csv/i.test(f.name ?? '') && /\.zip$/i.test(f.name ?? ''));
    if (file?.url) return file.url;
  } catch (err) {
    process.stdout.write(`  (item metadata unavailable: ${err.message}; using the known file URL)\n`);
  }
  return RIIS_CSV_ZIP_FALLBACK;
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader (central directory; stored or deflated entries)
// ---------------------------------------------------------------------------

/** Returns the bytes of the entry whose name ends with `name` (ignores __MACOSX resource forks). */
export function readZipEntry(zip, name) {
  // End of central directory record: scan backwards for its signature.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive (no end-of-central-directory record).');
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.');
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const entryName = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!entryName.endsWith(name) || entryName.includes('__MACOSX')) continue;
    // Local header: its own name/extra lengths may differ from the central directory's.
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const data = zip.subarray(start, start + compressedSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data);
    throw new Error(`Unsupported ZIP compression method ${method} for ${entryName}.`);
  }
  throw new Error(`${name} not found in the archive.`);
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180: quoted fields, doubled quotes, newlines inside quotes)
// ---------------------------------------------------------------------------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

// ---------------------------------------------------------------------------
// Builders (pure; exported for reuse)
// ---------------------------------------------------------------------------

const round = (v) => Math.round(Number(v) * 10 ** COORD_DECIMALS) / 10 ** COORD_DECIMALS;

/** phzmapi.org all.json → { meta…, zips: { "20817": ["7b", 38.997, -77.135] } }. */
export function buildZones(all) {
  const src = all?.zipcodes;
  if (!src || typeof src !== 'object') throw new Error('phzmapi all.json: missing "zipcodes".');
  const zips = {};
  let skipped = 0;
  for (const zip of Object.keys(src).sort()) {
    const e = src[zip];
    const zone = typeof e?.zone === 'string' ? e.zone.trim().toLowerCase() : '';
    const lat = Number(e?.coordinates?.lat);
    const lon = Number(e?.coordinates?.lon);
    if (!/^\d{5}$/.test(zip) || !/^\d{1,2}[ab]?$/.test(zone) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      skipped++;
      continue;
    }
    zips[zip] = [zone, round(lat), round(lon)];
  }
  return {
    source: 'Derived from the USDA/OSU PRISM 2023 Plant Hardiness Zone Map via phzmapi.org; not the official USDA map.',
    sourceUrl: 'https://phzmapi.org/',
    vintage: String(all.source_vintage ?? '2023'),
    upstreamGenerated: all.generated ?? null,
    generated: new Date().toISOString().slice(0, 10),
    format: 'zips[zip] = [zone, lat, lon] (ZIP centroid, WGS84)',
    count: Object.keys(zips).length,
    skipped,
    zips,
  };
}

/** "Other name(s): A; B; too numerous to list" → ["A", "B"]. */
function synonymsOf(remarks) {
  const m = /^Other name\(s\):\s*(.*)$/i.exec((remarks ?? '').trim());
  if (!m) return [];
  return m[1]
    .split(/;\s*/)
    .map((s) => s.trim())
    .filter((s) => s && !/too numerous/i.test(s));
}

/**
 * US-RIIS master list CSV → one row per scientific name (plants only):
 *   [scientificName, commonName, "L48 AK HI status digits", synonyms?]
 * Status digits: 0 = not listed there, 1 = established, 2 = invasive, 3 = widespread invasive.
 */
export function buildInvasives(csvText) {
  const rows = parseCsv(csvText.replace(/^﻿/, '')); // the header's 'locality' carries a UTF-8 BOM
  const header = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`US-RIIS: missing column "${name}".`);
    return i;
  };
  const iLoc = col('locality');
  const iName = col('scientificName');
  const iCommon = col('vernacularName');
  const iDegree = col('degreeOfEstablishment');
  const iKingdom = col('kingdom');
  const iRemarks = col('taxonRemarks');

  /** @type {Map<string, { name: string; common: string; commonLoc: string; status: number[]; synonyms: Set<string> }>} */
  const byName = new Map();
  const unknownDegrees = new Set();
  let plantRows = 0;
  for (const r of rows.slice(1)) {
    if (r[iKingdom] !== 'Plantae') continue;
    plantRows++;
    const name = r[iName].replace(/\s+/g, ' ').trim();
    const loc = r[iLoc].trim();
    const li = LOCALITIES.indexOf(loc);
    if (!name || li < 0) continue;
    const status = RIIS_STATUS[r[iDegree].trim()];
    if (!status) {
      unknownDegrees.add(r[iDegree]);
      continue;
    }
    let e = byName.get(name);
    if (!e) {
      e = { name, common: '', commonLoc: '', status: [0, 0, 0], synonyms: new Set() };
      byName.set(name, e);
    }
    e.status[li] = Math.max(e.status[li], status);
    const common = r[iCommon].trim();
    // Prefer the lower-48 common name (the US-RIIS names differ slightly between localities).
    if (common && (!e.common || (loc === 'L48' && e.commonLoc !== 'L48'))) {
      e.common = common;
      e.commonLoc = loc;
    }
    for (const s of synonymsOf(r[iRemarks])) if (s !== name) e.synonyms.add(s);
  }
  if (unknownDegrees.size) throw new Error(`US-RIIS: unknown degreeOfEstablishment values: ${[...unknownDegrees].join(' | ')}`);

  const out = [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => {
      const row = [e.name, e.common, e.status.join('')];
      if (e.synonyms.size) row.push([...e.synonyms].sort().join('|'));
      return row;
    });
  return {
    source: 'USGS United States Register of Introduced and Invasive Species (US-RIIS) v2.0 (November 2022) — plants only.',
    sourceUrl: RIIS_ITEM_URL,
    license: 'CC0 1.0 (public domain). Simpson et al. (2022), https://doi.org/10.5066/P9KFFTOD',
    generated: new Date().toISOString().slice(0, 10),
    localities: LOCALITIES,
    statusCodes: { 0: 'not listed', 1: 'established (introduced, not invasive)', 2: 'invasive', 3: 'widespread invasive' },
    format: 'rows[i] = [scientificName, commonName, status digits for L48 AK HI, synonyms joined by "|" (optional)]',
    sourceRows: plantRows,
    count: out.length,
    rows: out,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function main() {
  const args = process.argv.slice(2);
  const only = argValue(args, '--only');
  await mkdir(OUT_DIR, { recursive: true });

  if (!only || only === 'zones') {
    const phzmPath = argValue(args, '--phzm');
    const raw = phzmPath ? await readFile(phzmPath) : await download(PHZM_URL, 'phzmapi.org all.json');
    const zones = buildZones(JSON.parse(raw.toString('utf8')));
    if (zones.count < 35_000) throw new Error(`Only ${zones.count} ZIPs — the source looks truncated; not writing zones.json.`);
    const json = JSON.stringify(zones);
    await writeFile(join(OUT_DIR, 'zones.json'), json);
    process.stdout.write(`✓ public/data/zones.json — ${zones.count} ZIPs (${zones.skipped} skipped), ${kb(json.length)}\n`);
  }

  if (!only || only === 'invasives') {
    const riisPath = argValue(args, '--riis');
    const zip = riisPath ? await readFile(riisPath) : await download(await resolveRiisZipUrl(), 'US-RIIS v2.0 CSV archive');
    const csv = readZipEntry(zip, RIIS_MASTER_CSV).toString('utf8');
    const invasives = buildInvasives(csv);
    if (invasives.count < 4_000) throw new Error(`Only ${invasives.count} plant names — the source looks truncated; not writing invasives.json.`);
    const json = JSON.stringify(invasives);
    await writeFile(join(OUT_DIR, 'invasives.json'), json);
    const invasive = invasives.rows.filter((r) => Number(r[2][0]) >= 2).length;
    process.stdout.write(
      `✓ public/data/invasives.json — ${invasives.count} plant names from ${invasives.sourceRows} rows (${invasive} invasive in the lower 48), ${kb(json.length)}\n`,
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`✗ ${err.stack ?? err}\n`);
    process.exit(1);
  });
}
