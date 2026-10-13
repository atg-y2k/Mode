/**
 * Site data for plant feasibility, all free & local-first:
 * - ZIP → USDA hardiness zone + centroid from a bundled table (public/data/zones.json,
 *   derived from phzmapi.org / PRISM 2023 — "not the official USDA map");
 * - invasive plant flags from USGS US-RIIS v2.0 (CC0, public/data/invasives.json);
 * - sun hours from SunCalc + facade azimuth (photo EXIF heading or user compass);
 * - photo GPS / heading / time via exifr;
 * - optional site profile through the server (NOAA frost dates, USDA soil) — see server/site;
 * - link-outs to native plant finders and extension databases (no scraping).
 *
 * Implementation lives in the sibling modules (zip, invasives, sun, capture,
 * links, profile, format); this file is the public surface.
 */

/** Looks up a ZIP in the bundled table (fetched lazily once, cached). Null when unknown. */
export { lookupZip, normalizeZip, localityForZip, loadZipTable, ZONE_SOURCE_NOTE, type ZipInfo } from './zip';

/** Reads GPS, compass heading and capture time from an original photo file (before downscaling strips EXIF). */
export { readPhotoCapture, captureFromTags } from './capture';

/**
 * facadeAzimuthFromHeading: the photographed facade faces roughly opposite to the camera heading.
 *
 * sunHours: estimated direct-sun hours for a surface/yard facing `azimuthDeg` (0 = north,
 * clockwise) at lat/lon on the 15th of `month` (1-12), assuming open sky and a
 * 2-story house shading the side behind it. Classification: ≥ 6 h full sun,
 * 2–6 h part sun, < 2 h shade.
 *
 * sunPosition: sun position at a time (degrees): altitude above horizon, azimuth from north clockwise.
 */
export {
  facadeAzimuthFromHeading,
  sunHours,
  sunPosition,
  seasonalSunHours,
  sunTimes,
  exposureFromHours,
  isSunInFront,
  angularDistance,
  normalizeDeg,
  compassPoint,
  compassName,
  GROWING_SEASON,
  MIN_SUN_ALTITUDE_DEG,
  type SunHoursOptions,
} from './sun';

/** invasiveStatus: true when the scientific name (or a synonym / genus+species prefix) is flagged invasive in the lower 48 (US-RIIS). */
export {
  invasiveStatus,
  invasiveStatusSync,
  findInvasive,
  describeInvasive,
  loadInvasives,
  invasivesReady,
  onInvasivesLoaded,
  parseBotanical,
  splitBotanicalNames,
  LOCALITY_NAMES,
  RIIS_SOURCE,
  type InvasiveMatch,
  type InvasiveVerdict,
  type Locality,
  type RiisLevel,
} from './invasives';

/** One-click verification links (open in a new tab; no scraping). */
export { plantLinkOuts, plantLinks, type LinkOut } from './links';

/** Fetches (via the Mode server) and caches the NOAA frost dates + USDA soil profile for coordinates. */
export { fetchSiteProfile, parseSiteProfile } from './profile';

export {
  formatMonthDay,
  frostSummary,
  soilFacts,
  formatCoords,
  COORDS_SOURCE_LABELS,
  ZONE_SOURCE_LABELS,
  DEER_PRESSURE_OPTIONS,
  deerPressureLabel,
  type FrostSummary,
} from './format';
