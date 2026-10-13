/**
 * Periodic noise for seamless tiles. Every field here repeats exactly over
 * the tile (lattice cell counts are integers per tile side), so tiling the
 * result never shows a seam. Fields are filled for the whole tile at once
 * with per-row / per-column precomputation, which is far cheaper than
 * evaluating scalar noise per pixel.
 */
import { hash3 } from './rng';

/** Gradient table for a cx×cy periodic lattice. */
function gradients(cx: number, cy: number, seed: number): { gx: Float32Array; gy: Float32Array } {
  const n = cx * cy;
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  for (let j = 0; j < cy; j++) {
    for (let i = 0; i < cx; i++) {
      const a = (hash3(i, j, seed) / 4294967296) * Math.PI * 2;
      gx[j * cx + i] = Math.cos(a);
      gy[j * cx + i] = Math.sin(a);
    }
  }
  return { gx, gy };
}

interface Axis {
  i0: Int32Array;
  i1: Int32Array;
  t: Float32Array;
  f: Float32Array;
}

/** Per-pixel lattice index / fraction / quintic fade along one axis. */
function axis(size: number, cells: number): Axis {
  const i0 = new Int32Array(size);
  const i1 = new Int32Array(size);
  const t = new Float32Array(size);
  const f = new Float32Array(size);
  const k = cells / size;
  for (let p = 0; p < size; p++) {
    let c = (p + 0.5) * k;
    c -= Math.floor(c / cells) * cells;
    const i = Math.floor(c);
    const fr = c - i;
    i0[p] = i % cells;
    i1[p] = (i + 1) % cells;
    t[p] = fr;
    f[p] = fr * fr * fr * (fr * (fr * 6 - 15) + 10);
  }
  return { i0, i1, t, f };
}

/**
 * Adds `amp` × periodic gradient (Perlin-style) noise to `out` (w×h), with
 * `cx`×`cy` lattice cells across the tile. Output of one call is roughly
 * in [-amp, amp]. Different cx/cy give anisotropic (stretched) features.
 */
export function addNoise(
  out: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  seed: number,
  amp: number,
  mode: 'signed' | 'abs' = 'signed',
): void {
  cx = Math.max(1, Math.round(cx));
  cy = Math.max(1, Math.round(cy));
  const { gx, gy } = gradients(cx, cy, seed);
  const ax = axis(w, cx);
  const ay = axis(h, cy);
  const xi0 = ax.i0;
  const xi1 = ax.i1;
  const xt = ax.t;
  const xf = ax.f;
  const scale = amp * 1.42;
  const abs = mode === 'abs';
  for (let y = 0; y < h; y++) {
    const r0 = ay.i0[y] * cx;
    const r1 = ay.i1[y] * cx;
    const ty = ay.t[y];
    const ty1 = ty - 1;
    const fy = ay.f[y];
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const a0 = r0 + xi0[x];
      const b0 = r0 + xi1[x];
      const a1 = r1 + xi0[x];
      const b1 = r1 + xi1[x];
      const tx = xt[x];
      const tx1 = tx - 1;
      const n00 = gx[a0] * tx + gy[a0] * ty;
      const n10 = gx[b0] * tx1 + gy[b0] * ty;
      const n01 = gx[a1] * tx + gy[a1] * ty1;
      const n11 = gx[b1] * tx1 + gy[b1] * ty1;
      const fx = xf[x];
      const nx0 = n00 + (n10 - n00) * fx;
      const nx1 = n01 + (n11 - n01) * fx;
      const v = (nx0 + (nx1 - nx0) * fy) * scale;
      out[row + x] += abs ? (v < 0 ? -v : v) : v;
    }
  }
}

/** Adds the periodic bilinear upsampling of `src` (sw×sh) into `out` (w×h). */
function upsampleAdd(src: Float32Array, sw: number, sh: number, out: Float32Array, w: number, h: number): void {
  const kx = sw / w;
  const ky = sh / h;
  const x0s = new Int32Array(w);
  const x1s = new Int32Array(w);
  const txs = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const fx = (x + 0.5) * kx - 0.5;
    const f = Math.floor(fx);
    txs[x] = fx - f;
    x0s[x] = ((f % sw) + sw) % sw;
    x1s[x] = (x0s[x] + 1) % sw;
  }
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) * ky - 0.5;
    const f = Math.floor(fy);
    const ty = fy - f;
    const y0 = ((f % sh) + sh) % sh;
    const y1 = (y0 + 1) % sh;
    const ra = y0 * sw;
    const rb = y1 * sw;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const a = x0s[x];
      const b = x1s[x];
      const tx = txs[x];
      const top = src[ra + a] + (src[ra + b] - src[ra + a]) * tx;
      const bot = src[rb + a] + (src[rb + b] - src[rb + a]) * tx;
      out[row + x] += top + (bot - top) * ty;
    }
  }
}

/**
 * Fractal (fBm) periodic noise: octaves of addNoise doubling the cell count.
 * Octaves whose cells would be smaller than ~1.5 px are skipped (they would
 * only alias). The sum is normalized so the result stays in about [-amp, amp]
 * ('abs' mode: [0, amp], a turbulence field).
 *
 * Smooth octaves are evaluated on coarser grids (cells ≥ ~6 grid samples)
 * and accumulated coarse-to-fine — each grid is bilinearly upsampled into the
 * next finer one — so a whole field costs about one full-resolution pass.
 */
export function addFbm(
  out: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  octaves: number,
  gain: number,
  seed: number,
  amp: number,
  mode: 'signed' | 'abs' = 'signed',
): void {
  let total = 0;
  let a = 1;
  for (let o = 0; o < octaves; o++) {
    total += a;
    a *= gain;
  }
  a = amp / total;
  let fx = Math.max(1, Math.round(cx));
  let fy = Math.max(1, Math.round(cy));
  // Group octaves by grid decimation (a power of two, ≤ 8).
  const groups = new Map<number, { fx: number; fy: number; seed: number; amp: number }[]>();
  for (let o = 0; o < octaves; o++) {
    if (o > 0 && (w / fx < 1.5 || h / fy < 1.5)) break;
    const cell = Math.min(w / fx, h / fy);
    let d = 1;
    while (d < 8 && cell / (d * 2) >= 6) d *= 2;
    let g = groups.get(d);
    if (!g) groups.set(d, (g = []));
    g.push({ fx, fy, seed: (seed + Math.imul(o + 1, 0x9e3779b1)) | 0, amp: a });
    a *= gain;
    fx *= 2;
    fy *= 2;
  }
  const ds = [...groups.keys()].sort((p, q) => q - p);
  let acc: Float32Array | null = null;
  let aw = 0;
  let ah = 0;
  for (const d of ds) {
    const gw = d === 1 ? w : Math.max(1, Math.ceil(w / d));
    const gh = d === 1 ? h : Math.max(1, Math.ceil(h / d));
    const buf = d === 1 ? out : new Float32Array(gw * gh);
    if (acc) upsampleAdd(acc, aw, ah, buf, gw, gh);
    for (const oc of groups.get(d)!) addNoise(buf, gw, gh, oc.fx, oc.fy, oc.seed, oc.amp, mode);
    acc = buf;
    aw = gw;
    ah = gh;
  }
  if (acc && acc !== out) upsampleAdd(acc, aw, ah, out, w, h);
}

/** New field filled with fBm (see addFbm). */
export function fbmField(
  w: number,
  h: number,
  cx: number,
  cy: number,
  octaves: number,
  gain: number,
  seed: number,
  mode: 'signed' | 'abs' = 'signed',
): Float32Array {
  const f = new Float32Array(w * h);
  addFbm(f, w, h, cx, cy, octaves, gain, seed, 1, mode);
  return f;
}

/**
 * Number of lattice cells across `sizePx` pixels for features of about
 * `featurePx` pixels — an integer ≥ 1 so the field stays periodic.
 */
export function cellsFor(sizePx: number, featurePx: number): number {
  return Math.max(1, Math.round(sizePx / Math.max(1e-6, featurePx)));
}

/**
 * Fiber / streak noise: independent 1D value noise along x for each pixel
 * row (cells of ~`cellPx` px), periodic in x. Gives wood fibers, brushed
 * metal and broom finishes. `vertical` streaks run along y instead.
 */
export function addStreaks(
  out: Float32Array,
  w: number,
  h: number,
  cellPx: number,
  seed: number,
  amp: number,
  vertical = false,
): void {
  const len = vertical ? h : w;
  const lines = vertical ? w : h;
  const n = Math.max(1, Math.round(len / Math.max(1, cellPx)));
  const k = n / len;
  const vals = new Float32Array(n);
  for (let line = 0; line < lines; line++) {
    for (let i = 0; i < n; i++) vals[i] = (hash3(line, i, seed) / 4294967296) * 2 - 1;
    for (let p = 0; p < len; p++) {
      const c = (p + 0.5) * k;
      const i = Math.floor(c);
      const t = c - i;
      const s = t * t * (3 - 2 * t);
      const a = vals[i % n];
      const b = vals[(i + 1) % n];
      const idx = vertical ? p * w + line : line * w + p;
      out[idx] += (a + (b - a) * s) * amp;
    }
  }
}

/** Per-pixel white noise in [-amp, amp] (granules, speckle). */
export function addWhiteNoise(out: Float32Array, w: number, h: number, seed: number, amp: number): void {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) out[row + x] += ((hash3(x, y, seed) / 4294967296) * 2 - 1) * amp;
  }
}

/** Separable box blur with wrap-around (seamless), applied `passes` times (2 ≈ tent, 3 ≈ gaussian). */
export function blurWrap(src: Float32Array, w: number, h: number, rx: number, ry: number, passes = 2): Float32Array {
  let a = new Float32Array(src);
  let b = new Float32Array(src.length);
  rx = Math.max(0, Math.min(Math.floor((w - 1) / 2), Math.round(rx)));
  ry = Math.max(0, Math.min(Math.floor((h - 1) / 2), Math.round(ry)));
  const col = new Float64Array(w);
  for (let p = 0; p < passes; p++) {
    if (rx > 0) {
      const inv = 1 / (2 * rx + 1);
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let s = 0;
        for (let k = -rx; k <= rx; k++) s += a[row + (k < 0 ? k + w : k)];
        for (let x = 0; x < w; x++) {
          b[row + x] = s * inv;
          const add = x + rx + 1;
          const sub = x - rx;
          s += a[row + (add >= w ? add - w : add)] - a[row + (sub < 0 ? sub + w : sub)];
        }
      }
      const t = a;
      a = b;
      b = t;
    }
    if (ry > 0) {
      // Row-major running column sums (cache friendly).
      const inv = 1 / (2 * ry + 1);
      col.fill(0);
      for (let k = -ry; k <= ry; k++) {
        const row = (k < 0 ? k + h : k) * w;
        for (let x = 0; x < w; x++) col[x] += a[row + x];
      }
      for (let y = 0; y < h; y++) {
        const row = y * w;
        const add = y + ry + 1;
        const sub = y - ry;
        const ra = (add >= h ? add - h : add) * w;
        const rs = (sub < 0 ? sub + h : sub) * w;
        for (let x = 0; x < w; x++) {
          b[row + x] = col[x] * inv;
          col[x] += a[ra + x] - a[rs + x];
        }
      }
      const t = a;
      a = b;
      b = t;
    }
  }
  return a;
}
