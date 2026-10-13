import { describe, expect, it } from 'vitest';
import type { ClimateProfile, Project, ProjectLocation } from '../../shared/types';
import { coordsSourceOf, distanceKm, locationForUserZone, locationForZip, photosWithGps, withCoords } from './location';
import type { ZipInfo } from './zip';

const BETHESDA: ZipInfo = { zip: '20817', zone: '7b', lat: 38.997, lon: -77.135, source: 'table' };
const ROCKVILLE: ZipInfo = { zip: '20850', zone: '7a', lat: 39.09, lon: -77.18, source: 'table' };
const BOSTON: ZipInfo = { zip: '02134', zone: '6b', lat: 42.355, lon: -71.132, source: 'table' };
const CLIMATE: ClimateProfile = { hardinessZone: '7a', summary: 'Humid subtropical', notes: [], source: 'ai', updatedAt: 1 };
const SITE = { coordsSource: 'zip' as const, updatedAt: 1, ecoregion: 'Northern Piedmont' };

describe('distanceKm', () => {
  it('measures great-circle distance', () => {
    expect(distanceKm(BETHESDA, BETHESDA)).toBe(0);
    expect(distanceKm(BETHESDA, BOSTON)).toBeGreaterThan(600);
    expect(distanceKm(BETHESDA, BOSTON)).toBeLessThan(650);
  });
});

describe('locationForZip', () => {
  it('fills zone (zip-table) and ZIP-centre coordinates for a new project', () => {
    expect(locationForZip({}, BETHESDA)).toEqual({ zip: '20817', hardinessZone: '7b', zoneSource: 'zip-table', lat: 38.997, lon: -77.135 });
  });

  it('keeps the AI climate profile in step with the table zone', () => {
    const patch = locationForZip({ climate: CLIMATE }, BETHESDA);
    expect(patch.climate).toEqual({ ...CLIMATE, hardinessZone: '7b' });
  });

  it('keeps exact coordinates inside the new ZIP area, replaces a stale ZIP centre', () => {
    const exact: ProjectLocation = { zip: '20817', lat: 39.0, lon: -77.1 };
    expect(locationForZip(exact, ROCKVILLE, BETHESDA).lat).toBeUndefined(); // kept
    const atCentre: ProjectLocation = { zip: '20817', lat: BETHESDA.lat, lon: BETHESDA.lon, site: SITE };
    const moved = locationForZip(atCentre, ROCKVILLE, BETHESDA);
    expect(moved).toMatchObject({ lat: ROCKVILLE.lat, lon: ROCKVILLE.lon });
    expect('site' in moved && moved.site === undefined).toBe(true); // ~11 km away: stale profile dropped
    const far: ProjectLocation = { zip: '20817', lat: 39.0, lon: -77.1 };
    expect(locationForZip(far, BOSTON, BETHESDA)).toMatchObject({ lat: BOSTON.lat, lon: BOSTON.lon });
  });
});

describe('withCoords', () => {
  it('keeps the site profile for small moves only', () => {
    const loc: ProjectLocation = { lat: 38.997, lon: -77.135, site: SITE };
    expect(withCoords(loc, { lat: 38.998, lon: -77.136 })).toEqual({ lat: 38.998, lon: -77.136 });
    expect(withCoords(loc, { lat: 39.2, lon: -77.135 })).toEqual({ lat: 39.2, lon: -77.135, site: undefined });
  });
});

describe('locationForUserZone', () => {
  it('marks the zone as typed and mirrors it into the climate profile', () => {
    expect(locationForUserZone({ climate: CLIMATE }, '7b')).toEqual({ hardinessZone: '7b', zoneSource: 'user', climate: { ...CLIMATE, hardinessZone: '7b' } });
    expect(locationForUserZone({}, undefined)).toEqual({ hardinessZone: undefined, zoneSource: undefined });
  });
});

describe('coordinate sources', () => {
  it('tells ZIP centre, photo GPS and exact locations apart', () => {
    expect(coordsSourceOf({}, BETHESDA)).toBeNull();
    expect(coordsSourceOf({ lat: 38.9971, lon: -77.1351 }, BETHESDA)).toBe('zip');
    expect(coordsSourceOf({ lat: 38.99, lon: -77.12 }, BETHESDA, [{ lat: 38.99, lon: -77.12 }])).toBe('photo-gps');
    expect(coordsSourceOf({ lat: 38.99, lon: -77.12 }, BETHESDA)).toBe('address');
  });

  it('lists photos with GPS, newest first', () => {
    const photo = (id: string, createdAt: number, capture?: object) => ({ id, name: id, createdAt, capture }) as never;
    const project = {
      spaces: [{ photos: [photo('a', 1, { lat: 1, lon: 2 }), photo('b', 3, { headingDeg: 10 }), photo('c', 2, { lat: 3, lon: 4, headingDeg: 5 })] }],
    } as unknown as Project;
    expect(photosWithGps(project).map((p) => p.photoId)).toEqual(['c', 'a']);
    expect(photosWithGps(null)).toEqual([]);
  });
});
