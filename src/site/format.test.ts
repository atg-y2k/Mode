import { describe, expect, it } from 'vitest';
import { deerPressureLabel, formatCoords, formatDistanceKm, formatMonthDay, frostSummary, phLabel, soilFacts } from './format';

describe('site formatting', () => {
  it('formats month-day strings', () => {
    expect(formatMonthDay('04-12')).toBe('Apr 12');
    expect(formatMonthDay('10-01')).toBe('Oct 1');
    expect(formatMonthDay('13-01')).toBe('13-01');
    expect(formatMonthDay('soon')).toBe('soon');
    expect(formatMonthDay(undefined)).toBe('');
  });

  it('summarizes frost dates with the source station', () => {
    const s = frostSummary({ station: 'ROCKVILLE 1 NE, MD', distanceKm: 6.2, lastSpring50: '04-12', lastSpring90: '04-28', firstFall50: '10-21', freeDays: 191.6 });
    expect(s).toEqual({
      lastFrost: 'Apr 12',
      lastFrostLate: '1 in 10 years: Apr 28',
      firstFrost: 'Oct 21',
      firstFrostEarly: undefined,
      season: '~192 frost-free days',
      sourceLine: 'NOAA 1991–2020 normals · ROCKVILLE 1 NE, MD (6 km)',
    });
    expect(formatDistanceKm(0.3)).toBe('<1 km');
  });

  it('shows a frost-free spot as frost-free, not as missing records', () => {
    const s = frostSummary({ station: 'HILO INTL AP, HI', distanceKm: 2.4, frostFree: true });
    expect(s.frostFree).toBe(true);
    expect(s.headline).toBe('Frost-free most years (HILO INTL AP, HI, 2 km)');
    expect(s.sourceLine).toBe('NOAA 1991–2020 normals · HILO INTL AP, HI (2 km)');
    expect(frostSummary({ station: 'MIAMI INTL AP, FL', distanceKm: 0.4 }).headline).toBe('Frost-free most years (MIAMI INTL AP, FL, <1 km)');
  });

  it('lists soil facts in plain words', () => {
    expect(soilFacts({ mapUnit: 'Glenelg', drainage: 'well drained', ph: 5.62, clayPct: 18.4, hydroGroup: 'b' })).toEqual([
      { label: 'Drainage', value: 'Well drained' },
      { label: 'Topsoil pH', value: '5.6 (acid)' },
      { label: 'Clay', value: '18%' },
      { label: 'Hydrologic group', value: 'B · moderately fast-draining' },
    ]);
    expect(soilFacts({ mapUnit: 'Urban land' })).toEqual([]);
    expect(phLabel(7)).toBe('neutral');
    expect(phLabel(8.2)).toBe('alkaline');
  });

  it('formats coordinates and deer pressure', () => {
    expect(formatCoords(38.9968, -77.1352)).toBe('38.997° N, 77.135° W');
    expect(formatCoords(-33.5, 151.25)).toBe('33.500° S, 151.250° E');
    expect(deerPressureLabel('high')).toBe('Deer: high');
    expect(deerPressureLabel(undefined)).toBe('');
  });
});
