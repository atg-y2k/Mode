/**
 * Lookup, search, filters, nearest paints, zone parsing, materials by
 * surface and the AI summary.
 */
import { describe, expect, it } from 'vitest';
import type { AssetDef } from '../../../shared/types';
import {
  BUILTIN_ASSETS,
  DECOR,
  FIXTURES,
  MATERIALS,
  PAINT_COLORS,
  PLANTS,
  catalogSummaryForAI,
  findAsset,
  getBuiltinAsset,
  getMaterial,
  getPaint,
  materialsForSurface,
  nearestPaints,
  parseZone,
  searchAssets,
  searchPaints,
} from './index';

const ids = (list: readonly { id: string }[]) => list.map((x) => x.id);

const userAsset = (over: Partial<AssetDef> = {}): AssetDef => ({
  id: 'ast_user1',
  name: 'My stone lantern',
  category: 'decor',
  source: 'user',
  aspect: 0.6,
  realHeightFt: 3,
  tags: ['lantern', 'japanese garden'],
  imageId: 'img_1',
  createdAt: 1,
  ...over,
});

describe('lookup', () => {
  it('finds paints, materials and assets by id', () => {
    expect(getPaint(PAINT_COLORS[3].id)).toBe(PAINT_COLORS[3]);
    expect(getMaterial('white-oak-planks')?.category).toBe('flooring');
    expect(getBuiltinAsset('boxwood-green-velvet')?.plant?.botanical).toBe("Buxus 'Green Velvet'");
    expect(getBuiltinAsset('coach-lantern-black')?.category).toBe('lighting');
    expect(getPaint('nope')).toBeUndefined();
    expect(getMaterial('boxwood-green-velvet')).toBeUndefined();
    expect(getBuiltinAsset('white-oak-planks')).toBeUndefined();
  });

  it('findAsset checks built-ins first, then the library', () => {
    const mine = userAsset();
    expect(findAsset('ast_user1', [mine])).toBe(mine);
    expect(findAsset('boxwood-green-velvet', [mine])).toBe(getBuiltinAsset('boxwood-green-velvet'));
    const shadow = userAsset({ id: 'boxwood-green-velvet', name: 'Imposter' });
    expect(findAsset('boxwood-green-velvet', [shadow])?.name).toBe("Boxwood 'Green Velvet'");
    expect(findAsset('missing', [mine])).toBeUndefined();
    expect(findAsset('ast_user1', [])).toBeUndefined();
  });
});

describe('searchAssets', () => {
  it('returns everything (in order) for an empty query', () => {
    expect(searchAssets(BUILTIN_ASSETS, '')).toEqual(BUILTIN_ASSETS);
    expect(searchAssets(BUILTIN_ASSETS, '   ')).toEqual(BUILTIN_ASSETS);
    expect(searchAssets([], 'boxwood')).toEqual([]);
  });

  it('ranks name-prefix matches first', () => {
    const res = searchAssets(BUILTIN_ASSETS, 'box');
    expect(res[0].id).toBe('boxwood-green-velvet');
    // Boxwood alternatives (tagged) still show up, after the name matches.
    const boxwood = searchAssets(BUILTIN_ASSETS, 'boxwood');
    expect(boxwood[0].id).toBe('boxwood-green-velvet');
    expect(ids(boxwood)).toContain('inkberry-holly-shamrock');
  });

  it('puts an exact name match above word matches', () => {
    const res = searchAssets(BUILTIN_ASSETS, 'Camellia');
    expect(res[0].id).toBe('camellia-japonica');
    const lav = searchAssets(BUILTIN_ASSETS, 'lavender');
    expect(lav[0].id).toBe('lavender-phenomenal');
    // Lavender-flowered plants match through their bloom, below the name match.
    expect(ids(lav)).toContain('catmint-walkers-low');
  });

  it('is case- and punctuation-insensitive', () => {
    expect(searchAssets(BUILTIN_ASSETS, 'BOXWOOD')[0].id).toBe('boxwood-green-velvet');
    expect(searchAssets(BUILTIN_ASSETS, 'walkers low')[0].id).toBe('catmint-walkers-low');
    expect(searchAssets(BUILTIN_ASSETS, "Walker's")[0].id).toBe('catmint-walkers-low');
  });

  it('matches botanical names, tags and subcategories', () => {
    expect(ids(searchAssets(BUILTIN_ASSETS, 'acer'))).toEqual(['red-maple-october-glory', 'japanese-maple-bloodgood']);
    expect(searchAssets(BUILTIN_ASSETS, 'quercus').map((a) => a.id).sort()).toEqual(['southern-live-oak', 'swamp-white-oak']);
    const privacy = searchAssets(BUILTIN_ASSETS, 'privacy');
    expect(ids(privacy)).toEqual(expect.arrayContaining(['emerald-green-arborvitae', 'skip-laurel-hedge', 'cedar-privacy-fence-panel']));
    const sconces = searchAssets(BUILTIN_ASSETS, 'sconce');
    expect(sconces.length).toBeGreaterThanOrEqual(4);
    expect(sconces.every((a) => a.category === 'lighting')).toBe(true);
  });

  it('handles plurals and requires every word to match', () => {
    const ferns = searchAssets(BUILTIN_ASSETS, 'ferns');
    expect(ids(ferns)).toEqual(expect.arrayContaining(['ostrich-fern', 'japanese-painted-fern', 'boston-fern']));
    const res = searchAssets(BUILTIN_ASSETS, 'native shade tree');
    expect(ids(res)).toEqual(expect.arrayContaining(['red-maple-october-glory', 'swamp-white-oak', 'river-birch-heritage']));
    for (const a of res) {
      expect(a.tags, a.id).toContain('native');
      expect(a.plant?.type, a.id).toBe('tree');
    }
    expect(searchAssets(BUILTIN_ASSETS, 'boxwood zzzzqx')).toEqual([]);
  });

  it('does not match short words inside other words', () => {
    // "red" must not hit "louvered shutters" or "shredded".
    const red = ids(searchAssets(BUILTIN_ASSETS, 'red'));
    expect(red).not.toContain('louvered-shutters-black');
    expect(red).toEqual(expect.arrayContaining(['red-maple-october-glory', 'knock-out-rose']));
    // "path" must not match inside the botanical name Spathiphyllum.
    expect(ids(searchAssets(BUILTIN_ASSETS, 'path light'))).not.toContain('peace-lily');
  });

  it('"native" means native to North America, not just any origin', () => {
    const natives = searchAssets(BUILTIN_ASSETS, 'native', { category: 'plant' });
    expect(natives.length).toBeGreaterThan(15);
    for (const a of natives) expect(a.tags, a.id).toContain('native');
    const nativeIds = ids(natives);
    expect(nativeIds).not.toContain('hosta-patriot'); // hybrid, East Asia
    expect(nativeIds).not.toContain('japanese-maple-bloodgood');
    // Every plant tagged native is found.
    for (const p of PLANTS.filter((x) => x.tags.includes('native'))) expect(nativeIds, p.id).toContain(p.id);
    // The origin itself stays searchable.
    expect(ids(searchAssets(BUILTIN_ASSETS, 'japan', { category: 'plant' }))).toContain('japanese-maple-bloodgood');
  });

  it('finds plants by light, water and flags', () => {
    const shade = searchAssets(BUILTIN_ASSETS, 'shade', { category: 'plant', setting: 'outdoor' });
    expect(shade.length).toBeGreaterThan(5);
    const tolerant = (a: AssetDef) => !!a.plant?.sun.includes('shade') || /shade/i.test(a.name);
    // Shade trees (tagged) also match, but after every shade-tolerant plant.
    expect(shade.every((a) => tolerant(a) || a.subcategory === 'shade-tree')).toBe(true);
    const firstTree = shade.findIndex((a) => !tolerant(a));
    expect(shade.slice(firstTree).every((a) => !tolerant(a))).toBe(true);
    const deer = searchAssets(BUILTIN_ASSETS, 'deer resistant', { category: 'plant' });
    expect(deer.length).toBeGreaterThan(10);
    expect(deer.every((a) => a.plant?.deerResistant)).toBe(true);
  });
});

describe('searchAssets filters', () => {
  it('category, subcategory and source', () => {
    expect(searchAssets(BUILTIN_ASSETS, '', { category: 'lighting' })).toEqual(FIXTURES);
    const hardscape = searchAssets(BUILTIN_ASSETS, '', { category: 'hardscape' });
    expect(hardscape.length).toBeGreaterThan(5);
    expect(hardscape.every((a) => a.category === 'hardscape')).toBe(true);
    expect(ids(searchAssets(BUILTIN_ASSETS, '', { subcategory: 'pergola' }))).toEqual(['cedar-pergola', 'aluminum-pergola-black']);
    const pool = [...BUILTIN_ASSETS, userAsset()];
    expect(ids(searchAssets(pool, '', { source: 'user' }))).toEqual(['ast_user1']);
    expect(ids(searchAssets(pool, 'lantern', { source: 'user' }))).toEqual(['ast_user1']);
  });

  it('plant type, sun and water only keep plants that match', () => {
    const grasses = searchAssets(BUILTIN_ASSETS, '', { plantType: 'grass' });
    expect(grasses.length).toBeGreaterThanOrEqual(4);
    expect(grasses.every((a) => a.plant?.type === 'grass')).toBe(true);
    const sun = searchAssets(BUILTIN_ASSETS, '', { sun: 'shade' });
    expect(sun.every((a) => a.plant?.sun.includes('shade'))).toBe(true);
    const dry = searchAssets(BUILTIN_ASSETS, '', { water: 'low' });
    expect(dry.length).toBeGreaterThan(10);
    expect(dry.every((a) => a.plant?.water === 'low')).toBe(true);
  });

  it('zone keeps plants hardy there, unzoned houseplants and non-plants', () => {
    const z4 = searchAssets(BUILTIN_ASSETS, '', { zone: 4 });
    const z4ids = ids(z4);
    expect(z4ids).not.toContain('southern-live-oak'); // 8–10
    expect(z4ids).not.toContain('agave-americana'); // 8–11
    expect(z4ids).toContain('hydrangea-limelight'); // 3–8
    expect(z4ids).toContain('fiddle-leaf-fig');
    expect(z4ids).toContain('coach-lantern-black');
    expect(z4ids).toContain('teak-garden-bench');
    for (const a of z4) {
      const p = a.plant;
      if (p?.zoneMin !== undefined) expect(p.zoneMin <= 4 && 4 <= (p.zoneMax ?? 13), a.id).toBe(true);
    }
    // Half zones and fractional values ("7b" read as 7.5) belong to their whole zone.
    expect(ids(searchAssets(BUILTIN_ASSETS, '', { zone: 7.5 }))).toEqual(ids(searchAssets(BUILTIN_ASSETS, '', { zone: 7 })));
    // A plant at its range edges.
    expect(z4ids).toContain('red-maple-october-glory'); // 4–9
    expect(ids(searchAssets(BUILTIN_ASSETS, '', { zone: 10 }))).not.toContain('red-maple-october-glory');
  });

  it('setting splits indoor and outdoor', () => {
    const inPlants = searchAssets(BUILTIN_ASSETS, '', { category: 'plant', setting: 'indoor' });
    expect(inPlants.length).toBeGreaterThanOrEqual(10);
    expect(inPlants.every((a) => a.plant?.indoor)).toBe(true);
    const outPlants = searchAssets(BUILTIN_ASSETS, '', { category: 'plant', setting: 'outdoor' });
    expect(outPlants.length + inPlants.length).toBe(PLANTS.length);

    const inLights = ids(searchAssets(BUILTIN_ASSETS, '', { category: 'lighting', setting: 'indoor' }));
    const outLights = ids(searchAssets(BUILTIN_ASSETS, '', { category: 'lighting', setting: 'outdoor' }));
    expect(inLights).toContain('dome-pendant-black');
    expect(outLights).not.toContain('dome-pendant-black');
    expect(outLights).toContain('pagoda-path-light-black');
    expect(inLights).not.toContain('pagoda-path-light-black');
    // Rated for both → in both lists.
    expect(inLights).toContain('ceiling-fan-52');
    expect(outLights).toContain('ceiling-fan-52');

    const inDecor = ids(searchAssets(DECOR, '', { setting: 'indoor' }));
    expect(inDecor).toContain('linen-sofa');
    expect(inDecor).not.toContain('stone-fire-pit');
    expect(inDecor).toContain('terracotta-pot-16in'); // tagged indoor + outdoor
    // Objects without setting information fit both.
    expect(ids(searchAssets([userAsset({ tags: [] })], '', { setting: 'indoor' }))).toEqual(['ast_user1']);
  });

  it('filters and text combine', () => {
    const res = searchAssets(BUILTIN_ASSETS, 'hydrangea', { sun: 'shade' });
    expect(ids(res)).toEqual(['oakleaf-hydrangea-ruby-slippers']);
  });
});

describe('searchPaints', () => {
  it('returns the whole palette for an empty query, optionally by family', () => {
    expect(searchPaints('')).toEqual(PAINT_COLORS);
    const blues = searchPaints('', 'blue');
    expect(blues.length).toBeGreaterThan(8);
    expect(blues.every((p) => p.family === 'blue')).toBe(true);
  });

  it('ranks name matches first and searches collection, tags and family', () => {
    const harbor = searchPaints('harbor').map((p) => p.name);
    // Name-start matches (in fan-deck order) before mid-name word matches.
    expect(harbor.slice(0, 2)).toEqual(['Harbor Fog', 'Harbor Navy']);
    expect(harbor).toContain('Steel Harbor');
    expect(harbor.indexOf('Steel Harbor')).toBeGreaterThan(1);
    expect(searchPaints('Hearth Linen')[0].id).toBe('hearth-linen');
    const doors = searchPaints('front door');
    expect(doors.length).toBeGreaterThanOrEqual(12);
    expect(doors.filter((p) => p.collection === 'Front door favorites').length).toBe(12);
    const ceiling = searchPaints('ceiling');
    expect(ceiling[0].name).toMatch(/ceiling/i);
    expect(searchPaints('greens').some((p) => p.collection === 'Greens')).toBe(true);
    expect(searchPaints('qqqxyz')).toEqual([]);
  });

  it('combines family with text', () => {
    const reds = searchPaints('front door', 'red');
    expect(reds.length).toBeGreaterThan(0);
    expect(reds.every((p) => p.family === 'red')).toBe(true);
  });

  it('a hex query returns the nearest colors, exact match first', () => {
    const p = PAINT_COLORS[20];
    const res = searchPaints(p.hex);
    expect(res[0]).toBe(p);
    expect(res.length).toBeLessThanOrEqual(24);
    expect(searchPaints(p.hex.slice(1).toUpperCase())[0]).toBe(p);
    // A word made only of hex letters is still text.
    expect(searchPaints('facade')).toEqual([]);
  });
});

describe('nearestPaints', () => {
  it('finds an exact catalog color at ΔE 0, then ascending distances', () => {
    const p = PAINT_COLORS[42];
    const res = nearestPaints(p.hex, 5);
    expect(res).toHaveLength(5);
    expect(res[0].paint).toBe(p);
    expect(res[0].deltaE).toBeCloseTo(0, 6);
    for (let i = 1; i < res.length; i++) expect(res[i].deltaE).toBeGreaterThanOrEqual(res[i - 1].deltaE);
  });

  it('maps a pure color to a sensible neighbor', () => {
    expect(nearestPaints('#ffffff', 1)[0].paint.family).toBe('white');
    expect(nearestPaints('#000000', 1)[0].paint.family).toBe('black');
    expect(['blue', 'gray']).toContain(nearestPaints('#2a3b55', 1)[0].paint.family);
  });

  it('defaults to a short list and handles bad input', () => {
    expect(nearestPaints('#808080')).toHaveLength(8);
    expect(nearestPaints('#abc', 3)).toHaveLength(3);
    expect(nearestPaints('not a color')).toEqual([]);
    expect(nearestPaints('#808080', 0)).toEqual([]);
    expect(nearestPaints('#808080', 10_000)).toHaveLength(PAINT_COLORS.length);
  });
});

describe('parseZone', () => {
  it('reads USDA zones', () => {
    expect(parseZone('7a')).toBe(7);
    expect(parseZone('10b')).toBe(10);
    expect(parseZone('6')).toBe(6);
    expect(parseZone(' 8B ')).toBe(8);
    expect(parseZone('Zone 5b')).toBe(5);
    expect(parseZone('USDA zone 9a')).toBe(9);
    expect(parseZone('Zone: 6b')).toBe(6);
    expect(parseZone('13')).toBe(13);
    expect(parseZone('1a')).toBe(1);
  });

  it('rejects anything else', () => {
    expect(parseZone(undefined)).toBeUndefined();
    expect(parseZone(null)).toBeUndefined();
    expect(parseZone('')).toBeUndefined();
    expect(parseZone('abc')).toBeUndefined();
    expect(parseZone('0')).toBeUndefined();
    expect(parseZone('14a')).toBeUndefined();
    expect(parseZone('7c')).toBeUndefined();
    expect(parseZone('7a-8b')).toBeUndefined();
  });
});

describe('materialsForSurface', () => {
  it('floors: flooring first, then tile; every result is offered for floors', () => {
    const list = materialsForSurface('floor');
    expect(list[0].id).toBe('white-oak-planks');
    expect(list.every((m) => m.surfaces.includes('floor'))).toBe(true);
    const firstTile = list.findIndex((m) => m.category === 'tile');
    const lastFlooring = list.map((m) => m.category).lastIndexOf('flooring');
    expect(firstTile).toBeGreaterThan(lastFlooring);
  });

  it('keeps categories contiguous in their preferred order', () => {
    const cats = materialsForSurface('patio').map((m) => m.category);
    expect(cats[0]).toBe('hardscape');
    const order = [...new Set(cats)];
    expect(order.slice(0, 3)).toEqual(['hardscape', 'tile', 'decking']);
    for (let i = 1; i < cats.length; i++) {
      if (cats[i] !== cats[i - 1]) expect(cats.slice(i).includes(cats[i - 1])).toBe(false);
    }
  });

  it('within a category, primary-use materials come first', () => {
    // Pavers list 'patio' first; flagstone lists 'path' first.
    const patio = ids(materialsForSurface('patio'));
    expect(patio.indexOf('concrete-pavers-ashlar')).toBeLessThan(patio.indexOf('bluestone-flagstone'));
    const path = ids(materialsForSurface('path'));
    expect(path.indexOf('bluestone-flagstone')).toBeLessThan(path.indexOf('concrete-pavers-ashlar'));
  });

  it('lawns are grass first, then lawn replacements', () => {
    const lawn = materialsForSurface('lawn');
    expect(lawn.slice(0, 2).map((m) => m.texture.pattern)).toEqual(['grass', 'grass']);
    expect(ids(lawn)).toContain('decomposed-granite');
  });

  it('roofs only get roofing; painted-only surfaces get nothing; other gets all', () => {
    const roof = materialsForSurface('roof');
    expect(roof.length).toBeGreaterThanOrEqual(5);
    expect(roof.every((m) => m.category === 'roofing')).toBe(true);
    expect(materialsForSurface('cabinet')).toEqual([]);
    expect(materialsForSurface('trim')).toEqual([]);
    expect(materialsForSurface('other')).toEqual(MATERIALS);
  });

  it('returns a fresh array each call', () => {
    const a = materialsForSurface('deck');
    a.length = 0;
    expect(materialsForSurface('deck').length).toBeGreaterThan(0);
  });
});

describe('catalogSummaryForAI', () => {
  const summary = catalogSummaryForAI();
  const lines = summary.split('\n');

  it('is stable across calls', () => {
    expect(catalogSummaryForAI()).toBe(summary);
  });

  it('lists every material, plant, fixture and decor id exactly once', () => {
    const listed = lines.map((l) => /^(material|plant|fixture|decor|furniture|hardscape|other) ([a-z0-9-]+) \|/.exec(l)?.[2]).filter(Boolean);
    const expected = [...ids(MATERIALS), ...ids(PLANTS), ...ids(FIXTURES), ...ids(DECOR)];
    expect(listed).toEqual(expected);
  });

  it('uses the compact line format', () => {
    const box = lines.find((l) => l.startsWith('plant boxwood-green-velvet |'));
    expect(box).toBe(
      "plant boxwood-green-velvet | Boxwood 'Green Velvet' | shrub | sun: full,part | water: med | z5-8 | 3x3ft | evergreen, deer-resistant | $35-65/3 gal",
    );
    expect(lines.find((l) => l.startsWith('material white-oak-planks |'))).toBe(
      'material white-oak-planks | White oak planks (natural) | flooring | floor,stair | wood-planks 7.5x72in | $6-12/sqft',
    );
    expect(lines.find((l) => l.startsWith('fixture coach-lantern-black |'))).toBe(
      'fixture coach-lantern-black | Coach wall lantern (black) | wall-lantern | outdoor | omni 2700K 800lm reach 8ft | mount 6ft | $50-200',
    );
    const fig = lines.find((l) => l.startsWith('plant fiddle-leaf-fig |'))!;
    expect(fig).toContain('indoor light: bright,indirect');
    expect(fig).not.toMatch(/\bz\d/);
    expect(lines.find((l) => l.startsWith('plant sun-annual-mix |'))).toContain('annual (all zones)');
    expect(lines.find((l) => l.startsWith('plant eastern-redbud |'))).toContain('native: Eastern & Central US');
  });

  it('has no undefined / NaN and stays compact', () => {
    expect(summary).not.toMatch(/undefined|NaN|null/);
    expect(summary.length).toBeLessThan(40_000);
    for (const l of lines) expect(l.length, l).toBeLessThan(260);
  });
});
