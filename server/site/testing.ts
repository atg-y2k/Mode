/**
 * Recorded answers of the real services (server/site/fixtures, captured
 * 2026-10-13 from NOAA NCEI, USDA Soil Data Access and EPA) and a fake fetch
 * that replays them, so the parsers are locked to the real formats.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EPA_ECOREGION_URL } from './ecoregion';
import { NOAA_DATA_URL, NOAA_INVENTORY_URL } from './noaa';
import { SDA_URL } from './soil';

export const FIXTURE_DIR = fileURLToPath(new URL('./fixtures', import.meta.url));

export type FixturePoint = 'rockville' | 'manhattan' | 'miami' | 'leadville' | 'offshore';
export const FIXTURE_POINTS = JSON.parse(readFileSync(join(FIXTURE_DIR, 'points.json'), 'utf8')) as Record<
  FixturePoint,
  { lat: number; lon: number; noaaStations: string[] }
>;

export const fixtureText = (name: string): string => readFileSync(join(FIXTURE_DIR, name), 'utf8');
export const fixtureJson = (name: string): unknown => JSON.parse(fixtureText(name));

export interface RecordedCall {
  url: string;
  method: string;
  body: string | null;
}

type Service = 'inventory' | 'noaa' | 'sda' | 'epa';

/**
 * What Soil Data Access serves with HTTP 200 during its daily maintenance
 * window (00:30–00:45 US Central): an HTML page instead of the JSON table.
 */
export const SDA_MAINTENANCE_HTML =
  '<!DOCTYPE html>\n<html><head><title>Soil Data Access - Maintenance</title></head><body><h1>Soil Data Access is temporarily unavailable</h1><p>The service is undergoing scheduled maintenance. Please try again later.</p></body></html>';

export interface FixtureFetchOptions {
  /**
   * Make one service fail: 'throw' = network error, a number = that HTTP
   * status, 'html' = HTTP 200 with an HTML page (SDA maintenance window).
   */
  fail?: Partial<Record<Service, 'throw' | 'html' | number>>;
  /** Answer a service only after this many ms. */
  delayMs?: Partial<Record<Service, number>>;
}

/** Point a request belongs to (by the SDA/EPA coordinates or the first NOAA station asked for). */
function pointFor(url: URL, body: string | null): FixturePoint {
  const entries = Object.entries(FIXTURE_POINTS) as [FixturePoint, (typeof FIXTURE_POINTS)[FixturePoint]][];
  if (url.href.startsWith(NOAA_DATA_URL)) {
    const first = url.searchParams.get('stations')?.split(',')[0];
    const hit = entries.find(([, p]) => p.noaaStations[0] === first);
    if (hit) return hit[0];
    throw new Error(`fixtureFetch: no recorded NOAA answer for stations starting with ${first}`);
  }
  const text = body ?? url.searchParams.get('geometry') ?? '';
  const near = (a: number, b: number) => Math.abs(a - b) < 0.0006;
  const nums = (text.match(/-?\d+\.\d+/g) ?? []).map(Number);
  const hit = entries.find(([, p]) => nums.some((n) => near(n, p.lat)) && nums.some((n) => near(n, p.lon)));
  if (!hit) throw new Error(`fixtureFetch: no recorded answer for ${url.href}`);
  return hit[0];
}

/** A fetch that replays the recorded answers and records every call. */
export function fixtureFetch(opts: FixtureFetchOptions = {}): typeof fetch & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const respond = async (service: Service, make: () => Response): Promise<Response> => {
    const delay = opts.delayMs?.[service];
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const failure = opts.fail?.[service];
    if (failure === 'throw') throw new TypeError('fetch failed');
    if (failure === 'html') return new Response(SDA_MAINTENANCE_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (typeof failure === 'number') return new Response('upstream says no', { status: failure });
    return make();
  };
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url: url.href, method: init?.method ?? 'GET', body });
    // Content types as the live services send them (checked 2026-10-13).
    const json = (text: string, type = 'application/json;charset=utf-8') => new Response(text, { headers: { 'content-type': type } });
    if (url.href === NOAA_INVENTORY_URL) return respond('inventory', () => new Response(fixtureText('noaa-inventory-excerpt.txt'), { headers: { 'content-type': 'text/plain' } }));
    if (url.href.startsWith(NOAA_DATA_URL)) return respond('noaa', () => json(fixtureText(`noaa-normals-${pointFor(url, body)}.json`)));
    if (url.href.startsWith(SDA_URL)) return respond('sda', () => json(fixtureText(`sda-${pointFor(url, body)}.json`), 'application/json; charset=utf-8'));
    if (url.href.startsWith(EPA_ECOREGION_URL)) return respond('epa', () => json(fixtureText(`epa-${pointFor(url, body)}.json`), 'application/json;charset=UTF-8'));
    throw new Error(`fixtureFetch: unexpected request ${url.href}`);
  }) as typeof fetch & { calls: RecordedCall[] };
  fn.calls = calls;
  return fn;
}
