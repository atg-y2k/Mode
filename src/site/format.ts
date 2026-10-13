/**
 * Display helpers for site data (Settings site card, feasibility headers).
 * Pure; tested in node.
 */
import type { ProjectLocation, SiteProfile } from '../../shared/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "04-12" → "Apr 12"; anything unexpected is returned as is. */
export function formatMonthDay(md: string | undefined): string {
  if (!md) return '';
  const m = /^(\d{1,2})[-/](\d{1,2})$/.exec(md.trim());
  if (!m) return md;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return md;
  return `${MONTHS[month - 1]} ${day}`;
}

export interface FrostSummary {
  /** "Apr 12" — median last spring frost. */
  lastFrost: string;
  /** "1 in 10 years: Apr 28" */
  lastFrostLate?: string;
  /** "Oct 21" — median first fall frost. */
  firstFrost: string;
  /** "1 in 10 years: Oct 6" */
  firstFrostEarly?: string;
  /** "~192 frost-free days" */
  season?: string;
  /** "NOAA 1991–2020 normals · ROCKVILLE 1 NE, MD (6 km)" */
  sourceLine: string;
}

export function frostSummary(frost: NonNullable<SiteProfile['frost']>): FrostSummary {
  return {
    lastFrost: formatMonthDay(frost.lastSpring50),
    lastFrostLate: frost.lastSpring90 ? `1 in 10 years: ${formatMonthDay(frost.lastSpring90)}` : undefined,
    firstFrost: formatMonthDay(frost.firstFall50),
    firstFrostEarly: frost.firstFall10 ? `1 in 10 years: ${formatMonthDay(frost.firstFall10)}` : undefined,
    season: frost.freeDays !== undefined ? `~${Math.round(frost.freeDays)} frost-free days` : undefined,
    sourceLine: `NOAA 1991–2020 normals · ${frost.station} (${formatDistanceKm(frost.distanceKm)})`,
  };
}

/** 6.4 → "6 km", 0.4 → "<1 km", 12.6 → "13 km". */
export function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km)) return '';
  return km < 1 ? '<1 km' : `${Math.round(km)} km`;
}

/** Hydrologic soil groups (NRCS): A sandy / fast infiltration … D clay / slow. */
const HYDRO_GROUP_HINT: Record<string, string> = {
  A: 'fast-draining',
  B: 'moderately fast-draining',
  C: 'slow-draining',
  D: 'very slow-draining',
};

/** Facts for the soil card, in reading order. */
export function soilFacts(soil: NonNullable<SiteProfile['soil']>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (soil.drainage) out.push({ label: 'Drainage', value: soil.drainage.charAt(0).toUpperCase() + soil.drainage.slice(1) });
  if (soil.ph !== undefined) out.push({ label: 'Topsoil pH', value: `${soil.ph.toFixed(1)} (${phLabel(soil.ph)})` });
  if (soil.clayPct !== undefined) out.push({ label: 'Clay', value: `${Math.round(soil.clayPct)}%` });
  if (soil.hydroGroup) {
    const g = soil.hydroGroup.trim().toUpperCase();
    const hint = HYDRO_GROUP_HINT[g[0]];
    out.push({ label: 'Hydrologic group', value: hint ? `${g} · ${hint}` : g });
  }
  return out;
}

/** USDA soil pH classes, simplified for gardeners. */
export function phLabel(ph: number): string {
  if (ph < 5.5) return 'strongly acid';
  if (ph < 6.5) return 'acid';
  if (ph <= 7.3) return 'neutral';
  if (ph <= 7.8) return 'slightly alkaline';
  return 'alkaline';
}

/** 38.9968, -77.1352 → "38.997° N, 77.135° W". */
export function formatCoords(lat: number, lon: number): string {
  const f = (v: number) => Math.abs(v).toFixed(3);
  return `${f(lat)}° ${lat >= 0 ? 'N' : 'S'}, ${f(lon)}° ${lon >= 0 ? 'E' : 'W'}`;
}

export const COORDS_SOURCE_LABELS: Record<SiteProfile['coordsSource'], string> = {
  zip: 'ZIP code centre',
  address: 'Exact location',
  'photo-gps': 'Photo GPS',
};

export const ZONE_SOURCE_LABELS: Record<NonNullable<ProjectLocation['zoneSource']>, string> = {
  'zip-table': 'From your ZIP (derived from the USDA/OSU PRISM 2023 map; not the official USDA map)',
  ai: 'From AI — verify it locally',
  user: 'Entered by you',
};

export const DEER_PRESSURE_OPTIONS: { value: NonNullable<ProjectLocation['deerPressure']>; label: string; hint: string }[] = [
  { value: 'low', label: 'Low', hint: 'Rarely see deer — no deer filtering' },
  { value: 'medium', label: 'Medium', hint: 'Deer pass through — deer favorites get a caution' },
  { value: 'high', label: 'High', hint: 'Deer browse here often — prefer plants deer rarely damage' },
];

/** "Deer: high" style label; empty when unknown. */
export function deerPressureLabel(p: ProjectLocation['deerPressure']): string {
  return p ? `Deer: ${p}` : '';
}
