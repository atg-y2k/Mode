/**
 * Site data route (shared/api.ts §Site data):
 *
 *   POST /api/site/profile   { lat, lon, coordsSource? } → SiteProfile
 *
 * Frost dates (NOAA NCEI 1991–2020 normals, nearest station with freeze
 * probabilities), soil (USDA Soil Data Access) and the EPA Level III
 * ecoregion, cached per coordinate rounded to 3 decimals in memory and under
 * `.cache/site/`. Upstream hiccups give a partial profile (200); only when
 * every service fails does the route answer 502 upstream_error.
 */
import type { Env, Hono } from 'hono';
import { z } from 'zod';
import { API_PATHS } from '../../shared/api';
import { ApiHttpError } from '../errors';
import { guarded, methodNotAllowed, readJson } from '../handoff/http';
import { defaultSiteCacheDir } from './cache';
import { SiteBusyError, SiteUpstreamError, createSiteProfileService, type SiteProfileService, type SiteServiceOptions } from './profile';

export const SiteProfileRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Where the coordinates came from (echoed in the profile). */
  coordsSource: z.enum(['zip', 'address', 'photo-gps']).optional(),
});

export interface SiteDeps extends SiteServiceOptions {
  /** A ready service (tests); otherwise one is created from the options. */
  service?: SiteProfileService;
}

export function registerSiteRoutes<E extends Env>(app: Hono<E>, deps: SiteDeps = {}): void {
  const log = deps.log ?? ((line: string) => console.log(line));
  const service = deps.service ?? createSiteProfileService({ cacheDir: defaultSiteCacheDir(), ...deps, log });

  app.post(
    API_PATHS.siteProfile,
    guarded<E>(log, 'site', async (c) => {
      const req = await readJson(c, SiteProfileRequestSchema);
      try {
        const profile = await service.profile(req.lat, req.lon, req.coordsSource ?? 'zip');
        c.header('Cache-Control', 'no-store');
        return c.json(profile);
      } catch (err) {
        if (err instanceof SiteBusyError) {
          throw new ApiHttpError('rate_limited', 'Too many frost-date and soil lookups in a short time. Try again in a few minutes.', 429, {
            retryAfterSec: err.retryAfterSec,
          });
        }
        if (err instanceof SiteUpstreamError) {
          throw new ApiHttpError(
            'upstream_error',
            "NOAA and the USDA soil survey aren't responding right now. Try again in a few minutes.",
            502,
          );
        }
        throw err;
      }
    }),
  );
  methodNotAllowed(app, API_PATHS.siteProfile, ['POST']);
}
