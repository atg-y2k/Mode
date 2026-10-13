/**
 * Data-quality checks for the built-in catalog: ids, colors, horticulture
 * sanity, material textures, fixture photometrics and that every asset's
 * aspect matches its rendered art.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DECOR_FORMS, FIXTURE_FORMS, PLANT_FORMS, type ArtSpec } from '../../../shared/art';
import {
  ASSET_CATEGORIES,
  COST_UNITS,
  LIGHT_BEAMS,
  MATERIAL_CATEGORIES,
  PLANT_TYPES,
  SURFACE_KINDS,
  TEXTURE_PATTERNS,
  type AssetDef,
} from '../../../shared/types';
import { FIXTURE_EMITTER_Y, renderArt } from '../art';
import { colorFamilyOf } from '../../engine/color';
import { BUILTIN_ASSETS, DECOR, FIXTURES, MATERIALS, PAINT_COLLECTIONS, PAINT_COLORS, PLANTS } from './index';

const HEX = /^#[0-9a-f]{6}$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function artColors(art: ArtSpec): string[] {
  switch (art.kind) {
    case 'plant':
      return [art.foliage, art.foliage2, art.flower, art.trunk, art.pot].filter((c): c is string => c !== undefined);
    case 'fixture':
      return [art.finish, art.shade].filter((c): c is string => c !== undefined);
    case 'decor':
      return [art.color, art.color2].filter((c): c is string => c !== undefined);
  }
}

describe('ids', () => {
  const all = [...PAINT_COLORS.map((p) => p.id), ...MATERIALS.map((m) => m.id), ...BUILTIN_ASSETS.map((a) => a.id)];

  it('are kebab-case', () => {
    for (const id of all) expect(id, id).toMatch(KEBAB);
  });

  it('are unique across the whole catalog', () => {
    const seen = new Set<string>();
    const dupes = all.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    expect(dupes).toEqual([]);
  });

  it('BUILTIN_ASSETS is plants, then fixtures, then decor', () => {
    expect(BUILTIN_ASSETS).toEqual([...PLANTS, ...FIXTURES, ...DECOR]);
  });
});

describe('paints', () => {
  it('has a designer-sized palette in every collection from the spec', () => {
    expect(PAINT_COLORS.length).toBeGreaterThanOrEqual(150);
    expect(PAINT_COLLECTIONS).toEqual([
      'Warm whites',
      'Cool whites',
      'Greige & neutrals',
      'Grays',
      'Charcoals & blacks',
      'Earth tones',
      'Greens',
      'Blues',
      'Accent reds & oranges',
      'Yellows & golds',
      'Purples & pinks',
      'Exterior classics',
      'Front door favorites',
      'Trim & ceiling',
    ]);
    for (const c of PAINT_COLLECTIONS) {
      expect(PAINT_COLORS.filter((p) => p.collection === c).length, c).toBeGreaterThanOrEqual(8);
    }
  });

  it('colors are listed collection by collection (fan-deck order)', () => {
    const order = PAINT_COLORS.map((p) => PAINT_COLLECTIONS.indexOf(p.collection));
    expect(order.every((v, i) => v >= 0 && (i === 0 || v >= order[i - 1]))).toBe(true);
  });

  it('have valid, unique lowercase hexes and unique names', () => {
    for (const p of PAINT_COLORS) expect(p.hex, p.name).toMatch(HEX);
    expect(new Set(PAINT_COLORS.map((p) => p.hex)).size).toBe(PAINT_COLORS.length);
    expect(new Set(PAINT_COLORS.map((p) => p.name.toLowerCase())).size).toBe(PAINT_COLORS.length);
  });

  it('family agrees with the engine classification', () => {
    for (const p of PAINT_COLORS) expect(p.family, p.name).toBe(colorFamilyOf(p.hex));
  });

  it('covers the main color families', () => {
    const fams = new Set(PAINT_COLORS.map((p) => p.family));
    for (const f of ['white', 'neutral', 'gray', 'black', 'beige', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const) {
      expect(fams.has(f), f).toBe(true);
    }
  });

  it('every color carries use tags', () => {
    for (const p of PAINT_COLORS) {
      expect(p.tags.length, p.name).toBeGreaterThanOrEqual(2);
      for (const t of p.tags) expect(t).toBe(t.trim().toLowerCase());
    }
  });

  it('uses original names, not well-known brand color names or codes', () => {
    const famous = [
      'agreeable gray',
      'repose gray',
      'hale navy',
      'simply white',
      'alabaster',
      'chantilly lace',
      'swiss coffee',
      'revere pewter',
      'edgecomb gray',
      'tricorn black',
      'naval',
      'sea salt',
      'iron ore',
      'urbane bronze',
      'pure white',
      'white dove',
      'accessible beige',
      'kendall charcoal',
      'pale oak',
      'classic gray',
      'evergreen fog',
      'hague blue',
      'railings',
      'elephants breath',
    ];
    for (const p of PAINT_COLORS) {
      const n = p.name.toLowerCase().replace(/['’]/g, '');
      expect(famous.includes(n), p.name).toBe(false);
      expect(p.name, p.name).not.toMatch(/\b(SW|HC|OC|AF|CSP|PPU|PPG|BM)[ -]?\d/i);
    }
  });
});

describe('materials', () => {
  it('cover every material category and every texture pattern', () => {
    expect(new Set(MATERIALS.map((m) => m.category))).toEqual(new Set(MATERIAL_CATEGORIES));
    expect(new Set(MATERIALS.map((m) => m.texture.pattern))).toEqual(new Set(TEXTURE_PATTERNS));
    expect(MATERIALS.length).toBeGreaterThanOrEqual(45);
  });

  it('have valid textures with real unit sizes', () => {
    for (const m of MATERIALS) {
      const t = m.texture;
      expect(TEXTURE_PATTERNS, m.id).toContain(t.pattern);
      expect(t.colors.length, m.id).toBeGreaterThan(0);
      for (const c of t.colors) expect(c, m.id).toMatch(HEX);
      expect(t.unitWidthIn, m.id).toBeGreaterThan(0);
      expect(t.unitHeightIn, m.id).toBeGreaterThan(0);
      expect(Math.max(t.unitWidthIn, t.unitHeightIn), m.id).toBeLessThanOrEqual(144);
      expect(t.variation, m.id).toBeGreaterThanOrEqual(0);
      expect(t.variation, m.id).toBeLessThanOrEqual(1);
      if (t.joint) {
        expect(t.joint.color, m.id).toMatch(HEX);
        expect(t.joint.widthIn, m.id).toBeGreaterThan(0);
        expect(t.joint.widthIn, m.id).toBeLessThan(2);
      }
    }
    expect(new Set(MATERIALS.map((m) => m.texture.seed)).size).toBe(MATERIALS.length);
  });

  it('use true-to-life sizes for the classics', () => {
    const tex = (id: string) => MATERIALS.find((m) => m.id === id)!.texture;
    expect([tex('white-oak-planks').unitWidthIn, tex('white-oak-planks').unitHeightIn]).toEqual([7.5, 72]);
    expect([tex('white-subway-tile').unitWidthIn, tex('white-subway-tile').unitHeightIn]).toEqual([6, 3]);
    expect([tex('clay-brick-pavers').unitWidthIn, tex('clay-brick-pavers').unitHeightIn]).toEqual([8, 4]);
    expect(tex('fiber-cement-lap-white').unitHeightIn).toBe(7);
    expect(tex('pea-gravel').unitWidthIn).toBeCloseTo(0.375);
  });

  it('offer sensible surfaces and costs', () => {
    for (const m of MATERIALS) {
      expect(m.surfaces.length, m.id).toBeGreaterThan(0);
      for (const s of m.surfaces) expect(SURFACE_KINDS, m.id).toContain(s);
      expect(new Set(m.surfaces).size, m.id).toBe(m.surfaces.length);
      expect(m.cost.low, m.id).toBeGreaterThan(0);
      expect(m.cost.high, m.id).toBeGreaterThanOrEqual(m.cost.low);
      // Loose fill is sold by the cubic yard, everything else by the square foot.
      const loose = m.texture.pattern === 'mulch' || m.texture.pattern === 'gravel';
      expect(m.cost.unit, m.id).toBe(loose ? 'cuyd' : 'sqft');
      expect(m.description.length, m.id).toBeGreaterThan(20);
      expect(m.tags.length, m.id).toBeGreaterThan(2);
    }
  });

  it('roofing goes on roofs and lawns are grass', () => {
    for (const m of MATERIALS.filter((x) => x.category === 'roofing')) expect(m.surfaces[0], m.id).toBe('roof');
    for (const m of MATERIALS.filter((x) => x.texture.pattern === 'grass')) expect(m.surfaces, m.id).toEqual(['lawn']);
  });
});

describe('every built-in asset', () => {
  it('is a builtin with art, a category, description, tags and cost', () => {
    for (const a of BUILTIN_ASSETS) {
      expect(a.source, a.id).toBe('builtin');
      expect(ASSET_CATEGORIES, a.id).toContain(a.category);
      expect(a.art, a.id).toBeDefined();
      expect(a.svg, a.id).toBeUndefined();
      expect(a.imageId, a.id).toBeUndefined();
      expect(a.description?.length ?? 0, a.id).toBeGreaterThan(20);
      expect(a.tags.length, a.id).toBeGreaterThan(2);
      expect(a.subcategory, a.id).toMatch(KEBAB);
      expect(a.cost, a.id).toBeDefined();
      expect(COST_UNITS, a.id).toContain(a.cost!.unit);
      expect(a.cost!.low, a.id).toBeGreaterThan(0);
      expect(a.cost!.high, a.id).toBeGreaterThanOrEqual(a.cost!.low);
    }
  });

  it('has an aspect equal to its rendered art (width / height)', () => {
    for (const a of BUILTIN_ASSETS) {
      const r = renderArt(a.art!);
      expect(a.aspect, a.id).toBeCloseTo(r.width / r.height, 10);
      expect(Number.isFinite(a.aspect) && a.aspect > 0, a.id).toBe(true);
    }
  });

  it('has a plausible real height', () => {
    for (const a of BUILTIN_ASSETS) {
      expect(Number.isFinite(a.realHeightFt), a.id).toBe(true);
      expect(a.realHeightFt, a.id).toBeGreaterThan(0.1);
      expect(a.realHeightFt, a.id).toBeLessThanOrEqual(30);
    }
  });

  it('uses valid art forms and hex colors', () => {
    for (const a of BUILTIN_ASSETS) {
      const art = a.art!;
      if (art.kind === 'plant') expect(PLANT_FORMS, a.id).toContain(art.form);
      if (art.kind === 'fixture') expect(FIXTURE_FORMS, a.id).toContain(art.form);
      if (art.kind === 'decor') expect(DECOR_FORMS, a.id).toContain(art.form);
      for (const c of artColors(art)) expect(c, a.id).toMatch(HEX);
    }
  });
});

describe('plants', () => {
  const outdoor = PLANTS.filter((p) => !p.plant!.indoor);
  const indoor = PLANTS.filter((p) => p.plant!.indoor);

  it('is a broad mix with ~12 houseplants', () => {
    expect(PLANTS.length).toBeGreaterThanOrEqual(65);
    expect(indoor.length).toBeGreaterThanOrEqual(10);
    expect(new Set(PLANTS.map((p) => p.plant!.type))).toEqual(new Set(PLANT_TYPES));
  });

  it('have plant art and plant data', () => {
    for (const p of PLANTS) {
      expect(p.category, p.id).toBe('plant');
      expect(p.art?.kind, p.id).toBe('plant');
      const info = p.plant!;
      expect(info.botanical, p.id).toBeTruthy();
      expect(info.sun.length, p.id).toBeGreaterThan(0);
      expect(new Set(info.sun).size, p.id).toBe(info.sun.length);
      expect(['low', 'medium', 'high'], p.id).toContain(info.water);
      expect(info.matureHeightFt, p.id).toBeGreaterThan(0);
      expect(info.matureWidthFt, p.id).toBeGreaterThan(0);
      expect(info.containerSize, p.id).toBeTruthy();
      expect(info.native, p.id).toBeTruthy();
      // Placed height ≤ mature height (+ the pot for houseplants / visible mat thickness for groundcovers).
      expect(p.realHeightFt, p.id).toBeLessThanOrEqual(info.matureHeightFt + 1);
    }
  });

  it('outdoor plants have sane USDA zone ranges', () => {
    for (const p of outdoor) {
      const { zoneMin, zoneMax } = p.plant!;
      expect(Number.isInteger(zoneMin), p.id).toBe(true);
      expect(Number.isInteger(zoneMax), p.id).toBe(true);
      expect(zoneMin!, p.id).toBeGreaterThanOrEqual(1);
      expect(zoneMax!, p.id).toBeLessThanOrEqual(13);
      expect(zoneMin!, p.id).toBeLessThanOrEqual(zoneMax!);
      // Real perennials/shrubs/trees have a limited range; only bedding annuals span everything.
      if (p.plant!.type !== 'annual') expect(zoneMax! - zoneMin!, p.id).toBeLessThanOrEqual(8);
      expect(typeof p.plant!.deerResistant === 'boolean' || p.plant!.deerResistant === undefined, p.id).toBe(true);
    }
  });

  it('houseplants are indoor, unzoned and potted', () => {
    for (const p of indoor) {
      expect(p.plant!.type, p.id).toBe('houseplant');
      expect(p.plant!.zoneMin, p.id).toBeUndefined();
      expect(p.plant!.zoneMax, p.id).toBeUndefined();
      expect(p.art?.kind === 'plant' && p.art.pot, p.id).toBeTruthy();
    }
    for (const p of PLANTS.filter((x) => x.plant!.type === 'houseplant')) expect(p.plant!.indoor, p.id).toBe(true);
  });

  it('art matches the plant (spot checks from the spec)', () => {
    const art = (id: string) => PLANTS.find((p) => p.id === id)!.art!;
    const jm = art('japanese-maple-bloodgood');
    expect(jm.kind === 'plant' && jm.form).toBe('ornamental-tree');
    // Red foliage: red channel clearly dominant.
    if (jm.kind === 'plant') {
      const v = parseInt(jm.foliage.slice(1), 16);
      expect((v >> 16) & 255).toBeGreaterThan(((v >> 8) & 255) * 2);
    }
    const lav = art('lavender-phenomenal');
    expect(lav.kind === 'plant' && lav.form).toBe('flowering-perennial');
    if (lav.kind === 'plant') {
      expect(lav.seed % 3).toBe(0); // spike variant
      const v = parseInt(lav.flower!.slice(1), 16);
      expect(v & 255).toBeGreaterThan((v >> 8) & 255); // purple: blue > green
    }
    const box = art('boxwood-green-velvet');
    expect(box.kind === 'plant' && box.form).toBe('round-shrub');
    for (const p of PLANTS.filter((x) => x.plant!.type === 'grass')) expect(p.art?.kind === 'plant' && p.art.form, p.id).toBe('ornamental-grass');
    for (const p of PLANTS.filter((x) => x.plant!.type === 'vine')) expect(p.art?.kind === 'plant' && p.art.form, p.id).toBe('vine-trellis');
  });

  it('flowering art carries a flower color when the plant blooms showily', () => {
    for (const p of PLANTS) {
      const a = p.art!;
      if (a.kind === 'plant' && (a.form === 'flowering-shrub' || a.form === 'flowering-perennial' || a.form === 'flower-bed')) {
        expect(a.flower, p.id).toMatch(HEX);
        expect(p.plant!.bloom, p.id).toBeTruthy();
      }
    }
  });
});

describe('fixtures', () => {
  it('are lighting assets with fixture art and LightInfo', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(25);
    for (const f of FIXTURES) {
      expect(f.category, f.id).toBe('lighting');
      expect(f.art?.kind, f.id).toBe('fixture');
      const l = f.light!;
      expect(LIGHT_BEAMS, f.id).toContain(l.beam);
      expect(l.kelvin, f.id).toBeGreaterThanOrEqual(1800);
      expect(l.kelvin, f.id).toBeLessThanOrEqual(5000);
      expect(l.lumens, f.id).toBeGreaterThan(0);
      expect(l.lumens, f.id).toBeLessThanOrEqual(5000);
      expect(l.reachFt, f.id).toBeGreaterThan(0);
      expect(l.indoor || l.outdoor, f.id).toBe(true);
      if (l.mountHeightFt !== undefined) expect(l.mountHeightFt, f.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('emit from where the art draws the lamp', () => {
    for (const f of FIXTURES) {
      const art = f.art!;
      if (art.kind !== 'fixture') throw new Error(f.id);
      expect(f.light!.emitterY, f.id).toBe(FIXTURE_EMITTER_Y[art.form]);
    }
  });

  it('line-shaped fixtures use line beams', () => {
    for (const f of FIXTURES) {
      const art = f.art!;
      if (art.kind !== 'fixture') continue;
      if (art.form === 'string-lights') expect(f.light!.beam, f.id).toBe('string');
      if (art.form === 'led-strip') expect(f.light!.beam, f.id).toBe('strip');
    }
  });

  it('cover both interior and exterior lighting', () => {
    expect(FIXTURES.filter((f) => f.light!.indoor).length).toBeGreaterThanOrEqual(10);
    expect(FIXTURES.filter((f) => f.light!.outdoor).length).toBeGreaterThanOrEqual(10);
  });
});

describe('decor', () => {
  it('are decor / furniture / hardscape objects with decor art', () => {
    expect(DECOR.length).toBeGreaterThanOrEqual(25);
    const cats = new Set(DECOR.map((d) => d.category));
    for (const c of ['decor', 'furniture', 'hardscape'] as const) expect(cats.has(c), c).toBe(true);
    for (const d of DECOR) {
      expect(['decor', 'furniture', 'hardscape', 'other'], d.id).toContain(d.category);
      expect(d.art?.kind, d.id).toBe('decor');
      expect(d.plant, d.id).toBeUndefined();
      expect(d.light, d.id).toBeUndefined();
      expect(d.tags.includes('indoor') || d.tags.includes('outdoor'), d.id).toBe(true);
    }
  });

  it('wide items derive their height from the true width', () => {
    const rug = DECOR.find((d) => d.id === 'wool-area-rug-neutral') as AssetDef;
    expect(rug.realHeightFt * rug.aspect).toBeCloseTo(10, 1);
  });
});

/** Source code with string literals and comments blanked out (so prose like "a front window." is ignored). */
function codeOnly(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

describe('module hygiene', () => {
  it('catalog sources use no DOM APIs (the server imports them)', () => {
    for (const f of ['index.ts', 'helpers.ts', 'paints.ts', 'materials.ts', 'plants.ts', 'fixtures.ts', 'decor.ts']) {
      const code = codeOnly(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'));
      expect(code, f).not.toMatch(/\b(document|window|navigator|localStorage|sessionStorage|HTMLElement|OffscreenCanvas|Image|createImageBitmap)\s*[.(]/);
    }
  });

  it('the stripper keeps code and drops prose', () => {
    expect(codeOnly("const a = 'a front window.'; // window.open\nwindow.x")).toBe('const a = ""; \nwindow.x');
  });
});
