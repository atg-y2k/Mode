import { describe, expect, it } from 'vitest';
import type { AssetListDraft } from '../shared/api';
import { defaultFinishFor, normalizeHex, postprocessAnalysis, postprocessAssetMeta, postprocessDrafts } from './postprocess';
import { fakeCatalog } from './testing';

const draft = (overrides: Partial<AssetListDraft> = {}): AssetListDraft => ({
  name: 'Item',
  category: 'decor',
  quantity: 1,
  unit: 'each',
  unitCostUsd: 10,
  specs: '',
  vendor: null,
  notes: '',
  hex: null,
  refId: null,
  spaceNames: [],
  ...overrides,
});

describe('normalizeHex', () => {
  it('normalizes 3/6 digit hex with or without #', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('a1b2c3')).toBe('#a1b2c3');
    expect(normalizeHex(' #A1B2C3 ')).toBe('#a1b2c3');
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('postprocessDrafts', () => {
  it('cleans numbers, ids and duplicates', () => {
    const out = postprocessDrafts(
      [
        draft({ name: ' Planter ', quantity: -2, unitCostUsd: -5, refId: 'planter-tall-white' }),
        draft({ name: 'planter', unitCostUsd: 3 }),
        draft({ name: 'Mystery', refId: 'not-in-catalog', unit: ' ', quantity: Number.NaN }),
        draft({ name: '   ' }),
      ],
      fakeCatalog,
    );
    expect(out.map((d) => d.name)).toEqual(['Planter', 'Mystery']);
    expect(out[0]).toMatchObject({ quantity: 0, unitCostUsd: null, refId: 'planter-tall-white' });
    expect(out[1]).toMatchObject({ refId: null, unit: 'each', quantity: 0 });
  });
});

describe('postprocessAnalysis', () => {
  it('drops landscaping for interiors', () => {
    const out = postprocessAnalysis(
      {
        spaceType: 'kitchen',
        summary: ' A kitchen. ',
        style: 'Builder',
        surfaces: [],
        lighting: { natural: '', artificial: '', issues: ['', 'Dark'] },
        landscaping: { features: ['x'], issues: [] },
        opportunities: ['Paint', 'Paint'],
      },
      { image: 'data:image/png;base64,AA==', spaceType: 'kitchen', notes: null },
    );
    expect(out.landscaping).toBeNull();
    expect(out.summary).toBe('A kitchen.');
    expect(out.lighting.issues).toEqual(['Dark']);
    expect(out.opportunities).toEqual(['Paint']);
  });
});

describe('postprocessAssetMeta', () => {
  it('keeps the requested category and sane numbers', () => {
    const out = postprocessAssetMeta(
      {
        name: '',
        category: 'other',
        subcategory: ' Bench ',
        description: '',
        realHeightFt: -1,
        tags: ['Teak', 'teak', 'Outdoor'],
        costLowUsd: null,
        costHighUsd: 400,
      },
      { description: 'teak bench', category: 'furniture', mode: 'vector' },
    );
    expect(out).toMatchObject({
      name: 'teak bench',
      category: 'furniture',
      subcategory: 'bench',
      description: 'teak bench',
      realHeightFt: 3,
      tags: ['teak', 'outdoor'],
      costLowUsd: 400,
      costHighUsd: 400,
    });
  });
});

describe('defaultFinishFor', () => {
  it('picks surface-appropriate finishes', () => {
    expect(defaultFinishFor('ceiling')).toBe('flat');
    expect(defaultFinishFor('trim')).toBe('semi-gloss');
    expect(defaultFinishFor('siding')).toBe('satin');
    expect(defaultFinishFor('wall')).toBe('eggshell');
    expect(defaultFinishFor(undefined)).toBe('eggshell');
  });
});
