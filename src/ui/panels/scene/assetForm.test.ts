import { describe, expect, it } from 'vitest';
import type { AssetDef } from '../../../../shared/types';
import {
  costFromDetails,
  detailsFromAsset,
  detailsToFields,
  emptyDetails,
  hasErrors,
  isValidVendorUrl,
  nameFromFilename,
  saneAspect,
  svgAspect,
  svgToDataUrl,
  tagsFor,
  validateDetails,
} from './assetForm';

describe('nameFromFilename', () => {
  it('humanizes file names', () => {
    expect(nameFromFilename('my_boxwood-photo (2).JPG')).toBe('My boxwood photo (2)');
    expect(nameFromFilename('lantern.webp')).toBe('Lantern');
    expect(nameFromFilename('IMG_2041.jpeg')).toBe('');
    expect(nameFromFilename('PXL-20240101.png')).toBe('');
    expect(nameFromFilename('.png')).toBe('');
  });
});

describe('validation', () => {
  it('accepts a complete form', () => {
    const d = { ...emptyDetails('plant'), name: 'Fern' };
    expect(hasErrors(validateDetails(d))).toBe(false);
  });

  it('reports each problem', () => {
    const e = validateDetails({ ...emptyDetails('decor'), realHeightFt: 0, costLow: 30, costHigh: 10, vendorUrl: 'javascript:alert(1)' });
    expect(e.name).toBeTruthy();
    expect(e.realHeightFt).toBeTruthy();
    expect(e.cost).toBeTruthy();
    expect(e.vendorUrl).toBeTruthy();
    expect(validateDetails({ ...emptyDetails(), name: 'x', costLow: -1 }).cost).toBeTruthy();
  });

  it('checks vendor urls', () => {
    expect(isValidVendorUrl('')).toBe(true);
    expect(isValidVendorUrl('https://www.homedepot.com/p/123')).toBe(true);
    expect(isValidVendorUrl('homedepot.com')).toBe(false);
    expect(isValidVendorUrl('ftp://x.y')).toBe(false);
  });
});

describe('conversion', () => {
  it('builds cost from one or two prices', () => {
    expect(costFromDetails({ costLow: undefined, costHigh: undefined })).toBeUndefined();
    expect(costFromDetails({ costLow: 20, costHigh: undefined })).toEqual({ low: 20, high: 20, unit: 'each' });
    expect(costFromDetails({ costLow: 10, costHigh: 25 })).toEqual({ low: 10, high: 25, unit: 'each' });
  });

  it('adds light info only for lighting and keeps previous light facts', () => {
    const lamp = detailsToFields({ ...emptyDetails('lighting'), name: ' Lamp ', beam: 'down', kelvin: 3000, vendorUrl: ' ' });
    expect(lamp.name).toBe('Lamp');
    expect(lamp.vendorUrl).toBeUndefined();
    expect(lamp.light).toMatchObject({ beam: 'down', kelvin: 3000, indoor: true, outdoor: true });
    const prev = {
      id: 'a',
      name: 'Old',
      category: 'lighting',
      source: 'user',
      aspect: 1,
      realHeightFt: 1,
      tags: [],
      light: { beam: 'omni', kelvin: 2200, lumens: 1200, reachFt: 20, emitterY: 0.1, indoor: false, outdoor: true },
    } satisfies AssetDef;
    const edited = detailsToFields({ ...detailsFromAsset(prev), kelvin: 4000 }, prev);
    expect(edited.light).toEqual({ ...prev.light, kelvin: 4000, mountHeightFt: undefined });
    const plant = detailsToFields({ ...emptyDetails('plant'), name: 'Fern' });
    expect(plant.light).toBeUndefined();
    expect(plant.realHeightFt).toBe(3);
  });

  it('tags new assets', () => {
    expect(tagsFor('plant', 'user')).toEqual(['plant', 'uploaded']);
    expect(tagsFor('decor', 'ai', ['Bench', ' ', 'decor'])).toEqual(['decor', 'ai-generated', 'bench']);
  });
});

describe('svg helpers', () => {
  it('reads the aspect ratio', () => {
    expect(svgAspect('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 400"><g/></svg>')).toBe(0.5);
    expect(svgAspect("<svg width='300' height='100'></svg>")).toBe(3);
    expect(svgAspect('<div></div>')).toBeNull();
    expect(saneAspect(Number.NaN, 0.8)).toBe(0.8);
    expect(saneAspect(1.5)).toBe(1.5);
    expect(saneAspect(1000)).toBe(1);
  });

  it('encodes a data url', () => {
    const url = svgToDataUrl('<svg viewBox="0 0 1 1"></svg>');
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(url.split(',')[1])).toBe('<svg viewBox="0 0 1 1"></svg>');
  });
});
