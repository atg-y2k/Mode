/**
 * NOAA NCEI U.S. Climate Normals 1991–2020: frost (32 °F freeze) dates for
 * the nearest station that has freeze-probability normals.
 *
 * Data (public domain, no key):
 * - Station inventory: inventory_30yr.txt (every 1991–2020 normals station
 *   with coordinates, ~1.3 MB fixed-width text). Fetched once and cached on
 *   disk as compact JSON. CoCoRaHS precipitation-only stations (IDs "US1…")
 *   are dropped: they never have temperature normals.
 * - Freeze probabilities: the NCEI data access service, dataset
 *   normals-annualseasonal-1991-2020, queried for the nearest candidate
 *   stations at once. Stations without temperature normals come back without
 *   the PRB* fields, so "has the fields" is decided by the answer itself.
 *
 * Field meanings (NCEI readme, "ANN-TMIN-PRBLST-T32FP10 = earliest date by
 * which …"): PRBLST-T32FPnn is the date after which the LAST spring freeze
 * occurs with probability nn %, PRBFST-T32FPnn the date before which the
 * FIRST fall freeze occurs with probability nn %. So:
 *   lastSpring50 = PRBLST FP50 (median last frost)
 *   lastSpring90 = PRBLST FP10 (only 1 year in 10 has a frost after it — "90 % safe")
 *   firstFall50  = PRBFST FP50 (median first frost)
 *   firstFall10  = PRBFST FP10 (1 year in 10 has a frost before it)
 *   freeDays     = PRBGSL FP50 (median freeze-free season length, days)
 * Special values (-9999 etc.) mean "not computable": either no freeze in most
 * years (season ≥ 365 days → a frost-free climate) or freezes possible in any
 * month (mountain tops). A frost-free nearest station means the spot has no
 * frost dates; a too-cold station is skipped in favour of the next one.
 */
import type { SiteProfile } from '../../shared/types';

export const NOAA_INVENTORY_URL = 'https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/doc/inventory_30yr.txt';
export const NOAA_DATA_URL = 'https://www.ncei.noaa.gov/access/services/data/v1';
export const NORMALS_DATASET = 'normals-annualseasonal-1991-2020';

export const FREEZE_FIELDS = {
  lastSpring50: 'ANN-TMIN-PRBLST-T32FP50',
  lastSpringLate: 'ANN-TMIN-PRBLST-T32FP10',
  firstFall50: 'ANN-TMIN-PRBFST-T32FP50',
  firstFallEarly: 'ANN-TMIN-PRBFST-T32FP10',
  season50: 'ANN-TMIN-PRBGSL-T32FP50',
} as const;

/** Stations farther than this aren't representative of the spot. */
export const MAX_STATION_KM = 200;
/** Candidate stations asked for per request, and how many requests at most. */
export const STATION_BATCH = 25;
export const MAX_BATCHES = 3;

export interface NormalsStation {
  id: string;
  lat: number;
  lon: number;
  /** Two-letter state / province code ("" when none). */
  state: string;
  name: string;
}

/** Freeze normals of one station as read from the data service. */
export interface FreezeRecord {
  id: string;
  /** "ROCKVILLE 1 NE, MD" */
  name: string | null;
  /** Whether the station has freeze-probability normals at all. */
  hasFields: boolean;
  lastSpring50: string | null;
  lastSpringLate: string | null;
  firstFall50: string | null;
  firstFallEarly: string | null;
  seasonDays: number | null;
}

export type FrostChoice =
  | { kind: 'dates'; station: NormalsStation; km: number; record: FreezeRecord }
  | { kind: 'frost-free'; station: NormalsStation; km: number; record: FreezeRecord }
  | { kind: 'none' };

/**
 * Parses inventory_30yr.txt (GHCN fixed-width: ID 1–11, LAT 13–20, LON 22–30,
 * ELEV 32–37, STATE 39–40, NAME 42–71). Skips malformed lines and the
 * precipitation-only CoCoRaHS stations.
 */
export function parseStationInventory(text: string): NormalsStation[] {
  const out: NormalsStation[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length < 30) continue;
    const id = line.slice(0, 11).trim();
    if (!/^[A-Z0-9]{11}$/.test(id) || id.startsWith('US1')) continue;
    const lat = Number(line.slice(12, 20));
    const lon = Number(line.slice(21, 30));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const state = line.slice(38, 40).trim();
    const name = line.slice(41, 71).trim();
    out.push({ id, lat, lon, state: /^[A-Z]{2}$/.test(state) ? state : '', name });
  }
  return out;
}

const EARTH_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Stations within `maxKm`, nearest first. */
export function nearestStations(
  stations: readonly NormalsStation[],
  lat: number,
  lon: number,
  maxKm = MAX_STATION_KM,
): { station: NormalsStation; km: number }[] {
  // Cheap bounding-box prefilter before the trigonometry.
  const dLat = maxKm / 111;
  const dLon = maxKm / (111 * Math.max(0.05, Math.cos(rad(lat))));
  const out: { station: NormalsStation; km: number }[] = [];
  for (const station of stations) {
    if (Math.abs(station.lat - lat) > dLat) continue;
    const lonGap = Math.abs(((station.lon - lon + 540) % 360) - 180);
    if (lonGap > dLon) continue;
    const km = distanceKm(lat, lon, station.lat, station.lon);
    if (km <= maxKm) out.push({ station, km });
  }
  return out.sort((a, b) => a.km - b.km || a.station.id.localeCompare(b.station.id));
}

/** The data-service URL for freeze normals of `stationIds`. */
export function normalsUrl(stationIds: readonly string[]): string {
  const params = new URLSearchParams({
    dataset: NORMALS_DATASET,
    stations: stationIds.join(','),
    dataTypes: Object.values(FREEZE_FIELDS).join(','),
    format: 'json',
    includeStationName: 'true',
  });
  return `${NOAA_DATA_URL}?${params.toString()}`;
}

/** "   04/01" → "04-01"; special values (-9999.0 …) and nonsense → null. */
export function parseMonthDay(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^\s*(\d{1,2})\/(\d{1,2})\s*$/.exec(raw);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDays(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 366 ? Math.round(n) : null;
}

/** "ROCKVILLE 1 NE, MD US" → "ROCKVILLE 1 NE, MD". */
export function formatStationName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ').replace(/,? US$/, '');
  return name || null;
}

/** Parses the data service's JSON array into records keyed by station id (unexpected shapes → empty). */
export function parseNormalsResponse(json: unknown): Map<string, FreezeRecord> {
  const out = new Map<string, FreezeRecord>();
  if (!Array.isArray(json)) return out;
  for (const row of json) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.STATION === 'string' ? r.STATION.trim() : '';
    if (!id) continue;
    const hasFields = FREEZE_FIELDS.lastSpring50 in r && FREEZE_FIELDS.firstFall50 in r;
    out.set(id, {
      id,
      name: formatStationName(r.NAME),
      hasFields,
      lastSpring50: parseMonthDay(r[FREEZE_FIELDS.lastSpring50]),
      lastSpringLate: parseMonthDay(r[FREEZE_FIELDS.lastSpringLate]),
      firstFall50: parseMonthDay(r[FREEZE_FIELDS.firstFall50]),
      firstFallEarly: parseMonthDay(r[FREEZE_FIELDS.firstFallEarly]),
      seasonDays: parseDays(r[FREEZE_FIELDS.season50]),
    });
  }
  return out;
}

/**
 * Picks the station whose frost dates represent the spot: the nearest one
 * with freeze normals. Its dates are used; if it is frost-free (no freeze in
 * most years) the spot gets no frost dates; a station too cold to compute
 * dates (freezes in any month) is skipped. `candidates` must be nearest first
 * and `records` must cover every candidate passed (missing = no normals).
 */
export function chooseFrostStation(
  candidates: readonly { station: NormalsStation; km: number }[],
  records: ReadonlyMap<string, FreezeRecord>,
): FrostChoice {
  for (const { station, km } of candidates) {
    const record = records.get(station.id);
    if (!record?.hasFields) continue;
    if (record.lastSpring50 && record.firstFall50) return { kind: 'dates', station, km, record };
    if (record.seasonDays !== null && record.seasonDays >= 365) return { kind: 'frost-free', station, km, record };
    // Too cold to compute (or incomplete): the next station decides.
  }
  return { kind: 'none' };
}

/** SiteProfile.frost for a chosen station. */
export function frostSection(choice: Extract<FrostChoice, { kind: 'dates' }>): NonNullable<SiteProfile['frost']> {
  const { station, km, record } = choice;
  const frost: NonNullable<SiteProfile['frost']> = {
    station: record.name ?? (station.state ? `${station.name}, ${station.state}` : station.name),
    distanceKm: Math.round(km * 10) / 10,
    lastSpring50: record.lastSpring50 as string,
    firstFall50: record.firstFall50 as string,
  };
  if (record.lastSpringLate) frost.lastSpring90 = record.lastSpringLate;
  if (record.firstFallEarly) frost.firstFall10 = record.firstFallEarly;
  if (record.seasonDays !== null) frost.freeDays = record.seasonDays;
  return frost;
}
