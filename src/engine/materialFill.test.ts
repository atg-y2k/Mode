import { describe, expect, it } from 'vitest';
import type { MaterialDef, MaterialTreatment, Photo, Quad, Region, SurfaceKind } from '../../shared/types';
import { applyMaterial, assumedPhotoSpanFt, estimatePlaneAspect, mappingForRegion, type TextureMapping } from './materialFill';
import { generateTexture, type TextureTile } from './textures';
import type { ImageDataLike, Mask } from './types';

const W = 200;
const H = 200;

function image(w: number, h: number, f: (x: number, y: number) => [number, number, number]): ImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}

function maskOf(w: number, h: number, f: (x: number, y: number) => number): Mask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y);
  return { width: w, height: h, data };
}

/** A tile whose texels are given row by row, at `ppi` texels per inch. */
function tileOf(rows: [number, number, number][][], ppi: number): TextureTile {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) =>
    row.forEach(([r, g, b], x) => {
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }),
  );
  return { width: w, height: h, data, pxPerInch: ppi };
}

function solidTile(rgb: [number, number, number]): TextureTile {
  return tileOf(
    Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => rgb)),
    1,
  );
}

const px = (img: ImageDataLike, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

const RED: [number, number, number] = [220, 30, 30];
const GREEN: [number, number, number] = [30, 200, 40];
const BLUE: [number, number, number] = [30, 40, 220];
const WHITE: [number, number, number] = [240, 240, 240];
/** 2×2 inches at 4 texels per inch: red TL, green TR, blue BL, white BR quadrants. */
const QUADRANTS = tileOf(
  Array.from({ length: 8 }, (_, y) =>
    Array.from({ length: 8 }, (_, x) => (y < 4 ? (x < 4 ? RED : GREEN) : x < 4 ? BLUE : WHITE)),
  ),
  4,
);

function closeTo(a: number[], b: number[], tol: number) {
  for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(tol);
}

describe('applyMaterial', () => {
  const screen: TextureMapping = { kind: 'screen', pxPerInch: 4, rotationDeg: 0 };

  it('never touches pixels outside the mask', () => {
    const src = image(W, H, (x, y) => [(x * 7) & 255, (y * 3) & 255, (x + y) & 255]);
    const dst = image(W, H, (x, y) => [(x * 5) & 255, (y * 11) & 255, 77]);
    const before = new Uint8ClampedArray(dst.data);
    const mask = maskOf(W, H, (x, y) => (x > 50 && x < 150 && y > 60 && y < 140 ? 255 : 0));
    applyMaterial(src, dst, mask, { tile: generateTexture({ pattern: 'brick', colors: ['#9c4a32'], unitWidthIn: 8, unitHeightIn: 2.25, variation: 0.5, seed: 1 }, 4), mapping: screen, strength: 1 });
    let changed = 0;
    for (let i = 0; i < W * H; i++) {
      if (mask.data[i] === 0) {
        for (let c = 0; c < 4; c++) expect(dst.data[i * 4 + c]).toBe(before[i * 4 + c]);
      } else if (dst.data[i * 4] !== before[i * 4]) changed++;
    }
    expect(changed).toBeGreaterThan(1000);
  });

  it('is a no-op at strength 0 and with an empty mask', () => {
    const src = image(W, H, () => [100, 100, 100]);
    const dst = image(W, H, () => [10, 20, 30]);
    const before = new Uint8ClampedArray(dst.data);
    applyMaterial(src, dst, maskOf(W, H, () => 255), { tile: solidTile(RED), mapping: screen, strength: 0 });
    expect(dst.data).toEqual(before);
    applyMaterial(src, dst, maskOf(W, H, () => 0), { tile: solidTile(RED), mapping: screen, strength: 1 });
    expect(dst.data).toEqual(before);
  });

  it('reproduces the texture color on an evenly lit surface', () => {
    const src = image(W, H, () => [120, 110, 100]);
    const dst = image(W, H, () => [0, 0, 0]);
    applyMaterial(src, dst, maskOf(W, H, () => 255), { tile: solidTile([180, 120, 60]), mapping: screen, strength: 1 });
    closeTo(px(dst, 100, 100), [180, 120, 60], 2);
    closeTo(px(dst, 3, 197), [180, 120, 60], 2);
  });

  it('blends by mask coverage × strength', () => {
    const src = image(W, H, () => [128, 128, 128]);
    const dst = image(W, H, () => [0, 0, 0]);
    applyMaterial(src, dst, maskOf(W, H, () => 128), { tile: solidTile([200, 200, 200]), mapping: screen, strength: 0.5 });
    const v = px(dst, 100, 100)[0];
    expect(v).toBeGreaterThan(200 * 0.25 - 4);
    expect(v).toBeLessThan(200 * 0.25 + 4);
  });

  it("keeps the photo's light and shadow (and drops it with shading 0)", () => {
    // Left half in shadow, right half lit; a gentle gradient inside each.
    const src = image(W, H, (x) => (x < 100 ? [60 + x * 0.1, 60, 60] : [170 + (x - 100) * 0.1, 170, 170]));
    const dst = image(W, H, () => [0, 0, 0]);
    const mask = maskOf(W, H, () => 255);
    applyMaterial(src, dst, mask, { tile: solidTile([150, 150, 150]), mapping: screen, strength: 1 });
    const dark = px(dst, 30, 100)[0];
    const lit = px(dst, 170, 100)[0];
    expect(dark).toBeLessThan(lit - 40);
    // Order preserved within the lit side.
    expect(px(dst, 190, 100)[0]).toBeGreaterThanOrEqual(px(dst, 120, 100)[0]);
    const flat = image(W, H, () => [0, 0, 0]);
    applyMaterial(src, flat, mask, { tile: solidTile([150, 150, 150]), mapping: screen, strength: 1, shading: 0 });
    expect(Math.abs(px(flat, 30, 100)[0] - px(flat, 170, 100)[0])).toBeLessThanOrEqual(1);
    closeTo(px(flat, 30, 100), [150, 150, 150], 2);
  });

  it('applies a tint as a recolor that keeps texture structure', () => {
    const src = image(W, H, () => [128, 128, 128]);
    const dst = image(W, H, () => [0, 0, 0]);
    const striped = tileOf([[[200, 200, 200], [100, 100, 100]]], 0.25);
    applyMaterial(src, dst, maskOf(W, H, () => 255), {
      tile: striped,
      mapping: { kind: 'screen', pxPerInch: 10, rotationDeg: 0 },
      strength: 1,
      tint: '#3366cc',
      shading: 0,
    });
    // Blue dominates everywhere, and the stripes are still there.
    let bright = 0;
    let dark = 255;
    for (let x = 0; x < 80; x++) {
      const [r, g, b] = px(dst, x, 50);
      expect(b).toBeGreaterThan(r);
      expect(b).toBeGreaterThan(g);
      bright = Math.max(bright, b);
      dark = Math.min(dark, b);
    }
    expect(bright - dark).toBeGreaterThan(30);
  });

  it('screen mapping scales and rotates the pattern', () => {
    const src = image(W, H, () => [128, 128, 128]);
    // 10 photo px per inch → each 1-inch quadrant is 10×10 px.
    const dst = image(W, H, () => [0, 0, 0]);
    applyMaterial(src, dst, maskOf(W, H, () => 255), {
      tile: QUADRANTS,
      mapping: { kind: 'screen', pxPerInch: 10, rotationDeg: 0 },
      strength: 1,
      shading: 0,
    });
    closeTo(px(dst, 5, 5), RED, 3);
    closeTo(px(dst, 15, 5), GREEN, 3);
    closeTo(px(dst, 5, 15), BLUE, 3);
    closeTo(px(dst, 25, 5), RED, 3); // wraps
    const rot = image(W, H, () => [0, 0, 0]);
    applyMaterial(src, rot, maskOf(W, H, () => 255), {
      tile: QUADRANTS,
      mapping: { kind: 'screen', pxPerInch: 10, rotationDeg: 90 },
      strength: 1,
      shading: 0,
    });
    // Rotated a quarter turn clockwise: red moves from top-left to top-right.
    closeTo(px(rot, 15, 5), RED, 3);
    closeTo(px(rot, 5, 5), BLUE, 3);
  });

  describe('plane mapping', () => {
    const src = image(W, H, () => [128, 128, 128]);
    const full = maskOf(W, H, () => 255);

    it('maps the quad corners to the texture origin and axes', () => {
      const dst = image(W, H, () => [0, 0, 0]);
      const quad: Quad = [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
        { x: 0, y: 200 },
      ];
      applyMaterial(src, dst, full, {
        tile: QUADRANTS,
        mapping: { kind: 'plane', quad, widthIn: 2, heightIn: 2, rotationDeg: 0 },
        strength: 1,
        shading: 0,
      });
      closeTo(px(dst, 50, 50), RED, 3);
      closeTo(px(dst, 150, 50), GREEN, 3);
      closeTo(px(dst, 50, 150), BLUE, 3);
      closeTo(px(dst, 150, 150), WHITE, 3);
    });

    it('follows a perspective quad (texture origin at the quad top-left)', () => {
      const dst = image(W, H, () => [0, 0, 0]);
      // A floor: far edge short and high, near edge wide and low.
      const quad: Quad = [
        { x: 70, y: 20 },
        { x: 130, y: 20 },
        { x: 200, y: 200 },
        { x: 0, y: 200 },
      ];
      applyMaterial(src, dst, full, {
        tile: QUADRANTS,
        mapping: { kind: 'plane', quad, widthIn: 2, heightIn: 2, rotationDeg: 0 },
        strength: 1,
        shading: 0,
      });
      // Rows near the far edge cover little depth; the near half of the quad
      // (in image space) is mostly the second half of the texture (t > 0.5).
      closeTo(px(dst, 85, 26), RED, 6);
      closeTo(px(dst, 115, 26), GREEN, 6);
      closeTo(px(dst, 50, 150), BLUE, 6);
      closeTo(px(dst, 150, 150), WHITE, 6);
      // Foreshortening: y = 70 is well above the quad's image middle (y = 110)
      // yet already past the texture's middle (t ≈ 0.56), so it's blue.
      closeTo(px(dst, 80, 70), BLUE, 6);
    });

    it('averages detail toward the horizon instead of aliasing', () => {
      const dst = image(W, H, () => [0, 0, 0]);
      const stripes = tileOf([[WHITE, [20, 20, 20]]], 4); // 1/4" stripes
      const quad: Quad = [
        { x: 95, y: 10 },
        { x: 105, y: 10 },
        { x: 200, y: 200 },
        { x: 0, y: 200 },
      ];
      applyMaterial(src, dst, full, {
        tile: stripes,
        mapping: { kind: 'plane', quad, widthIn: 120, heightIn: 1200, rotationDeg: 90 },
        strength: 1,
        shading: 0,
      });
      // Near the horizon a pixel spans many stripes: values converge to the mean.
      const far = [];
      for (let x = 90; x < 110; x++) far.push(px(dst, x, 14)[0]);
      const spread = Math.max(...far) - Math.min(...far);
      expect(spread).toBeLessThan(40);
      const mean = far.reduce((a, b) => a + b, 0) / far.length;
      expect(mean).toBeGreaterThan(110);
      expect(mean).toBeLessThan(200);
    });

    it('fills pixels beyond the horizon with the mean color (no NaN garbage)', () => {
      const dst = image(W, H, () => [0, 0, 0]);
      const quad: Quad = [
        { x: 90, y: 100 },
        { x: 110, y: 100 },
        { x: 200, y: 200 },
        { x: 0, y: 200 },
      ];
      applyMaterial(src, dst, full, {
        tile: QUADRANTS,
        mapping: { kind: 'plane', quad, widthIn: 2, heightIn: 20, rotationDeg: 0 },
        strength: 1,
        shading: 0,
      });
      const top = px(dst, 100, 2);
      // Mean of the four quadrants (in linear light) is a light neutral-ish color.
      expect(top[0]).toBeGreaterThan(100);
      expect(top[1]).toBeGreaterThan(80);
      expect(top[2]).toBeGreaterThan(100);
    });

    it('falls back gracefully for a degenerate quad', () => {
      const dst = image(W, H, () => [0, 0, 0]);
      const quad: Quad = [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 200 },
        { x: 0, y: 200 },
      ];
      applyMaterial(src, dst, full, {
        tile: solidTile(RED),
        mapping: { kind: 'plane', quad, widthIn: 2, heightIn: 2, rotationDeg: 0 },
        strength: 1,
        shading: 0,
      });
      closeTo(px(dst, 100, 150), RED, 3);
    });
  });
});

describe('mappingForRegion', () => {
  const material: MaterialDef = {
    id: 'oak',
    name: 'Oak',
    category: 'flooring',
    surfaces: ['floor'],
    texture: { pattern: 'wood-planks', colors: ['#b48a5e'], unitWidthIn: 7.5, unitHeightIn: 72, variation: 0.5, seed: 1 },
    cost: { low: 5, high: 9, unit: 'sqft' } as MaterialDef['cost'],
    description: '',
    tags: [],
  };
  const treat = (scale = 1, rotation = 0): MaterialTreatment => ({ type: 'material', materialId: 'oak', scale, rotation, strength: 1 });
  const region = (surface: SurfaceKind, plane?: Region['plane']): Region => ({
    id: 'r',
    name: 'R',
    surface,
    maskId: 'm',
    color: '#ff0000',
    createdAt: 0,
    plane,
  });
  const photo: Pick<Photo, 'width' | 'height' | 'calibration'> = { width: 1560, height: 1040 };

  it('uses the photo-width heuristic without calibration (12–15 ft across a room)', () => {
    const { mapping, tilePxPerInch } = mappingForRegion(region('wall'), photo, treat(), material);
    expect(mapping.kind).toBe('screen');
    if (mapping.kind !== 'screen') return;
    const ftAcross = photo.width / mapping.pxPerInch / 12;
    expect(ftAcross).toBeGreaterThanOrEqual(12);
    expect(ftAcross).toBeLessThanOrEqual(15);
    expect(tilePxPerInch).toBeCloseTo(mapping.pxPerInch, 6);
    // Exterior facades are seen from farther away.
    const ext = mappingForRegion(region('siding'), photo, treat(), material).mapping;
    expect(ext.kind === 'screen' && ext.pxPerInch).toBeLessThan(mapping.pxPerInch);
    expect(assumedPhotoSpanFt('siding')).toBeGreaterThan(assumedPhotoSpanFt('wall'));
  });

  it('uses calibration px/ft and folds in the treatment scale and rotation', () => {
    const cal = { a: { x: 100, y: 500 }, b: { x: 400, y: 500 }, lengthFt: 10 };
    const m1 = mappingForRegion(region('wall'), { ...photo, calibration: cal }, treat(1, 0), material).mapping;
    expect(m1.kind).toBe('screen');
    if (m1.kind === 'screen') expect(m1.pxPerInch).toBeCloseTo(30 / 12, 6);
    const m2 = mappingForRegion(region('wall'), { ...photo, calibration: cal }, treat(2, 30), material).mapping;
    if (m2.kind === 'screen') {
      expect(m2.pxPerInch).toBeCloseTo(60 / 12, 6);
      expect(m2.rotationDeg).toBe(30);
    }
  });

  it('maps a plane with a known real size', () => {
    const quad: Quad = [
      { x: 400, y: 500 },
      { x: 1100, y: 500 },
      { x: 1500, y: 1000 },
      { x: 50, y: 1000 },
    ];
    const r = region('floor', { quad, widthFt: 14, heightFt: 16 });
    const { mapping, tilePxPerInch } = mappingForRegion(r, photo, treat(2, 90), material);
    expect(mapping.kind).toBe('plane');
    if (mapping.kind !== 'plane') return;
    expect(mapping.widthIn).toBeCloseTo((14 * 12) / 2, 6);
    expect(mapping.heightIn).toBeCloseTo((16 * 12) / 2, 6);
    expect(mapping.rotationDeg).toBe(90);
    expect(mapping.quad).toBe(quad);
    // Resolution comes from the near (bottom) edge: ~1450 px over 84 texture inches.
    expect(tilePxPerInch).toBeGreaterThan(14);
    expect(tilePxPerInch).toBeLessThan(25);
  });

  it('estimates an unknown plane size (~12 ft across a room) and its aspect', () => {
    const quad: Quad = [
      { x: 0, y: 400 },
      { x: 1560, y: 400 },
      { x: 1560, y: 1040 },
      { x: 0, y: 1040 },
    ];
    const m = mappingForRegion(region('floor', { quad }), photo, treat(), material).mapping;
    expect(m.kind).toBe('plane');
    if (m.kind !== 'plane') return;
    expect(m.widthIn / 12).toBeGreaterThan(10);
    expect(m.widthIn / 12).toBeLessThan(15);
    // Fronto-parallel rectangle: real aspect equals the image aspect of the quad.
    expect(m.widthIn / m.heightIn).toBeCloseTo(1560 / 640, 2);
    // With only the width known, the depth follows the estimated aspect.
    const m2 = mappingForRegion(region('floor', { quad, widthFt: 20 }), photo, treat(), material).mapping;
    if (m2.kind === 'plane') {
      expect(m2.widthIn).toBeCloseTo(240, 6);
      expect(m2.heightIn).toBeCloseTo(240 / (1560 / 640), 1);
    }
  });

  it('measures an unknown plane through an on-plane calibration line', () => {
    const quad: Quad = [
      { x: 100, y: 100 },
      { x: 1100, y: 100 },
      { x: 1100, y: 600 },
      { x: 100, y: 600 },
    ];
    // 500 px along the plane = 10 ft → the 1000 px wide quad is 20 ft.
    const cal = { a: { x: 300, y: 300 }, b: { x: 800, y: 300 }, lengthFt: 10 };
    const m = mappingForRegion(region('patio', { quad }), { ...photo, calibration: cal }, treat(), material).mapping;
    expect(m.kind).toBe('plane');
    if (m.kind === 'plane') {
      expect(m.widthIn).toBeCloseTo(240, 0);
      expect(m.heightIn).toBeCloseTo(120, 0);
    }
  });

  it('sizes the tile for the visible part of a plane, not off-image corners', () => {
    const small = { width: 1000, height: 800 };
    // Near corners dragged far below the photo (common when a floor runs out of frame).
    const quad: Quad = [
      { x: 400, y: 300 },
      { x: 600, y: 300 },
      { x: 3000, y: 5000 },
      { x: -2000, y: 5000 },
    ];
    const { tilePxPerInch } = mappingForRegion(region('floor', { quad, widthFt: 10, heightFt: 40 }), small, treat(), material);
    // The bottom corners alone would ask for ~80 px/in (clamped to 48).
    expect(tilePxPerInch).toBeLessThan(40);
    expect(tilePxPerInch).toBeGreaterThan(0.5);
  });

  it('falls back to screen mapping for a degenerate plane', () => {
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ];
    const { mapping, tilePxPerInch } = mappingForRegion(region('floor', { quad }), photo, treat(), material);
    expect(mapping.kind).toBe('screen');
    expect(Number.isFinite(tilePxPerInch)).toBe(true);
  });

  it('estimates foreshortening of a receding floor', () => {
    // A strongly foreshortened trapezoid depicts a rectangle much deeper than it looks.
    const quad: Quad = [
      { x: 600, y: 520 },
      { x: 960, y: 520 },
      { x: 1500, y: 1040 },
      { x: 60, y: 1040 },
    ];
    const aspect = estimatePlaneAspect(quad, 1560, 1040);
    const imageAspect = 1440 / 520;
    expect(aspect).toBeLessThan(imageAspect);
    expect(aspect).toBeGreaterThan(0.05);
  });
});
