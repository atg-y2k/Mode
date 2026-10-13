/**
 * ZIP → USDA hardiness zone + ZIP centroid from the bundled table
 * (public/data/zones.json, derived from phzmapi.org / PRISM 2023 — "not the
 * official USDA map"). The ~1.2 MB table loads lazily once and stays in memory;
 * the service worker caches it for offline use. A ZIP missing from the table
 * falls back to phzmapi.org's per-ZIP file when online (CORS is open).
 */
import { canFetchRelative, fetchDataJson } from './data';
import type { Locality } from './invasives';

export interface ZipInfo {
  zip: string;
  /** e.g. "7a" */
  zone: string;
  lat: number;
  lon: number;
  /** Where the answer came from (the bundled table, or phzmapi.org when the table lacked the ZIP). */
  source?: 'table' | 'online';
}

export type ZipTable = Record<string, [zone: string, lat: number, lon: number]>;

export const ZONE_SOURCE_NOTE = 'Derived from the USDA/OSU PRISM 2023 map; not the official USDA map.';
export const PHZM_ONLINE_URL = (zip: string) => `https://phzmapi.org/${zip}.json`;

let table: ZipTable | null = null;
let loading: Promise<ZipTable | null> | null = null;
const onlineCache = new Map<string, ZipInfo | null>();

/** "20817", "20817-1234", " 20817 " → "20817"; anything else → null. */
export function normalizeZip(zip: string | null | undefined): string | null {
  if (typeof zip !== 'string') return null;
  const m = /^\s*(\d{5})(?:-?\d{4})?\s*$/.exec(zip);
  return m ? m[1] : null;
}

/**
 * Region of a ZIP for regional data (US-RIIS): Alaska 995–999, Hawaii
 * 967–968; other US ZIPs → the lower 48. Null for non-ZIPs.
 */
export function localityForZip(zip: string | null | undefined): Locality | null {
  const z = normalizeZip(zip);
  if (!z) return null;
  const p = Number(z.slice(0, 3));
  if (p >= 995) return 'AK';
  if (p === 967 || p === 968) return 'HI';
  return 'L48';
}

const ZONE_RE = /^(?:[1-9]|1[0-3])[ab]?$/;

/** Validates zones.json ({ zips: { "20817": ["7b", lat, lon] } }) and returns its table. */
export function parseZipTable(json: unknown): ZipTable {
  const zips = (json as { zips?: unknown } | null)?.zips;
  if (!zips || typeof zips !== 'object' || Array.isArray(zips)) throw new Error('zones.json: missing "zips".');
  return zips as ZipTable;
}

/** Installs a table directly (tests or preloading). Null clears it and the online cache. */
export function setZipTable(t: ZipTable | null): void {
  table = t;
  loading = null;
  onlineCache.clear();
}

/** Loads the bundled table once; resolves null when it can't be loaded (a later call retries). */
export function loadZipTable(): Promise<ZipTable | null> {
  if (table) return Promise.resolve(table);
  if (loading) return loading;
  if (!canFetchRelative()) return Promise.resolve(null);
  loading = fetchDataJson('zones.json')
    .then((json) => (table = parseZipTable(json)))
    .catch(() => {
      loading = null;
      return null;
    });
  return loading;
}

/** Synchronous lookup in a table. */
export function zipFromTable(t: ZipTable, zip: string): ZipInfo | null {
  const z = normalizeZip(zip);
  const row = z ? t[z] : undefined;
  if (!z || !Array.isArray(row)) return null;
  const [zone, lat, lon] = row;
  if (typeof zone !== 'string' || !ZONE_RE.test(zone) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { zip: z, zone, lat, lon, source: 'table' };
}

/** Parses phzmapi.org's per-ZIP JSON ({ zone, coordinates: { lat: "38.99", lon: "-77.13" } }). */
export function parsePhzmZip(zip: string, json: unknown): ZipInfo | null {
  const j = json as { zone?: unknown; coordinates?: { lat?: unknown; lon?: unknown } } | null;
  const zone = typeof j?.zone === 'string' ? j.zone.trim().toLowerCase() : '';
  const lat = Number(j?.coordinates?.lat);
  const lon = Number(j?.coordinates?.lon);
  if (!ZONE_RE.test(zone) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { zip, zone, lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, source: 'online' };
}

async function lookupOnline(zip: string, signal?: AbortSignal): Promise<ZipInfo | null> {
  if (onlineCache.has(zip)) return onlineCache.get(zip) ?? null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(PHZM_ONLINE_URL(zip), { signal: controller.signal });
    const info = res.ok ? parsePhzmZip(zip, await res.json()) : null;
    // Only remember definitive answers (a 404 = unknown ZIP), not network failures.
    if (info || res.status === 404) onlineCache.set(zip, info);
    return info;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Looks up a ZIP in the bundled table (fetched lazily once, cached). Null when unknown.
 * `online: false` skips the phzmapi.org fallback (default: only in a browser).
 */
export async function lookupZip(zip: string, opts: { online?: boolean; signal?: AbortSignal } = {}): Promise<ZipInfo | null> {
  const z = normalizeZip(zip);
  if (!z) return null;
  const t = await loadZipTable();
  const hit = t ? zipFromTable(t, z) : null;
  if (hit) return hit;
  const online = opts.online ?? typeof window !== 'undefined';
  return online ? lookupOnline(z, opts.signal) : null;
}
