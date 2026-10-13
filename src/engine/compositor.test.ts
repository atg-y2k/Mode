import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LIGHTING, type Design, type MaterialDef, type Photo, type PlacedLight, type Region, type Treatment } from '../../shared/types';
import type { AssetDef } from '../../shared/types';
import { assetSvgDataUrl, assetSvgMarkup, evictAssetImage, getAssetImage, getAssetImageUrl, peekAssetImage, svgIntrinsicSize } from './assetImages';
import { DesignRenderer, renderTreatmentsLayer, type RenderContext } from './compositor';
import { createMask, fillPolygon } from './mask';
import { createImageDataLike, type ImageDataLike, type Mask } from './types';

const W = 40;
const H = 30;

function rectMask(x0: number, y0: number, x1: number, y1: number, w = W, h = H): Mask {
  const m = createMask(w, h);
  fillPolygon(
    m,
    [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    'add',
    false,
  );
  return m;
}

/** Wall-like photo: warm gray with gentle shading so paint has something to keep. */
function photoImage(w = W, h = H): ImageDataLike {
  const img = createImageDataLike(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = 150 + Math.round(30 * Math.sin(x / 7) * Math.cos(y / 9));
      img.data[i] = v + 6;
      img.data[i + 1] = v;
      img.data[i + 2] = v - 8;
    }
  }
  return img;
}

function region(id: string, p: Partial<Region> = {}): Region {
  return { id, name: id, surface: 'wall', maskId: `m-${id}`, color: '#ff0000', createdAt: 0, ...p };
}

const paint = (hex: string, strength = 1): Treatment => ({ type: 'paint', hex, finish: 'matte', coats: 2, strength });

const BRICK: MaterialDef = {
  id: 'test-brick',
  name: 'Test brick',
  category: 'siding',
  surfaces: ['wall', 'siding'],
  texture: { pattern: 'brick', colors: ['#8a3b2a', '#9c4a34', '#7a3324'], unitWidthIn: 8, unitHeightIn: 2.25, joint: { color: '#cfc8bb', widthIn: 0.4 }, variation: 0.4, seed: 3 },
  cost: { low: 10, high: 20, unit: 'sqft' },
  description: '',
  tags: [],
};

interface Setup {
  ctx: RenderContext;
  masks: Record<string, Mask>;
}

function setup(regions: Region[], masks: Record<string, Mask>, treatments: Record<string, Treatment>, design: Partial<Design> = {}): Setup {
  const d: Design = {
    id: 'd1',
    name: 'Option A',
    createdAt: 0,
    updatedAt: 0,
    treatments,
    hiddenRegionIds: [],
    objects: [],
    lights: [],
    lighting: { ...DEFAULT_LIGHTING },
    aiRenders: [],
    ...design,
  };
  const photo: Photo = {
    id: 'p1',
    name: 'Photo',
    imageId: 'img',
    thumbId: 'thumb',
    width: W,
    height: H,
    createdAt: 0,
    regions,
    generations: [],
    designs: [d],
    activeDesignId: d.id,
  };
  const ctx: RenderContext = {
    photo,
    design: d,
    image: photoImage(),
    getMask: (id) => masks[id],
    getMaterial: (id) => (id === BRICK.id ? BRICK : undefined),
    getAsset: () => undefined,
    maskVersions: {},
  };
  return { ctx, masks };
}

function px(img: ImageDataLike, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

describe('renderTreatmentsLayer', () => {
  it('returns an untouched copy when there are no treatments', () => {
    const { ctx } = setup([region('a')], { 'm-a': rectMask(0, 0, 20, 30) }, {});
    const out = renderTreatmentsLayer(ctx);
    expect(out).not.toBe(ctx.image);
    expect(out.data).not.toBe(ctx.image.data);
    expect(out.data).toEqual(ctx.image.data);
  });

  it('paints inside the mask only and never mutates the original', () => {
    const { ctx } = setup([region('a')], { 'm-a': rectMask(0, 0, 20, 30) }, { a: paint('#2f4f6f') });
    const original = new Uint8ClampedArray(ctx.image.data);
    const out = renderTreatmentsLayer(ctx);
    expect(ctx.image.data).toEqual(original);
    const inside = px(out, 8, 15);
    expect(inside[2]).toBeGreaterThan(inside[0]); // navy-ish
    expect(px(out, 30, 15)).toEqual(px(ctx.image, 30, 15));
  });

  it('applies regions in order (later regions win where masks overlap)', () => {
    const masks = { 'm-a': rectMask(0, 0, 25, 30), 'm-b': rectMask(15, 0, 40, 30) };
    const red = '#b03a2e';
    const green = '#3e8e41';
    const ab = renderTreatmentsLayer(setup([region('a'), region('b')], masks, { a: paint(red), b: paint(green) }).ctx);
    const ba = renderTreatmentsLayer(setup([region('b'), region('a')], masks, { a: paint(red), b: paint(green) }).ctx);
    const greenish = (c: [number, number, number]) => c[1] > c[0];
    expect(greenish(px(ab, 20, 15))).toBe(true); // overlap: b last
    expect(greenish(px(ba, 20, 15))).toBe(false); // overlap: a last
    expect(greenish(px(ab, 5, 15))).toBe(false); // only a
    expect(greenish(px(ab, 35, 15))).toBe(true); // only b
  });

  it('honours hiddenRegionIds', () => {
    const masks = { 'm-a': rectMask(0, 0, 20, 30), 'm-b': rectMask(20, 0, 40, 30) };
    const { ctx } = setup([region('a'), region('b')], masks, { a: paint('#1d3557'), b: paint('#e63946') }, { hiddenRegionIds: ['a'] });
    const out = renderTreatmentsLayer(ctx);
    expect(px(out, 5, 10)).toEqual(px(ctx.image, 5, 10));
    expect(px(out, 30, 10)).not.toEqual(px(ctx.image, 30, 10));
  });

  it('solo renders just one region, at full strength, even if hidden', () => {
    const masks = { 'm-a': rectMask(0, 0, 20, 30), 'm-b': rectMask(20, 0, 40, 30) };
    const { ctx } = setup([region('a'), region('b')], masks, { a: paint('#1d3557', 0.3), b: paint('#e63946') }, { hiddenRegionIds: ['a'] });
    const solo = renderTreatmentsLayer(ctx, { soloRegionId: 'a' });
    expect(px(solo, 30, 10)).toEqual(px(ctx.image, 30, 10));
    const full = renderTreatmentsLayer(setup([region('a')], masks, { a: paint('#1d3557', 1) }).ctx);
    expect(px(solo, 5, 10)).toEqual(px(full, 5, 10));
  });

  it('respects treatment strength', () => {
    const masks = { 'm-a': rectMask(0, 0, 40, 30) };
    const strong = renderTreatmentsLayer(setup([region('a')], masks, { a: paint('#1d3557', 1) }).ctx);
    const half = renderTreatmentsLayer(setup([region('a')], masks, { a: paint('#1d3557', 0.5) }).ctx);
    const orig = photoImage();
    const dist = (a: ImageDataLike) => Math.abs(px(a, 10, 10)[0] - px(orig, 10, 10)[0]);
    expect(dist(half)).toBeGreaterThan(0);
    expect(dist(half)).toBeLessThan(dist(strong));
  });

  it('applies material treatments with the region mapping', () => {
    const masks = { 'm-a': rectMask(0, 0, 40, 15) };
    const t: Treatment = { type: 'material', materialId: BRICK.id, scale: 1, rotation: 0, strength: 1 };
    const { ctx } = setup([region('a', { surface: 'siding' })], masks, { a: t });
    const out = renderTreatmentsLayer(ctx);
    let changed = 0;
    for (let x = 0; x < W; x++) if (px(out, x, 5).join() !== px(ctx.image, x, 5).join()) changed++;
    expect(changed).toBeGreaterThan(30);
    expect(px(out, 10, 25)).toEqual(px(ctx.image, 10, 25));
    // Brick reads red-brown.
    const [r, , b] = px(out, 10, 5);
    expect(r).toBeGreaterThan(b);
  });

  it('skips unknown materials, missing masks and masks of the wrong size', () => {
    const masks: Record<string, Mask> = { 'm-b': rectMask(0, 0, 40, 30, 20, 15) };
    const { ctx } = setup(
      [region('a'), region('b'), region('c')],
      masks,
      {
        a: paint('#e63946'), // mask m-a missing
        b: paint('#e63946'), // wrong size
        c: { type: 'material', materialId: 'nope', scale: 1, rotation: 0, strength: 1 },
      },
    );
    ctx.getMask = (id) => (id === 'm-c' ? rectMask(0, 0, 40, 30) : masks[id]);
    expect(renderTreatmentsLayer(ctx).data).toEqual(ctx.image.data);
  });

  it('keeps going when one treatment throws', () => {
    const masks = { 'm-a': rectMask(0, 0, 20, 30), 'm-b': rectMask(20, 0, 40, 30) };
    const { ctx } = setup([region('a', { surface: 'siding' }), region('b')], masks, {
      a: { type: 'material', materialId: BRICK.id, scale: 1, rotation: 0, strength: 1 },
      b: paint('#e63946'),
    });
    ctx.getMaterial = () => {
      throw new Error('boom');
    };
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      const out = renderTreatmentsLayer(ctx);
      expect(px(out, 30, 10)).not.toEqual(px(ctx.image, 30, 10));
    } finally {
      console.warn = warn;
    }
  });
});

// ---------------------------------------------------------------------------
// DesignRenderer caching (node: a fake 2D canvas that records putImageData)
// ---------------------------------------------------------------------------

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

class FakeCanvas {
  width = 1;
  height = 1;
  last: Uint8ClampedArray | null = null;
  getContext(): unknown {
    return {
      putImageData: (img: FakeImageData) => {
        this.last = new Uint8ClampedArray(img.data);
      },
    };
  }
}

describe('DesignRenderer', () => {
  // Node has no ImageData; the renderer only needs the constructor to wrap pixels.
  const g = globalThis as unknown as { ImageData?: unknown };
  const stubbed = !('ImageData' in g);
  beforeAll(() => {
    if (stubbed) g.ImageData = FakeImageData;
  });
  afterAll(() => {
    if (stubbed) delete g.ImageData;
  });

  async function render(r: DesignRenderer, ctx: RenderContext): Promise<Uint8ClampedArray> {
    const c = new FakeCanvas();
    await r.render(ctx, c as unknown as HTMLCanvasElement, { includeObjects: false });
    expect(c.width).toBe(W);
    expect(c.height).toBe(H);
    return c.last as Uint8ClampedArray;
  }

  it('blits the treatment layer, graded and lit', async () => {
    const masks = { 'm-a': rectMask(0, 0, 20, 30) };
    const { ctx } = setup([region('a')], masks, { a: paint('#2f4f6f') });
    const r = new DesignRenderer();
    const plain = await render(r, ctx);
    expect(plain).toEqual(renderTreatmentsLayer(ctx).data);

    const night = { ...ctx, design: { ...ctx.design, lighting: { ...DEFAULT_LIGHTING, timeOfDay: 'night' as const } } };
    const dark = await render(r, night);
    expect(dark[(15 * W + 30) * 4]).toBeLessThan(plain[(15 * W + 30) * 4]);

    const lamp: PlacedLight = { id: 'l', name: 'l', x: 30, y: 15, beam: 'omni', radius: 12, intensity: 1, kelvin: 2700, on: true, showFixture: false, fixtureSize: 6 };
    const lit = await render(r, { ...night, design: { ...night.design, lights: [lamp] } });
    expect(lit[(15 * W + 30) * 4]).toBeGreaterThan(dark[(15 * W + 30) * 4]);
    // Off light → same as no light.
    const off = await render(r, { ...night, design: { ...night.design, lights: [{ ...lamp, on: false }] } });
    expect(off).toEqual(dark);
  });

  it('caches the treatment layer until the mask version changes', async () => {
    const masks = { 'm-a': rectMask(0, 0, 20, 30) };
    const { ctx } = setup([region('a')], masks, { a: paint('#2f4f6f') });
    const r = new DesignRenderer();
    const first = await render(r, ctx);
    // Edit the mask in place without bumping its version: the cached layer is reused.
    masks['m-a'].data.fill(255);
    expect(await render(r, ctx)).toEqual(first);
    // Bumping the version (what runtime.markMaskDirty does) re-renders.
    const bumped = { ...ctx, maskVersions: { 'm-a': 1 } };
    const second = await render(r, bumped);
    expect(second).not.toEqual(first);
    expect(second).toEqual(renderTreatmentsLayer(bumped).data);
  });

  it('re-renders when treatments or hidden regions change, and after reset', async () => {
    const masks = { 'm-a': rectMask(0, 0, 20, 30) };
    const { ctx } = setup([region('a')], masks, { a: paint('#2f4f6f') });
    const r = new DesignRenderer();
    const a = await render(r, ctx);
    const recolored = await render(r, { ...ctx, design: { ...ctx.design, treatments: { a: paint('#c0392b') } } });
    expect(recolored).not.toEqual(a);
    const hidden = await render(r, { ...ctx, design: { ...ctx.design, hiddenRegionIds: ['a'] } });
    expect(hidden).toEqual(ctx.image.data);
    masks['m-a'].data.fill(0);
    r.reset();
    expect(await render(r, ctx)).toEqual(ctx.image.data);
  });

  it('never caches without mask versions', async () => {
    const masks = { 'm-a': rectMask(0, 0, 20, 30) };
    const { ctx } = setup([region('a')], masks, { a: paint('#2f4f6f') });
    const noVersions: RenderContext = { ...ctx, maskVersions: undefined };
    const r = new DesignRenderer();
    const first = await render(r, noVersions);
    masks['m-a'].data.fill(0);
    expect(await render(r, noVersions)).not.toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// assetImages (the DOM-free parts)
// ---------------------------------------------------------------------------

describe('assetImages', () => {
  const shrub: AssetDef = {
    id: 'test-shrub',
    name: 'Shrub',
    category: 'plant',
    source: 'builtin',
    art: { kind: 'plant', form: 'round-shrub', foliage: '#3f6b35', seed: 4 },
    aspect: 1,
    realHeightFt: 3,
    tags: [],
  };
  const aiSvg: AssetDef = {
    id: 'test-ai',
    name: 'AI bench',
    category: 'decor',
    source: 'ai',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#865"/></svg>',
    aspect: 2,
    realHeightFt: 2,
    tags: [],
  };
  const raster: AssetDef = { id: 'test-raster', name: 'Photo', category: 'decor', source: 'user', imageId: 'blob-1', aspect: 1, realHeightFt: 2, tags: [] };
  const none: AssetDef = { id: 'test-none', name: 'Nothing', category: 'other', source: 'user', aspect: 1, realHeightFt: 1, tags: [] };

  it('renders procedural art to SVG markup, tinted on request', () => {
    const svg = assetSvgMarkup(shrub);
    expect(svg).toMatch(/^<svg/);
    const tinted = assetSvgMarkup(shrub, '#aa3355');
    expect(tinted).toMatch(/^<svg/);
    expect(tinted).not.toBe(svg);
    expect(assetSvgMarkup(aiSvg)).toBe(aiSvg.svg);
    expect(assetSvgMarkup(raster)).toBeNull();
    expect(assetSvgMarkup(none)).toBeNull();
  });

  it('makes cached data URLs for vector assets only', () => {
    const a = assetSvgDataUrl(shrub);
    expect(a).toMatch(/^data:image\/svg\+xml/);
    expect(assetSvgDataUrl(shrub)).toBe(a);
    expect(decodeURIComponent((a as string).split(',')[1])).toBe(assetSvgMarkup(shrub));
    expect(assetSvgDataUrl(raster)).toBeNull();
  });

  it('reads the intrinsic size of SVG documents', () => {
    expect(svgIntrinsicSize('<svg width="120" height="80" viewBox="0 0 12 8"></svg>')).toEqual({ width: 120, height: 80 });
    expect(svgIntrinsicSize(aiSvg.svg as string)).toEqual({ width: 200, height: 100 });
    expect(svgIntrinsicSize('<svg width="100%" viewBox="0,0,30,60"/>')).toEqual({ width: 30, height: 60 });
    expect(svgIntrinsicSize('<div/>')).toBeNull();
  });

  it('rejects / returns nothing for assets without a visual, and evicts safely', async () => {
    await expect(getAssetImage(none)).rejects.toThrow();
    expect(peekAssetImage(none)).toBeUndefined();
    expect(await getAssetImageUrl(none)).toBeNull();
    expect(await getAssetImageUrl(shrub)).toBe(assetSvgDataUrl(shrub));
    expect(() => evictAssetImage(shrub.id)).not.toThrow();
    expect(assetSvgDataUrl(shrub)).toMatch(/^data:image\/svg\+xml/);
  });
});
