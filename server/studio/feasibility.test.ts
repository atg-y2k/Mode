import { describe, expect, it } from 'vitest';
import type { ElementOptionsResult, PlanRequest, PlanResult } from '../../shared/api';
import type { AssetDef } from '../../shared/types';
import {
  catalogPlantsFromAssets,
  catalogVerdict,
  crossCheckOptions,
  crossCheckPlanPlants,
  findCatalogPlant,
  parseZoneNumber,
  propertyZone,
  targetedSun,
} from './feasibility';

const asset = (name: string, botanical: string, zoneMin: number, zoneMax: number, sun: ('full-sun' | 'part-sun' | 'shade')[]): AssetDef => ({
  id: name.toLowerCase().replace(/\W+/g, '-'),
  name,
  category: 'plant',
  source: 'builtin',
  aspect: 1,
  realHeightFt: 2,
  tags: [],
  plant: { botanical, type: 'perennial', sun, water: 'low', zoneMin, zoneMax, matureHeightFt: 2, matureWidthFt: 2, evergreen: false, indoor: false },
});

const plants = catalogPlantsFromAssets([
  asset("Lavender 'Hidcote'", "Lavandula angustifolia 'Hidcote'", 5, 9, ['full-sun']),
  asset('Hosta', 'Hosta sieboldiana', 3, 8, ['part-sun', 'shade']),
  asset('Bougainvillea', 'Bougainvillea glabra', 9, 11, ['full-sun']),
]);

describe('zones', () => {
  it('parses zone numbers', () => {
    expect(parseZoneNumber('7a')).toBe(7);
    expect(parseZoneNumber('Zone 7b')).toBe(7.5);
    expect(parseZoneNumber('USDA 10a')).toBe(10);
    expect(parseZoneNumber('')).toBeNull();
    expect(propertyZone({ zip: '1', hardinessZone: null, notes: null }, 'USDA zone 6b. Cold winters.')).toBe(6.5);
    expect(propertyZone(null, null)).toBeNull();
  });
});

describe('matching', () => {
  it('matches by common name or species', () => {
    expect(findCatalogPlant('hosta', null, plants)?.name).toBe('Hosta');
    expect(findCatalogPlant('English lavender', "Lavandula angustifolia 'Munstead'", plants)?.name).toBe("Lavender 'Hidcote'");
    expect(findCatalogPlant('Mystery shrub', 'Unknownus plantus', plants)).toBeNull();
  });
});

describe('catalogVerdict', () => {
  const [lavender, hosta, bougainvillea] = plants;
  it('flags cold and heat limits and sun mismatches', () => {
    expect(catalogVerdict(bougainvillea, 6, null)?.rating).toBe('poor');
    expect(catalogVerdict(hosta, 9.5, null)?.rating).toBe('caution');
    expect(catalogVerdict(hosta, 10, null)?.rating).toBe('poor');
    expect(catalogVerdict(lavender, 7, 'shade')).toMatchObject({ rating: 'caution' });
    expect(catalogVerdict(lavender, 7, 'full-sun')).toBeNull();
    expect(catalogVerdict(lavender, null, null)).toBeNull();
  });
});

describe('cross-checks', () => {
  it('downgrades plan plants the catalog contradicts, never upgrades', () => {
    const notes: PlanResult['plants'] = [
      { name: 'Bougainvillea', botanical: 'Bougainvillea glabra', rating: 'good', notes: ['Vivid color'], alternative: null },
      { name: 'Hosta', botanical: null, rating: 'poor', notes: ['Deer love it'], alternative: 'Hellebore' },
      { name: 'Coneflower', botanical: 'Echinacea purpurea', rating: 'good', notes: [], alternative: null },
    ];
    const out = crossCheckPlanPlants(notes, { plants, zone: 6, sun: null });
    expect(out[0].rating).toBe('poor');
    expect(out[0].notes[1]).toContain('too cold');
    expect(out[1]).toEqual(notes[1]);
    expect(out[2]).toEqual(notes[2]);
  });

  it('checks plant options of element choices', () => {
    const result: ElementOptionsResult = {
      tips: [],
      dimensions: [
        {
          id: 'plants',
          label: 'Plants',
          question: '?',
          multiple: true,
          options: [
            {
              id: 'lavender',
              label: 'Lavender',
              description: "Lavandula angustifolia 'Hidcote', 18 in mounds",
              promptText: 'lavender',
              visual: { kind: 'none', pattern: null, colors: [], unitWidthIn: null, unitHeightIn: null },
              rationale: '',
              feasibility: { rating: 'good', reasons: ['Loves sun'] },
            },
          ],
        },
      ],
    };
    const out = crossCheckOptions(result, { plants, zone: 4, sun: null });
    expect(out.dimensions[0].options[0].feasibility?.rating).toBe('poor');
    expect(crossCheckOptions(result, { plants, zone: 7, sun: null })).toEqual(result);
  });

  it('derives the sun of the targeted areas when they agree', () => {
    const req = {
      zones: [
        { id: 'a', kind: 'planting-bed', label: 'Front bed', description: '', sun: 'shade' },
        { id: 'b', kind: 'lawn', label: 'Lawn', description: '', sun: 'full-sun' },
        { id: 'c', kind: 'facade', label: 'Facade', description: '', sun: null },
      ],
      brief: { prompt: '', scope: 'zones', plantMaturity: 'new', targetZoneLabels: ['Front bed', 'Facade'], elements: [] },
    } as unknown as PlanRequest;
    expect(targetedSun(req)).toBe('shade');
    expect(targetedSun({ ...req, brief: { ...req.brief, targetZoneLabels: ['Front bed', 'Lawn'] } })).toBeNull();
  });
});
