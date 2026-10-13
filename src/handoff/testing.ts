/**
 * Synthetic images for the hand-off tests (deterministic, DOM-free): a
 * textured "scene" with plenty of corners for feature matching, elliptical
 * target masks, and a simulated app round trip (resize + zoom/shift +
 * colour cast + an edit inside the target + noise).
 */
import { createMask, fillPolygon } from '../engine/mask';
import type { ImageDataLike, Mask } from '../engine/types';
import { applyAffine, composeAffine, invertAffine, rectToRect, warpAffineRGBA, type Affine, type Rect } from './resample';

/** Small deterministic PRNG (LCG) returning [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Textured scene: gradient ground/sky, random rectangles and discs, fine noise. */
export function texturedScene(width: number, height: number, seed = 7): ImageDataLike {
  const rand = rng(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const t = y / height;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      data[p] = t < 0.4 ? 150 + 60 * t : 70 + 40 * t;
      data[p + 1] = t < 0.4 ? 180 + 40 * t : 110 + 30 * t;
      data[p + 2] = t < 0.4 ? 220 : 60 + 20 * t;
      data[p + 3] = 255;
    }
  }
  const shapes = Math.round((width * height) / 1800);
  for (let k = 0; k < shapes; k++) {
    const cx = rand() * width;
    const cy = rand() * height;
    const size = 3 + rand() * Math.max(width, height) * 0.025;
    const r = Math.round(rand() * 255);
    const g = Math.round(rand() * 255);
    const b = Math.round(rand() * 255);
    const disc = rand() < 0.5;
    const hw = size * (0.5 + rand());
    const hh = size * (0.5 + rand());
    const x0 = Math.max(0, Math.floor(cx - hw));
    const x1 = Math.min(width - 1, Math.ceil(cx + hw));
    const y0 = Math.max(0, Math.floor(cy - hh));
    const y1 = Math.min(height - 1, Math.ceil(cy + hh));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (disc && ((x - cx) / hw) ** 2 + ((y - cy) / hh) ** 2 > 1) continue;
        const p = (y * width + x) * 4;
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
      }
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() - 0.5) * 10;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  return { width, height, data };
}

/** Solid ellipse mask (hard edge, anti-aliased). */
export function ellipseMask(width: number, height: number, cx: number, cy: number, rx: number, ry: number): Mask {
  const m = createMask(width, height);
  const pts = Array.from({ length: 64 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  });
  fillPolygon(m, pts, 'add');
  return m;
}

export interface SimulatedReturn {
  returned: ImageDataLike;
  /** Ground truth photo → returned transform. */
  truth: Affine;
}

export interface SimulateOptions {
  /** Returned size relative to the export (default 0.75). */
  scale?: number;
  /** Returned canvas size, when the app changed the aspect (content stays centred at `scale`). */
  size?: { w: number; h: number };
  /** Extra zoom the "model" applied around the centre (default 1.03 = slight crop). */
  zoom?: number;
  /** Shift in returned px (default 9, −6). */
  shift?: { x: number; y: number };
  /** Per-channel colour cast (default warm). */
  cast?: { gain: [number, number, number]; offset: [number, number, number] };
  /** Colour of the edit painted inside the target (stripes alternate with a darker shade). */
  editColor?: [number, number, number];
  /** Extra change outside the target: a solid disc in photo px. */
  outsideChange?: { x: number; y: number; r: number; color: [number, number, number] };
  noise?: number;
  seed?: number;
}

/**
 * Simulates what an app returns for an export of `crop` (exportImg is the
 * marked or clean export): resized, zoomed and shifted, colour cast, the
 * target repainted with stripes, optional outside change, noise.
 */
export function simulateReturn(exportImg: ImageDataLike, crop: Rect, target: Mask, opts: SimulateOptions = {}): SimulatedReturn {
  const scale = opts.scale ?? 0.75;
  const zoom = opts.zoom ?? 1.03;
  const shift = opts.shift ?? { x: 9, y: -6 };
  const rw = opts.size?.w ?? Math.round(exportImg.width * scale);
  const rh = opts.size?.h ?? Math.round(exportImg.height * scale);
  // export px → returned px: scale, zoom about the centre, shift.
  const k = scale * zoom;
  const T: Affine = [k, 0, rw / 2 - (exportImg.width / 2) * k + shift.x, 0, k, rh / 2 - (exportImg.height / 2) * k + shift.y];
  const E = rectToRect(crop, { x: 0, y: 0, w: exportImg.width, h: exportImg.height });
  const truth = composeAffine(T, E);
  const back = invertAffine(T) as Affine;
  const warped = warpAffineRGBA(exportImg, back, rw, rh).image;
  const toPhoto = invertAffine(truth) as Affine;
  const rand = rng(opts.seed ?? 3);
  const cast = opts.cast ?? { gain: [1.06, 1.0, 0.88], offset: [8, 2, -3] };
  const edit = opts.editColor ?? [150, 110, 80];
  const d = warped.data;
  for (let v = 0; v < rh; v++) {
    for (let u = 0; u < rw; u++) {
      const p = (v * rw + u) * 4;
      const ph = applyAffine(toPhoto, u + 0.5, v + 0.5);
      const px = Math.floor(ph.x);
      const py = Math.floor(ph.y);
      const inPhoto = px >= 0 && py >= 0 && px < target.width && py < target.height;
      if (inPhoto && target.data[py * target.width + px] > 128) {
        const stripe = Math.floor((u + v) / 12) % 2 === 0 ? 1 : 0.75;
        d[p] = edit[0] * stripe;
        d[p + 1] = edit[1] * stripe;
        d[p + 2] = edit[2] * stripe;
      }
      const oc = opts.outsideChange;
      if (oc && Math.hypot(ph.x - oc.x, ph.y - oc.y) < oc.r) {
        d[p] = oc.color[0];
        d[p + 1] = oc.color[1];
        d[p + 2] = oc.color[2];
      }
      const n = (rand() - 0.5) * 2 * (opts.noise ?? 2);
      for (let c = 0; c < 3; c++) d[p + c] = cast.gain[c] * d[p + c] + cast.offset[c] + n;
      d[p + 3] = 255;
    }
  }
  return { returned: warped, truth };
}
