/**
 * Colour correction of a returned image (Freepik's per-channel scaling,
 * made robust): image models drift in white balance and exposure (GPT
 * images skew warm), so a per-channel gain + offset is fitted on pixels
 * that should be unchanged — OUTSIDE the target — mapping the returned
 * colours onto the original's, with the worst 10 % of residuals (things the
 * model really changed) trimmed and the fit repeated. Drift is reported as
 * the mean CIE76 ΔE (Lab, D65) over the same pixels, before and after.
 */
import { rgb8ToLabInto } from '../engine/color';
import type { ImageDataLike } from '../engine/types';

export interface ChannelFit {
  gain: [number, number, number];
  offset: [number, number, number];
}

export const IDENTITY_FIT: ChannelFit = { gain: [1, 1, 1], offset: [0, 0, 0] };

const MIN_GAIN = 0.5;
const MAX_GAIN = 2;
const MAX_OFFSET = 96;

/** Least-squares y ≈ g·x + o over the selected samples (per channel). */
function solve(sx: number, sy: number, sxx: number, sxy: number, n: number): { g: number; o: number } {
  if (n < 2) return { g: 1, o: 0 };
  const mx = sx / n;
  const my = sy / n;
  const vx = sxx / n - mx * mx;
  const cxy = sxy / n - mx * my;
  let g = vx > 4 ? cxy / vx : 1; // flat samples (σ < 2 levels): offset only
  g = Math.min(MAX_GAIN, Math.max(MIN_GAIN, g));
  const o = Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, my - g * mx));
  return { g, o };
}

/**
 * Robust per-channel gain/offset mapping `src` colours onto `dst` colours,
 * fitted on pixel indices `samples` (both images the same size). Each round
 * drops the samples whose summed |residual| is in the top `trim` share.
 */
export function fitChannels(src: ImageDataLike, dst: ImageDataLike, samples: Uint32Array, trim = 0.1, rounds = 3): ChannelFit {
  if (samples.length < 64) return { gain: [...IDENTITY_FIT.gain], offset: [...IDENTITY_FIT.offset] };
  const s = src.data;
  const d = dst.data;
  let fit: ChannelFit = { gain: [1, 1, 1], offset: [0, 0, 0] };
  let limit = Infinity; // max summed residual allowed this round
  const hist = new Uint32Array(766);
  for (let round = 0; round < rounds; round++) {
    const acc = new Float64Array(15); // per channel: sx, sy, sxx, sxy, n
    for (let k = 0; k < samples.length; k++) {
      const p = samples[k] * 4;
      if (round > 0) {
        let res = 0;
        for (let c = 0; c < 3; c++) res += Math.abs(d[p + c] - (fit.gain[c] * s[p + c] + fit.offset[c]));
        if (res > limit) continue;
      }
      for (let c = 0; c < 3; c++) {
        const x = s[p + c];
        const y = d[p + c];
        const a = c * 5;
        acc[a] += x;
        acc[a + 1] += y;
        acc[a + 2] += x * x;
        acc[a + 3] += x * y;
        acc[a + 4] += 1;
      }
    }
    const next: ChannelFit = { gain: [1, 1, 1], offset: [0, 0, 0] };
    for (let c = 0; c < 3; c++) {
      const a = c * 5;
      const { g, o } = solve(acc[a], acc[a + 1], acc[a + 2], acc[a + 3], acc[a + 4]);
      next.gain[c] = g;
      next.offset[c] = o;
    }
    fit = next;
    if (round === rounds - 1) break;
    // Residual threshold at the (1 − trim) quantile, via a histogram of summed |residuals|.
    hist.fill(0);
    for (let k = 0; k < samples.length; k++) {
      const p = samples[k] * 4;
      let res = 0;
      for (let c = 0; c < 3; c++) res += Math.abs(d[p + c] - (fit.gain[c] * s[p + c] + fit.offset[c]));
      hist[Math.min(765, Math.round(res))]++;
    }
    const keep = Math.ceil(samples.length * (1 - trim));
    let cum = 0;
    limit = 765;
    for (let v = 0; v < hist.length; v++) {
      cum += hist[v];
      if (cum >= keep) {
        limit = v + 0.5;
        break;
      }
    }
  }
  return fit;
}

/** Applies a fit in place to every pixel (or where `valid` > 0). */
export function applyChannelFit(img: ImageDataLike, fit: ChannelFit, valid?: Uint8Array): void {
  const lut = [0, 1, 2].map((c) => {
    const t = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) t[v] = fit.gain[c] * v + fit.offset[c];
    return t;
  });
  const d = img.data;
  const n = img.width * img.height;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (valid && valid[i] === 0) continue;
    d[p] = lut[0][d[p]];
    d[p + 1] = lut[1][d[p + 1]];
    d[p + 2] = lut[2][d[p + 2]];
  }
}

/**
 * Trimmed mean CIE76 ΔE between `a` and `b` over pixel indices `samples`
 * (the largest `trim` share dropped, so a few real changes don't dominate
 * the colour-drift figure), optionally with `fitB` applied to `b` first.
 * 0 when there are no samples.
 */
export function meanDeltaE(a: ImageDataLike, b: ImageDataLike, samples: Uint32Array, trim = 0.1, fitB?: ChannelFit): number {
  if (!samples.length) return 0;
  const la = new Float64Array(3);
  const lb = new Float64Array(3);
  const values = new Float32Array(samples.length);
  const tb = (v: number, c: number) => (fitB ? Math.max(0, Math.min(255, Math.round(fitB.gain[c] * v + fitB.offset[c]))) : v);
  for (let k = 0; k < samples.length; k++) {
    const p = samples[k] * 4;
    rgb8ToLabInto(a.data[p], a.data[p + 1], a.data[p + 2], la, 0);
    rgb8ToLabInto(tb(b.data[p], 0), tb(b.data[p + 1], 1), tb(b.data[p + 2], 2), lb, 0);
    values[k] = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
  }
  values.sort();
  const keep = Math.max(1, Math.ceil(values.length * (1 - trim)));
  let sum = 0;
  for (let k = 0; k < keep; k++) sum += values[k];
  return sum / keep;
}
