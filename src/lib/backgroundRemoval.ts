/**
 * Lightweight background removal for user-uploaded asset photos (a plant or
 * fixture shot against a plain wall / sky / product-page white): flood-fills
 * from the image border over colors similar to the border, feathers the edge,
 * then trims fully transparent margins. Pure pixels — no ML.
 */
import { rgbaToLabArray } from '../engine/color';
import type { ImageDataLike } from '../engine/types';

export interface BackgroundRemovalOptions {
  /** ΔE tolerance from sampled border colors (default 18). */
  tolerance?: number;
  /** Edge feather radius in px (default 1.5). */
  feather?: number;
}

/** Pixels with alpha below this count as already transparent. */
const TRANSPARENT_ALPHA = 128;
const MAX_CLUSTERS = 8;

interface BorderCluster {
  l: number;
  a: number;
  b: number;
  r: number;
  g: number;
  bl: number;
  count: number;
}

/**
 * Groups the opaque border pixels into a few representative background colors
 * (greedy clustering in Lab). Small clusters — usually the object touching the
 * frame — are dropped so they don't get treated as background.
 */
function borderClusters(img: ImageDataLike, lab: Float32Array, tol: number): BorderCluster[] {
  const { width: w, height: h, data } = img;
  const ring = Math.max(1, Math.min(3, Math.round(Math.min(w, h) * 0.01)));
  const clusters: BorderCluster[] = [];
  let total = 0;
  const join = tol * 0.5;
  const visit = (x: number, y: number) => {
    const i = y * w + x;
    if (data[i * 4 + 3] < TRANSPARENT_ALPHA) return;
    const L = lab[i * 3];
    const A = lab[i * 3 + 1];
    const B = lab[i * 3 + 2];
    total++;
    let best: BorderCluster | null = null;
    let bestD = join * join;
    for (const c of clusters) {
      const dl = c.l - L, da = c.a - A, db = c.b - B;
      const d = dl * dl + da * da + db * db;
      if (d <= bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) {
      // Running mean keeps the cluster centered on its members.
      const k = best.count + 1;
      best.l += (L - best.l) / k;
      best.a += (A - best.a) / k;
      best.b += (B - best.b) / k;
      best.r += (data[i * 4] - best.r) / k;
      best.g += (data[i * 4 + 1] - best.g) / k;
      best.bl += (data[i * 4 + 2] - best.bl) / k;
      best.count = k;
    } else if (clusters.length < 64) {
      clusters.push({ l: L, a: A, b: B, r: data[i * 4], g: data[i * 4 + 1], bl: data[i * 4 + 2], count: 1 });
    }
  };
  for (let y = 0; y < h; y++) {
    const edgeRow = y < ring || y >= h - ring;
    if (edgeRow) for (let x = 0; x < w; x++) visit(x, y);
    else {
      for (let x = 0; x < Math.min(ring, w); x++) visit(x, y);
      for (let x = Math.max(ring, w - ring); x < w; x++) visit(x, y);
    }
  }
  if (!total) return [];
  clusters.sort((p, q) => q.count - p.count);
  const kept: BorderCluster[] = [];
  let covered = 0;
  for (const c of clusters) {
    if (kept.length >= MAX_CLUSTERS || covered >= total * 0.85 || c.count < total * 0.05) break;
    kept.push(c);
    covered += c.count;
  }
  return kept;
}

/** Separable Gaussian blur of an 8-bit channel (radius ≈ 2σ). */
function blurChannel(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const r = Math.max(1, Math.ceil(radius));
  const sigma = Math.max(0.5, radius / 2);
  const kernel = new Float32Array(2 * r + 1);
  let ksum = 0;
  for (let i = -r; i <= r; i++) ksum += kernel[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
        s += src[row + xx] * kernel[k + r];
      }
      tmp[row + x] = s;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
        s += tmp[yy * w + x] * kernel[k + r];
      }
      out[y * w + x] = s + 0.5;
    }
  }
  return out;
}

/** Returns a NEW image with background alpha = 0. */
export function removeBackground(img: ImageDataLike, opts: BackgroundRemovalOptions = {}): ImageDataLike {
  const tol = Math.max(1, opts.tolerance ?? 18);
  const feather = Math.max(0, opts.feather ?? 1.5);
  const { width: w, height: h, data: src } = img;
  const n = w * h;
  const out: ImageDataLike = { width: w, height: h, data: new Uint8ClampedArray(src) };
  if (n === 0) return out;

  const lab = new Float32Array(n * 3);
  rgbaToLabArray(src, lab, n);
  const clusters = borderClusters(img, lab, tol);

  // Distance of every pixel to the nearest background color, and which one.
  const dist = new Float32Array(n);
  const nearest = new Uint8Array(n);
  if (clusters.length) {
    for (let i = 0, o = 0; i < n; i++, o += 3) {
      const L = lab[o], A = lab[o + 1], B = lab[o + 2];
      let best = Infinity;
      let bi = 0;
      for (let c = 0; c < clusters.length; c++) {
        const cl = clusters[c];
        const dl = cl.l - L, da = cl.a - A, db = cl.b - B;
        const d = dl * dl + da * da + db * db;
        if (d < best) {
          best = d;
          bi = c;
        }
      }
      dist[i] = Math.sqrt(best);
      nearest[i] = bi;
    }
  } else {
    dist.fill(Infinity);
  }

  // 1) Flood fill from the border. A pixel joins the background when it is
  // transparent, close to a border color, or a smooth continuation of an
  // adjacent background pixel (gradients: vignetted walls, skies).
  const bg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  const isTransparent = (i: number) => src[i * 4 + 3] < TRANSPARENT_ALPHA;
  const seed = (i: number) => {
    if (!bg[i] && (isTransparent(i) || dist[i] <= tol)) {
      bg[i] = 1;
      queue[qt++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  const gradTol2 = (tol * 0.25) ** 2;
  const tryGrow = (p: number, q: number) => {
    if (bg[q]) return;
    let ok = isTransparent(q) || dist[q] <= tol;
    if (!ok && dist[q] <= tol * 2) {
      const po = p * 3, qo = q * 3;
      const dl = lab[po] - lab[qo], da = lab[po + 1] - lab[qo + 1], db = lab[po + 2] - lab[qo + 2];
      ok = dl * dl + da * da + db * db <= gradTol2;
    }
    if (ok) {
      bg[q] = 1;
      queue[qt++] = q;
    }
  };
  while (qh < qt) {
    const p = queue[qh++];
    const x = p % w;
    if (x > 0) tryGrow(p, p - 1);
    if (x < w - 1) tryGrow(p, p + 1);
    if (p >= w) tryGrow(p, p - w);
    if (p < n - w) tryGrow(p, p + w);
  }

  // 2) Enclosed holes (between chair legs, inside a trellis): sizable regions
  // that are very close to the background color.
  if (clusters.length) {
    const holeTol = tol * 0.5;
    const minHole = Math.max(64, Math.round(n * 0.001));
    const seen = new Uint8Array(n);
    const visit = (q: number) => {
      if (seen[q] || bg[q] || dist[q] > holeTol) return;
      seen[q] = 1;
      queue[qt++] = q;
    };
    for (let s = 0; s < n; s++) {
      if (bg[s] || seen[s] || dist[s] > holeTol) continue;
      qh = 0;
      qt = 0;
      visit(s);
      while (qh < qt) {
        const p = queue[qh++];
        const x = p % w;
        if (x > 0) visit(p - 1);
        if (x < w - 1) visit(p + 1);
        if (p >= w) visit(p - w);
        if (p < n - w) visit(p + w);
      }
      if (qt >= minHole) for (let k = 0; k < qt; k++) bg[queue[k]] = 1;
    }
  }

  // 3) Matte: background 0, object 255. Rim pixels (object pixels touching the
  // background) are usually a mix C = α·F + (1−α)·B of the object color F and
  // the background B: estimate α by projecting C onto the B→F line, with F =
  // the mean of neighboring interior pixels, then un-mix the color.
  const matte = new Uint8Array(n);
  const isRim = (i: number, x: number) =>
    (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (i >= w && bg[i - w]) || (i < n - w && bg[i + w]);
  for (let i = 0; i < n; i++) if (!bg[i]) matte[i] = 255;
  const d = out.data;
  if (clusters.length) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (bg[i] || !isRim(i, x)) continue;
        // Interior neighbors in a 5×5 window give the pure object color.
        let fr = 0, fg = 0, fb = 0, fc = 0;
        for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) {
          for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
            const j = yy * w + xx;
            if (bg[j] || isRim(j, xx)) continue;
            const q = j * 4;
            fr += src[q];
            fg += src[q + 1];
            fb += src[q + 2];
            fc++;
          }
        }
        const c = clusters[nearest[i]];
        const p = i * 4;
        let a: number;
        if (fc) {
          fr /= fc;
          fg /= fc;
          fb /= fc;
          const vr = fr - c.r, vg = fg - c.g, vb = fb - c.bl;
          const len2 = vr * vr + vg * vg + vb * vb;
          a = len2 > 100 ? ((src[p] - c.r) * vr + (src[p + 1] - c.g) * vg + (src[p + 2] - c.bl) * vb) / len2 : 1;
        } else {
          // Thin structure without interior: fall back to the color distance.
          a = (dist[i] - tol * 0.5) / (tol * 1.5);
        }
        a = Math.min(1, Math.max(0, a));
        matte[i] = Math.round(a * 255);
        if (a >= 0.98) continue;
        if (a >= 0.3) {
          d[p] = (src[p] - (1 - a) * c.r) / a;
          d[p + 1] = (src[p + 1] - (1 - a) * c.g) / a;
          d[p + 2] = (src[p + 2] - (1 - a) * c.bl) / a;
        } else if (fc) {
          d[p] = fr;
          d[p + 1] = fg;
          d[p + 2] = fb;
        }
      }
    }
  }

  // 4) Feather inward only (min with the matte): no background halo.
  const alpha = feather > 0 ? blurChannel(matte, w, h, feather) : matte;
  for (let i = 0, p = 3; i < n; i++, p += 4) d[p] = Math.min(alpha[i], matte[i], src[p]);
  return out;
}

/** Crops away fully transparent rows/columns (keeps a 2px margin). */
export function trimTransparent(img: ImageDataLike): ImageDataLike {
  const { width: w, height: h, data } = img;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    let rowAny = false;
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] !== 0) {
        rowAny = true;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    if (rowAny) {
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return { width: w, height: h, data: new Uint8ClampedArray(data) };
  const margin = 2;
  x0 = Math.max(0, x0 - margin);
  y0 = Math.max(0, y0 - margin);
  x1 = Math.min(w - 1, x1 + margin);
  y1 = Math.min(h - 1, y1 + margin);
  const ow = x1 - x0 + 1;
  const oh = y1 - y0 + 1;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    const start = ((y0 + y) * w + x0) * 4;
    out.set(data.subarray(start, start + ow * 4), y * ow * 4);
  }
  return { width: ow, height: oh, data: out };
}

/** True if a meaningful share (> 2%) of pixels is already transparent. */
export function hasTransparency(img: ImageDataLike): boolean {
  const { data } = img;
  const n = img.width * img.height;
  if (n === 0) return false;
  const limit = n * 0.02;
  let count = 0;
  for (let p = 3; p < data.length; p += 4) {
    if (data[p] < TRANSPARENT_ALPHA && ++count > limit) return true;
  }
  return false;
}
