/**
 * Site profile service: frost dates (NOAA normals), soil (USDA SDA) and the
 * EPA ecoregion for a point, fetched in parallel, merged into a SiteProfile
 * and cached per coordinate rounded to 3 decimals (~100 m — the station
 * choice and the soil map unit don't change within that).
 *
 * - Frost dates come from the bundled station table (server/site/data,
 *   built by scripts/build-frost-data.mjs) — no network; only when it can't
 *   be read does the service fall back to NOAA's station inventory and data
 *   service.
 * - Upstream queries use the rounded point too, so the precise address
 *   never leaves the server and every cache hit is exact.
 * - Answers with frost and soil settled (data or a definite "none") are
 *   cached in memory and on disk (`.cache/site/`, 180 days). If NOAA or SDA
 *   fails, the others still answer (partial profile, kept in memory for 2
 *   minutes so a retry soon asks again); only when every service fails is it
 *   an error (SiteUpstreamError → 502). The ecoregion is optional context:
 *   the answer waits at most ECOREGION_GRACE_MS for it once frost and soil
 *   are in; a late answer still lands in the cache, and a failed one is
 *   retried in the background on a later request (at most hourly).
 * - An HTML page where JSON was expected (SDA's daily maintenance window
 *   answers HTTP 200 with HTML) is such a temporary failure, not "no data".
 * - Concurrent requests for the same point share one lookup, and a lookup
 *   finishes (and fills the cache) even if the asking browser goes away.
 */
import type { SiteProfile } from '../../shared/types';
import { JsonFileCache } from './cache';
import { ecoregionUrl, parseEcoregion } from './ecoregion';
import { FREEZE_TABLE_FILE, loadFreezeTable, type FreezeTable } from './freezeTable';
import {
  MAX_BATCHES,
  NOAA_INVENTORY_URL,
  STATION_BATCH,
  chooseFrostStation,
  frostFreeSection,
  frostSection,
  nearestStations,
  normalsUrl,
  parseNormalsResponse,
  parseStationInventory,
  type FreezeRecord,
  type NormalsStation,
} from './noaa';
import { SDA_URL, parseSdaResponse, soilRequestBody, summarizeSoil } from './soil';

export const SITE_TIMEOUTS_MS = {
  inventory: 25_000,
  normals: 15_000,
  soil: 15_000,
  /** Optional context from an occasionally slow service; answered late in the background (see ECOREGION_GRACE_MS). */
  ecoregion: 10_000,
  /** The web client gives up after 45 s; answer (partially) before that. */
  total: 38_000,
} as const;

export const PROFILE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const PARTIAL_TTL_MS = 2 * 60 * 1000;
/** A cached profile whose (optional) ecoregion failed retries it in the background this often. */
export const ECOREGION_RETRY_MS = 60 * 60 * 1000;
/** How long the answer waits for the ecoregion after frost and soil are in; later answers fill the cache. */
export const ECOREGION_GRACE_MS = 1_000;
/** Fresh (uncached) lookups allowed per window: a house needs one or two; this stops a client from making the server hammer NOAA / USDA. */
export const LOOKUP_LIMIT = { count: 60, windowMs: 10 * 60 * 1000 } as const;
/** Profiles kept in memory (oldest dropped first; the disk cache still has them). */
export const MEMORY_ENTRIES = 1_000;
/** The 1991–2020 inventory is fixed; refresh yearly in case NCEI republishes it. */
export const INVENTORY_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** 2: frost-free spots get a frost section (`frostFree: true`) instead of none. */
const PROFILE_VERSION = 2;
const INVENTORY_VERSION = 1;
const INVENTORY_FILE = `noaa-normals-stations-v${INVENTORY_VERSION}.json`;
const USER_AGENT = 'ModeHomeStudio/1.0 (site profile; local app)';

export type CoordsSource = SiteProfile['coordsSource'];
type Frost = NonNullable<SiteProfile['frost']>;
type Soil = NonNullable<SiteProfile['soil']>;

/** A section's outcome: data, a definite "nothing here", or a failure (not cached). */
export type Section<T> = { status: 'ok'; value: T } | { status: 'none'; note?: string } | { status: 'error'; reason: string };

export type SiteSection = 'frost' | 'soil' | 'ecoregion';

export interface CachedProfile {
  version: number;
  /** "38.997,-77.135" */
  key: string;
  savedAt: number;
  frost?: Frost;
  soil?: Soil;
  ecoregion?: string;
  /** Sections that failed. Profiles with frost or soil failed are never written to disk. */
  failed?: SiteSection[];
  /** Last background attempt to fill a failed ecoregion. */
  ecoregionTriedAt?: number;
}

const durable = (p: CachedProfile) => !p.failed?.some((s) => s === 'frost' || s === 'soil');

/** Too many fresh lookups in a short time (answer 429). */
export class SiteBusyError extends Error {
  constructor(readonly retryAfterSec: number) {
    super('Too many site lookups; try again later.');
    this.name = 'SiteBusyError';
  }
}

/** Every upstream service failed. */
export class SiteUpstreamError extends Error {
  constructor(readonly reasons: string[]) {
    super(`Every site data service failed: ${reasons.join('; ')}`);
    this.name = 'SiteUpstreamError';
  }
}

export interface SiteServiceOptions {
  fetch?: typeof fetch;
  /** Folder for the disk cache; null = memory only. */
  cacheDir?: string | null;
  now?: () => number;
  log?: (line: string) => void;
  timeouts?: Partial<Record<keyof typeof SITE_TIMEOUTS_MS, number>>;
  /** Fresh lookups per window (default LOOKUP_LIMIT). */
  lookupLimit?: { count: number; windowMs: number };
  /**
   * Frost-date station table: omitted = the bundled file, a path = that file,
   * a parsed table = that table, null = none (NOAA's runtime services only).
   */
  freezeTable?: FreezeTable | string | null;
}

export interface SiteProfileService {
  profile(lat: number, lon: number, coordsSource?: CoordsSource): Promise<SiteProfile>;
  /**
   * The profile plus the sections that failed temporarily (upstream down or in
   * maintenance): asking again in a few minutes may fill them.
   */
  profileWithStatus?(lat: number, lon: number, coordsSource?: CoordsSource): Promise<{ profile: SiteProfile; unavailable: SiteSection[] }>;
  /** Drops the memory caches (tests). */
  clearMemory(): void;
}

/** Cache key / upstream point: coordinates rounded to 3 decimals. */
export function roundedPoint(lat: number, lon: number): { lat: number; lon: number; key: string } {
  const r = (v: number) => Math.round(v * 1000) / 1000 + 0; // + 0 turns -0 into 0
  const rl = r(lat);
  const ro = r(lon);
  return { lat: rl, lon: ro, key: `${rl.toFixed(3)},${ro.toFixed(3)}` };
}

class UpstreamError extends Error {}

/**
 * An HTML page where JSON was expected (maintenance or error page served with
 * HTTP 200). JSON content types are trusted; anything else (text/plain, a
 * missing header) is judged by the first non-blank character.
 */
export function looksLikeHtml(contentType: string, body: string): boolean {
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type === 'application/json' || type.endsWith('+json')) return false;
  if (type === 'text/html' || type === 'application/xhtml+xml') return true;
  return body.trimStart().startsWith('<');
}

/** The promise's value if it settles within `ms`, else null (it keeps running). */
async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createSiteProfileService(opts: SiteServiceOptions = {}): SiteProfileService {
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.log(line));
  const timeouts = { ...SITE_TIMEOUTS_MS, ...opts.timeouts };
  const disk = new JsonFileCache(opts.cacheDir ?? null, log);

  const memory = new Map<string, { profile: CachedProfile; expiresAt: number }>();
  /** Map order = recency; the oldest entry goes once the map is full. */
  const remember = (key: string, entry: { profile: CachedProfile; expiresAt: number }) => {
    memory.delete(key);
    memory.set(key, entry);
    if (memory.size > MEMORY_ENTRIES) memory.delete(memory.keys().next().value as string);
  };
  const inflight = new Map<string, Promise<CachedProfile>>();
  const limit = opts.lookupLimit ?? LOOKUP_LIMIT;
  const recentLookups: number[] = [];
  /** Counts one fresh lookup; throws SiteBusyError when over the limit. */
  const takeLookup = () => {
    const t = now();
    while (recentLookups.length && recentLookups[0] <= t - limit.windowMs) recentLookups.shift();
    if (recentLookups.length >= limit.count) {
      throw new SiteBusyError(Math.max(1, Math.ceil((recentLookups[0] + limit.windowMs - t) / 1000)));
    }
    recentLookups.push(t);
  };
  let inventory: Promise<NormalsStation[]> | null = null;

  // ---- bundled frost table (primary source; read once) ------------------------

  let freezeTable: Promise<FreezeTable | null> | null = null;
  const loadTable = (): Promise<FreezeTable | null> => {
    freezeTable ??= (async () => {
      const source = opts.freezeTable === undefined ? FREEZE_TABLE_FILE : opts.freezeTable;
      if (source === null || typeof source !== 'string') return source;
      try {
        return await loadFreezeTable(source);
      } catch (err) {
        log(`[site] bundled frost table unavailable (${err instanceof Error ? err.message : String(err)}); asking NOAA instead`);
        return null;
      }
    })();
    return freezeTable;
  };

  // ---- upstream helpers -----------------------------------------------------

  type GetInit = { method: 'GET' | 'POST'; accept: string; contentType?: string; body?: string };

  const get = async (url: string, init: GetInit, ms: number, total: AbortSignal, what: string): Promise<{ text: string; contentType: string }> => {
    const signal = AbortSignal.any([AbortSignal.timeout(ms), total]);
    const headers: Record<string, string> = { accept: init.accept, 'user-agent': USER_AGENT };
    if (init.contentType) headers['content-type'] = init.contentType;
    let res: Response;
    try {
      res = await doFetch(url, { method: init.method, headers, body: init.body, signal });
    } catch (err) {
      throw new UpstreamError(`${what}: ${signal.aborted ? 'timed out' : err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new UpstreamError(`${what}: HTTP ${res.status}`);
    }
    try {
      return { text: await res.text(), contentType: res.headers.get('content-type') ?? '' };
    } catch {
      throw new UpstreamError(`${what}: ${signal.aborted ? 'timed out' : 'connection dropped'}`);
    }
  };

  /**
   * GET/POST expecting JSON. The content type is checked before parsing: USDA
   * Soil Data Access answers HTTP 200 with an HTML page during its daily
   * maintenance window (00:30–00:45 US Central), and an HTML error page from
   * any service is a temporary failure (partial profile, asked again soon),
   * not "no data here".
   */
  const getJson = async (url: string, init: GetInit, ms: number, total: AbortSignal, what: string): Promise<unknown> => {
    const { text, contentType } = await get(url, init, ms, total, what);
    if (looksLikeHtml(contentType, text)) throw new UpstreamError(`${what}: temporarily unavailable (HTML page instead of data, e.g. maintenance)`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new UpstreamError(`${what}: not JSON`);
    }
  };

  // ---- NOAA station inventory (fetched once, cached on disk) ------------------

  type InventoryFile = { version: number; fetchedAt: number; source: string; stations: [string, number, number, string, string][] };

  const loadInventory = (total: AbortSignal): Promise<NormalsStation[]> => {
    inventory ??= (async () => {
      const cached = await disk.read<InventoryFile>(INVENTORY_FILE);
      const valid = cached?.version === INVENTORY_VERSION && Array.isArray(cached.stations) && cached.stations.length > 0;
      const fromFile = (f: InventoryFile) => f.stations.map(([id, lat, lon, state, name]) => ({ id, lat, lon, state, name }));
      if (valid && now() - cached.fetchedAt < INVENTORY_TTL_MS) return fromFile(cached);
      try {
        const { text } = await get(NOAA_INVENTORY_URL, { method: 'GET', accept: 'text/plain' }, timeouts.inventory, total, 'NOAA station inventory');
        const stations = parseStationInventory(text);
        if (stations.length < 100) throw new UpstreamError('NOAA station inventory: unexpectedly short');
        await disk.write(INVENTORY_FILE, {
          version: INVENTORY_VERSION,
          fetchedAt: now(),
          source: NOAA_INVENTORY_URL,
          stations: stations.map((s) => [s.id, s.lat, s.lon, s.state, s.name]),
        } satisfies InventoryFile);
        return stations;
      } catch (err) {
        if (valid) return fromFile(cached); // stale beats nothing
        throw err;
      }
    })().catch((err: unknown) => {
      inventory = null; // retry on the next request
      throw err;
    });
    return inventory;
  };

  // ---- sections -----------------------------------------------------------------

  const frostFor = async (lat: number, lon: number, total: AbortSignal): Promise<Section<Frost>> => {
    const table = await loadTable();
    if (table) {
      // The table holds exactly the stations the runtime path could pick, so its nearest one is the answer.
      const choice = chooseFrostStation(nearestStations(table.stations, lat, lon), table.records);
      if (choice.kind === 'dates') return { status: 'ok', value: frostSection(choice) };
      if (choice.kind === 'frost-free') return { status: 'ok', value: frostFreeSection(choice) };
      return { status: 'none', note: 'no station with freeze normals within 200 km' };
    }
    const stations = await loadInventory(total);
    const candidates = nearestStations(stations, lat, lon);
    if (candidates.length === 0) return { status: 'none', note: 'no normals station within 200 km' };
    const records = new Map<string, FreezeRecord>();
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const slice = candidates.slice(batch * STATION_BATCH, (batch + 1) * STATION_BATCH);
      if (slice.length === 0) break;
      const json = await getJson(normalsUrl(slice.map((c) => c.station.id)), { method: 'GET', accept: 'application/json' }, timeouts.normals, total, 'NOAA normals');
      if (!Array.isArray(json)) throw new UpstreamError('NOAA normals: unexpected answer');
      for (const [id, record] of parseNormalsResponse(json)) records.set(id, record);
      // Decide only over the stations asked so far (nearest first).
      const choice = chooseFrostStation(candidates.slice(0, (batch + 1) * STATION_BATCH), records);
      if (choice.kind === 'dates') return { status: 'ok', value: frostSection(choice) };
      if (choice.kind === 'frost-free') return { status: 'ok', value: frostFreeSection(choice) };
    }
    return { status: 'none', note: 'no nearby station with freeze normals' };
  };

  const soilFor = async (lat: number, lon: number, total: AbortSignal): Promise<Section<Soil>> => {
    const json = await getJson(
      SDA_URL,
      { method: 'POST', accept: 'application/json', contentType: 'application/json', body: soilRequestBody(lat, lon) },
      timeouts.soil,
      total,
      'USDA Soil Data Access',
    );
    const soil = summarizeSoil(parseSdaResponse(json));
    return soil ? { status: 'ok', value: soil } : { status: 'none', note: 'no soil survey at this point' };
  };

  const ecoregionFor = async (lat: number, lon: number, total: AbortSignal): Promise<Section<string>> => {
    const json = await getJson(ecoregionUrl(lat, lon), { method: 'GET', accept: 'application/json' }, timeouts.ecoregion, total, 'EPA ecoregions');
    const name = parseEcoregion(json);
    return name ? { status: 'ok', value: name } : { status: 'none' };
  };

  const settle = async <T>(what: string, run: () => Promise<Section<T>>): Promise<Section<T>> => {
    try {
      return await run();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log(`[site] ${what} unavailable: ${reason}`);
      return { status: 'error', reason };
    }
  };

  // ---- lookup + caches ------------------------------------------------------------

  /** Merges a late or retried ecoregion answer into the cached profile for `key` (memory, and disk when durable). */
  const applyEcoregion = async (key: string, result: Section<string>): Promise<void> => {
    const entry = memory.get(key);
    if (!entry) return;
    const next: CachedProfile = { ...entry.profile, ecoregionTriedAt: now() };
    if (result.status !== 'error') {
      if (result.status === 'ok') next.ecoregion = result.value;
      else delete next.ecoregion;
      const rest = (next.failed ?? []).filter((s) => s !== 'ecoregion');
      if (rest.length) next.failed = rest;
      else delete next.failed;
    }
    // Disk first: once memory shows the ecoregion, a new process sees it too.
    if (durable(next)) await disk.write(`profile_${key}.json`, next);
    remember(key, { profile: next, expiresAt: entry.expiresAt });
  };

  const lookUp = async (key: string, lat: number, lon: number): Promise<CachedProfile> => {
    const file = `profile_${key}.json`;
    const stored = await disk.read<CachedProfile>(file);
    if (stored && stored.version === PROFILE_VERSION && stored.key === key && durable(stored) && now() - stored.savedAt < PROFILE_TTL_MS) {
      remember(key, { profile: stored, expiresAt: stored.savedAt + PROFILE_TTL_MS });
      return stored;
    }

    takeLookup();
    const total = AbortSignal.timeout(timeouts.total);
    const ecoregionPending = settle('ecoregion', () => ecoregionFor(lat, lon, total));
    const [frost, soil] = await Promise.all([settle('frost dates', () => frostFor(lat, lon, total)), settle('soil', () => soilFor(lat, lon, total))]);
    // The ecoregion is optional: don't hold the answer for it (unless it is all there is).
    const bothFailed = frost.status === 'error' && soil.status === 'error';
    const ecoregion = bothFailed ? await ecoregionPending : await settledWithin(ecoregionPending, ECOREGION_GRACE_MS);
    if (bothFailed && ecoregion?.status === 'error') {
      throw new SiteUpstreamError([frost, soil, ecoregion].map((s) => (s.status === 'error' ? s.reason : '')));
    }

    const profile: CachedProfile = { version: PROFILE_VERSION, key, savedAt: now() };
    if (frost.status === 'ok') profile.frost = frost.value;
    if (soil.status === 'ok') profile.soil = soil.value;
    if (ecoregion?.status === 'ok') profile.ecoregion = ecoregion.value;
    const failed: NonNullable<CachedProfile['failed']> = [];
    if (frost.status === 'error') failed.push('frost');
    if (soil.status === 'error') failed.push('soil');
    // Still pending counts as failed until the late answer arrives (applyEcoregion).
    if (!ecoregion || ecoregion.status === 'error') failed.push('ecoregion');
    if (failed.length > 0) profile.failed = failed;
    if (durable(profile)) {
      remember(key, { profile, expiresAt: now() + PROFILE_TTL_MS });
      await disk.write(file, profile);
    } else {
      remember(key, { profile, expiresAt: now() + PARTIAL_TTL_MS });
    }
    if (!ecoregion) void ecoregionPending.then((late) => applyEcoregion(key, late));
    return profile;
  };

  /** Retries a cached profile's failed ecoregion in the background, at most hourly (never blocks a response). */
  const ecoregionRetries = new Set<string>();
  const maybeRetryEcoregion = (profile: CachedProfile, lat: number, lon: number): void => {
    if (!profile.failed?.includes('ecoregion') || !durable(profile) || ecoregionRetries.has(profile.key) || inflight.has(profile.key)) return;
    if (now() - (profile.ecoregionTriedAt ?? profile.savedAt) < ECOREGION_RETRY_MS) return;
    ecoregionRetries.add(profile.key);
    void settle('ecoregion', () => ecoregionFor(lat, lon, AbortSignal.timeout(timeouts.ecoregion)))
      .then((result) => applyEcoregion(profile.key, result))
      .finally(() => ecoregionRetries.delete(profile.key));
  };

  const profileWithStatus = async (
    lat: number,
    lon: number,
    coordsSource: CoordsSource = 'zip',
  ): Promise<{ profile: SiteProfile; unavailable: SiteSection[] }> => {
    const point = roundedPoint(lat, lon);
    const hit = memory.get(point.key);
    let cached: CachedProfile;
    if (hit && hit.expiresAt > now()) {
      remember(point.key, hit); // most recently used
      cached = hit.profile;
    } else {
      let pending = inflight.get(point.key);
      if (!pending) {
        pending = lookUp(point.key, point.lat, point.lon).finally(() => inflight.delete(point.key));
        inflight.set(point.key, pending);
      }
      cached = await pending;
    }
    maybeRetryEcoregion(cached, point.lat, point.lon);
    const out: SiteProfile = { coordsSource, updatedAt: cached.savedAt };
    if (cached.frost) out.frost = { ...cached.frost };
    if (cached.soil) out.soil = { ...cached.soil };
    if (cached.ecoregion) out.ecoregion = cached.ecoregion;
    return { profile: out, unavailable: [...(cached.failed ?? [])] };
  };

  return {
    async profile(lat, lon, coordsSource = 'zip') {
      return (await profileWithStatus(lat, lon, coordsSource)).profile;
    },
    profileWithStatus,
    clearMemory() {
      memory.clear();
      inventory = null;
    },
  };
}
