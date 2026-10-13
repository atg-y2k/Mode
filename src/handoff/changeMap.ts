/**
 * Where did the model change things OUTSIDE the target? Mode restores those
 * pixels from the original anyway; the map explains why the composite may
 * differ from what the app showed, and flags returns that re-framed or
 * regenerated the scene (suggest a stricter retry).
 *
 * Computed at ~512 px: per-pixel CIE76 ΔE between the original and the
 * colour-corrected, aligned result, blurred with a normalized box filter
 * restricted to protected pixels (so the edited target's large ΔE doesn't
 * bleed across the seam). Changed = blurred ΔE > 10; blobs are 8-connected
 * components larger than 0.2 % of the frame.
 */
import { rgbaToLabArray } from '../engine/color';
import type { ImageDataLike } from '../engine/types';

/** ΔE above which a protected pixel counts as changed. */
export const CHANGE_DELTA_E = 10;
/** Blobs smaller than this share of the compared frame are ignored. */
export const MIN_BLOB_SHARE = 0.002;

export interface ChangeBlob {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pixel count. */
  area: number;
}

export interface OutsideChanges {
  /** 0..255 per pixel (0 where not protected), same size as the inputs. */
  map: Uint8Array;
  /** Blurred ΔE per pixel (0 where not protected). */
  deltaE: Float32Array;
  /** Share (0..1) of protected pixels with blurred ΔE > threshold. */
  changedShare: number;
  /** Changed components, largest first (input px). */
  blobs: ChangeBlob[];
}

/** Separable box blur (radius r, edge-clamped) of a float field, in place via `tmp`. */
function boxBlur(src: Float32Array, tmp: Float32Array, w: number, h: number, r: number): void {
  if (r <= 0) return;
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let j = -r; j <= r; j++) s += src[row + Math.min(w - 1, Math.max(0, j))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s * norm;
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += tmp[Math.min(h - 1, Math.max(0, j)) * w + x];
    for (let y = 0; y < h; y++) {
      src[y * w + x] = s * norm;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

/**
 * 8-connected components of `binary` (non-zero = set) with at least
 * `minArea` pixels: bounding boxes and areas, largest first.
 */
export function connectedBlobs(binary: Uint8Array, w: number, h: number, minArea: number): ChangeBlob[] {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs: ChangeBlob[] = [];
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!binary[start] || labels[start]) continue;
    next++;
    let top = 0;
    stack[top++] = start;
    labels[start] = next;
    let area = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    while (top > 0) {
      const i = stack[--top];
      const x = i % w;
      const y = (i - x) / w;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
          const j = ny * w + nx;
          if (binary[j] && !labels[j]) {
            labels[j] = next;
            stack[top++] = j;
          }
        }
      }
    }
    if (area >= minArea) blobs.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
  }
  return blobs.sort((a, b) => b.area - a.area);
}

/**
 * Compares `original` and `result` (same size, ~512 px) on `protectedMask`
 * pixels (255 = must be unchanged).
 */
export function outsideChanges(
  original: ImageDataLike,
  result: ImageDataLike,
  protectedMask: Uint8Array,
  opts: { threshold?: number; blurRadius?: number; minBlobShare?: number } = {},
): OutsideChanges {
  const { width: w, height: h } = original;
  const n = w * h;
  const threshold = opts.threshold ?? CHANGE_DELTA_E;
  const radius = opts.blurRadius ?? Math.max(1, Math.round(Math.max(w, h) / 256));
  const labA = new Float32Array(n * 3);
  const labB = new Float32Array(n * 3);
  rgbaToLabArray(original.data, labA, n);
  rgbaToLabArray(result.data, labB, n);
  const de = new Float32Array(n);
  const weight = new Float32Array(n);
  let protectedCount = 0;
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    if (protectedMask[i] !== 255) continue;
    protectedCount++;
    weight[i] = 1;
    de[i] = Math.hypot(labA[o] - labB[o], labA[o + 1] - labB[o + 1], labA[o + 2] - labB[o + 2]);
  }
  // Normalized convolution: blur(ΔE·w) / blur(w), only protected pixels contribute.
  const tmp = new Float32Array(n);
  boxBlur(de, tmp, w, h, radius);
  boxBlur(weight, tmp, w, h, radius);
  const map = new Uint8Array(n);
  const changed = new Uint8Array(n);
  let changedCount = 0;
  for (let i = 0; i < n; i++) {
    if (protectedMask[i] !== 255 || weight[i] <= 1e-6) {
      de[i] = 0;
      continue;
    }
    const v = de[i] / weight[i];
    de[i] = v;
    // Heatmap ramp: invisible below ΔE 5, full at ΔE 30.
    map[i] = Math.max(0, Math.min(255, Math.round(((v - 5) / 25) * 255)));
    if (v > threshold) {
      changed[i] = 1;
      changedCount++;
    }
  }
  const minArea = Math.max(4, Math.round(n * (opts.minBlobShare ?? MIN_BLOB_SHARE)));
  return {
    map,
    deltaE: de,
    changedShare: protectedCount ? changedCount / protectedCount : 0,
    blobs: connectedBlobs(changed, w, h, minArea),
  };
}
