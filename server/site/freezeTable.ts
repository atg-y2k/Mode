/**
 * The bundled NOAA freeze-date station table (server/site/data/
 * noaa-freeze-stations.json, built by scripts/build-frost-data.mjs from the
 * NCEI 1991–2020 normals archive): the primary source of frost dates, so a
 * site profile needs no NOAA request and works offline. The runtime path
 * (station inventory + NCEI data service, profile.ts) is the fallback when
 * the table is missing or unreadable.
 *
 * The table holds only stations the runtime path could pick (dates, or
 * frost-free); stations without freeze normals or too cold to compute dates
 * are left out, so "nearest station in the table" = the runtime choice.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { formatStationName, type FreezeRecord, type NormalsStation } from './noaa';

export const FREEZE_TABLE_FILE = fileURLToPath(new URL('./data/noaa-freeze-stations.json', import.meta.url));

export interface FreezeTable {
  stations: NormalsStation[];
  /** By station id (every station has one). */
  records: Map<string, FreezeRecord>;
  source: string;
}

/** Thrown for a table file that isn't the expected format. */
export class FreezeTableFormatError extends Error {}

const MONTH_DAY = /^\d{2}-\d{2}$/;
const ROW_FIELDS = ['id', 'lat', 'lon', 'name', 'lastSpring50', 'lastSpring90', 'firstFall50', 'firstFall10', 'freeDays'];

const date = (v: unknown): string | null => (typeof v === 'string' && MONTH_DAY.test(v) ? v : null);

/** Validates the JSON document; malformed rows are skipped, a malformed document throws. */
export function parseFreezeTable(json: unknown): FreezeTable {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new FreezeTableFormatError('freeze table: not an object');
  const doc = json as { version?: unknown; fields?: unknown; stations?: unknown; source?: unknown };
  if (doc.version !== 1 || !Array.isArray(doc.stations)) throw new FreezeTableFormatError('freeze table: unknown version');
  if (!Array.isArray(doc.fields) || doc.fields.join(',') !== ROW_FIELDS.join(',')) throw new FreezeTableFormatError('freeze table: unexpected row layout');
  const stations: NormalsStation[] = [];
  const records = new Map<string, FreezeRecord>();
  for (const row of doc.stations as unknown[]) {
    if (!Array.isArray(row) || row.length !== ROW_FIELDS.length) continue;
    const [id, lat, lon, rawName, lastSpring50, lastSpring90, firstFall50, firstFall10, freeDays] = row as unknown[];
    if (typeof id !== 'string' || !id || typeof lat !== 'number' || typeof lon !== 'number' || records.has(id)) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const name = formatStationName(rawName);
    const record: FreezeRecord = {
      id,
      name,
      hasFields: true,
      lastSpring50: date(lastSpring50),
      lastSpringLate: date(lastSpring90),
      firstFall50: date(firstFall50),
      firstFallEarly: date(firstFall10),
      seasonDays: typeof freeDays === 'number' && Number.isFinite(freeDays) && freeDays >= 0 && freeDays <= 366 ? Math.round(freeDays) : null,
    };
    // Only usable rows: dates, or frost-free (season 365).
    const usable = (record.lastSpring50 && record.firstFall50) || (record.seasonDays !== null && record.seasonDays >= 365);
    if (!usable) continue;
    // The state isn't needed: the record's name ("DALECARLIA RSVR, MD") is what gets shown.
    stations.push({ id, lat, lon, state: '', name: name ?? id });
    records.set(id, record);
  }
  if (stations.length === 0) throw new FreezeTableFormatError('freeze table: no stations');
  return { stations, records, source: typeof doc.source === 'string' ? doc.source : '' };
}

/** Reads and parses the bundled table (throws when missing or malformed). */
export async function loadFreezeTable(file: string = FREEZE_TABLE_FILE): Promise<FreezeTable> {
  return parseFreezeTable(JSON.parse(await readFile(file, 'utf8')) as unknown);
}
