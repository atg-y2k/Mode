/**
 * Sun position and estimated direct-sun hours from SunCalc (BSD-2).
 *
 * SunCalc v2 (the version bundled here) works in DEGREES with azimuth measured
 * clockwise from NORTH (0 = N, 90 = E, 180 = S, 270 = W) — unlike v1, which
 * used radians from south. Dates are UTC instants.
 *
 * Sun-hours model (an estimate for plant choice, not a shading study):
 * a yard/bed in front of a facade facing azimuth A gets direct sun while the
 * sun is at least ~5° above the horizon (lower sun is blocked by fences,
 * shrubs and neighbours) and within ±90° of A — i.e. in front of the house.
 * When the sun is behind the house, a typical 2-story house shades the yard.
 * Open sky otherwise (no trees or neighbouring buildings).
 */
import { getPosition, getTimes } from 'suncalc';
import type { SunExposure } from '../../shared/types';

/** Sun below this altitude counts as blocked by fences, shrubs and neighbours. */
export const MIN_SUN_ALTITUDE_DEG = 5;
/** Integration step for sunHours. */
export const SUN_STEP_MINUTES = 10;
/** The sun lights a surface while it is within this many degrees of the surface's facing direction. */
export const SUN_HALF_ANGLE_DEG = 90;
/** Reference year for monthly estimates (the sun's path repeats to within minutes year to year). */
export const SUN_REFERENCE_YEAR = 2025;
/** Growing-season months used by seasonalSunHours (April–September). */
export const GROWING_SEASON = [4, 5, 6, 7, 8, 9] as const;

/** Wraps degrees into [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Smallest angle between two compass directions, 0..180. */
export function angularDistance(a: number, b: number): number {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}

/** Sun position at a time (degrees): altitude above horizon, azimuth from north clockwise. */
export function sunPosition(lat: number, lon: number, date: Date): { altitudeDeg: number; azimuthDeg: number } {
  const p = getPosition(date, lat, lon);
  return { altitudeDeg: p.altitude, azimuthDeg: normalizeDeg(p.azimuth) };
}

/** The photographed facade faces roughly opposite to the camera heading. */
export function facadeAzimuthFromHeading(headingDeg: number): number {
  return normalizeDeg(headingDeg + 180);
}

/** True when the sun (azimuth) is in front of a surface facing `facingDeg`. */
export function isSunInFront(sunAzimuthDeg: number, facingDeg: number, halfAngleDeg = SUN_HALF_ANGLE_DEG): boolean {
  return angularDistance(sunAzimuthDeg, facingDeg) <= halfAngleDeg;
}

/** ≥ 6 h full sun, 2–6 h part sun, < 2 h shade. */
export function exposureFromHours(hours: number): SunExposure {
  return hours >= 6 ? 'full-sun' : hours >= 2 ? 'part-sun' : 'shade';
}

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const COMPASS_NAMES: Record<(typeof COMPASS_8)[number], string> = {
  N: 'north',
  NE: 'northeast',
  E: 'east',
  SE: 'southeast',
  S: 'south',
  SW: 'southwest',
  W: 'west',
  NW: 'northwest',
};

/** 0 → "N", 200 → "S", 225 → "SW". */
export function compassPoint(deg: number): (typeof COMPASS_8)[number] {
  return COMPASS_8[Math.round(normalizeDeg(deg) / 45) % 8];
}

/** 0 → "north", 225 → "southwest". */
export function compassName(deg: number): string {
  return COMPASS_NAMES[compassPoint(deg)];
}

export interface SunHoursOptions {
  /** Default SUN_REFERENCE_YEAR. */
  year?: number;
  /** Day of the month, default 15. */
  day?: number;
  minAltitudeDeg?: number;
  halfAngleDeg?: number;
  stepMinutes?: number;
}

function assertFinite(values: Record<string, number>) {
  for (const [k, v] of Object.entries(values)) if (!Number.isFinite(v)) throw new RangeError(`sunHours: ${k} must be a finite number.`);
}

/**
 * Estimated direct-sun hours for a surface/yard facing `azimuthDeg` (0 = north,
 * clockwise) at lat/lon on the 15th of `month` (1-12), assuming open sky and a
 * 2-story house shading the side behind it. Classification: ≥ 6 h full sun,
 * 2–6 h part sun, < 2 h shade. Throws RangeError for non-finite inputs.
 */
export function sunHours(
  lat: number,
  lon: number,
  azimuthDeg: number,
  month: number,
  opts: SunHoursOptions = {},
): { hours: number; exposure: 'full-sun' | 'part-sun' | 'shade' } {
  assertFinite({ lat, lon, azimuthDeg, month });
  const m = Math.min(12, Math.max(1, Math.round(month)));
  const step = Math.max(1, opts.stepMinutes ?? SUN_STEP_MINUTES);
  const minAlt = opts.minAltitudeDeg ?? MIN_SUN_ALTITUDE_DEG;
  const half = opts.halfAngleDeg ?? SUN_HALF_ANGLE_DEG;
  // Local solar midnight ≈ UTC midnight shifted by longitude (15° per hour), so the
  // 24 h window covers one whole solar day wherever the property is.
  const start = Date.UTC(opts.year ?? SUN_REFERENCE_YEAR, m - 1, opts.day ?? 15) - (lon / 15) * 3_600_000;
  const stepMs = step * 60_000;
  const steps = Math.round((24 * 60) / step);
  let lit = 0;
  for (let i = 0; i < steps; i++) {
    // Midpoint sampling: each step stands for the interval around its middle.
    const p = getPosition(new Date(start + (i + 0.5) * stepMs), lat, lon);
    if (p.altitude >= minAlt && angularDistance(p.azimuth, azimuthDeg) <= half) lit++;
  }
  const hours = Math.round(((lit * step) / 60) * 10) / 10;
  return { hours, exposure: exposureFromHours(hours) };
}

/** Average daily direct-sun hours over the growing season (or the given months) plus each month's value. */
export function seasonalSunHours(
  lat: number,
  lon: number,
  azimuthDeg: number,
  months: readonly number[] = GROWING_SEASON,
): { hours: number; exposure: SunExposure; byMonth: { month: number; hours: number }[] } {
  const byMonth = months.map((month) => ({ month, hours: sunHours(lat, lon, azimuthDeg, month).hours }));
  const avg = byMonth.length ? byMonth.reduce((s, x) => s + x.hours, 0) / byMonth.length : 0;
  const hours = Math.round(avg * 10) / 10;
  return { hours, exposure: exposureFromHours(hours), byMonth };
}

/** Sunrise / solar noon / sunset on a date (null at polar day/night). */
export function sunTimes(lat: number, lon: number, date: Date): { sunrise: Date | null; solarNoon: Date; sunset: Date | null } {
  const t = getTimes(date, lat, lon);
  return { sunrise: t.sunrise ?? null, solarNoon: t.solarNoon, sunset: t.sunset ?? null };
}
