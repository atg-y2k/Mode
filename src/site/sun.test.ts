import { describe, expect, it } from 'vitest';
import {
  MIN_SUN_ALTITUDE_DEG,
  angularDistance,
  compassName,
  compassPoint,
  exposureFromHours,
  facadeAzimuthFromHeading,
  isSunInFront,
  seasonalSunHours,
  sunHours,
  sunPosition,
  sunTimes,
} from './sun';

// Philadelphia-ish: 40°N, 75°W.
const LAT = 40;
const LON = -75;

describe('sunPosition', () => {
  it('uses degrees with azimuth clockwise from north (SunCalc v2)', () => {
    // Solar noon at 75°W ≈ 17:00 UTC; the sun is due south and high in June.
    const noon = sunPosition(LAT, LON, new Date(Date.UTC(2025, 5, 21, 17, 0)));
    expect(noon.azimuthDeg).toBeGreaterThan(170);
    expect(noon.azimuthDeg).toBeLessThan(190);
    expect(noon.altitudeDeg).toBeGreaterThan(70); // 90 − 40 + 23.4 ≈ 73.4
    // Morning: east of south, lower.
    const morning = sunPosition(LAT, LON, new Date(Date.UTC(2025, 5, 21, 12, 0)));
    expect(morning.azimuthDeg).toBeGreaterThan(60);
    expect(morning.azimuthDeg).toBeLessThan(120);
    // Midnight: below the horizon.
    expect(sunPosition(LAT, LON, new Date(Date.UTC(2025, 5, 21, 5, 0))).altitudeDeg).toBeLessThan(0);
  });
});

describe('sunHours', () => {
  it('south-facing at 40°N in June gets full sun (≥ 6 h)', () => {
    const r = sunHours(LAT, LON, 180, 6);
    expect(r.hours).toBeGreaterThanOrEqual(6);
    expect(r.exposure).toBe('full-sun');
  });

  it('north-facing in December gets ≈ 0 h (shade)', () => {
    const r = sunHours(LAT, LON, 0, 12);
    expect(r.hours).toBeLessThan(0.5);
    expect(r.exposure).toBe('shade');
  });

  it('east and west faces split the day and mirror each other', () => {
    const east = sunHours(LAT, LON, 90, 6).hours;
    const west = sunHours(LAT, LON, 270, 6).hours;
    expect(Math.abs(east - west)).toBeLessThanOrEqual(0.4);
    expect(east).toBeGreaterThan(4);
    expect(east).toBeLessThan(sunHours(LAT, LON, 180, 6).hours + 1.5);
  });

  it('south faces get more winter sun than north faces in summer… but both less than a south face in summer', () => {
    const southDec = sunHours(LAT, LON, 180, 12).hours;
    const northJun = sunHours(LAT, LON, 0, 6).hours;
    const southJun = sunHours(LAT, LON, 180, 6).hours;
    expect(southDec).toBeGreaterThan(5); // the whole short winter day is in front of a south face
    expect(northJun).toBeGreaterThan(0.5); // early morning + late evening in summer
    expect(northJun).toBeLessThan(southJun);
  });

  it('is independent of longitude for the same latitude (solar day window)', () => {
    const a = sunHours(LAT, -75, 135, 4).hours;
    const b = sunHours(LAT, -122, 135, 4).hours;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(0.2);
  });

  it('mirrors in the southern hemisphere (north faces are the sunny ones)', () => {
    expect(sunHours(-34, 151, 0, 12).exposure).toBe('full-sun');
    expect(sunHours(-34, 151, 180, 6).exposure).toBe('shade');
  });

  it('clamps the month and rejects non-finite input', () => {
    expect(sunHours(LAT, LON, 180, 13)).toEqual(sunHours(LAT, LON, 180, 12));
    expect(() => sunHours(Number.NaN, LON, 180, 6)).toThrow(RangeError);
  });
});

describe('the owner\'s ZIP (Montgomery County, MD: 38.99°N, 77.13°W)', () => {
  const [lat, lon] = [38.99, -77.13];

  it('a north-facing front yard is shade over the growing season (under 3 h), not part sun', () => {
    const r = seasonalSunHours(lat, lon, 0);
    expect(r.hours).toBeLessThan(3);
    expect(r.exposure).toBe('shade');
    // Even in June (long days, sun rising and setting in the north) it stays under full sun.
    const june = sunHours(lat, lon, 0, 6);
    expect(june.hours).toBeLessThan(6);
    expect(june.exposure).not.toBe('full-sun');
  });

  it('a south-facing front yard is full sun (≥ 6 h)', () => {
    const r = seasonalSunHours(lat, lon, 180);
    expect(r.hours).toBeGreaterThanOrEqual(6);
    expect(r.exposure).toBe('full-sun');
    expect(sunHours(lat, lon, 180, 6).exposure).toBe('full-sun');
  });

  it('counts sun under 15° as blocked by neighbours, fences and the house', () => {
    expect(MIN_SUN_ALTITUDE_DEG).toBe(15);
    // Low sun adds hours: with the old 5° cut-off the north face read as part sun.
    expect(sunHours(lat, lon, 0, 6, { minAltitudeDeg: 5 }).hours).toBeGreaterThan(sunHours(lat, lon, 0, 6).hours);
  });
});

describe('seasonalSunHours', () => {
  it('averages the growing season and reports each month', () => {
    const r = seasonalSunHours(LAT, LON, 180);
    expect(r.byMonth.map((m) => m.month)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(r.exposure).toBe('full-sun');
    const min = Math.min(...r.byMonth.map((m) => m.hours));
    const max = Math.max(...r.byMonth.map((m) => m.hours));
    expect(r.hours).toBeGreaterThanOrEqual(min);
    expect(r.hours).toBeLessThanOrEqual(max);
  });
});

describe('helpers', () => {
  it('facade faces opposite to the camera heading', () => {
    expect(facadeAzimuthFromHeading(0)).toBe(180);
    expect(facadeAzimuthFromHeading(200)).toBe(20);
    expect(facadeAzimuthFromHeading(-90)).toBe(90);
    expect(facadeAzimuthFromHeading(540)).toBe(0);
  });

  it('angles wrap around north', () => {
    expect(angularDistance(350, 10)).toBe(20);
    expect(angularDistance(0, 180)).toBe(180);
    expect(isSunInFront(100, 180)).toBe(true);
    expect(isSunInFront(80, 180)).toBe(false);
  });

  it('classifies hours like the rest of Mode: ≥ 6 full sun, 3–6 part sun, < 3 shade', () => {
    expect(exposureFromHours(6)).toBe('full-sun');
    expect(exposureFromHours(5.9)).toBe('part-sun');
    expect(exposureFromHours(3)).toBe('part-sun');
    expect(exposureFromHours(2.9)).toBe('shade');
    expect(exposureFromHours(2)).toBe('shade');
  });

  it('names compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(225)).toBe('SW');
    expect(compassName(100)).toBe('east');
  });

  it('gives sunrise before solar noon before sunset', () => {
    const t = sunTimes(LAT, LON, new Date(Date.UTC(2025, 5, 21, 12)));
    expect(t.sunrise && t.sunset).toBeTruthy();
    expect(t.sunrise!.getTime()).toBeLessThan(t.solarNoon.getTime());
    expect(t.solarNoon.getTime()).toBeLessThan(t.sunset!.getTime());
  });
});
