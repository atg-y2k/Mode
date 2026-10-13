/**
 * Site data for plant feasibility, all free & local-first:
 * - ZIP → USDA hardiness zone + centroid from a bundled table (public/data/zones.json,
 *   derived from phzmapi.org / PRISM 2023 — "not the official USDA map");
 * - invasive plant flags from USGS US-RIIS v2.0 (CC0, public/data/invasives.json);
 * - sun hours from SunCalc + facade azimuth (photo EXIF heading or user compass);
 * - photo GPS / heading / time via exifr;
 * - optional site profile through the server (NOAA frost dates, USDA soil) — see server/site;
 * - link-outs to native plant finders and extension databases (no scraping).
 */
import type { PhotoCapture, SiteProfile } from '../../shared/types';

export interface ZipInfo {
  zip: string;
  /** e.g. "7a" */
  zone: string;
  lat: number;
  lon: number;
}

/** Looks up a ZIP in the bundled table (fetched lazily once, cached). Null when unknown. */
export declare function lookupZip(zip: string): Promise<ZipInfo | null>;

/** Reads GPS, compass heading and capture time from an original photo file (before downscaling strips EXIF). */
export declare function readPhotoCapture(file: Blob): Promise<PhotoCapture | undefined>;

/** The photographed facade faces roughly opposite to the camera heading. */
export declare function facadeAzimuthFromHeading(headingDeg: number): number;

/**
 * Estimated direct-sun hours for a surface/yard facing `azimuthDeg` (0 = north,
 * clockwise) at lat/lon on the 15th of `month` (1-12), assuming open sky and a
 * 2-story house shading the side behind it. Classification: ≥ 6 h full sun,
 * 2–6 h part sun, < 2 h shade.
 */
export declare function sunHours(
  lat: number,
  lon: number,
  azimuthDeg: number,
  month: number,
): { hours: number; exposure: 'full-sun' | 'part-sun' | 'shade' };

/** Sun position at a time (degrees): altitude above horizon, azimuth from north clockwise. */
export declare function sunPosition(lat: number, lon: number, date: Date): { altitudeDeg: number; azimuthDeg: number };

/** True when the scientific name (or a synonym / genus+species prefix) is flagged invasive in the lower 48 (US-RIIS). */
export declare function invasiveStatus(botanical: string): Promise<{ invasive: boolean; note?: string } | null>;

/** One-click verification links (open in a new tab; no scraping). */
export declare function plantLinkOuts(opts: { zip?: string; botanical?: string; common?: string }): { label: string; url: string }[];

/** Fetches (via the Mode server) and caches the NOAA frost dates + USDA soil profile for coordinates. */
export declare function fetchSiteProfile(lat: number, lon: number, signal?: AbortSignal): Promise<SiteProfile>;
