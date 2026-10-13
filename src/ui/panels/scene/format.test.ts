import { describe, expect, it } from 'vitest';
import type { PlantInfo } from '../../../../shared/types';
import {
  compactUsd,
  formatCostRange,
  formatDegrees,
  formatEv,
  formatFeetShort,
  formatKelvin,
  formatSigned100,
  formatSize,
  lampColorName,
  whiteBalanceName,
  zoneFit,
  zoneShortLabel,
} from './format';

const plant = (p: Partial<PlantInfo>): PlantInfo => ({
  type: 'shrub',
  sun: ['full-sun'],
  water: 'medium',
  matureHeightFt: 3,
  matureWidthFt: 3,
  evergreen: true,
  indoor: false,
  ...p,
});

describe('money', () => {
  it('formats compact dollars', () => {
    expect(compactUsd(4.5)).toBe('$4.50');
    expect(compactUsd(12)).toBe('$12');
    expect(compactUsd(24.98)).toBe('$25');
    expect(compactUsd(1450)).toBe('$1,450');
    expect(compactUsd(Number.NaN)).toBe('—');
  });

  it('formats cost ranges with units', () => {
    expect(formatCostRange({ low: 12, high: 25, unit: 'each' })).toBe('$12–$25');
    expect(formatCostRange({ low: 40, high: 40, unit: 'each' })).toBe('$40');
    expect(formatCostRange({ low: 3, high: 5, unit: 'sqft' })).toBe('$3–$5 / sq ft');
    expect(formatCostRange({ low: 30, high: 20, unit: 'each' })).toBe('$20–$30');
  });

  it('returns null without a usable price', () => {
    expect(formatCostRange(undefined)).toBeNull();
    expect(formatCostRange({ low: 0, high: 0, unit: 'each' })).toBeNull();
    expect(formatCostRange({ low: Number.NaN, high: 18, unit: 'each' })).toBe('$18');
  });
});

describe('light & scene values', () => {
  it('formats kelvin and names', () => {
    expect(formatKelvin(2704)).toBe('2700 K');
    expect(lampColorName(2200)).toBe('Candlelight');
    expect(lampColorName(2700)).toBe('Warm white');
    expect(lampColorName(3000)).toBe('Soft white');
    expect(lampColorName(4000)).toBe('Neutral white');
    expect(lampColorName(5000)).toBe('Daylight');
    expect(whiteBalanceName(5500)).toBe('Neutral');
    expect(whiteBalanceName(3000)).toBe('Very warm');
    expect(whiteBalanceName(8500)).toBe('Very cool');
  });

  it('formats signed values', () => {
    expect(formatEv(0)).toBe('0 EV');
    expect(formatEv(0.54)).toBe('+0.5 EV');
    expect(formatEv(-1.2)).toBe('−1.2 EV');
    expect(formatSigned100(0.2)).toBe('+20');
    expect(formatSigned100(-0.351)).toBe('−35');
    expect(formatSigned100(0.001)).toBe('0');
    expect(formatDegrees(-35.4)).toBe('−35°');
    expect(formatDegrees(90)).toBe('90°');
  });
});

describe('plants & sizes', () => {
  it('labels zone ranges', () => {
    expect(zoneShortLabel(plant({ zoneMin: 5, zoneMax: 9 }))).toBe('Z5–9');
    expect(zoneShortLabel(plant({ zoneMin: 7 }))).toBe('Z7+');
    expect(zoneShortLabel(plant({ zoneMin: 8, zoneMax: 8 }))).toBe('Z8');
    expect(zoneShortLabel(plant({}))).toBeNull();
    expect(zoneShortLabel(undefined)).toBeNull();
  });

  it('checks zone fit', () => {
    const p = plant({ zoneMin: 5, zoneMax: 8 });
    expect(zoneFit(p, 7)).toBe('fits');
    expect(zoneFit(p, 5)).toBe('fits');
    expect(zoneFit(p, 9)).toBe('outside');
    expect(zoneFit(p, 4)).toBe('outside');
    expect(zoneFit(p, undefined)).toBe('unknown');
    expect(zoneFit(plant({ indoor: true }), 7)).toBe('unknown');
  });

  it('formats feet and photo sizes', () => {
    expect(formatFeetShort(0.5)).toBe('6 in');
    expect(formatFeetShort(2.25)).toBe('2.3 ft');
    expect(formatFeetShort(3)).toBe('3 ft');
    expect(formatFeetShort(14.4)).toBe('14 ft');
    expect(formatFeetShort(0)).toBe('—');
    expect(formatSize(220, null)).toBe('220 px');
    expect(formatSize(210, 50)).toBe('4.2 ft');
  });
});
