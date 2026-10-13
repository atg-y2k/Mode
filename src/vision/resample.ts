/**
 * Turning raw model outputs into photo-space data, pure:
 * - SAM-family low-res mask logits (e.g. 256×256 for the whole, squashed
 *   frame) → a soft-edged coverage mask at photo size;
 * - SegFormer class logits (C × h × w) → per-pixel argmax labels at an
 *   analysis resolution (bilinear in logit space, so class borders are
 *   smoother than nearest-neighbour upsampling);
 * - CLIPSeg logits → sigmoid probabilities resampled to the analysis grid.
 *
 * All three models see the photo resized to a square without padding, so a
 * model pixel maps linearly onto the whole photo in each axis.
 */

/** Bilinear tap positions for mapping `dst` pixels onto a `src` axis (pixel centers aligned). */
function taps(src: number, dst: number): { i0: Int32Array; i1: Int32Array; f: Float32Array } {
  const i0 = new Int32Array(dst);
  const i1 = new Int32Array(dst);
  const f = new Float32Array(dst);
  const scale = src / dst;
  for (let d = 0; d < dst; d++) {
    let s = (d + 0.5) * scale - 0.5;
    if (s < 0) s = 0;
    if (s > src - 1) s = src - 1;
    const a = Math.floor(s);
    i0[d] = a;
    i1[d] = Math.min(src - 1, a + 1);
    f[d] = s - a;
  }
  return { i0, i1, f };
}

/**
 * Coverage mask (0..255, 128 = the decision boundary) from mask logits of
 * size `lw`×`lh`, at `width`×`height`. The edge is a short linear ramp in
 * logit space (≈ ±2.7 logits), which gives a few pixels of anti-aliasing at
 * photo size.
 */
export function logitsToCoverage(logits: ArrayLike<number>, lw: number, lh: number, width: number, height: number, offset = 0): Uint8Array {
  const out = new Uint8Array(width * height);
  if (lw <= 0 || lh <= 0 || width <= 0 || height <= 0) return out;
  const tx = taps(lw, width);
  const ty = taps(lh, height);
  for (let y = 0; y < height; y++) {
    const r0 = offset + ty.i0[y] * lw;
    const r1 = offset + ty.i1[y] * lw;
    const fy = ty.f[y];
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const a = tx.i0[x];
      const b = tx.i1[x];
      const fx = tx.f[x];
      const top = logits[r0 + a] + (logits[r0 + b] - logits[r0 + a]) * fx;
      const bot = logits[r1 + a] + (logits[r1 + b] - logits[r1 + a]) * fx;
      const v = top + (bot - top) * fy;
      const c = 128 + v * 48;
      out[row + x] = c <= 0 ? 0 : c >= 255 ? 255 : c;
    }
  }
  return out;
}

/**
 * Argmax class labels at `width`×`height` from logits laid out [C, lh, lw]
 * (bilinear per class). Classes ≥ 256 are not supported (ADE20K has 150).
 */
export function logitsToLabels(logits: ArrayLike<number>, classes: number, lw: number, lh: number, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  if (classes <= 0 || lw <= 0 || lh <= 0) return out;
  const plane = lw * lh;
  const tx = taps(lw, width);
  const ty = taps(lh, height);
  for (let y = 0; y < height; y++) {
    const r0 = ty.i0[y] * lw;
    const r1 = ty.i1[y] * lw;
    const fy = ty.f[y];
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const a = tx.i0[x];
      const b = tx.i1[x];
      const fx = tx.f[x];
      const w00 = (1 - fx) * (1 - fy);
      const w01 = fx * (1 - fy);
      const w10 = (1 - fx) * fy;
      const w11 = fx * fy;
      const k00 = r0 + a;
      const k01 = r0 + b;
      const k10 = r1 + a;
      const k11 = r1 + b;
      let best = 0;
      let bestV = -Infinity;
      for (let c = 0, o = 0; c < classes; c++, o += plane) {
        const v = logits[o + k00] * w00 + logits[o + k01] * w01 + logits[o + k10] * w10 + logits[o + k11] * w11;
        if (v > bestV) {
          bestV = v;
          best = c;
        }
      }
      out[row + x] = best;
    }
  }
  return out;
}

/** Sigmoid probabilities (0..1) at `width`×`height` from one `lw`×`lh` logit plane starting at `offset`. */
export function logitsToProbs(logits: ArrayLike<number>, lw: number, lh: number, width: number, height: number, offset = 0): Float32Array {
  const out = new Float32Array(width * height);
  if (lw <= 0 || lh <= 0) return out;
  const tx = taps(lw, width);
  const ty = taps(lh, height);
  for (let y = 0; y < height; y++) {
    const r0 = offset + ty.i0[y] * lw;
    const r1 = offset + ty.i1[y] * lw;
    const fy = ty.f[y];
    for (let x = 0; x < width; x++) {
      const a = tx.i0[x];
      const b = tx.i1[x];
      const fx = tx.f[x];
      const top = logits[r0 + a] + (logits[r0 + b] - logits[r0 + a]) * fx;
      const bot = logits[r1 + a] + (logits[r1 + b] - logits[r1 + a]) * fx;
      out[y * width + x] = 1 / (1 + Math.exp(-(top + (bot - top) * fy)));
    }
  }
  return out;
}

/** Analysis grid size: the photo scaled so its long edge is `longEdge` (never upscaled). */
export function analysisSize(width: number, height: number, longEdge = 512): { width: number; height: number } {
  const k = Math.min(1, longEdge / Math.max(1, width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
