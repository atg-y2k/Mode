import { afterEach, describe, expect, it } from 'vitest';
import type { AssetDef, PlantInfo } from '../../../shared/types';
import { invasivesReady, setInvasivesData } from '../../site/invasives';
import { paletteFeasibility, profileFeasibility, shortPlantName } from './feasibility';
import { deerPressureFromNotes, dominantSun, feasibilityContext, optionFeasibility, parseHardinessZone, withPlantFeasibility } from './spec';
import { plantFeasibility } from './index';
import { PLANT_PROFILES } from './plants';
import { getElementDef } from './spec';

function plant(info: Partial<PlantInfo>, name = 'Test plant'): AssetDef {
  return {
    id: 'test-plant',
    name,
    category: 'plant',
    source: 'builtin',
    aspect: 1,
    realHeightFt: 3,
    tags: [],
    plant: {
      type: 'shrub',
      sun: ['full-sun', 'part-sun'],
      water: 'medium',
      zoneMin: 5,
      zoneMax: 8,
      matureHeightFt: 4,
      matureWidthFt: 4,
      evergreen: true,
      indoor: false,
      ...info,
    },
  };
}

describe('plantFeasibility', () => {
  it('rates a plant inside its zone range and sun list as good, with reasons', () => {
    const f = plantFeasibility(plant({}), { zone: 7, zoneLabel: '7a', sun: 'full-sun', areaSqFt: 100 });
    expect(f.rating).toBe('good');
    expect(f.reasons.join(' | ')).toMatch(/zones 5–8 ✓ \(you're zone 7a\)/);
    expect(f.reasons.join(' | ')).toMatch(/full sun ✓/);
    expect(f.reasons.join(' | ')).toMatch(/fits this space/);
  });

  it('flags zones: one colder = caution, two colder = poor, warmer edges likewise', () => {
    expect(plantFeasibility(plant({}), { zone: 4 }).rating).toBe('caution');
    expect(plantFeasibility(plant({}), { zone: 3 }).rating).toBe('poor');
    expect(plantFeasibility(plant({}), { zone: 3 }).reasons[0]).toMatch(/Not winter-hardy/);
    expect(plantFeasibility(plant({}), { zone: 9 }).rating).toBe('caution');
    expect(plantFeasibility(plant({}), { zone: 10 }).rating).toBe('poor');
    expect(plantFeasibility(plant({}), { zone: 10 }).reasons[0]).toMatch(/Too warm/);
  });

  it('treats half zones as their whole zone', () => {
    expect(plantFeasibility(plant({ zoneMax: 7 }), { zone: 7.5, zoneLabel: '7b' }).rating).toBe('good');
  });

  it('does not guess without a zone, but asks for one', () => {
    const f = plantFeasibility(plant({}), {});
    expect(f.rating).toBe('good');
    expect(f.reasons.join(' ')).toMatch(/add your ZIP/i);
  });

  it('compares sun needs with the spot', () => {
    const sunLover = plant({ sun: ['full-sun'] });
    expect(plantFeasibility(sunLover, { zone: 6, sun: 'part-sun' }).rating).toBe('caution');
    const shaded = plantFeasibility(sunLover, { zone: 6, sun: 'shade' });
    expect(shaded.rating).toBe('poor');
    expect(shaded.reasons[0]).toMatch(/Needs full sun/);
    const shadePlant = plant({ sun: ['part-sun', 'shade'] });
    expect(plantFeasibility(shadePlant, { zone: 6, sun: 'full-sun' }).rating).toBe('poor');
    expect(plantFeasibility(shadePlant, { zone: 6, sun: 'shade' }).rating).toBe('good');
    const partOnly = plant({ sun: ['part-sun'] });
    expect(plantFeasibility(partOnly, { zone: 6, sun: 'full-sun' }).rating).toBe('caution');
  });

  it('compares mature width with the available space', () => {
    const tree = plant({ type: 'tree', matureWidthFt: 30, matureHeightFt: 40 });
    const small = plantFeasibility(tree, { zone: 6, areaSqFt: 36 });
    expect(small.rating).toBe('poor');
    expect(small.reasons[0]).toMatch(/30 ft wide; this space is only ~6 ft across/);
    expect(plantFeasibility(tree, { zone: 6, areaSqFt: 30 * 30 }).rating).toBe('caution');
    expect(plantFeasibility(tree, { zone: 6, areaSqFt: 50 * 50 }).rating).toBe('good');
    expect(plantFeasibility(tree, { zone: 6 }).reasons.join(' ')).toMatch(/20\+ ft from the house/);
  });

  it('adds cautions for deer, rainfall and invasive species', () => {
    const deerCandy = plant({ deerResistant: false });
    expect(plantFeasibility(deerCandy, { zone: 6, deerPressure: true }).rating).toBe('caution');
    expect(plantFeasibility(deerCandy, { zone: 6 }).rating).toBe('good');
    expect(plantFeasibility(plant({ deerResistant: true }), { zone: 6, deerPressure: true }).reasons).toContain('Deer resistant ✓');
    expect(plantFeasibility(plant({ water: 'high' }), { zone: 6, annualRainfallIn: 12 }).rating).toBe('caution');
    expect(plantFeasibility(plant({ water: 'low' }), { zone: 6, annualRainfallIn: 12 }).reasons).toContain('Drought tolerant once established ✓');
    expect(plantFeasibility(plant({ water: 'low', type: 'perennial' }), { zone: 6, annualRainfallIn: 60 }).rating).toBe('caution');
    const barberry = plantFeasibility(plant({ botanical: 'Berberis thunbergii' }, 'Japanese barberry'), { zone: 6 });
    expect(barberry.rating).toBe('caution');
    expect(barberry.reasons.join(' ')).toMatch(/invasive/i);
  });

  it('grades deer advice by deer pressure (low / medium / high)', () => {
    const favorite = plant({ deerResistant: false });
    const high = plantFeasibility(favorite, { zone: 6, deerPressure: 'high' });
    expect(high.rating).toBe('caution');
    expect(high.reasons[0]).toMatch(/deer pressure is high here/);
    expect(plantFeasibility(favorite, { zone: 6, deerPressure: 'medium' }).reasons[0]).toBe('Deer favorite — protect it or choose a deer-resistant plant');
    // true (deer noted in the climate profile) reads like medium; low / false skip deer advice entirely.
    expect(plantFeasibility(favorite, { zone: 6, deerPressure: true }).reasons[0]).toBe('Deer favorite — protect it or choose a deer-resistant plant');
    for (const none of ['low', false] as const) {
      const f = plantFeasibility(favorite, { zone: 6, deerPressure: none });
      expect(f.rating).toBe('good');
      expect(f.reasons.join(' ')).not.toMatch(/deer/i);
    }
    // Unknown pressure: a note only.
    const unknown = plantFeasibility(favorite, { zone: 6 });
    expect(unknown.rating).toBe('good');
    expect(unknown.reasons).toContain('Browsed by deer where they are common');
    // Resistant plants are confirmed under any pressure; unrated ones get a hint under high pressure.
    expect(plantFeasibility(plant({ deerResistant: true }), { zone: 6, deerPressure: 'high' }).reasons).toContain('Deer resistant ✓');
    expect(plantFeasibility(plant({ deerResistant: true }), { zone: 6, deerPressure: 'low' }).reasons).not.toContain('Deer resistant ✓');
    const unrated = plantFeasibility(plant({}), { zone: 6, deerPressure: 'high' });
    expect(unrated.rating).toBe('good');
    expect(unrated.reasons.join(' ')).toMatch(/Deer resistance not rated/);
    // Interior plants never get deer advice.
    expect(plantFeasibility(favorite, { setting: 'interior', deerPressure: 'high' }).reasons.join(' ')).not.toMatch(/deer/i);
  });

  it('evaluates houseplants indoors by light and outdoors as summer containers', () => {
    const fig = plant({ type: 'houseplant', indoor: true, zoneMin: undefined, zoneMax: undefined, sun: ['full-sun', 'part-sun'] }, 'Fiddle-leaf fig');
    expect(plantFeasibility(fig, { zone: 6, setting: 'interior', sun: 'part-sun' }).rating).toBe('good');
    const dark = plantFeasibility(fig, { setting: 'interior', sun: 'shade' });
    expect(dark.rating).toBe('caution');
    expect(dark.reasons[0]).toMatch(/bright/);
    expect(plantFeasibility(fig, { zone: 6, setting: 'exterior' }).rating).toBe('caution');
    expect(plantFeasibility(fig, { zone: 11, setting: 'exterior' }).rating).toBe('good');
    // an outdoor shrub is a poor houseplant
    expect(plantFeasibility(plant({}), { setting: 'interior' }).rating).toBe('poor');
  });

  it('is cautious about assets without plant data', () => {
    const asset = plant({});
    delete asset.plant;
    expect(plantFeasibility(asset, { zone: 6 }).rating).toBe('caution');
  });
});

describe('US-RIIS invasive reasons', () => {
  afterEach(() => setInvasivesData(null));
  const RIIS = {
    rows: [
      ['Prunus laurocerasus', 'Cherry laurel', '300'],
      ['Lavandula angustifolia', 'English lavender', '100'],
      ['Cynodon dactylon', 'Bermudagrass', '303'],
      ['Zoysia japonica', 'Zoysiagrass', '100'],
      ['Berberis thunbergii', 'Japanese barberry', '300'],
      ['Euonymus fortunei var. radicans', 'Climbing euonymus', '200'],
      ['Ficus elastica', 'Indian rubberplant', '202'],
      ['Mentha X piperita', 'Peppermint', '020'],
    ] as [string, string, string][],
  };

  it('adds nothing until the list has loaded (rating stays synchronous)', () => {
    expect(invasivesReady()).toBe(false);
    expect(plantFeasibility(plant({ botanical: "Prunus laurocerasus 'Otto Luyken'" }), { zone: 7 }).rating).toBe('good');
  });

  it('cautions on plants listed invasive in the region, with the source', () => {
    setInvasivesData(RIIS);
    const f = plantFeasibility(plant({ botanical: "Prunus laurocerasus 'Schipkaensis'" }, 'Skip laurel'), { zone: 7 });
    expect(f.rating).toBe('caution');
    expect(f.reasons[0]).toBe(
      "Invasive risk: Cherry laurel (Prunus laurocerasus) is listed as a widespread invasive in the lower 48 states (USGS US-RIIS v2.0) — check your state's invasive plant list before planting",
    );
  });

  it('keeps the curated regional note when both lists know the plant', () => {
    setInvasivesData(RIIS);
    const f = plantFeasibility(plant({ botanical: 'Berberis thunbergii' }, 'Japanese barberry'), { zone: 6 });
    const invasive = f.reasons.filter((r) => /invasive/i.test(r));
    expect(invasive).toHaveLength(1);
    expect(invasive[0]).toMatch(/East and Midwest/);
  });

  it('ignores "established" (introduced, not invasive) plants', () => {
    setInvasivesData(RIIS);
    expect(plantFeasibility(plant({ botanical: "Lavandula angustifolia 'Hidcote'" }), { zone: 6 }).reasons.join(' ')).not.toMatch(/invasive|US-RIIS/i);
  });

  it('treats spreading lawn grasses as a note, checking every species of a mix', () => {
    setInvasivesData(RIIS);
    const lawn = plant({ type: 'grass', botanical: 'Zoysia japonica / Cynodon dactylon', matureWidthFt: 0, matureHeightFt: 0.2 }, 'Zoysia / Bermuda grass');
    const f = plantFeasibility(lawn, { zone: 8 });
    expect(f.rating).toBe('good');
    expect(f.reasons.join(' ')).toMatch(/^.*Spreads beyond the lawn: Bermudagrass \(Cynodon dactylon\)/);
  });

  it('uses the property region (Hawaii lists differ from the lower 48)', () => {
    setInvasivesData(RIIS);
    const rubber = plant({ type: 'tree', botanical: 'Ficus elastica', zoneMin: 10, zoneMax: 12 }, 'Rubber tree');
    expect(plantFeasibility(rubber, { zone: 11, setting: 'exterior' }).reasons.join(' ')).toMatch(/invasive in the lower 48/);
    expect(plantFeasibility(rubber, { zone: 11, setting: 'exterior', locality: 'HI' }).reasons.join(' ')).toMatch(/invasive in Hawaii/);
    const mint = plant({ type: 'perennial', botanical: 'Mentha × piperita' }, 'Peppermint');
    expect(plantFeasibility(mint, { zone: 6 }).reasons.join(' ')).not.toMatch(/invasive/i);
    expect(plantFeasibility(mint, { zone: 4, locality: 'AK' }).rating).toBe('caution');
  });

  it('notes when only some forms of a species are listed', () => {
    setInvasivesData(RIIS);
    const f = plantFeasibility(plant({ botanical: "Euonymus fortunei 'Emerald Gaiety'" }), { zone: 6 });
    expect(f.rating).toBe('good');
    expect(f.reasons.join(' ')).toMatch(/Euonymus fortunei var\. radicans \(a form of this species\)/);
  });

  it('flags palettes that include a listed plant, naming it', () => {
    setInvasivesData({ rows: [...RIIS.rows, ['Acer palmatum', 'Japanese maple', '300']] });
    const f = paletteFeasibility([PLANT_PROFILES['japanese-maple'], PLANT_PROFILES.coneflower], 'all', { zone: 6, sun: 'full-sun' });
    expect(f?.rating).toBe('caution');
    expect(f?.reasons[0]).toMatch(/^Japanese maple: Invasive risk: Japanese maple \(Acer palmatum\)/);
  });
});

describe('palette feasibility', () => {
  const P = PLANT_PROFILES;

  it('shortens plant names without cultivars', () => {
    expect(shortPlantName("Boxwood 'Green Velvet'")).toBe('Boxwood');
    expect(shortPlantName("Catmint 'Walker's Low'")).toBe('Catmint');
    expect(shortPlantName('Microclover (overseeded in turf)')).toBe('Microclover');
    expect(shortPlantName('Pink muhly grass')).toBe('Pink muhly grass');
  });

  it('"all" palettes are good only when every plant is, naming the problem plants', () => {
    const good = paletteFeasibility([P.coneflower, P['black-eyed-susan'], P.catmint], 'all', { zone: 6, zoneLabel: '6b', sun: 'full-sun' });
    expect(good?.rating).toBe('good');
    expect(good?.reasons).toContain('All 3 hardy in zone 6b ✓');
    const mixed = paletteFeasibility([P['feather-reed-grass'], P.switchgrass, P['prairie-dropseed'], P['pink-muhly']], 'all', { zone: 4, sun: 'full-sun' });
    expect(mixed?.rating).toBe('caution');
    expect(mixed?.reasons[0]).toMatch(/^Pink muhly grass: Not winter-hardy/);
    const shadeInSun = paletteFeasibility([P.hosta, P.hellebore, P['autumn-fern']], 'all', { zone: 6, sun: 'full-sun' });
    expect(shadeInSun?.rating).toBe('poor');
  });

  it('"any" palettes are rated by the best-suited alternative', () => {
    const f = paletteFeasibility([P['creeping-thyme'], P['pennsylvania-sedge']], 'any', { zone: 6, sun: 'shade' });
    expect(f?.rating).toBe('good');
    expect(f?.reasons[0]).toBe('Best fit here: Pennsylvania sedge ✓');
    expect(paletteFeasibility([], 'any', {})).toBeUndefined();
  });

  it('profileFeasibility matches plantFeasibility for the same data', () => {
    const p = P['japanese-maple'];
    const viaAsset = plantFeasibility({ ...plant({}), name: p.name, plant: p }, { zone: 9, sun: 'full-sun' });
    expect(profileFeasibility(p, { zone: 9, sun: 'full-sun' })).toEqual(viaAsset);
  });

  it('annotates built-in plant options of a dimension', () => {
    expect(optionFeasibility('trees-shrubs', 'species', 'crape-myrtle', { zone: 5 })?.rating).toBe('poor');
    expect(optionFeasibility('trees-shrubs', 'species', 'crape-myrtle', { zone: 8, sun: 'full-sun' })?.rating).toBe('good');
    expect(optionFeasibility('pathway', 'width', 'width-4ft', { zone: 8 })).toBeUndefined();
    const dims = withPlantFeasibility('trees-shrubs', getElementDef('trees-shrubs').dimensions, { zone: 5 });
    const species = dims.find((d) => d.id === 'species');
    expect(species?.options.every((o) => o.feasibility)).toBe(true);
    expect(getElementDef('trees-shrubs').dimensions.find((d) => d.id === 'species')?.options[0].feasibility).toBeUndefined();
  });
});

describe('feasibility context', () => {
  it('parses hardiness zones', () => {
    expect(parseHardinessZone('7a')).toBe(7);
    expect(parseHardinessZone('10b')).toBe(10);
    expect(parseHardinessZone(' Zone 6 ')).toBe(6);
    expect(parseHardinessZone('hot')).toBeUndefined();
    expect(parseHardinessZone('99')).toBeUndefined();
    expect(parseHardinessZone(undefined)).toBeUndefined();
  });

  it('finds the dominant sun of zones', () => {
    expect(dominantSun([{ sun: 'shade' }, { sun: 'shade' }, { sun: 'full-sun' }])).toBe('shade');
    expect(dominantSun([{ sun: 'shade' }, { sun: 'full-sun' }])).toBe('part-sun');
    expect(dominantSun([{}, {}])).toBeUndefined();
  });

  it('reads deer pressure from climate notes', () => {
    expect(deerPressureFromNotes(['Heavy deer pressure in wooded suburbs'])).toBe(true);
    expect(deerPressureFromNotes(['Low deer pressure in the city'])).toBe(false);
    expect(deerPressureFromNotes(['Clay soils'])).toBeUndefined();
    expect(deerPressureFromNotes(undefined)).toBeUndefined();
  });

  it('builds a context from the project location and zones', () => {
    const ctx = feasibilityContext(
      {
        zip: '02139',
        hardinessZone: '6b',
        climate: { hardinessZone: '7a', summary: '', annualRainfallIn: 46, notes: ['Deer are common'], source: 'ai', updatedAt: 0 },
      },
      [{ sun: 'part-sun' }],
    );
    expect(ctx).toEqual({ setting: 'exterior', zone: 7, zoneLabel: '7a', sun: 'part-sun', annualRainfallIn: 46, deerPressure: true });
    expect(feasibilityContext(undefined)).toEqual({ setting: 'exterior' });
  });
});
