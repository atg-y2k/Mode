import { describe, expect, it } from 'vitest';
import { DEFAULT_LIGHTING, TIMES_OF_DAY, type LightingSettings, type PlacedLight, type TimeOfDay } from '../../shared/types';
import { SRGB8_TO_LINEAR } from './color';
import {
  TIME_OF_DAY_LOOKS,
  applyGrade,
  gradeGain,
  isIdentityGrade,
  lightColorLinear,
  lightEndPoint,
  lightGain,
  renderLights,
  stringBulbs,
  stringPoint,
  whiteBalanceGains,
} from './lighting';
import { cloneImageData, createImageDataLike, type ImageDataLike } from './types';

/** Deterministic noisy test photo: gradients + per-pixel noise in every channel. */
function photo(w = 64, h = 48, seed = 7): ImageDataLike {
  const img = createImageDataLike(w, h);
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      img.data[i] = Math.round((x / (w - 1)) * 200 + rnd() * 55);
      img.data[i + 1] = Math.round((y / (h - 1)) * 200 + rnd() * 55);
      img.data[i + 2] = Math.round(((x + y) / (w + h - 2)) * 200 + rnd() * 55);
    }
  }
  return img;
}

function gray(v: number, w = 40, h = 30): ImageDataLike {
  return createImageDataLike(w, h, { r: v, g: v, b: v });
}

/** Mean linear R, G, B and luminance. */
function stats(img: ImageDataLike): { r: number; g: number; b: number; y: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = img.width * img.height;
  for (let i = 0; i < img.data.length; i += 4) {
    r += SRGB8_TO_LINEAR[img.data[i]];
    g += SRGB8_TO_LINEAR[img.data[i + 1]];
    b += SRGB8_TO_LINEAR[img.data[i + 2]];
  }
  r /= n;
  g /= n;
  b /= n;
  return { r, g, b, y: 0.2126 * r + 0.7152 * g + 0.0722 * b };
}

function graded(img: ImageDataLike, s: Partial<LightingSettings>): ImageDataLike {
  const out = cloneImageData(img);
  applyGrade(out, { ...DEFAULT_LIGHTING, ...s });
  return out;
}

function px(img: ImageDataLike, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

function light(p: Partial<PlacedLight> = {}): PlacedLight {
  return {
    id: 'l1',
    name: 'Light',
    x: 50,
    y: 40,
    beam: 'omni',
    radius: 30,
    intensity: 1,
    kelvin: 2700,
    on: true,
    showFixture: false,
    fixtureSize: 12,
    ...p,
  };
}

const NIGHT: LightingSettings = { ...DEFAULT_LIGHTING, timeOfDay: 'night' };

describe('lightGain', () => {
  it('rises from day (≈0.2) to night (1)', () => {
    expect(lightGain('day')).toBeCloseTo(0.2, 5);
    expect(lightGain('night')).toBe(1);
    const order = (['day', 'golden', 'dusk', 'night'] as TimeOfDay[]).map(lightGain);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });
});

describe('TIME_OF_DAY_LOOKS', () => {
  it('has a neutral day look and a look for every time of day', () => {
    for (const t of TIMES_OF_DAY) expect(TIME_OF_DAY_LOOKS[t]).toBeDefined();
    expect(TIME_OF_DAY_LOOKS.day).toMatchObject({ exposure: 0, tint: [1, 1, 1], saturation: 0, contrast: 0 });
  });

  it('darkens progressively: golden > dusk > night', () => {
    expect(TIME_OF_DAY_LOOKS.golden.exposure).toBeLessThan(0);
    expect(TIME_OF_DAY_LOOKS.dusk.exposure).toBeLessThan(TIME_OF_DAY_LOOKS.golden.exposure);
    expect(TIME_OF_DAY_LOOKS.night.exposure).toBeLessThan(TIME_OF_DAY_LOOKS.dusk.exposure);
  });
});

describe('applyGrade', () => {
  it('is the identity for DEFAULT_LIGHTING', () => {
    const img = photo();
    const before = new Uint8ClampedArray(img.data);
    applyGrade(img, DEFAULT_LIGHTING);
    expect(img.data).toEqual(before);
    expect(isIdentityGrade(DEFAULT_LIGHTING)).toBe(true);
  });

  it('is the identity for any time of day at ambient 0 with neutral settings', () => {
    for (const t of TIMES_OF_DAY) {
      const img = photo();
      const before = new Uint8ClampedArray(img.data);
      applyGrade(img, { ...DEFAULT_LIGHTING, timeOfDay: t, ambient: 0 });
      expect(img.data).toEqual(before);
    }
  });

  it('never touches alpha', () => {
    const img = photo();
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 100 + (i % 7);
    const alpha = img.data.filter((_, i) => i % 4 === 3);
    applyGrade(img, NIGHT);
    expect(img.data.filter((_, i) => i % 4 === 3)).toEqual(alpha);
  });

  it('night darkens strongly and cools', () => {
    const img = gray(150);
    const out = graded(img, { timeOfDay: 'night' });
    const a = stats(img);
    const b = stats(out);
    expect(b.y).toBeLessThan(a.y * 0.3);
    // A neutral gray turns blue: blue dominates red in the graded result.
    expect(b.b / b.r).toBeGreaterThan(1.8);
    const [r, , bl] = px(out, 5, 5);
    expect(bl).toBeGreaterThan(r);
  });

  it('night desaturates colors before tinting', () => {
    const img = createImageDataLike(20, 20, { r: 40, g: 170, b: 40 }); // saturated lawn green
    const out = graded(img, { timeOfDay: 'night' });
    const s = stats(out);
    // Green no longer towers over blue the way it did.
    const before = stats(img);
    expect(s.g / s.b).toBeLessThan((before.g / before.b) * 0.25);
  });

  it('dusk is darker than golden hour and lighter than night', () => {
    const img = photo();
    const y = (t: TimeOfDay) => stats(graded(img, { timeOfDay: t })).y;
    expect(y('golden')).toBeLessThan(stats(img).y);
    expect(y('dusk')).toBeLessThan(y('golden'));
    expect(y('night')).toBeLessThan(y('dusk'));
  });

  it('golden hour warms neutral surfaces but keeps a blue sky blue', () => {
    const wall = gray(170);
    const g = stats(graded(wall, { timeOfDay: 'golden' }));
    expect(g.r / g.b).toBeGreaterThan(1.5);
    const sky = createImageDataLike(10, 10, { r: 92, g: 146, b: 214 });
    const s = stats(graded(sky, { timeOfDay: 'golden' }));
    expect(s.b).toBeGreaterThan(s.r * 2);
  });

  it('ambient scales the strength of the look', () => {
    const img = gray(150);
    const weak = stats(graded(img, { timeOfDay: 'night', ambient: 0.3 })).y;
    const strong = stats(graded(img, { timeOfDay: 'night', ambient: 1 })).y;
    expect(strong).toBeLessThan(weak);
    expect(weak).toBeLessThan(stats(img).y);
  });

  it('exposure is about 2^EV in linear light', () => {
    const img = gray(90);
    const base = stats(img).y;
    expect(stats(graded(img, { exposure: -1 })).y / base).toBeCloseTo(0.5, 1);
    expect(stats(graded(img, { exposure: 1 })).y / base).toBeCloseTo(2, 1);
  });

  it('rolls bright highlights off smoothly instead of clipping', () => {
    const ramp = createImageDataLike(256, 1);
    for (let x = 0; x < 256; x++) ramp.data[x * 4] = ramp.data[x * 4 + 1] = ramp.data[x * 4 + 2] = x;
    const out = graded(ramp, { exposure: 2 });
    let clipped = 0;
    for (let x = 0; x < 256; x++) if (out.data[x * 4 + 1] === 255) clipped++;
    // A hard +2 EV would clip everything above code ~136 (120 codes); the shoulder keeps detail.
    expect(clipped).toBeLessThan(40);
    // …and the curve stays monotonic (allowing ±1 for dither).
    for (let x = 1; x < 256; x++) expect(out.data[x * 4 + 1]).toBeGreaterThanOrEqual(out.data[(x - 1) * 4 + 1] - 1);
  });

  it('white balance: low kelvin warms, high kelvin cools, 5500 K is neutral', () => {
    expect(whiteBalanceGains(5500)).toEqual([1, 1, 1]);
    const img = gray(128);
    const warm = stats(graded(img, { kelvin: 3000 }));
    const cool = stats(graded(img, { kelvin: 8500 }));
    expect(warm.r).toBeGreaterThan(warm.b);
    expect(cool.b).toBeGreaterThan(cool.r);
    // Luminance is preserved (it's a color shift, not an exposure change).
    expect(warm.y / stats(img).y).toBeCloseTo(1, 1);
  });

  it('contrast pivots around mid-gray', () => {
    const dark = gray(50);
    const light = gray(205);
    expect(stats(graded(dark, { contrast: 0.8 })).y).toBeLessThan(stats(dark).y);
    expect(stats(graded(light, { contrast: 0.8 })).y).toBeGreaterThan(stats(light).y);
    expect(stats(graded(dark, { contrast: -0.8 })).y).toBeGreaterThan(stats(dark).y);
    expect(stats(graded(light, { contrast: -0.8 })).y).toBeLessThan(stats(light).y);
  });

  it('saturation −1 makes gray, +1 increases chroma', () => {
    const img = createImageDataLike(10, 10, { r: 180, g: 90, b: 60 });
    const [r0, g0, b0] = px(graded(img, { saturation: -1 }), 3, 3);
    expect(Math.max(r0, g0, b0) - Math.min(r0, g0, b0)).toBeLessThanOrEqual(2);
    const [r1, , b1] = px(graded(img, { saturation: 0.8 }), 3, 3);
    expect(r1 - b1).toBeGreaterThan(180 - 60);
  });

  it('tolerates malformed settings from old saves', () => {
    const img = photo();
    const bad = { timeOfDay: 'midnight', exposure: Number.NaN, kelvin: undefined, ambient: null, contrast: 0, saturation: 0 } as unknown as LightingSettings;
    expect(() => applyGrade(img, bad)).not.toThrow();
  });

  it('gradeGain reflects the grade multiplier', () => {
    expect(gradeGain(DEFAULT_LIGHTING)).toEqual([1, 1, 1]);
    const g = gradeGain(NIGHT);
    expect(g[2]).toBeGreaterThan(g[0]);
    expect(0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]).toBeLessThan(0.4);
  });
});

describe('renderLights', () => {
  const base = () => {
    const img = gray(60, 100, 80);
    applyGrade(img, NIGHT);
    return img;
  };

  function expectNeverDarker(before: ImageDataLike, after: ImageDataLike): void {
    let darker = 0;
    for (let i = 0; i < before.data.length; i++) if (after.data[i] < before.data[i]) darker++;
    expect(darker).toBe(0);
  }

  it('only brightens, for every beam and time of day', () => {
    const beams: Partial<PlacedLight>[] = [
      { beam: 'omni' },
      { beam: 'down' },
      { beam: 'up' },
      { beam: 'spot', angle: 45, spread: 50 },
      { beam: 'strip', x: 20, y: 30, x2: 80, y2: 35 },
      { beam: 'string', x: 10, y: 20, x2: 90, y2: 25, fixtureSize: 20 },
    ];
    for (const t of TIMES_OF_DAY) {
      const s = { ...DEFAULT_LIGHTING, timeOfDay: t };
      for (const b of beams) {
        const before = photo(100, 80, 3);
        applyGrade(before, s);
        const after = cloneImageData(before);
        renderLights(after, [light(b)], s, photo(100, 80, 3));
        expectNeverDarker(before, after);
        let brighter = 0;
        for (let i = 0; i < before.data.length; i++) if (after.data[i] > before.data[i]) brighter++;
        expect(brighter, `${t} ${b.beam}`).toBeGreaterThan(20);
      }
    }
  });

  it('skips lights that are off', () => {
    const before = base();
    const after = cloneImageData(before);
    renderLights(after, [light({ on: false }), light({ id: 'l2', on: false, beam: 'spot', angle: 90 })], NIGHT);
    expect(after.data).toEqual(before.data);
  });

  it('does nothing with no lights or zero intensity / radius', () => {
    const before = base();
    const after = cloneImageData(before);
    renderLights(after, [], NIGHT);
    renderLights(after, [light({ intensity: 0 }), light({ id: 'b', radius: 0 })], NIGHT);
    expect(after.data).toEqual(before.data);
  });

  it('fades to nothing at the radius (no light beyond it)', () => {
    const before = base();
    const after = cloneImageData(before);
    const l = light({ x: 50, y: 40, radius: 25 });
    renderLights(after, [l], NIGHT);
    let changedOutside = 0;
    let changedInside = 0;
    for (let y = 0; y < after.height; y++) {
      for (let x = 0; x < after.width; x++) {
        const same = px(after, x, y).join() === px(before, x, y).join();
        if (Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y) <= l.radius + 1) changedInside += same ? 0 : 1;
        else changedOutside += same ? 0 : 1;
      }
    }
    expect(changedOutside).toBe(0);
    expect(changedInside).toBeGreaterThan(500);
  });

  it('never reaches past the radius for any beam (distance from the source, segment or wire)', () => {
    const W = 160;
    const H = 120;
    const cases: Partial<PlacedLight>[] = [
      { beam: 'omni', x: 80, y: 60, radius: 30 },
      { beam: 'down', x: 80, y: 30, radius: 40 },
      { beam: 'up', x: 80, y: 100, radius: 40 },
      { beam: 'spot', x: 40, y: 60, radius: 50, angle: 20, spread: 60 },
      { beam: 'strip', x: 30, y: 60, x2: 130, y2: 70, radius: 18 },
      { beam: 'string', x: 20, y: 20, x2: 140, y2: 30, radius: 25, fixtureSize: 30 },
    ];
    for (const c of cases) {
      const l = light(c);
      // Distance to the light's geometry: the point, the strip segment, or the sampled wire.
      const pts: { x: number; y: number }[] =
        l.beam === 'string'
          ? Array.from({ length: 201 }, (_, i) => stringPoint(l, i / 200))
          : l.beam === 'strip'
            ? Array.from({ length: 201 }, (_, i) => ({ x: l.x + ((l.x2 as number) - l.x) * (i / 200), y: l.y + ((l.y2 as number) - l.y) * (i / 200) }))
            : [{ x: l.x, y: l.y }];
      const before = gray(35, W, H);
      const after = cloneImageData(before);
      renderLights(after, [l], NIGHT, gray(170, W, H));
      let outside = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const d = Math.min(...pts.map((p) => Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y)));
          if (d > l.radius + 1.5 && px(after, x, y).join() !== px(before, x, y).join()) outside++;
        }
      }
      expect(outside, l.beam).toBe(0);
    }
  });

  it('falls off smoothly from the center (no hard rim)', () => {
    const before = gray(40, 200, 40);
    const after = cloneImageData(before);
    renderLights(after, [light({ x: 100, y: 20, radius: 90, intensity: 0.6 })], NIGHT);
    let prev = 255;
    let maxStep = 0;
    for (let x = 100; x < 200; x++) {
      const g = px(after, x, 20)[1];
      expect(g).toBeLessThanOrEqual(prev + 1); // non-increasing outward (±1 dither)
      if (x > 104) maxStep = Math.max(maxStep, Math.abs(prev - g));
      prev = g;
    }
    expect(maxStep).toBeLessThanOrEqual(6);
    expect(px(after, 100, 20)[1]).toBeGreaterThan(px(before, 100, 20)[1] + 60);
  });

  it('is brighter at night than in daylight and scales with intensity', () => {
    const lift = (s: LightingSettings, intensity: number) => {
      const img = gray(100, 100, 80);
      const after = cloneImageData(img);
      renderLights(after, [light({ intensity })], s, img);
      return stats(after).y - stats(img).y;
    };
    expect(lift(NIGHT, 1)).toBeGreaterThan(lift(DEFAULT_LIGHTING, 1) * 2.5);
    expect(lift(NIGHT, 2)).toBeGreaterThan(lift(NIGHT, 1) * 1.3);
  });

  it('warm lights add warm light', () => {
    const before = gray(40, 100, 80);
    const after = cloneImageData(before);
    renderLights(after, [light({ kelvin: 2400, intensity: 0.5 })], NIGHT, gray(150, 100, 80));
    const [r, g, b] = px(after, 50, 42);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    const c = lightColorLinear(2400);
    expect(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]).toBeCloseTo(1, 5);
  });

  it('down lights light below the fixture, up lights above it', () => {
    const run = (beam: PlacedLight['beam']) => {
      const before = gray(30, 100, 120);
      const after = cloneImageData(before);
      renderLights(after, [light({ beam, x: 50, y: 60, radius: 50 })], NIGHT, gray(160, 100, 120));
      return { above: px(after, 50, 30)[1], below: px(after, 50, 90)[1] };
    };
    const down = run('down');
    const up = run('up');
    expect(down.below).toBeGreaterThan(down.above + 10);
    expect(up.above).toBeGreaterThan(up.below + 10);
  });

  it('spot lights follow their angle', () => {
    const before = gray(30, 120, 120);
    const after = cloneImageData(before);
    renderLights(after, [light({ beam: 'spot', x: 20, y: 60, radius: 90, angle: 0, spread: 30 })], NIGHT, gray(160, 120, 120));
    expect(px(after, 70, 60)[1]).toBeGreaterThan(px(after, 20, 15)[1] + 20); // along the beam vs off-axis
  });

  it('strip lights glow along the whole segment', () => {
    const before = gray(30, 120, 60);
    const after = cloneImageData(before);
    renderLights(after, [light({ beam: 'strip', x: 10, y: 30, x2: 110, y2: 30, radius: 20 })], NIGHT, gray(160, 120, 60));
    for (const x of [15, 40, 60, 90, 105]) expect(px(after, x, 30)[1]).toBeGreaterThan(80);
    expect(px(after, 60, 5)).toEqual(px(before, 60, 5));
  });

  it('string lights hang bulbs along a sagging wire', () => {
    const l = light({ beam: 'string', x: 10, y: 20, x2: 190, y2: 20, fixtureSize: 30, radius: 40 });
    const bulbs = stringBulbs(l);
    expect(bulbs.length).toBeGreaterThan(5);
    const mid = stringPoint(l, 0.5);
    expect(mid.y).toBeGreaterThan(20); // sags below the mounting points
    for (const b of bulbs) {
      expect(b.x).toBeGreaterThan(10);
      expect(b.x).toBeLessThan(190);
    }
    const before = gray(25, 200, 80);
    const after = cloneImageData(before);
    renderLights(after, [l], NIGHT);
    const b = bulbs[Math.floor(bulbs.length / 2)];
    expect(px(after, Math.round(b.x), Math.round(b.y + 2))[1]).toBeGreaterThan(150);
  });

  it('falls back to a short run when a line light has no end point', () => {
    const l = light({ beam: 'strip', x2: undefined, y2: undefined, radius: 50 });
    const e = lightEndPoint(l);
    expect(e.y).toBe(l.y);
    expect(e.x).toBeGreaterThan(l.x);
  });

  it('does not light up open blue sky', () => {
    const sky = createImageDataLike(100, 80, { r: 92, g: 146, b: 214 });
    const wall = createImageDataLike(100, 80, { r: 200, g: 196, b: 188 });
    const lift = (albedo: ImageDataLike) => {
      const img = cloneImageData(albedo);
      applyGrade(img, NIGHT);
      const before = stats(img).y;
      renderLights(img, [light()], NIGHT, albedo);
      return stats(img).y - before;
    };
    expect(lift(sky)).toBeLessThan(lift(wall) * 0.4);
  });

  it('estimates surface color from the graded image when no albedo is given', () => {
    const albedo = gray(170, 100, 80);
    const img = cloneImageData(albedo);
    applyGrade(img, NIGHT);
    const a = cloneImageData(img);
    const b = cloneImageData(img);
    renderLights(a, [light()], NIGHT, albedo);
    renderLights(b, [light()], NIGHT);
    const ya = stats(a).y;
    const yb = stats(b).y;
    expect(Math.abs(ya - yb) / ya).toBeLessThan(0.15);
  });

  it('handles lights partly or fully outside the image', () => {
    const before = base();
    const after = cloneImageData(before);
    expect(() =>
      renderLights(after, [light({ x: -20, y: -20, radius: 40 }), light({ id: 'far', x: 5000, y: 5000 }), light({ id: 'nan', x: Number.NaN })], NIGHT),
    ).not.toThrow();
    expectNeverDarker(before, after);
    expect(px(after, 0, 0)[1]).toBeGreaterThan(px(before, 0, 0)[1]);
  });

  it('renders large images through the coarse grid without seams', () => {
    // 900×700 uses the coarse grid (step 4) for the big pool and bounce.
    const W = 900;
    const H = 700;
    const before = gray(45, W, H);
    const after = cloneImageData(before);
    renderLights(after, [light({ x: 450, y: 350, radius: 300 })], NIGHT, gray(150, W, H));
    // Start past the small full-resolution bulb halo (a few px wide) at the center.
    let prev = px(after, 462, 350)[1];
    for (let x = 463; x < 760; x++) {
      const g = px(after, x, 350)[1];
      expect(g).toBeLessThanOrEqual(prev + 1);
      expect(prev - g).toBeLessThanOrEqual(4);
      prev = g;
    }
    // Symmetric left / right and up / down (the grid doesn't skew the pool).
    const right = px(after, 600, 350)[1];
    const left = px(after, 300, 350)[1];
    expect(Math.abs(right - left)).toBeLessThanOrEqual(2);
  });
});
