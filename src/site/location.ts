/**
 * Pure helpers that keep a project's location consistent when the ZIP or the
 * coordinates change (Settings / New project). The zone from the bundled ZIP
 * table is the source of truth for plant feasibility unless the user typed one,
 * so a stored AI climate profile is kept in step with it.
 */
import type { PhotoCapture, Project, ProjectLocation, SiteProfile } from '../../shared/types';
import type { ZipInfo } from './zip';

/** Exact coordinates farther than this from a new ZIP's centre are treated as another place. */
const SAME_AREA_KM = 30;
/** A site profile describes a point; moving farther than this makes it stale. */
const SITE_STALE_KM = 2;
/** Coordinates this close count as "the same point" (rounding in tables, EXIF). */
const SAME_POINT_KM = 0.15;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance in km (haversine). */
export function distanceKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function coordsOf(location: ProjectLocation | undefined): LatLon | null {
  const lat = location?.lat;
  const lon = location?.lon;
  return typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** Photos of the project that carry GPS coordinates (newest first). */
export function photosWithGps(project: Project | null | undefined): { photoId: string; name: string; capture: PhotoCapture & LatLon }[] {
  if (!project) return [];
  const out: { photoId: string; name: string; createdAt: number; capture: PhotoCapture & LatLon }[] = [];
  for (const space of project.spaces) {
    for (const photo of space.photos) {
      const c = photo.capture;
      if (c && typeof c.lat === 'number' && typeof c.lon === 'number') {
        out.push({ photoId: photo.id, name: photo.name, createdAt: photo.createdAt, capture: c as PhotoCapture & LatLon });
      }
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).map(({ photoId, name, capture }) => ({ photoId, name, capture }));
}

/**
 * Where the project's coordinates came from: the ZIP centre, a photo's GPS, or
 * an exact location the user entered. Null without coordinates.
 */
export function coordsSourceOf(
  location: ProjectLocation | undefined,
  zipInfo: ZipInfo | null | undefined,
  gpsPoints: readonly LatLon[] = [],
): SiteProfile['coordsSource'] | null {
  const c = coordsOf(location);
  if (!c) return null;
  if (zipInfo && distanceKm(c, zipInfo) <= SAME_POINT_KM) return 'zip';
  if (gpsPoints.some((p) => distanceKm(c, p) <= SAME_POINT_KM)) return 'photo-gps';
  return 'address';
}

/** Location patch that moves the coordinates (drops a site profile measured elsewhere). */
export function withCoords(current: ProjectLocation, next: LatLon): Partial<ProjectLocation> {
  const patch: Partial<ProjectLocation> = { lat: round6(next.lat), lon: round6(next.lon) };
  const prev = coordsOf(current);
  if (current.site && (!prev || distanceKm(prev, next) > SITE_STALE_KM)) patch.site = undefined;
  return patch;
}

/**
 * Location patch for a ZIP that resolved in the table: the ZIP, its zone
 * (zoneSource 'zip-table', mirrored into the AI climate profile so feasibility
 * reads one zone) and coordinates. Exact coordinates (photo GPS / entered) are
 * kept when they lie in the new ZIP's area; otherwise the ZIP centre is used.
 */
export function locationForZip(current: ProjectLocation, info: ZipInfo, previousZip?: ZipInfo | null): Partial<ProjectLocation> {
  const patch: Partial<ProjectLocation> = { zip: info.zip, hardinessZone: info.zone, zoneSource: 'zip-table' };
  if (current.climate && current.climate.hardinessZone !== info.zone) patch.climate = { ...current.climate, hardinessZone: info.zone };
  const prev = coordsOf(current);
  const atOldCentre = prev && previousZip ? distanceKm(prev, previousZip) <= SAME_POINT_KM : false;
  const keepExact = prev && !atOldCentre && distanceKm(prev, info) <= SAME_AREA_KM;
  if (!keepExact) Object.assign(patch, withCoords(current, info));
  return patch;
}

/** Location patch for a zone the user typed (mirrored into the climate profile). */
export function locationForUserZone(current: ProjectLocation, zone: string | undefined): Partial<ProjectLocation> {
  const patch: Partial<ProjectLocation> = { hardinessZone: zone, zoneSource: zone ? 'user' : undefined };
  if (zone && current.climate && current.climate.hardinessZone !== zone) patch.climate = { ...current.climate, hardinessZone: zone };
  return patch;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
