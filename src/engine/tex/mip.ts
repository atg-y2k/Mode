/**
 * Mip chains for periodic tiles: linear-light float pyramids with wrap-around
 * box filtering, plus bilinear / trilinear / anisotropic sampling. Sampling
 * a pre-filtered level whenever one output pixel covers several texels is
 * what keeps receding floors and lawns free of moiré.
 */
import { SRGB8_TO_LINEAR } from '../color';
import type { ImageDataLike } from '../types';

export interface MipLevel {
  w: number;
  h: number;
  /** Linear RGB, interleaved. */
  data: Float32Array;
  /** This level's texels per level-0 texel along x / y. */
  kx: number;
  ky: number;
}

export interface MipChain {
  levels: MipLevel[];
  /** Mean linear color of the whole tile. */
  mean: [number, number, number];
  /** Level-0 size (the repeat period in texels). */
  w0: number;
  h0: number;
}

/** Resamples one axis by an exact box filter with wrap-around (periodic). */
function boxResample(
  src: Float32Array,
  w: number,
  h: number,
  nw: number,
  nh: number,
  horizontal: boolean,
): Float32Array {
  const out = new Float32Array(nw * nh * 3);
  const n = horizontal ? w : h;
  const nn = horizontal ? nw : nh;
  const r = n / nn;
  // Tap lists per output index.
  const taps: { idx: number[]; wt: number[] }[] = [];
  for (let o = 0; o < nn; o++) {
    const a = o * r;
    const b = (o + 1) * r;
    const idx: number[] = [];
    const wt: number[] = [];
    for (let i = Math.floor(a); i < b; i++) {
      const lo = Math.max(a, i);
      const hi = Math.min(b, i + 1);
      if (hi > lo) {
        idx.push(((i % n) + n) % n);
        wt.push((hi - lo) / r);
      }
    }
    taps.push({ idx, wt });
  }
  if (horizontal) {
    for (let y = 0; y < nh; y++) {
      const srow = y * w * 3;
      const orow = y * nw * 3;
      for (let o = 0; o < nw; o++) {
        const t = taps[o];
        let rr = 0;
        let gg = 0;
        let bb = 0;
        for (let k = 0; k < t.idx.length; k++) {
          const p = srow + t.idx[k] * 3;
          const wv = t.wt[k];
          rr += src[p] * wv;
          gg += src[p + 1] * wv;
          bb += src[p + 2] * wv;
        }
        out[orow + o * 3] = rr;
        out[orow + o * 3 + 1] = gg;
        out[orow + o * 3 + 2] = bb;
      }
    }
  } else {
    for (let o = 0; o < nh; o++) {
      const t = taps[o];
      const orow = o * nw * 3;
      for (let x = 0; x < nw; x++) {
        let rr = 0;
        let gg = 0;
        let bb = 0;
        for (let k = 0; k < t.idx.length; k++) {
          const p = (t.idx[k] * w + x) * 3;
          const wv = t.wt[k];
          rr += src[p] * wv;
          gg += src[p + 1] * wv;
          bb += src[p + 2] * wv;
        }
        out[orow + x * 3] = rr;
        out[orow + x * 3 + 1] = gg;
        out[orow + x * 3 + 2] = bb;
      }
    }
  }
  return out;
}

const cached = new WeakMap<ImageDataLike, MipChain>();

/** buildMipChain memoized per tile object (tiles are immutable once generated). */
export function getMipChain(tile: ImageDataLike): MipChain {
  let c = cached.get(tile);
  if (!c) {
    c = buildMipChain(tile);
    cached.set(tile, c);
  }
  return c;
}

/** Builds the pyramid down to 1×1 (the last level is the tile's mean color). */
export function buildMipChain(tile: ImageDataLike): MipChain {
  const w0 = Math.max(1, tile.width);
  const h0 = Math.max(1, tile.height);
  const base = new Float32Array(w0 * h0 * 3);
  const src = tile.data;
  const lin = SRGB8_TO_LINEAR;
  for (let i = 0, p = 0, q = 0; i < w0 * h0; i++, p += 4, q += 3) {
    base[q] = lin[src[p]];
    base[q + 1] = lin[src[p + 1]];
    base[q + 2] = lin[src[p + 2]];
  }
  const levels: MipLevel[] = [{ w: w0, h: h0, data: base, kx: 1, ky: 1 }];
  let cur = levels[0];
  while (cur.w > 1 || cur.h > 1) {
    const nw = Math.max(1, Math.round(cur.w / 2));
    const nh = Math.max(1, Math.round(cur.h / 2));
    const tmp = nw !== cur.w ? boxResample(cur.data, cur.w, cur.h, nw, cur.h, true) : cur.data;
    const data = nh !== cur.h ? boxResample(tmp, nw, cur.h, nw, nh, false) : tmp;
    cur = { w: nw, h: nh, data, kx: nw / w0, ky: nh / h0 };
    levels.push(cur);
  }
  const top = levels[levels.length - 1].data;
  return { levels, mean: [top[0], top[1], top[2]], w0, h0 };
}

/** Applies a per-texel linear color transform to every level (it commutes with box filtering). */
export function mapChain(chain: MipChain, f: (r: number, g: number, b: number, out: Float32Array, o: number) => void): MipChain {
  const levels = chain.levels.map((l) => {
    const data = new Float32Array(l.data.length);
    for (let p = 0; p < data.length; p += 3) f(l.data[p], l.data[p + 1], l.data[p + 2], data, p);
    return { ...l, data };
  });
  const top = levels[levels.length - 1].data;
  return { levels, mean: [top[0], top[1], top[2]], w0: chain.w0, h0: chain.h0 };
}

/**
 * Adds `wt` × the bilinear, wrap-around sample of `l` at level-0 texel
 * coordinates (u, v) into acc[0..2]. (u, v) must already be wrapped into
 * the level-0 period [0, w0) × [0, h0) (see accumTrilinear).
 */
export function accumBilinear(l: MipLevel, u: number, v: number, wt: number, acc: Float64Array): void {
  const x = u * l.kx - 0.5;
  const y = v * l.ky - 0.5;
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const tx = x - fx;
  const ty = y - fy;
  const w = l.w;
  const h = l.h;
  let x0 = fx;
  if (x0 < 0) x0 += w;
  else if (x0 >= w) x0 -= w;
  let y0 = fy;
  if (y0 < 0) y0 += h;
  else if (y0 >= h) y0 -= h;
  const x1 = x0 + 1 === w ? 0 : x0 + 1;
  const y1 = y0 + 1 === h ? 0 : y0 + 1;
  const d = l.data;
  const a = (y0 * w + x0) * 3;
  const b = (y0 * w + x1) * 3;
  const c = (y1 * w + x0) * 3;
  const e = (y1 * w + x1) * 3;
  const w00 = (1 - tx) * (1 - ty) * wt;
  const w10 = tx * (1 - ty) * wt;
  const w01 = (1 - tx) * ty * wt;
  const w11 = tx * ty * wt;
  acc[0] += d[a] * w00 + d[b] * w10 + d[c] * w01 + d[e] * w11;
  acc[1] += d[a + 1] * w00 + d[b + 1] * w10 + d[c + 1] * w01 + d[e + 1] * w11;
  acc[2] += d[a + 2] * w00 + d[b + 2] * w10 + d[c + 2] * w01 + d[e + 2] * w11;
}

/**
 * Trilinear sample at level-of-detail `lod` (log2 of texels per pixel),
 * accumulated with weight `wt`. (u, v) are level-0 texel coordinates, any range.
 */
export function accumTrilinear(chain: MipChain, u: number, v: number, lod: number, wt: number, acc: Float64Array): void {
  const levels = chain.levels;
  const max = levels.length - 1;
  const w0 = chain.w0;
  const h0 = chain.h0;
  u -= Math.floor(u / w0) * w0;
  v -= Math.floor(v / h0) * h0;
  if (u >= w0) u = 0;
  if (v >= h0) v = 0;
  if (!(lod > 0)) {
    accumBilinear(levels[0], u, v, wt, acc);
    return;
  }
  if (lod >= max) {
    const m = chain.mean;
    acc[0] += m[0] * wt;
    acc[1] += m[1] * wt;
    acc[2] += m[2] * wt;
    return;
  }
  const i = Math.floor(lod);
  const f = lod - i;
  accumBilinear(levels[i], u, v, wt * (1 - f), acc);
  if (f > 1e-3) accumBilinear(levels[i + 1], u, v, wt * f, acc);
}

/**
 * Anisotropic sample: the pixel footprint is the parallelogram spanned by
 * (dux, dvx) and (duy, dvy) (level-0 texels per output pixel along screen x
 * and y). Up to `maxTaps` trilinear taps are spread along the major axis at
 * the LOD of the minor axis, so foreshortened surfaces stay sharp across
 * while still being filtered along the receding direction.
 */
export function accumAniso(
  chain: MipChain,
  u: number,
  v: number,
  dux: number,
  dvx: number,
  duy: number,
  dvy: number,
  maxTaps: number,
  acc: Float64Array,
): void {
  const lx = dux * dux + dvx * dvx;
  const ly = duy * duy + dvy * dvy;
  let majU: number;
  let majV: number;
  let maj2: number;
  let min2: number;
  if (lx >= ly) {
    majU = dux;
    majV = dvx;
    maj2 = lx;
    min2 = ly;
  } else {
    majU = duy;
    majV = dvy;
    maj2 = ly;
    min2 = lx;
  }
  const maj = Math.sqrt(maj2);
  const min = Math.sqrt(min2);
  let taps = 1;
  if (maxTaps > 1 && maj > 1 && maj > min * 1.5) taps = Math.min(maxTaps, Math.ceil(maj / Math.max(min, 1e-6)));
  // Per-tap footprint along the major axis is maj / taps.
  const fp = Math.max(min, maj / taps);
  const lod = fp > 1 ? Math.log2(fp) : 0;
  if (taps === 1) {
    accumTrilinear(chain, u, v, lod, 1, acc);
    return;
  }
  const wt = 1 / taps;
  for (let k = 0; k < taps; k++) {
    const t = (k + 0.5) / taps - 0.5;
    accumTrilinear(chain, u + majU * t, v + majV * t, lod, wt, acc);
  }
}
