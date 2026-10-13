import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { API_PATHS, ApiErrorBodySchema } from '../../shared/api';
import { parseSiteProfile } from '../../src/site/profile';
import { createApp } from '../app';
import { testConfig } from '../config';
import { SiteUpstreamError, createSiteProfileService, type SiteProfileService } from './profile';
import { registerSiteRoutes } from './routes';
import { FIXTURE_POINTS, fixtureFetch } from './testing';

function makeApp(service: SiteProfileService) {
  const app = new Hono();
  registerSiteRoutes(app, { service, log: () => undefined });
  return app;
}

const post = (app: { request: Hono['request'] }, body: unknown, headers: Record<string, string> = {}) =>
  app.request(API_PATHS.siteProfile, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('POST /api/site/profile', () => {
  it('answers a SiteProfile the web client accepts as is', async () => {
    const app = makeApp(createSiteProfileService({ fetch: fixtureFetch(), cacheDir: null, log: () => undefined }));
    const p = FIXTURE_POINTS.rockville;
    const res = await post(app, { lat: p.lat, lon: p.lon, coordsSource: 'address' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.coordsSource).toBe('address');
    // The client's lenient parser keeps every section: nothing malformed.
    expect(parseSiteProfile(json, 'zip')).toEqual(json);
    expect(json).toMatchObject({ frost: { station: 'DALECARLIA RSVR, MD' }, soil: { hydroGroup: 'C' }, ecoregion: 'Northern Piedmont' });
  });

  it('defaults the coordinate source to zip', async () => {
    const app = makeApp(createSiteProfileService({ fetch: fixtureFetch(), cacheDir: null, log: () => undefined }));
    const p = FIXTURE_POINTS.miami;
    const json = (await (await post(app, { lat: p.lat, lon: p.lon })).json()) as Record<string, unknown>;
    expect(json.coordsSource).toBe('zip');
    expect(json.frost).toBeUndefined();
  });

  it('validates the body', async () => {
    const app = makeApp(createSiteProfileService({ fetch: fixtureFetch(), cacheDir: null, log: () => undefined }));
    for (const body of [{}, { lat: 91, lon: 0 }, { lat: 0, lon: -181 }, { lat: '38', lon: -77 }, { lat: 1, lon: 1, coordsSource: 'gps' }]) {
      const res = await post(app, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe('bad_request');
    }
    const notJson = await app.request(API_PATHS.siteProfile, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(notJson.status).toBe(400);
    expect((await app.request(API_PATHS.siteProfile)).status).toBe(405);
  });

  it('answers 502 upstream_error (not 500) when every service is down', async () => {
    const app = makeApp({
      profile: async () => {
        throw new SiteUpstreamError(['a', 'b', 'c']);
      },
      clearMemory: () => undefined,
    });
    const res = await post(app, { lat: 40, lon: -75 });
    expect(res.status).toBe(502);
    const body = ApiErrorBodySchema.parse(await res.json());
    expect(body.error.code).toBe('upstream_error');
    expect(body.error.message).toMatch(/NOAA/);
  });

  it('limits fresh lookups (429 with Retry-After); cached points still answer', async () => {
    const service = createSiteProfileService({ fetch: fixtureFetch(), cacheDir: null, log: () => undefined, lookupLimit: { count: 2, windowMs: 60_000 } });
    const app = makeApp(service);
    const r = FIXTURE_POINTS.rockville;
    const m = FIXTURE_POINTS.manhattan;
    expect((await post(app, { lat: r.lat, lon: r.lon })).status).toBe(200);
    expect((await post(app, { lat: m.lat, lon: m.lon })).status).toBe(200);
    const busy = await post(app, { lat: FIXTURE_POINTS.miami.lat, lon: FIXTURE_POINTS.miami.lon });
    expect(busy.status).toBe(429);
    expect(Number(busy.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(ApiErrorBodySchema.parse(await busy.json()).error.code).toBe('rate_limited');
    expect((await post(app, { lat: r.lat, lon: r.lon })).status).toBe(200);
  });

  it('turns unexpected failures into a generic 500 without details', async () => {
    const logs: string[] = [];
    const app = new Hono();
    registerSiteRoutes(app, {
      service: {
        profile: async () => {
          throw new Error('disk exploded at /secret/path');
        },
        clearMemory: () => undefined,
      },
      log: (l) => logs.push(l),
    });
    const res = await post(app, { lat: 40, lon: -75 });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('/secret/path');
    expect(logs.some((l) => l.includes('disk exploded'))).toBe(true);
  });

  it('sits behind the host app’s access token', async () => {
    const service = createSiteProfileService({ fetch: fixtureFetch(), cacheDir: null, log: () => undefined });
    const app = createApp({
      config: testConfig({ accessToken: 'tok' }),
      claude: null,
      imageProvider: null,
      log: () => undefined,
      extraRoutes: (api) => registerSiteRoutes(api, { service, log: () => undefined }),
    });
    const p = FIXTURE_POINTS.manhattan;
    expect((await post(app, { lat: p.lat, lon: p.lon })).status).toBe(401);
    expect((await post(app, { lat: p.lat, lon: p.lon }, { 'x-mode-token': 'tok' })).status).toBe(200);
  });
});
