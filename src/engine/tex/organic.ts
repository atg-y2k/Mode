/**
 * Organic ground covers built by splatting many small elements with wrap-
 * around: grass (layers of tapered blades) and mulch (fibrous bark chips).
 */
import { addFbm, addWhiteNoise, cellsFor, fbmField } from './noise';
import type { PatternFactory } from './plan';
import { hash3 } from './rng';
import { paletteMean, pickTone, specRng } from './spec';
import { clamp, mix3, scale3, type Surface, type Vec3 } from './surface';

/**
 * Anti-aliased thin stroke (Xiaolin Wu style) from (x0, y0) to (x1, y1) in
 * pixel coordinates, wrapping around the tile. Coverage at parameter t is
 * alpha(t); `plot(i, a, t)` blends one pixel. Cost is linear in length.
 */
function wuStroke(
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  alpha: (t: number) => number,
  plot: (i: number, a: number, t: number) => void,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steep = Math.abs(dy) > Math.abs(dx);
  const len = Math.max(Math.abs(dx), Math.abs(dy));
  const n = Math.max(1, Math.ceil(len));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = x0 + dx * t - 0.5;
    const y = y0 + dy * t - 0.5;
    const a = alpha(t) * (k === 0 || k === n ? 0.5 : 1);
    if (a <= 0.003) continue;
    if (steep) {
      const yi = Math.round(y);
      const xf = Math.floor(x);
      const fr = x - xf;
      const yy = ((yi % h) + h) % h;
      const xa = ((xf % w) + w) % w;
      const xb = xa + 1 === w ? 0 : xa + 1;
      plot(yy * w + xa, a * (1 - fr), t);
      plot(yy * w + xb, a * fr, t);
    } else {
      const xi = Math.round(x);
      const yf = Math.floor(y);
      const fr = y - yf;
      const xx = ((xi % w) + w) % w;
      const ya = ((yf % h) + h) % h;
      const yb = ya + 1 === h ? 0 : ya + 1;
      plot(ya * w + xx, a * (1 - fr), t);
      plot(yb * w + xx, a * fr, t);
    }
  }
}

// ---------------------------------------------------------------------------
// Grass
// ---------------------------------------------------------------------------

export const grass: PatternFactory = (spec) => {
  const bladeLen = clamp(Math.max(spec.uw, spec.uh), 0.6, 5);
  const span = clamp(bladeLen * 12, 18, 30);
  return {
    spanX: span,
    spanY: span,
    minFeatureIn: 0.09,
    render(s: Surface) {
      const { w, h, sx, sy, rgb, height } = s;
      const ppi = (sx + sy) / 2;
      const rng = specRng(spec, 50);
      const mean = paletteMean(spec.palette);
      // Thatch / soil base: dark, desaturated.
      const lum = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2];
      const soil: Vec3 = mix3(scale3(mean, 0.28), [lum * 0.3, lum * 0.24, lum * 0.12], 0.55);
      const base = fbmField(w, h, cellsFor(w, 1.2 * sx), cellsFor(h, 1.2 * sy), 3, 0.6, spec.seed ^ 0x501);
      for (let i = 0, p = 0; i < w * h; i++, p += 3) {
        const k = 1 + base[i] * 0.35;
        rgb[p] = soil[0] * k;
        rgb[p + 1] = soil[1] * k;
        rgb[p + 2] = soil[2] * k;
        height[i] = 0;
      }
      // Large patches of slightly different vigor/color hide the repeat.
      const patch = fbmField(w, h, cellsFor(w, 9 * sx), cellsFor(h, 9 * sy), 3, 0.5, spec.seed ^ 0x502);
      const layers = 4;
      const density = 1 / (0.16 * bladeLen * 0.1); // blades per sq inch for ~full cover
      const total = Math.round(span * span * density);
      const perLayer = Math.ceil(total / layers);
      const lenPx = bladeLen * ppi;
      const widthPx = 0.085 * ppi;
      // Blades thinner than a pixel draw with fractional coverage.
      const baseAlpha = clamp(widthPx, 0.25, 1);
      const pos = new Float32Array(2);
      for (let layer = 0; layer < layers; layer++) {
        const depth = 0.45 + 0.55 * ((layer + 1) / layers);
        for (let b = 0; b < perLayer; b++) {
          pos[0] = rng.next() * w;
          pos[1] = rng.next() * h;
          const pi = Math.min(w * h - 1, (pos[1] | 0) * w + (pos[0] | 0));
          const vigor = 1 + patch[pi] * 0.18;
          const c = pickTone(rng, spec, { light: 0.2, hue: 0.06, blend: 0.6 });
          const l = lenPx * rng.range(0.55, 1.15) * vigor;
          // Mostly upright (toward the far side of a lawn plane), leaning a bit.
          const ang = -Math.PI / 2 + rng.normal() * 0.42;
          const bend = rng.normal() * 0.35;
          const mx = pos[0] + Math.cos(ang) * l * 0.55;
          const my = pos[1] + Math.sin(ang) * l * 0.55;
          const ex = mx + Math.cos(ang + bend) * l * 0.45;
          const ey = my + Math.sin(ang + bend) * l * 0.45;
          const tipLight = rng.range(1.05, 1.35);
          const dry = rng.next() < 0.08 + 0.12 * spec.variation ? rng.range(0.2, 0.5) : 0;
          const z = layer + 1;
          const plot = (i: number, a: number, t: number) => {
            const shade = depth * (0.5 + 0.5 * t) * (1 + (tipLight - 1) * t * t) * vigor;
            const p = i * 3;
            const r = (c[0] + (c[1] * 0.55 - c[0]) * dry) * shade;
            const g = (c[1] * (1 - dry * 0.25)) * shade;
            const bb = c[2] * (1 - dry * 0.4) * shade;
            rgb[p] += (r - rgb[p]) * a;
            rgb[p + 1] += (g - rgb[p + 1]) * a;
            rgb[p + 2] += (bb - rgb[p + 2]) * a;
            height[i] += (z * 0.08 * (0.5 + t) - height[i]) * a;
          };
          wuStroke(w, h, pos[0], pos[1], mx, my, () => baseAlpha, (i, a) => plot(i, a, 0.25));
          wuStroke(w, h, mx, my, ex, ey, (t) => baseAlpha * (1 - t * 0.7), (i, a, t) => plot(i, a, 0.5 + t * 0.5));
        }
      }
      return { bump: 0.25, ao: 4, aoRadiusIn: 0.3 };
    },
  };
};

// ---------------------------------------------------------------------------
// Mulch
// ---------------------------------------------------------------------------

export const mulch: PatternFactory = (spec) => {
  const chip = clamp(Math.max(spec.uw, spec.uh), 0.4, 6);
  const span = clamp(chip * 16, 18, 36);
  return {
    spanX: span,
    spanY: span,
    minFeatureIn: Math.max(0.06, chip * 0.06),
    render(s: Surface) {
      const { w, h, sx, sy, rgb, height } = s;
      const ppi = (sx + sy) / 2;
      const rng = specRng(spec, 60);
      const mean = paletteMean(spec.palette);
      const gap: Vec3 = scale3(mean, 0.18);
      const base = new Float32Array(w * h);
      addFbm(base, w, h, cellsFor(w, chip * 0.5 * sx), cellsFor(h, chip * 0.5 * sy), 3, 0.5, spec.seed ^ 0x601, 0.4);
      for (let i = 0, p = 0; i < w * h; i++, p += 3) {
        const k = 1 + base[i];
        rgb[p] = gap[0] * k;
        rgb[p + 1] = gap[1] * k;
        rgb[p + 2] = gap[2] * k;
        height[i] = -0.3;
      }
      const grain = new Float32Array(w * h);
      addWhiteNoise(grain, w, h, spec.seed ^ 0x602, 1);
      const chipArea = chip * chip * 0.22;
      const count = Math.round(((span * span) / chipArea) * 2.6);
      const seed = spec.seed;
      for (let c = 0; c < count; c++) {
        const len = chip * rng.range(0.45, 1.25);
        const wid = len * rng.range(0.14, 0.34);
        const ang = rng.next() * Math.PI;
        const cx = rng.next() * w;
        const cy = rng.next() * h;
        const tone = pickTone(rng, spec, { light: 0.28, hue: 0.06, blend: 0.7 });
        const z = c / count;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const hl = (len * ppi) / 2;
        const hw = (wid * ppi) / 2;
        const ext = Math.ceil(Math.abs(ca) * hl + Math.abs(sa) * hw) + 1;
        const eyt = Math.ceil(Math.abs(sa) * hl + Math.abs(ca) * hw) + 1;
        const fiberFreq = rng.range(5, 9) / Math.max(hw, 0.5);
        const phase = rng.next() * 6.28;
        const curl = rng.range(-0.25, 0.25);
        const lighter = 0.75 + 0.5 * z;
        const cid = c;
        for (let py = Math.floor(cy - eyt); py <= cy + eyt; py++) {
          const yy = ((py % h) + h) % h;
          for (let px = Math.floor(cx - ext); px <= cx + ext; px++) {
            const dx = px + 0.5 - cx;
            const dy = py + 0.5 - cy;
            const a = dx * ca + dy * sa; // along
            let b = -dx * sa + dy * ca; // across
            b -= curl * (a * a) / Math.max(hl, 1);
            const ta = a / hl;
            if (ta <= -1 || ta >= 1) continue;
            // Tapered, ragged outline.
            const rag = ((hash3(cid, Math.floor((b / hw) * 3), seed) & 255) / 255) * 0.25;
            const half = hw * (1 - 0.55 * ta * ta) * (1 - rag * Math.abs(ta));
            const cov = clamp(half - Math.abs(b) + 0.5, 0, 1) * clamp((1 - Math.abs(ta)) * hl + 0.5, 0, 1);
            if (cov <= 0) continue;
            const i = yy * w + (((px % w) + w) % w);
            const fiber = 1 + 0.14 * Math.sin(b * fiberFreq + phase) + grain[i] * 0.12;
            const across = half > 0 ? b / half : 0;
            const k = fiber * lighter * (1 - 0.25 * across * across);
            const p = i * 3;
            rgb[p] += (tone[0] * k - rgb[p]) * cov;
            rgb[p + 1] += (tone[1] * k - rgb[p + 1]) * cov;
            rgb[p + 2] += (tone[2] * k - rgb[p + 2]) * cov;
            height[i] += (z * 0.5 + 0.12 * (1 - across * across) - height[i]) * cov;
          }
        }
      }
      return { bump: 0.6, ao: 3, aoRadiusIn: Math.max(0.2, chip * 0.3) };
    },
  };
};
