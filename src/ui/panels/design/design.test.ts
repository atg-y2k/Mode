import { describe, expect, it } from 'vitest';
import { SPACE_TYPES, SURFACE_KINDS, type MaterialDef, type PaintColor, type Project, type Treatment } from '../../../../shared/types';
import { formatCostRange, formatScale, formatShare, formatSqFt, formatUnitSize, plural } from './format';
import {
  groupMaterials,
  isDefaultAdjust,
  materialTreatmentFor,
  normalizeRotation,
  scaledUnitSize,
  searchMaterials,
  snapScale,
  unitNoun,
} from './materials';
import {
  deltaELabel,
  displayHex,
  filterPaints,
  groupByCollection,
  isSamePaint,
  localPaintSearch,
  lrvLabel,
  paintCollections,
  paintDisplayName,
  paintFamilies,
  paintFromCatalog,
  paintFromCustom,
  usedPaintColors,
} from './paint';
import { defaultFinishFor, isHorizontalSurface, prefersMaterial, renameForSurfaceChange, surfaceKindsFor } from './surfaceKinds';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PAINTS: PaintColor[] = [
  { id: 'p-linen', name: 'Soft Linen', hex: '#EEE6D8', family: 'white', collection: 'Warm whites', tags: ['trim', 'ceiling'] },
  { id: 'p-cream', name: 'Morning Cream', hex: '#f1e7cf', family: 'white', collection: 'Warm whites', tags: ['walls'] },
  { id: 'p-sage', name: 'Garden Sage', hex: '#9caf88', family: 'green', collection: 'Greens', tags: ['cabinets'] },
  { id: 'p-fern', name: 'Fern Hollow', hex: '#56704f', family: 'green', collection: 'Greens', tags: ['front door'] },
  { id: 'p-navy', name: 'Harbor Navy', hex: '#24344d', family: 'blue', collection: 'Blues', tags: ['front door', 'accent'] },
  { id: 'p-slate', name: 'Slate Blue', hex: '#5d7086', family: 'blue', collection: 'Blues', tags: [] },
];

function material(id: string, category: MaterialDef['category'], name: string, extra: Partial<MaterialDef> = {}): MaterialDef {
  return {
    id,
    name,
    category,
    surfaces: ['floor'],
    texture: { pattern: 'wood-planks', colors: ['#a07850'], unitWidthIn: 7.5, unitHeightIn: 72, variation: 0.5, seed: 1 },
    cost: { low: 4, high: 8, unit: 'sqft' },
    description: `${name} description`,
    tags: [],
    ...extra,
  };
}

function project(treatments: Record<string, Treatment>[]): Pick<Project, 'spaces'> {
  return {
    spaces: [
      {
        id: 's1',
        name: 'Living room',
        type: 'living-room',
        kind: 'interior',
        createdAt: 0,
        photos: [
          {
            id: 'ph1',
            name: 'Photo',
            imageId: 'i',
            thumbId: 't',
            width: 10,
            height: 10,
            createdAt: 0,
            regions: [],
            generations: [],
            activeDesignId: 'd0',
            designs: treatments.map((t, i) => ({
              id: `d${i}`,
              name: `Option ${i}`,
              createdAt: 0,
              updatedAt: 0,
              treatments: t,
              hiddenRegionIds: [],
              objects: [],
              lights: [],
              lighting: { timeOfDay: 'day', exposure: 0, kelvin: 5500, ambient: 0.75, contrast: 0, saturation: 0 },
              aiRenders: [],
            })),
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Surface kinds
// ---------------------------------------------------------------------------

describe('surfaceKindsFor', () => {
  it('lists every surface kind exactly once for every space type', () => {
    for (const type of [...SPACE_TYPES, undefined]) {
      const { primary, more } = surfaceKindsFor(type);
      const all = [...primary, ...more];
      expect(new Set(all).size, String(type)).toBe(all.length);
      expect([...all].sort()).toEqual([...SURFACE_KINDS].sort());
      expect(primary.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('puts relevant surfaces first for the space', () => {
    expect(surfaceKindsFor('kitchen').primary.slice(0, 4)).toEqual(['wall', 'cabinet', 'backsplash', 'countertop']);
    expect(surfaceKindsFor('front-exterior').primary[0]).toBe('siding');
    expect(surfaceKindsFor('backyard').primary[0]).toBe('lawn');
    // Interior spaces list remaining interior kinds before exterior ones; "Other" is last.
    const more = surfaceKindsFor('bedroom').more;
    expect(more.indexOf('backsplash')).toBeLessThan(more.indexOf('siding'));
    expect(more[more.length - 1]).toBe('other');
    const extMore = surfaceKindsFor('front-yard').more;
    expect(extMore.indexOf('roof')).toBeLessThan(extMore.indexOf('ceiling'));
  });

  it('falls back to the setting when the space type is unknown', () => {
    expect(surfaceKindsFor(undefined, 'exterior').primary[0]).toBe('siding');
    expect(surfaceKindsFor(undefined).primary[0]).toBe('wall');
  });
});

describe('surface defaults', () => {
  it('suggests a painter-typical finish', () => {
    expect(defaultFinishFor('ceiling')).toBe('flat');
    expect(defaultFinishFor('wall')).toBe('eggshell');
    expect(defaultFinishFor('trim')).toBe('semi-gloss');
    expect(defaultFinishFor('front-door')).toBe('semi-gloss');
    expect(defaultFinishFor('siding')).toBe('satin');
  });

  it('knows which surfaces prefer materials and which are horizontal', () => {
    expect(prefersMaterial('lawn')).toBe(true);
    expect(prefersMaterial('wall')).toBe(false);
    expect(isHorizontalSurface('patio')).toBe(true);
    expect(isHorizontalSurface('siding')).toBe(false);
  });

  it('renames auto-named regions when their type changes, keeping custom names', () => {
    expect(renameForSurfaceChange('Wall', 'wall', 'siding', [])).toBe('Siding');
    expect(renameForSurfaceChange('Wall 2', 'wall', 'siding', ['Siding'])).toBe('Siding 2');
    expect(renameForSurfaceChange('Wall', 'wall', 'siding', ['Siding', 'Siding 2'])).toBe('Siding 3');
    expect(renameForSurfaceChange('Back wall', 'wall', 'siding', [])).toBe('Back wall');
    expect(renameForSurfaceChange('Trim / baseboard', 'trim', 'door', [])).toBe('Door');
    expect(renameForSurfaceChange('Wall', 'wall', 'wall', [])).toBe('Wall');
  });
});

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

describe('paint collections & filtering', () => {
  it('lists collections in catalog order with counts', () => {
    expect(paintCollections(PAINTS)).toEqual([
      { name: 'Warm whites', count: 2 },
      { name: 'Greens', count: 2 },
      { name: 'Blues', count: 2 },
    ]);
    expect(paintFamilies(PAINTS, ['white', 'gray', 'green', 'blue'])).toEqual(['white', 'green', 'blue']);
  });

  it('filters by collection, family and text', () => {
    expect(filterPaints(PAINTS, { collection: 'Greens', family: null, query: '' }).map((p) => p.id)).toEqual(['p-sage', 'p-fern']);
    expect(filterPaints(PAINTS, { collection: null, family: 'blue', query: '' }).map((p) => p.id)).toEqual(['p-navy', 'p-slate']);
    expect(filterPaints(PAINTS, { collection: null, family: null, query: 'door' }).map((p) => p.id)).toEqual(['p-fern', 'p-navy']);
    expect(filterPaints(PAINTS, { collection: 'Blues', family: null, query: 'door' }).map((p) => p.id)).toEqual(['p-navy']);
    expect(filterPaints(PAINTS, { collection: null, family: null, query: 'zzz' })).toEqual([]);
  });

  it('ranks name-prefix matches first and matches hex', () => {
    const r = localPaintSearch(PAINTS, 'slate');
    expect(r[0].id).toBe('p-slate');
    expect(localPaintSearch(PAINTS, '#24344d').map((p) => p.id)).toEqual(['p-navy']);
    expect(localPaintSearch(PAINTS, 'blue').map((p) => p.id)).toEqual(['p-slate', 'p-navy']);
  });

  it('uses the provided search function for text queries', () => {
    const calls: [string, string | undefined][] = [];
    const out = filterPaints(PAINTS, { collection: null, family: 'green', query: ' sage ' }, (q, f) => {
      calls.push([q, f]);
      return [PAINTS[2]];
    });
    expect(calls).toEqual([['sage', 'green']]);
    expect(out.map((p) => p.id)).toEqual(['p-sage']);
  });

  it('groups by collection in order', () => {
    expect(groupByCollection(PAINTS).map((g) => [g.collection, g.paints.length])).toEqual([
      ['Warm whites', 2],
      ['Greens', 2],
      ['Blues', 2],
    ]);
  });
});

describe('paint treatments', () => {
  it('builds catalog paints with surface defaults, keeping settings of the current paint', () => {
    const t = paintFromCatalog(PAINTS[0], undefined, 'trim');
    expect(t).toEqual({ type: 'paint', hex: '#eee6d8', colorName: 'Soft Linen', paintId: 'p-linen', finish: 'semi-gloss', coats: 2, strength: 1 });
    const prev: Treatment = { ...t, finish: 'satin', coats: 3, strength: 0.6 };
    const next = paintFromCatalog(PAINTS[2], prev, 'trim');
    expect(next).toMatchObject({ paintId: 'p-sage', finish: 'satin', coats: 3, strength: 0.6 });
    // A previous material doesn't leak into the paint settings.
    const fromMaterial = paintFromCatalog(PAINTS[2], { type: 'material', materialId: 'x', scale: 2, rotation: 0, strength: 0.3 }, 'wall');
    expect(fromMaterial).toMatchObject({ finish: 'eggshell', coats: 2, strength: 1 });
  });

  it('builds custom paints and rejects invalid hexes', () => {
    expect(paintFromCustom({ hex: 'ABC', name: '  Chalk ', brand: ' ', code: 'HC-1' }, undefined, 'wall')).toEqual({
      type: 'paint',
      hex: '#aabbcc',
      colorName: 'Chalk',
      code: 'HC-1',
      finish: 'eggshell',
      coats: 2,
      strength: 1,
    });
    expect(paintFromCustom({ hex: 'nope' }, undefined, 'wall')).toBeNull();
  });

  it('compares and names paints', () => {
    const cat = paintFromCatalog(PAINTS[0], undefined, 'wall');
    expect(isSamePaint(cat, { hex: '#000', paintId: 'p-linen' })).toBe(true);
    expect(isSamePaint(cat, { hex: '#eee6d8' })).toBe(false);
    const custom = paintFromCustom({ hex: '#123456' }, undefined, 'wall')!;
    expect(isSamePaint(custom, { hex: '#123456' })).toBe(true);
    expect(isSamePaint(undefined, { hex: '#123456' })).toBe(false);
    expect(paintDisplayName(custom)).toBe('Custom color');
    expect(displayHex('#abc')).toBe('#AABBCC');
  });

  it('collects unique colors used across photos and designs, most used first', () => {
    const navy = paintFromCatalog(PAINTS[4], undefined, 'front-door');
    const linen = paintFromCatalog(PAINTS[0], undefined, 'trim');
    const custom = paintFromCustom({ hex: '#123456', name: 'Ink' }, undefined, 'wall')!;
    const used = usedPaintColors(
      project([
        { a: linen, b: navy, c: { type: 'material', materialId: 'oak', scale: 1, rotation: 0, strength: 1 } },
        { a: navy, d: custom, e: { ...custom, hex: '#123456' } },
      ]),
    );
    expect(used.map((u) => [u.paintId ?? u.hex, u.uses])).toEqual([
      ['p-navy', 2],
      ['#123456', 2],
      ['p-linen', 1],
    ]);
    expect(used[1].name).toBe('Ink');
    expect(usedPaintColors(null)).toEqual([]);
  });

  it('describes LRV and ΔE in words', () => {
    expect(lrvLabel(85)).toBe('Very light');
    expect(lrvLabel(60)).toBe('Light');
    expect(lrvLabel(40)).toBe('Mid-tone');
    expect(lrvLabel(20)).toBe('Deep');
    expect(lrvLabel(5)).toBe('Very dark');
    expect(deltaELabel(0.5)).toBe('Identical');
    expect(deltaELabel(3)).toBe('Very close');
    expect(deltaELabel(20)).toBe('Similar');
  });
});

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

describe('materials', () => {
  const list = [
    material('oak', 'flooring', 'White Oak Planks', { tags: ['wood'] }),
    material('subway', 'tile', 'Classic Subway Tile', { texture: { pattern: 'subway', colors: ['#fff'], unitWidthIn: 6, unitHeightIn: 3, variation: 0.1, seed: 2 } }),
    material('walnut', 'flooring', 'Walnut Herringbone', { tags: ['wood', 'dark'] }),
    material('slate', 'tile', 'Slate Hex', {
      description: 'Natural cleft stone',
      texture: { pattern: 'hex-tile', colors: ['#555'], unitWidthIn: 8, unitHeightIn: 8, variation: 0.3, seed: 3 },
    }),
  ];

  it('groups by category in order of first appearance', () => {
    expect(groupMaterials(list).map((g) => [g.category, g.label, g.materials.map((m) => m.id)])).toEqual([
      ['flooring', 'Flooring', ['oak', 'walnut']],
      ['tile', 'Tile', ['subway', 'slate']],
    ]);
  });

  it('searches names first, then tags, descriptions, categories and patterns', () => {
    expect(searchMaterials(list, 'wal').map((m) => m.id)).toEqual(['walnut']);
    expect(searchMaterials(list, 'wood').map((m) => m.id)).toEqual(['oak', 'walnut']);
    expect(searchMaterials(list, 'stone').map((m) => m.id)).toEqual(['slate']);
    expect(searchMaterials(list, 'tile').map((m) => m.id)).toEqual(['subway', 'slate']);
    expect(searchMaterials(list, 'subway').map((m) => m.id)).toEqual(['subway']);
    expect(searchMaterials(list, '  ')).toHaveLength(4);
  });

  it('builds treatments keeping rotation & strength but resetting scale and tint', () => {
    expect(materialTreatmentFor(list[0], undefined)).toEqual({ type: 'material', materialId: 'oak', scale: 1, rotation: 0, strength: 1 });
    const prev: Treatment = { type: 'material', materialId: 'oak', scale: 2, rotation: 45, strength: 0.7, tint: '#aa8866' };
    expect(materialTreatmentFor(list[2], prev)).toEqual({ type: 'material', materialId: 'walnut', scale: 1, rotation: 45, strength: 0.7 });
    expect(isDefaultAdjust(materialTreatmentFor(list[0], undefined))).toBe(true);
    expect(isDefaultAdjust(prev as Extract<Treatment, { type: 'material' }>)).toBe(false);
  });

  it('scales units, snaps to true size and normalizes rotation', () => {
    expect(scaledUnitSize(list[0], 2)).toEqual({ w: 15, h: 144 });
    expect(scaledUnitSize(list[0], -1)).toEqual({ w: 7.5, h: 72 });
    expect(snapScale(1.02)).toBe(1);
    expect(snapScale(1.5)).toBe(1.5);
    expect(snapScale(0)).toBe(1);
    expect(normalizeRotation(270)).toBe(-90);
    expect(normalizeRotation(-200)).toBe(160);
    expect(normalizeRotation(Number.NaN)).toBe(0);
    expect(unitNoun('wood-planks')).toBe('plank');
    expect(unitNoun('grass')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe('format', () => {
  it('formats areas, shares, sizes and scales', () => {
    expect(formatSqFt(142.4)).toBe('≈ 142 sq ft');
    expect(formatSqFt(8.46)).toBe('≈ 8.5 sq ft');
    expect(formatSqFt(1240)).toBe('≈ 1,240 sq ft');
    expect(formatShare(0.004)).toBe('< 1%');
    expect(formatShare(0.234)).toBe('23%');
    expect(formatShare(0)).toBe('0%');
    expect(formatUnitSize(7.5, 72)).toBe('7.5 × 72 in');
    expect(formatUnitSize(0.375, 0.375)).toBe('0.38 × 0.38 in');
    expect(formatScale(1)).toBe('1×');
    expect(formatScale(0.333)).toBe('0.33×');
    expect(plural(1, 'surface')).toBe('1 surface');
    expect(plural(3, 'surface')).toBe('3 surfaces');
  });

  it('formats cost ranges', () => {
    expect(formatCostRange({ low: 3, high: 6, unit: 'sqft' })).toBe('$3–$6 / sq ft');
    expect(formatCostRange({ low: 45, high: 45, unit: 'cuyd' })).toBe('$45 / cu yd');
    expect(formatCostRange({ low: 2.5, high: 4, unit: 'sqft' })).toBe('$2.50–$4 / sq ft');
    expect(formatCostRange(undefined)).toBe('');
  });
});
