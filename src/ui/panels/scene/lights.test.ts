import { describe, expect, it } from 'vitest';
import type { AssetDef, PlacedLight } from '../../../../shared/types';
import {
  beamChangePatch,
  duplicateLightData,
  GENERIC_GLOWS,
  glowPlacement,
  kelvinCss,
  kelvinGradient,
  lightPlacementForAsset,
  samePlacement,
} from './lights';

const light: PlacedLight = {
  id: 'l1',
  name: 'Glow',
  x: 100,
  y: 200,
  beam: 'omni',
  radius: 120,
  intensity: 1,
  kelvin: 2700,
  on: true,
  showFixture: false,
  fixtureSize: 40,
};

describe('placements', () => {
  it('carries fixture name, beam and kelvin', () => {
    const asset: AssetDef = {
      id: 'wall-lantern',
      name: 'Wall lantern',
      category: 'lighting',
      source: 'builtin',
      aspect: 0.6,
      realHeightFt: 1.5,
      tags: [],
      light: { beam: 'down', kelvin: 2400, lumens: 400, reachFt: 10, emitterY: 0.5, indoor: false, outdoor: true },
    };
    expect(lightPlacementForAsset(asset)).toEqual({ kind: 'light', assetId: 'wall-lantern', name: 'Wall lantern', beam: 'down', kelvin: 2400 });
    const bare = lightPlacementForAsset({ ...asset, light: undefined });
    expect(bare.beam).toBe('omni');
    expect(bare.kelvin).toBe(2700);
  });

  it('compares armed placements', () => {
    const a = lightPlacementForAsset({ id: 'x', name: 'X', category: 'lighting', source: 'builtin', aspect: 1, realHeightFt: 1, tags: [] });
    expect(samePlacement(a, { ...a })).toBe(true);
    expect(samePlacement(a, { kind: 'object', assetId: 'x' })).toBe(false);
    const g = glowPlacement(GENERIC_GLOWS[0]);
    expect(samePlacement(g, glowPlacement(GENERIC_GLOWS[0]))).toBe(true);
    expect(samePlacement(g, glowPlacement(GENERIC_GLOWS[1]))).toBe(false);
    expect(samePlacement({ kind: 'object', assetId: 'a' }, { kind: 'object', assetId: 'a' })).toBe(true);
    expect(samePlacement(null, g)).toBe(false);
  });
});

describe('beam changes', () => {
  it('adds an end point for line beams', () => {
    const p = beamChangePatch(light, 'strip');
    expect(p.beam).toBe('strip');
    expect(p.x2).toBeGreaterThan(light.x);
    expect(p.y2).toBe(light.y);
    expect(beamChangePatch({ ...light, x2: 5, y2: 6 }, 'string')).toEqual({ beam: 'string' });
  });

  it('adds angle and spread for spots', () => {
    expect(beamChangePatch(light, 'spot')).toEqual({ beam: 'spot', angle: 90, spread: 40 });
    expect(beamChangePatch({ ...light, angle: 10, spread: 20 }, 'spot')).toEqual({ beam: 'spot' });
  });

  it('duplicates with an offset', () => {
    const d = duplicateLightData({ ...light, x2: 300, y2: 210 }, 10);
    expect(d).not.toHaveProperty('id');
    expect([d.x, d.y, d.x2, d.y2]).toEqual([110, 210, 310, 220]);
    expect(duplicateLightData(light, 10).x2).toBeUndefined();
  });
});

describe('kelvin colors', () => {
  it('builds css colors and gradients', () => {
    expect(kelvinCss(6500)).toMatch(/^rgb\(\d+ \d+ \d+\)$/);
    const g = kelvinGradient(2000, 9000, 3);
    expect(g.startsWith('linear-gradient(to right, rgb(')).toBe(true);
    expect(g.match(/rgb\(/g)).toHaveLength(3);
    expect(g).toContain(' 100%)');
  });
});
