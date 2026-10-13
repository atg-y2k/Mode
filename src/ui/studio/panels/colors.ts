/**
 * Dominant colors of an inspiration image (idea board), pure and
 * deterministic: pixels are binned into a 4-bit-per-channel histogram, the
 * bins are clustered with weighted k-means (farthest-point seeding from the
 * most common bin), and the clusters are returned largest first. Near
 * duplicates are merged so the swatches read as a palette.
 */
import type { ImageDataLike } from '../../../engine/types';

interface Bin {
  r: number;
  g: number;
  b: number;
  n: number;
}

/** Perceptual-ish weights for RGB distance (green matters most, blue least). */
const WR = 2;
const WG = 4;
const WB = 3;

function dist2(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return WR * dr * dr + WG * dg * dg + WB * db * db;
}

function toHex(c: { r: number; g: number; b: number }): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Histogram of (mostly) opaque pixels, sampling at most ~`maxSamples` pixels evenly. */
function histogram(img: ImageDataLike, maxSamples: number): Bin[] {
  const total = img.width * img.height;
  if (total === 0) return [];
  const step = Math.max(1, Math.floor(Math.sqrt(total / maxSamples)));
  const sums = new Float64Array(4096 * 4);
  const { data, width, height } = img;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const o = key * 4;
      sums[o] += r;
      sums[o + 1] += g;
      sums[o + 2] += b;
      sums[o + 3] += 1;
    }
  }
  const bins: Bin[] = [];
  for (let k = 0; k < 4096; k++) {
    const n = sums[k * 4 + 3];
    if (n > 0) bins.push({ r: sums[k * 4] / n, g: sums[k * 4 + 1] / n, b: sums[k * 4 + 2] / n, n });
  }
  return bins;
}

/**
 * Up to `count` dominant colors ('#rrggbb'), most prominent first. Clusters
 * smaller than `minShare` of the image are dropped unless needed to reach two
 * colors. Returns [] for an empty or fully transparent image.
 */
export function extractPalette(img: ImageDataLike, count = 5, opts: { maxSamples?: number; minShare?: number } = {}): string[] {
  const bins = histogram(img, opts.maxSamples ?? 20_000);
  if (bins.length === 0 || count <= 0) return [];
  const totalN = bins.reduce((s, b) => s + b.n, 0);
  const k = Math.min(count + 2, bins.length); // a couple of extra clusters, merged / trimmed below

  // Farthest-point seeding weighted by bin size, starting from the most common bin.
  const centers: { r: number; g: number; b: number }[] = [];
  let first = bins[0];
  for (const b of bins) if (b.n > first.n) first = b;
  centers.push({ r: first.r, g: first.g, b: first.b });
  const nearest = bins.map((b) => dist2(b, centers[0]));
  while (centers.length < k) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < bins.length; i++) {
      const score = nearest[i] * Math.sqrt(bins[i].n);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0 || bestScore <= 0) break;
    const c = { r: bins[best].r, g: bins[best].g, b: bins[best].b };
    centers.push(c);
    for (let i = 0; i < bins.length; i++) nearest[i] = Math.min(nearest[i], dist2(bins[i], c));
  }

  // Weighted Lloyd iterations over the bins.
  const assign = new Int32Array(bins.length);
  let weights: number[] = [];
  for (let iter = 0; iter < 10; iter++) {
    const acc = centers.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (let i = 0; i < bins.length; i++) {
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(bins[i], centers[c]);
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      assign[i] = bi;
      const a = acc[bi];
      const n = bins[i].n;
      a.r += bins[i].r * n;
      a.g += bins[i].g * n;
      a.b += bins[i].b * n;
      a.n += n;
    }
    let moved = 0;
    for (let c = 0; c < centers.length; c++) {
      const a = acc[c];
      if (a.n === 0) continue;
      const next = { r: a.r / a.n, g: a.g / a.n, b: a.b / a.n };
      moved = Math.max(moved, dist2(next, centers[c]));
      centers[c] = next;
    }
    weights = acc.map((a) => a.n);
    if (moved < 1) break;
  }

  // Merge near-duplicates (ΔRGB weighted < ~18 per channel), then rank by size.
  const clusters = centers.map((c, i) => ({ ...c, n: weights[i] ?? 0 })).filter((c) => c.n > 0);
  clusters.sort((a, b) => b.n - a.n);
  const merged: { r: number; g: number; b: number; n: number }[] = [];
  const MERGE = 9 * 18 * 18;
  for (const c of clusters) {
    const twin = merged.find((m) => dist2(m, c) < MERGE);
    if (twin) {
      const n = twin.n + c.n;
      twin.r = (twin.r * twin.n + c.r * c.n) / n;
      twin.g = (twin.g * twin.n + c.g * c.n) / n;
      twin.b = (twin.b * twin.n + c.b * c.n) / n;
      twin.n = n;
    } else merged.push({ ...c });
  }
  merged.sort((a, b) => b.n - a.n);
  const minShare = opts.minShare ?? 0.015;
  const significant = merged.filter((c, i) => i < 2 || c.n / totalN >= minShare);
  return significant.slice(0, count).map(toHex);
}
