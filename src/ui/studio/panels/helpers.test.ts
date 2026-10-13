import { describe, expect, it } from 'vitest';
import type { ProductResult } from '../../../../shared/api';
import { ZONE_KINDS, SURFACE_KINDS, type SceneZone } from '../../../../shared/types';
import { ApiError } from '../../../lib/api';
import { AI_OFF_REASON, NO_DEVICE_MAP_REASON, aiAvailability, aiUsable, formatElapsed, friendlyAiError } from './aiErrors';
import { extractPalette } from './colors';
import { normalizeProductUrl, priceLabel, productInfoFrom, urlHost, zoneFit } from './productInfo';
import { ZONE_KIND_LABELS, isDesignZone, splitZones, zoneSurface, zonesForElement } from './zones';

function solid(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number?]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

describe('extractPalette', () => {
  it('finds the dominant colors, largest first', () => {
    // 60% green, 30% blue, 10% red.
    const img = solid(100, 100, (x) => (x < 60 ? [40, 140, 60] : x < 90 ? [30, 60, 200] : [210, 40, 30]));
    const palette = extractPalette(img, 5);
    expect(palette[0]).toBe('#288c3c');
    expect(palette[1]).toBe('#1e3cc8');
    expect(palette[2]).toBe('#d2281e');
    expect(palette).toHaveLength(3);
  });

  it('is deterministic and ignores transparent pixels', () => {
    const img = solid(64, 64, (x, y) => (y < 32 ? [250, 250, 250, 0] : x < 32 ? [120, 90, 60] : [200, 180, 140]));
    const a = extractPalette(img, 5);
    const b = extractPalette(img, 5);
    expect(a).toEqual(b);
    expect(a).not.toContain('#fafafa');
    expect(a).toHaveLength(2);
  });

  it('merges near duplicates and handles empty images', () => {
    const img = solid(50, 50, (x) => (x % 2 ? [100, 100, 100] : [104, 102, 101]));
    expect(extractPalette(img, 5)).toHaveLength(1);
    expect(extractPalette({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toEqual([]);
    expect(extractPalette(solid(4, 4, () => [0, 0, 0, 0]))).toEqual([]);
  });

  it('returns at most `count` colors on busy images', () => {
    const img = solid(120, 120, (x, y) => [(x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 256]);
    const p = extractPalette(img, 5);
    expect(p.length).toBeLessThanOrEqual(5);
    expect(p.length).toBeGreaterThanOrEqual(2);
    for (const hex of p) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('zones', () => {
  it('labels and maps every zone kind to a real surface kind', () => {
    for (const k of ZONE_KINDS) {
      expect(ZONE_KIND_LABELS[k]).toBeTruthy();
      expect(SURFACE_KINDS).toContain(zoneSurface(k));
    }
    expect(zoneSurface('walkway')).toBe('path');
    expect(zoneSurface('facade')).toBe('siding');
    expect(zoneSurface('cabinetry')).toBe('cabinet');
  });

  it('separates design zones from context zones', () => {
    const z = (id: string, kind: SceneZone['kind'], editable = true): SceneZone => ({ id, kind, label: id, description: '', polygon: [], editable });
    const zones = [z('a', 'walkway'), z('b', 'sky'), z('c', 'lawn', false), z('d', 'lawn')];
    expect(isDesignZone(zones[0])).toBe(true);
    expect(isDesignZone(zones[1])).toBe(false);
    expect(splitZones(zones).design.map((x) => x.id)).toEqual(['a', 'd']);
    expect(splitZones(zones).context.map((x) => x.id)).toEqual(['b', 'c']);
    const scene = { zones } as unknown as Parameters<typeof zonesForElement>[0];
    const r = zonesForElement(scene, ['lawn']);
    expect(r.relevant.map((x) => x.id)).toEqual(['d']);
    expect(r.other.map((x) => x.id)).toEqual(['a']);
    expect(zonesForElement(undefined, ['lawn'])).toEqual({ relevant: [], other: [] });
  });
});

describe('product info', () => {
  const product: ProductResult = {
    name: 'Little Lime Hydrangea',
    brand: 'Proven Winners',
    store: '',
    storeKind: 'nursery',
    url: 'https://www.example-nursery.com/hydrangea',
    imageUrl: ' https://img.example.com/h.jpg ',
    priceUsd: 39.99,
    priceText: null,
    category: 'plant',
    description: 'Compact panicle hydrangea',
    realHeightFt: 4,
    specs: ['Zones 3-8', '', '3 gal'],
    plant: { botanical: 'Hydrangea paniculata', sun: 'Full sun', water: null, zones: '3-8', matureSize: '3-5 ft' },
    light: null,
  };

  it('maps a product result to ProductInfo', () => {
    const info = productInfoFrom(product, 123);
    expect(info).toEqual({
      store: 'Nursery',
      storeKind: 'nursery',
      url: product.url,
      specs: ['Zones 3-8', '3 gal'],
      retrievedAt: 123,
      brand: 'Proven Winners',
      priceUsd: 39.99,
      imageUrl: 'https://img.example.com/h.jpg',
    });
    expect(priceLabel(info)).toBe('$39.99');
    expect(priceLabel({ priceText: '$24.98 / 3 gal', priceUsd: 24.98 })).toBe('$24.98 / 3 gal');
    expect(priceLabel({})).toBeNull();
    expect(urlHost(info.url)).toBe('example-nursery.com');
    expect(urlHost('nope')).toBeNull();
  });

  it('normalizes pasted links', () => {
    expect(normalizeProductUrl('https://www.homedepot.com/p/123')).toBe('https://www.homedepot.com/p/123');
    expect(normalizeProductUrl('  lowes.com/pd/abc ')).toBe('https://lowes.com/pd/abc');
    expect(normalizeProductUrl('ftp://x.com/a')).toBeNull();
    expect(normalizeProductUrl('hello world')).toBeNull();
    expect(normalizeProductUrl('')).toBeNull();
    expect(normalizeProductUrl('http://localhost/x')).toBeNull();
  });

  it('rates zone fit', () => {
    expect(zoneFit('5-9', '7a')?.kind).toBe('fits');
    expect(zoneFit('Zones 8 to 11', '6b')?.kind).toBe('outside');
    expect(zoneFit('5-9', null)).toEqual({ kind: 'unknown', text: 'Zones 5–9' });
    expect(zoneFit(null, '7a')).toBeNull();
  });
});

describe('aiErrors', () => {
  it('reads health', () => {
    expect(aiAvailability(null).state).toBe('unknown');
    const base = { ok: true, ai: { enabled: true, model: 'm' }, imageProvider: { enabled: false, name: null, model: null } };
    expect(aiAvailability(base).state).toBe('ready');
    expect(aiAvailability({ ...base, ai: { enabled: false, model: null } }).state).toBe('off');
    expect(aiAvailability({ ...base, ok: false }).state).toBe('offline');
    expect(aiUsable(aiAvailability(null))).toBe(true);
    expect(aiUsable(aiAvailability({ ...base, ok: false }))).toBe(false);
    expect(aiAvailability({ ...base, ai: { enabled: false, model: null } })).toEqual({ state: 'off', reason: AI_OFF_REASON });
    // Everyday copy for a missing (optional) key names no environment variables or files.
    for (const text of [AI_OFF_REASON, NO_DEVICE_MAP_REASON]) expect(text).not.toMatch(/_API_KEY|\.env|restart/i);
  });

  it('turns errors into friendly messages', () => {
    expect(friendlyAiError(new ApiError('network', 'Request cancelled.', 0, { aborted: true }))).toBeNull();
    // Claude / image keys are optional: plain words, no setup jargon.
    expect(friendlyAiError(new ApiError('ai_disabled', 'x', 503))).toMatch(/Claude key is optional/);
    expect(friendlyAiError(new ApiError('image_provider_disabled', 'x', 503))).toMatch(/ChatGPT or Gemini app/);
    for (const code of ['ai_disabled', 'image_provider_disabled'] as const) {
      expect(friendlyAiError(new ApiError(code, 'x', 503))).not.toMatch(/_API_KEY|\.env|restart/i);
    }
    expect(friendlyAiError(new ApiError('rate_limited', 'x', 429))).toMatch(/Wait a minute/);
    expect(friendlyAiError(new ApiError('refused', 'x', 422), 'get suggestions')).toMatch(/declined to get suggestions/);
    expect(friendlyAiError(new ApiError('upstream_error', 'x', 502), 'map the scene')).toMatch(/couldn't map the scene/);
    expect(friendlyAiError(new ApiError('network', 'Server down', 0))).toBe('Server down.');
    expect(friendlyAiError(new Error('Boom!'))).toBe('Boom!');
    expect(friendlyAiError(undefined, 'do it')).toBe("Couldn't do it. Please try again.");
  });

  it('formats elapsed time', () => {
    expect(formatElapsed(4_200)).toBe('4 s');
    expect(formatElapsed(65_000)).toBe('1 min 05 s');
  });
});
