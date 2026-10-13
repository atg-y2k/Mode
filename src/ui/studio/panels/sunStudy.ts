/**
 * Sun & orientation study for the Scene panel (borrowed from iScape's sun
 * slider), on top of src/site's SunCalc helpers:
 *
 * - which way the photographed side faces: the user's compass, else the
 *   photo's EXIF compass heading, else the AI's estimate (stored azimuth or
 *   its "faces south-east" orientation text);
 * - which side of each ground zone faces where — areas beside the house in a
 *   street view are side yards, facing 90° off the facade;
 * - estimated direct-sun hours per zone over the growing season (and for a
 *   chosen month), with SunCalc's open-sky model;
 * - the sun's position for a month and time, the house faces it lights, and
 *   the shadow the house casts — for the plan diagram.
 *
 * Pure (the time zone offset is a parameter); unit-tested.
 */
import type { PhotoCapture, SceneMap, SceneZone, SunExposure, ZoneKind } from '../../../../shared/types';
import { GROWING_SEASON, angularDistance, compassName, exposureFromHours, facadeAzimuthFromHeading, normalizeDeg, sunHours, sunPosition } from '../../../site';
import { GROUND_ZONE_KINDS, isDesignZone } from './zones';

// ---------------------------------------------------------------------------
// Which way the photo faces
// ---------------------------------------------------------------------------

/** Zone kinds that mean the photo looks at the house (a street view of the facade). */
const HOUSE_KINDS: readonly ZoneKind[] = ['facade', 'roof', 'front-door', 'garage-door', 'windows', 'porch', 'columns', 'trim'];

/** True when the photo shows the house itself (the camera looks at a facade), false for a yard seen from the house. */
export function looksAtHouse(scene: Pick<SceneMap, 'zones'> | undefined): boolean {
  return !!scene?.zones.some((z) => HOUSE_KINDS.includes(z.kind));
}

/**
 * Direction the photographed side faces, from the camera heading: a facade
 * faces the camera (opposite the heading); a yard photographed from the house
 * extends the way the camera looks.
 */
export function facingFromHeading(headingDeg: number, atHouse: boolean): number {
  return atHouse ? facadeAzimuthFromHeading(headingDeg) : normalizeDeg(headingDeg);
}

const COMPASS_WORDS: { re: RegExp; deg: number }[] = [
  { re: /\bnorth[\s-]?east\b|\bne\b/g, deg: 45 },
  { re: /\bsouth[\s-]?east\b|\bse\b/g, deg: 135 },
  { re: /\bsouth[\s-]?west\b|\bsw\b/g, deg: 225 },
  { re: /\bnorth[\s-]?west\b|\bnw\b/g, deg: 315 },
  { re: /\bnorth(ern)?\b|\bn\b/g, deg: 0 },
  { re: /\beast(ern)?\b|\be\b/g, deg: 90 },
  { re: /\bsouth(ern)?\b|\bs\b/g, deg: 180 },
  { re: /\bwest(ern)?\b|\bw\b/g, deg: 270 },
];

/**
 * Reads a compass direction from the AI's orientation text ("Front faces
 * roughly south-east" → 135). With several directions, the one closest to a
 * "faces / facing / oriented" cue wins ("morning sun from the east; the front
 * faces south" → 180). Null when the text names none.
 */
export function azimuthFromText(text: string | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const hits: { index: number; end: number; deg: number }[] = [];
  for (const w of COMPASS_WORDS) {
    for (const m of t.matchAll(w.re)) {
      const index = m.index ?? 0;
      // A compound ("south-east") also matches its parts; keep the compound.
      if (hits.some((h) => index >= h.index && index < h.end)) continue;
      hits.push({ index, end: index + m[0].length, deg: w.deg });
    }
  }
  // Single letters only count in a compass-like context ("faces SE", not "a").
  const real = hits.filter((h) => h.end - h.index > 2 || /\b(fac\w*|toward|towards|to the|oriented)\s*$/.test(t.slice(0, h.index)));
  if (real.length === 0) return null;
  const cues = [...t.matchAll(/\bfac(es|ing|e)\b|\boriented\b|\bpoints?\b/g)].map((m) => m.index ?? 0);
  if (cues.length === 0) return real.sort((a, b) => a.index - b.index)[0].deg;
  const dist = (h: { index: number }) => Math.min(...cues.map((c) => Math.abs(h.index - c)));
  return real.sort((a, b) => dist(a) - dist(b) || a.index - b.index)[0].deg;
}

export type FacingSource = NonNullable<SceneMap['facadeAzimuthSource']>;

export interface Facing {
  deg: number;
  source: FacingSource;
  /** The photo shows the house (facade) — else a yard seen from the house. */
  atHouse: boolean;
}

/**
 * Which way the photographed side faces: set by the user (compass) > the
 * photo's compass heading > the AI (stored azimuth, else its orientation text).
 */
export function resolveFacing(scene: SceneMap | undefined, capture: PhotoCapture | undefined): Facing | null {
  if (!scene) return null;
  const atHouse = looksAtHouse(scene);
  const stored = typeof scene.facadeAzimuthDeg === 'number' && Number.isFinite(scene.facadeAzimuthDeg) ? normalizeDeg(scene.facadeAzimuthDeg) : null;
  if (stored !== null && scene.facadeAzimuthSource === 'user') return { deg: stored, source: 'user', atHouse };
  const heading = capture?.headingDeg;
  if (typeof heading === 'number' && Number.isFinite(heading)) return { deg: facingFromHeading(heading, atHouse), source: 'photo', atHouse };
  if (stored !== null) return { deg: stored, source: scene.facadeAzimuthSource ?? 'ai', atHouse };
  const fromText = azimuthFromText(scene.orientation);
  return fromText === null ? null : { deg: fromText, source: 'ai', atHouse };
}

/** "south-east (135°)". */
export function directionText(deg: number): string {
  return `${compassName(deg).replace(/^(north|south)(east|west)$/, '$1-$2')} (${Math.round(normalizeDeg(deg))}°)`;
}

// ---------------------------------------------------------------------------
// Zones: which way each faces, and their sun
// ---------------------------------------------------------------------------

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bboxOf(points: readonly { x: number; y: number }[]): Box | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** The house's extent in the photo (facade, roof, doors…), or null in a yard view. */
export function houseBox(zones: readonly SceneZone[]): Box | null {
  return bboxOf(zones.filter((z) => HOUSE_KINDS.includes(z.kind)).flatMap((z) => z.polygon));
}

export type ZoneSide = 'front' | 'left' | 'right';

/**
 * Where a zone lies relative to the house in the photo: entirely beside it
 * (a side yard, left or right as seen in the photo) or in front of it.
 */
export function zoneSide(zone: Pick<SceneZone, 'polygon'>, house: Box | null): ZoneSide {
  const b = bboxOf(zone.polygon);
  if (!house || !b) return 'front';
  const slack = (house.maxX - house.minX) * 0.05;
  if (b.maxX <= house.minX + slack) return 'left';
  if (b.minX >= house.maxX - slack) return 'right';
  return 'front';
}

/**
 * Compass direction a zone faces. Standing in front of the house (facing it),
 * the photo's left is the house's side facing `facing + 90°`.
 */
export function sideAzimuth(facingDeg: number, side: ZoneSide): number {
  return normalizeDeg(side === 'left' ? facingDeg + 90 : side === 'right' ? facingDeg - 90 : facingDeg);
}

/** Ground zones whose sun matters for planting (roofed porches and tree canopies excluded). */
export function sunZones(zones: readonly SceneZone[]): SceneZone[] {
  return zones.filter((z) => isDesignZone(z) && GROUND_ZONE_KINDS.includes(z.kind) && z.kind !== 'porch' && z.kind !== 'tree');
}

/** April–September in the northern hemisphere, October–March in the southern. */
export function growingSeason(lat: number): readonly number[] {
  return lat < 0 ? [10, 11, 12, 1, 2, 3] : GROWING_SEASON;
}

export interface ZoneSunEstimate {
  zone: SceneZone;
  side: ZoneSide;
  azimuthDeg: number;
  /** Average daily direct-sun hours over the growing season. */
  hours: number;
  exposure: SunExposure;
  /** Hours on the 15th of the chosen month. */
  monthHours: number;
  /** Writing it would change the zone's stored sun / hours. */
  changed: boolean;
}

/** Estimated sun per ground zone. Computations are shared per facing direction (≤ 3 distinct). */
export function zoneSunEstimates(scene: Pick<SceneMap, 'zones'>, facingDeg: number, lat: number, lon: number, month: number): ZoneSunEstimate[] {
  const house = houseBox(scene.zones);
  const season = growingSeason(lat);
  const cache = new Map<number, { hours: number; monthHours: number }>();
  const at = (az: number) => {
    const key = Math.round(az * 10) / 10;
    let v = cache.get(key);
    if (!v) {
      const byMonth = season.map((m) => sunHours(lat, lon, az, m).hours);
      const hours = Math.round((byMonth.reduce((s, h) => s + h, 0) / byMonth.length) * 10) / 10;
      v = { hours, monthHours: sunHours(lat, lon, az, month).hours };
      cache.set(key, v);
    }
    return v;
  };
  return sunZones(scene.zones).map((zone) => {
    const side = zoneSide(zone, house);
    const azimuthDeg = sideAzimuth(facingDeg, side);
    const { hours, monthHours } = at(azimuthDeg);
    const exposure = exposureFromHours(hours);
    const changed = zone.sun !== exposure || zone.sunHours === undefined || Math.abs(zone.sunHours - hours) >= 0.05;
    return { zone, side, azimuthDeg, hours, exposure, monthHours, changed };
  });
}

// ---------------------------------------------------------------------------
// Sun at a time & the plan diagram
// ---------------------------------------------------------------------------

/** Reference year for the month view (any year; the sun's path repeats). */
export const STUDY_YEAR = 2025;

/**
 * Clock to show times in: the browser's local time when its UTC offset is
 * plausible for the property's longitude (within 2.5 h of solar time), else
 * solar time (noon = sun highest) — e.g. when planning a house in another
 * time zone. `tzOffsetMinutes` is Date#getTimezoneOffset() (minutes WEST of UTC).
 */
export function clockFor(lon: number, tzOffsetMinutes: number): 'local' | 'solar' {
  const browserEast = -tzOffsetMinutes / 60;
  return Math.abs(browserEast - lon / 15) <= 2.5 ? 'local' : 'solar';
}

/**
 * The instant for minutes after midnight on the 15th of `month`, in the
 * browser's local time or the property's solar time.
 */
export function studyDate(month: number, minutes: number, lon: number, clock: 'local' | 'solar', year = STUDY_YEAR): Date {
  const m = Math.min(12, Math.max(1, Math.round(month))) - 1;
  if (clock === 'local') return new Date(year, m, 15, Math.floor(minutes / 60), Math.round(minutes % 60));
  return new Date(Date.UTC(year, m, 15) + minutes * 60_000 - (lon / 15) * 3_600_000);
}

/** Minutes after midnight of an instant on the study clock (browser-local or the property's solar time). */
export function minutesOf(date: Date, lon: number, clock: 'local' | 'solar'): number {
  if (clock === 'local') return date.getHours() * 60 + date.getMinutes();
  const utc = date.getUTCHours() * 60 + date.getUTCMinutes();
  return Math.round((((utc + lon * 4) % 1440) + 1440) % 1440);
}

/** 570 → "9:30 AM". */
export function formatMinutes(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const mm = String(total % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

export interface SunAt {
  altitudeDeg: number;
  azimuthDeg: number;
  up: boolean;
}

export function sunAt(lat: number, lon: number, date: Date): SunAt {
  const p = sunPosition(lat, lon, date);
  return { ...p, up: p.altitudeDeg > 0 };
}

export interface LitFaces {
  front: boolean;
  back: boolean;
  /** As seen in the photo, standing in front of the house. */
  left: boolean;
  right: boolean;
}

/** House faces the sun lights (it is up and in front of the face). */
export function litFaces(sun: SunAt, facingDeg: number): LitFaces {
  const lit = (az: number) => sun.up && angularDistance(sun.azimuthDeg, az) < 90;
  return {
    front: lit(facingDeg),
    back: lit(facingDeg + 180),
    left: lit(sideAzimuth(facingDeg, 'left')),
    right: lit(sideAzimuth(facingDeg, 'right')),
  };
}

/**
 * "Sun on the front and the left side" / "Sun on the right side; the front is
 * in shade" / "Sun behind the house — the front is in shade" / "The sun is down".
 * Left / right as seen in the photo.
 */
export function litSummary(faces: LitFaces, sun: SunAt): string {
  if (!sun.up) return 'The sun is down';
  const sides = [faces.left && 'the left side', faces.right && 'the right side'].filter((x): x is string => !!x);
  if (faces.front) return `Sun on ${['the front', ...sides].join(' and ')}`;
  if (sides.length) return `Sun on ${sides.join(' and ')}; the front is in shade`;
  return 'Sun behind the house — the front is in shade';
}

/** Point on the plan diagram: bearing (0 = up/north, clockwise) and radius from the centre. */
export function polar(cx: number, cy: number, r: number, bearingDeg: number): { x: number; y: number } {
  const a = (bearingDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

/** Sun-path diagram radius for an altitude: zenith at the centre, horizon at `radius`. */
export function altitudeRadius(altitudeDeg: number, radius: number): number {
  return radius * (1 - Math.min(90, Math.max(0, altitudeDeg)) / 90);
}

/** The sun's track across the sky on the 15th of a month (points every `stepMin` while it is up). */
export function dayPath(lat: number, lon: number, month: number, clock: 'local' | 'solar', stepMin = 20): (SunAt & { minutes: number })[] {
  const out: (SunAt & { minutes: number })[] = [];
  for (let minutes = 0; minutes <= 1440; minutes += stepMin) {
    const s = sunAt(lat, lon, studyDate(month, minutes, lon, clock));
    if (s.up) out.push({ ...s, minutes });
  }
  return out;
}

/** Convex hull (monotone chain), counter-clockwise; used for the house's shadow on the diagram. */
export function convexHull(points: readonly { x: number; y: number }[]): { x: number; y: number }[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * The house's shadow on the plan: its footprint swept away from the sun by
 * height / tan(altitude), capped at `maxLength` (low sun = long shadows).
 * Empty when the sun is down.
 */
export function shadowPolygon(footprint: readonly { x: number; y: number }[], sun: SunAt, heightUnits: number, maxLength: number): { x: number; y: number }[] {
  if (!sun.up || footprint.length < 3) return [];
  const length = Math.min(maxLength, heightUnits / Math.tan((Math.max(1, sun.altitudeDeg) * Math.PI) / 180));
  const away = ((sun.azimuthDeg + 180) * Math.PI) / 180;
  const dx = Math.sin(away) * length;
  const dy = -Math.cos(away) * length;
  return convexHull([...footprint, ...footprint.map((p) => ({ x: p.x + dx, y: p.y + dy }))]);
}

/** The house footprint on the diagram, rotated so its front faces `facingDeg`. */
export function footprint(cx: number, cy: number, width: number, depth: number, facingDeg: number): { x: number; y: number }[] {
  // Local frame: front edge toward "up" (bearing 0); rotate clockwise by facing.
  const a = (facingDeg * Math.PI) / 180;
  const rot = (x: number, y: number) => ({ x: cx + x * Math.cos(a) - y * Math.sin(a), y: cy + x * Math.sin(a) + y * Math.cos(a) });
  const w = width / 2;
  const d = depth / 2;
  // Corners: front (−x), front (+x), back (+x), back (−x). Facing the house from
  // the front, the +x side is on your left — the photo's left side (facing + 90°).
  return [rot(-w, -d), rot(w, -d), rot(w, d), rot(-w, d)];
}

/** Snap to `step` degrees and wrap. */
export function snapDeg(deg: number, step = 5): number {
  return normalizeDeg(Math.round(deg / step) * step);
}

/** Bearing (0 = north/up, clockwise) of a point relative to the centre. */
export function bearingOf(cx: number, cy: number, x: number, y: number): number {
  return normalizeDeg((Math.atan2(x - cx, cy - y) * 180) / Math.PI);
}
