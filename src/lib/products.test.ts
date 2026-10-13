import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductResult } from '../../shared/api';

vi.mock('../assets/design', () => ({ optionVisualFromDraft: () => undefined, mergeDimensions: (b: unknown) => b }));
vi.mock('./imageImport', () => ({ blobToAIDataUrl: async () => 'data:image/jpeg;base64,AAAA' }));

const products = await import('./products');

const base: ProductResult = {
  name: 'Limelight Panicle Hydrangea',
  brand: 'Proven Winners',
  store: 'Nature Hills Nursery',
  storeKind: 'nursery',
  url: 'https://www.naturehills.com/limelight-hydrangea',
  imageUrl: 'https://cdn.naturehills.com/limelight.jpg',
  priceUsd: 39.95,
  priceText: '$39.95',
  category: 'plant',
  description: 'Big lime-green blooms that age to pink. Deer resistant once established.',
  realHeightFt: null,
  specs: ['3 gal container', 'Evergreen? No'],
  plant: { botanical: 'Hydrangea paniculata', sun: 'Full sun to part shade', water: 'Medium', zones: '3-9', matureSize: '6-8 ft tall x 6-8 ft wide' },
  light: null,
};

describe('productToAsset', () => {
  it('maps a plant product with feasibility-relevant info', () => {
    const asset = products.productToAsset(base, { imageId: 'img_1', aspect: 0.8 });
    expect(asset).toMatchObject({
      name: 'Limelight Panicle Hydrangea',
      category: 'plant',
      source: 'user',
      imageId: 'img_1',
      aspect: 0.8,
      vendorUrl: base.url,
      cost: { low: 39.95, high: 39.95, unit: 'each' },
      subcategory: 'shrub',
    });
    expect(asset.id).toMatch(/^asset_/);
    expect(asset.plant).toEqual({
      type: 'shrub',
      botanical: 'Hydrangea paniculata',
      sun: ['full-sun', 'part-sun'],
      water: 'medium',
      zoneMin: 3,
      zoneMax: 9,
      matureHeightFt: 8,
      matureWidthFt: 8,
      evergreen: false,
      indoor: false,
      containerSize: '3 gal',
      deerResistant: true,
    });
    expect(asset.realHeightFt).toBe(6);
    expect(asset.product).toMatchObject({ store: 'Nature Hills Nursery', storeKind: 'nursery', priceUsd: 39.95, imageUrl: base.imageUrl, brand: 'Proven Winners' });
    expect(asset.tags).toEqual(['plant', 'nature hills nursery', 'proven winners', 'shrub']);
  });

  it('maps a lighting product with sensible defaults', () => {
    const light: ProductResult = {
      ...base,
      name: 'Hampton Bay Low Voltage Bronze LED Path Light',
      brand: null,
      store: 'The Home Depot',
      storeKind: 'home-depot',
      category: 'lighting',
      description: 'Outdoor path light.',
      priceUsd: null,
      priceText: null,
      specs: ['3000K'],
      plant: null,
      light: { kelvin: 3000, lumens: 100, indoor: false, outdoor: true },
    };
    const asset = products.productToAsset(light, { imageId: 'img_2', aspect: Number.NaN });
    expect(asset.aspect).toBe(1);
    expect(asset.realHeightFt).toBe(1.8);
    expect(asset.cost).toBeUndefined();
    expect(asset.plant).toBeUndefined();
    expect(asset.light).toEqual({ beam: 'down', kelvin: 3000, lumens: 100, reachFt: 4, emitterY: 0.15, indoor: false, outdoor: true, mountHeightFt: 0 });
  });

  it('falls back to category heights', () => {
    const chair = products.productToAsset({ ...base, category: 'furniture', plant: null, name: 'Teak chair', description: '' }, { imageId: 'i', aspect: 1 });
    expect(chair.realHeightFt).toBe(3);
    expect(chair.description).toBe('3 gal container · Evergreen? No');
    expect(products.productToAsset({ ...base, realHeightFt: 4.5 }, { imageId: 'i', aspect: 1 }).realHeightFt).toBe(4.5);
  });
});

describe('text parsing', () => {
  it('parses sun exposure', () => {
    expect(products.parseSun('Full sun')).toEqual(['full-sun']);
    expect(products.parseSun('Part sun')).toEqual(['part-sun']);
    expect(products.parseSun('Partial shade to full shade')).toEqual(['part-sun', 'shade']);
    expect(products.parseSun('Shade')).toEqual(['shade']);
    expect(products.parseSun(null)).toEqual(['full-sun', 'part-sun']);
  });

  it('parses zones, water and sizes', () => {
    expect(products.parseZones('Zones 4 to 8')).toEqual({ min: 4, max: 8 });
    expect(products.parseZones('5a-9b')).toEqual({ min: 5, max: 9 });
    expect(products.parseZones('9-5')).toBeNull();
    expect(products.parseWater('Drought tolerant')).toBe('low');
    expect(products.parseWater('Keep consistently moist')).toBe('high');
    expect(products.parseSizesFt('3-4 ft tall x 2-3 ft wide')).toEqual({ height: 4, width: 3 });
    expect(products.parseSizesFt('Width: 30 in, Height: 18 in')).toEqual({ height: 1.5, width: 2.5 });
    expect(products.parseSizesFt("15' x 10'")).toEqual({ height: 15, width: 10 });
    expect(products.parseSizesFt('')).toEqual({ height: null, width: null });
  });
});

describe('network helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches product images through the proxy with the URL encoded', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([9]), { headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = await products.fetchProductImage('https://cdn.example.com/a b.jpg?x=1&y=2');
    expect(blob.size).toBe(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/products/image?url=https%3A%2F%2Fcdn.example.com%2Fa%20b.jpg%3Fx%3D1%26y%3D2');
  });

  it('posts pasted links and validates the response', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ product: base, method: 'structured-data' }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await products.productFromUrl('  https://www.naturehills.com/limelight-hydrangea ');
    expect(out.method).toBe('structured-data');
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ url: 'https://www.naturehills.com/limelight-hydrangea' });
  });
});
