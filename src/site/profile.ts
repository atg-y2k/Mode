/**
 * Site profile client: POST /api/site/profile { lat, lon } → SiteProfile
 * (NOAA NCEI 1991–2020 frost dates for the nearest station with freeze
 * probabilities + USDA Soil Data Access summary for the point). The Mode
 * server fetches and caches the government data; this client validates the
 * answer leniently (a missing or malformed section is dropped, not fatal —
 * the server degrades to partial profiles) and caches it per rounded
 * coordinate for the session. The project keeps the result in
 * location.site, which is the durable cache.
 */
import { z } from 'zod';
import { API_PATHS, ApiErrorBodySchema } from '../../shared/api';
import type { SiteProfile } from '../../shared/types';
import { API_TOKEN_HEADER, API_TOKEN_STORAGE_KEY, ApiError } from '../lib/api';

export const SITE_PROFILE_TIMEOUT_MS = 45_000;

const MonthDay = z.string().regex(/^\d{2}-\d{2}$/);
const FrostSchema = z.object({
  station: z.string().min(1),
  distanceKm: z.number().nonnegative(),
  lastSpring50: MonthDay,
  lastSpring90: MonthDay.optional(),
  firstFall50: MonthDay,
  firstFall10: MonthDay.optional(),
  freeDays: z.number().nonnegative().optional(),
});
const SoilSchema = z.object({
  mapUnit: z.string().min(1),
  drainage: z.string().optional(),
  ph: z.number().min(0).max(14).optional(),
  clayPct: z.number().min(0).max(100).optional(),
  hydroGroup: z.string().optional(),
  disturbed: z.boolean().optional(),
});
const COORD_SOURCES = ['zip', 'address', 'photo-gps'] as const;

/** Lenient parse: keeps the valid sections; null when the body isn't an object. */
export function parseSiteProfile(json: unknown, fallbackSource: SiteProfile['coordsSource'] = 'zip'): SiteProfile | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  // Optional fields of a valid section may arrive as null from JSON — treat as absent.
  const dropNulls = (v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)) : v;
  const frost = FrostSchema.safeParse(dropNulls(o.frost));
  const soil = SoilSchema.safeParse(dropNulls(o.soil));
  const source = COORD_SOURCES.find((s) => s === o.coordsSource) ?? fallbackSource;
  const profile: SiteProfile = {
    coordsSource: source,
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now(),
  };
  if (frost.success) profile.frost = frost.data;
  if (soil.success) profile.soil = soil.data;
  if (typeof o.ecoregion === 'string' && o.ecoregion.trim()) profile.ecoregion = o.ecoregion.trim();
  return profile;
}

const cache = new Map<string, SiteProfile>();
/** Coordinates rounded to ~100 m: the soil map unit and nearest station don't change within that. */
const cacheKey = (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

function readToken(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(API_TOKEN_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function messageFor(status: number, body: unknown): ApiError {
  const parsed = ApiErrorBodySchema.safeParse(body);
  if (parsed.success) return new ApiError(parsed.data.error.code, parsed.data.error.message, status);
  if (status === 404) {
    return new ApiError('network', "This Mode server can't look up frost dates and soil yet — update and restart it.", status);
  }
  if (status === 401 || status === 403) {
    return new ApiError('unauthorized', 'The server refused the request. Check the server access token in Settings.', status);
  }
  if (status === 429) return new ApiError('rate_limited', 'Too many requests. Wait a minute and try again.', status);
  return new ApiError('network', `The site lookup failed (HTTP ${status}). Try again later.`, status);
}

/**
 * Fetches (via the Mode server) and caches the NOAA frost dates + USDA soil profile for coordinates.
 * `opts.coordsSource` labels where the coordinates came from (default 'zip'); `opts.force` skips the cache.
 * Throws ApiError (aborted: true when the caller cancelled).
 */
export async function fetchSiteProfile(
  lat: number,
  lon: number,
  signal?: AbortSignal,
  opts: { coordsSource?: SiteProfile['coordsSource']; force?: boolean } = {},
): Promise<SiteProfile> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new ApiError('bad_request', 'Those coordinates are not valid.', 0);
  }
  const source = opts.coordsSource ?? 'zip';
  const key = cacheKey(lat, lon);
  const hit = !opts.force ? cache.get(key) : undefined;
  if (hit) return { ...hit, coordsSource: source };
  if (signal?.aborted) throw new ApiError('network', 'Request cancelled.', 0, { aborted: true });

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SITE_PROFILE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const token = readToken();
  if (token) headers[API_TOKEN_HEADER] = token;

  let res: Response;
  let text: string;
  try {
    res = await fetch(API_PATHS.siteProfile, {
      method: 'POST',
      headers,
      // Rounded like the cache key: enough for the station and the soil map unit, less precise than the address.
      body: JSON.stringify({ lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 }),
      signal: controller.signal,
    });
    text = await res.text();
  } catch {
    if (signal?.aborted) throw new ApiError('network', 'Request cancelled.', 0, { aborted: true });
    if (timedOut) throw new ApiError('network', 'The frost-date and soil services took too long to answer. Try again later.', 0);
    throw new ApiError('network', "Can't reach the Mode server. Check that it's running, then try again.", 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) throw messageFor(res.status, json);
  const profile = parseSiteProfile(json, source);
  if (!profile) throw new ApiError('internal', "The server's site profile wasn't understood. Reload the page and try again.", res.status);
  profile.coordsSource = source;
  // Only cache answers that carry data; an empty profile (services down) should be retried.
  if (profile.frost || profile.soil || profile.ecoregion) cache.set(key, profile);
  return profile;
}

/** Clears the session cache (tests). */
export function clearSiteProfileCache(): void {
  cache.clear();
}
