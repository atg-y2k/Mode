import { describe, expect, it } from 'vitest';
import type { AssetDef, PlantInfo } from '../../../../shared/types';
import {
  activeFilterCount,
  chipPool,
  countMatchesByChip,
  defaultChipFor,
  defaultSettingFor,
  filterLibrary,
  fixturesFor,
  matchesSetting,
  matchesZone,
  type LibraryFilterState,
  type TextSearch,
} from './filters';

function plantInfo(p: Partial<PlantInfo>): PlantInfo {
  return { type: 'shrub', sun: ['full-sun'], water: 'medium', matureHeightFt: 3, matureWidthFt: 3, evergreen: true, indoor: false, ...p };
}

function asset(id: string, a: Partial<AssetDef>): AssetDef {
  return { id, name: id, category: 'decor', source: 'builtin', aspect: 1, realHeightFt: 2, tags: [], ...a };
}

const boxwood = asset('boxwood', { name: 'Boxwood', category: 'plant', plant: plantInfo({ zoneMin: 5, zoneMax: 8, sun: ['full-sun', 'part-sun'] }) });
const hosta = asset('hosta', { name: 'Hosta', category: 'plant', plant: plantInfo({ type: 'perennial', sun: ['shade'], water: 'high', zoneMin: 3, zoneMax: 9 }) });
const agave = asset('agave', { name: 'Agave', category: 'plant', plant: plantInfo({ type: 'succulent', water: 'low', zoneMin: 9, zoneMax: 11 }) });
const pothos = asset('pothos', { name: 'Pothos', category: 'plant', plant: plantInfo({ type: 'houseplant', sun: ['part-sun', 'shade'], indoor: true }) });
const pendant = asset('pendant', {
  name: 'Globe pendant',
  category: 'lighting',
  light: { beam: 'down', kelvin: 2700, lumens: 800, reachFt: 8, emitterY: 0.6, indoor: true, outdoor: false },
});
const pathLight = asset('path-light', {
  name: 'Path light',
  category: 'lighting',
  light: { beam: 'down', kelvin: 2700, lumens: 100, reachFt: 6, emitterY: 0.2, indoor: false, outdoor: true },
});
const bench = asset('bench', { name: 'Garden bench', category: 'furniture' });
const boulder = asset('boulder', { name: 'Boulder', category: 'hardscape' });
const myPlant = asset('my-fern', { name: 'My fern', category: 'plant', source: 'user', createdAt: 2 });
const myLamp = asset('my-lamp', { name: 'My lamp', category: 'lighting', source: 'ai', createdAt: 5 });

const BUILTIN = [boxwood, hosta, agave, pothos, pendant, pathLight, bench, boulder];
const LIBRARY = [myPlant, myLamp];

/** Substring search, like the catalog's (ranking not needed here). */
const search: TextSearch = (all, q) => all.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()));

const base: LibraryFilterState = {
  chip: 'plants',
  text: '',
  plantType: null,
  sun: null,
  water: null,
  fitsZone: false,
  zone: 7,
  setting: 'all',
};

const ids = (list: AssetDef[]) => list.map((a) => a.id);

describe('library pools', () => {
  it('puts my items first within a category and the whole library under My assets', () => {
    expect(ids(chipPool('plants', BUILTIN, LIBRARY))).toEqual(['my-fern', 'boxwood', 'hosta', 'agave', 'pothos']);
    expect(ids(chipPool('decor', BUILTIN, LIBRARY))).toEqual(['bench']);
    expect(ids(chipPool('hardscape', BUILTIN, LIBRARY))).toEqual(['boulder']);
    expect(ids(chipPool('mine', BUILTIN, LIBRARY))).toEqual(['my-lamp', 'my-fern']);
  });

  it('picks defaults from the space kind', () => {
    expect(defaultChipFor('exterior')).toBe('plants');
    expect(defaultChipFor('interior')).toBe('decor');
    expect(defaultSettingFor('interior')).toBe('indoor');
    expect(defaultSettingFor('exterior')).toBe('outdoor');
    expect(defaultSettingFor(undefined)).toBe('all');
  });
});

describe('filters', () => {
  it('filters by setting', () => {
    expect(matchesSetting(pothos, 'indoor')).toBe(true);
    expect(matchesSetting(pothos, 'outdoor')).toBe(false);
    expect(matchesSetting(pendant, 'outdoor')).toBe(false);
    expect(matchesSetting(pathLight, 'outdoor')).toBe(true);
    expect(matchesSetting(bench, 'indoor')).toBe(true);
    const outdoor = filterLibrary(BUILTIN, LIBRARY, { ...base, setting: 'outdoor' }, search);
    expect(ids(outdoor)).toEqual(['my-fern', 'boxwood', 'hosta', 'agave']);
  });

  it('filters by zone, keeping houseplants', () => {
    expect(matchesZone(agave, 7)).toBe(false);
    expect(matchesZone(boxwood, 7)).toBe(true);
    expect(matchesZone(pothos, 7)).toBe(true);
    const fits = filterLibrary(BUILTIN, LIBRARY, { ...base, fitsZone: true }, search);
    expect(ids(fits)).toEqual(['my-fern', 'boxwood', 'hosta', 'pothos']);
    // No zone known: the toggle has no effect.
    expect(filterLibrary(BUILTIN, LIBRARY, { ...base, fitsZone: true, zone: undefined }, search)).toHaveLength(5);
  });

  it('filters plant facts and hides items without them', () => {
    expect(ids(filterLibrary(BUILTIN, LIBRARY, { ...base, sun: 'shade' }, search))).toEqual(['hosta', 'pothos']);
    expect(ids(filterLibrary(BUILTIN, LIBRARY, { ...base, water: 'low' }, search))).toEqual(['agave']);
    expect(ids(filterLibrary(BUILTIN, LIBRARY, { ...base, plantType: 'perennial' }, search))).toEqual(['hosta']);
  });

  it('ignores plant filters on other chips', () => {
    const decor = filterLibrary(BUILTIN, LIBRARY, { ...base, chip: 'decor', sun: 'shade', setting: 'indoor' }, search);
    expect(ids(decor)).toEqual(['bench']);
  });

  it('searches within the chip and counts other chips', () => {
    expect(ids(filterLibrary(BUILTIN, LIBRARY, { ...base, text: '  box ' }, search))).toEqual(['boxwood']);
    expect(filterLibrary(BUILTIN, LIBRARY, { ...base, text: 'light' }, search)).toEqual([]);
    const counts = countMatchesByChip(BUILTIN, LIBRARY, 'light', search);
    expect(counts).toEqual({ plants: 0, fixtures: 1, decor: 0, hardscape: 0, mine: 0 });
  });

  it('counts active filters', () => {
    expect(activeFilterCount(base, 'all')).toBe(0);
    expect(activeFilterCount({ ...base, sun: 'shade', fitsZone: true }, 'all')).toBe(2);
    expect(activeFilterCount({ ...base, setting: 'indoor' }, 'outdoor')).toBe(1);
    expect(activeFilterCount({ ...base, chip: 'decor', sun: 'shade' }, 'all')).toBe(0);
  });
});

describe('fixtures for the lighting panel', () => {
  it('includes my lighting assets and scopes by setting', () => {
    expect(ids(fixturesFor([pendant, pathLight], LIBRARY, 'indoor'))).toEqual(['my-lamp', 'pendant']);
    expect(ids(fixturesFor([pendant, pathLight], LIBRARY, 'outdoor'))).toEqual(['my-lamp', 'path-light']);
    expect(ids(fixturesFor([pendant, pathLight], LIBRARY, 'all'))).toEqual(['my-lamp', 'pendant', 'path-light']);
  });
});
