/**
 * Continuous surfaces driven mostly by periodic noise: concrete, stucco,
 * carpet, marble and terrazzo.
 */
import { addFbm, addStreaks, addWhiteNoise, cellsFor, fbmField } from './noise';
import type { PatternFactory } from './plan';
import { hash3 } from './rng';
import { jointColor, jointWidth, paletteMean, pickTone, specRng, type NormSpec } from './spec';
import { clamp, luminance, mix3, scale3, smoothstep, type Surface, type Vec3 } from './surface';

/** Signed distance (inches) to the nearest grid line of a `cell`-inch grid; negative inside the joint. */
function gridEdge(xIn: number, yIn: number, cell: number, half: number): number {
  const u = xIn - Math.floor(xIn / cell) * cell;
  const v = yIn - Math.floor(yIn / cell) * cell;
  return Math.min(u, cell - u, v, cell - v) - half;
}

// ---------------------------------------------------------------------------
// Concrete
// ---------------------------------------------------------------------------

export const concrete: PatternFactory = (spec) => {
  const slab = Math.max(spec.uw, spec.uh);
  const joints = spec.joint !== null && spec.joint.widthIn > 0 && slab >= 18;
  const slabs = slab >= 60 ? 1 : 2;
  const span = joints ? clamp(slab, 18, 240) * slabs : 48;
  return {
    spanX: span,
    spanY: span,
    minFeatureIn: joints ? Math.max(0.12, spec.joint!.widthIn) : 0.12,
    render(s: Surface) {
      const { w, h, sx, sy, rgb, height } = s;
      const ppi = (sx + sy) / 2;
      const rng = specRng(spec, 70);
      const v = spec.variation;
      const tones: Vec3[] = [];
      for (let k = 0; k < 4; k++) tones.push(pickTone(rng, spec, { light: 0.05, hue: 0.015, blend: 0.4 }));
      const big = fbmField(w, h, cellsFor(w, 14 * sx), cellsFor(h, 14 * sy), 4, 0.55, spec.seed ^ 0x701);
      const mid = fbmField(w, h, cellsFor(w, 2 * sx), cellsFor(h, 2 * sy), 3, 0.5, spec.seed ^ 0x702);
      const fine = new Float32Array(w * h);
      addWhiteNoise(fine, w, h, spec.seed ^ 0x703, 1);
      const broom = new Float32Array(w * h);
      addStreaks(broom, w, h, sx * 3, spec.seed ^ 0x704, 1);
      const jc = joints ? jointColor(spec, [0, 0, 0]) : ([0, 0, 0] as Vec3);
      const half = joints ? jointWidth(spec, 0.25) / 2 : 0;
      const seed = spec.seed;
      for (let y = 0; y < h; y++) {
        const yIn = (y + 0.5) / sy;
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const xIn = (x + 0.5) / sx;
          const slabId = joints ? (Math.floor(xIn / slab) + Math.floor(yIn / slab) * 2) & 3 : 0;
          const t = tones[slabId];
          // Aggregate specks: sparse pixels a little lighter or darker.
          const hsh = hash3(x, y, seed) & 255;
          const speck = hsh < 6 ? -0.12 : hsh > 250 ? 0.08 : 0;
          const k = 1 + big[i] * (0.05 + 0.07 * v) + mid[i] * 0.025 + fine[i] * 0.035 + broom[i] * 0.012 + speck;
          let r = t[0] * k;
          let g = t[1] * k;
          let b = t[2] * k;
          let hgt = mid[i] * 0.008 + fine[i] * 0.003;
          if (joints) {
            const e = gridEdge(xIn, yIn, slab, half);
            const cov = clamp(e * ppi + 0.5, 0, 1);
            if (cov < 1) {
              r = r * cov + jc[0] * (1 - cov);
              g = g * cov + jc[1] * (1 - cov);
              b = b * cov + jc[2] * (1 - cov);
              hgt = hgt * cov - 0.3 * (1 - cov);
            }
          }
          const p = i * 3;
          rgb[p] = r;
          rgb[p + 1] = g;
          rgb[p + 2] = b;
          height[i] = hgt;
        }
      }
      return { bump: 1, ao: joints ? 1.5 : 0, aoRadiusIn: 0.4 };
    },
  };
};

// ---------------------------------------------------------------------------
// Stucco
// ---------------------------------------------------------------------------

export const stucco: PatternFactory = (spec) => ({
  spanX: 24,
  spanY: 24,
  minFeatureIn: 0.08,
  render(s: Surface) {
    const { w, h, sx, sy, rgb, height } = s;
    const rng = specRng(spec, 80);
    const t = pickTone(rng, spec, { light: 0.02, hue: 0.01, blend: 0.3 });
    const pal2 = spec.palette.length > 1 ? spec.palette[1] : scale3(t, 0.93);
    const mott = fbmField(w, h, cellsFor(w, 7 * sx), cellsFor(h, 7 * sy), 4, 0.55, spec.seed ^ 0x801);
    const sand = new Float32Array(w * h);
    addFbm(sand, w, h, cellsFor(w, 0.16 * sx), cellsFor(h, 0.16 * sy), 2, 0.5, spec.seed ^ 0x802, 1);
    addWhiteNoise(sand, w, h, spec.seed ^ 0x803, 0.5);
    // Skip-trowel: flat raised patches with soft edges.
    const trowel = fbmField(w, h, cellsFor(w, 3.5 * sx), cellsFor(h, 2.5 * sy), 4, 0.55, spec.seed ^ 0x804);
    const amp = 0.4 + 0.6 * spec.variation;
    for (let i = 0, p = 0; i < w * h; i++, p += 3) {
      const patch = smoothstep(-0.05, 0.12, trowel[i]);
      const m = mott[i];
      const c = mix3(t, pal2, clamp(0.5 + m * 1.5, 0, 1) * 0.35);
      const k = 1 + m * 0.04 + sand[i] * 0.03 * (1 - patch * 0.6) + patch * 0.015;
      rgb[p] = c[0] * k;
      rgb[p + 1] = c[1] * k;
      rgb[p + 2] = c[2] * k;
      height[i] = (sand[i] * 0.02 * (1 - patch * 0.7) + patch * 0.06) * amp;
    }
    return { bump: 1.1, ao: 6, aoRadiusIn: 0.15 };
  },
});

// ---------------------------------------------------------------------------
// Carpet
// ---------------------------------------------------------------------------

export const carpet: PatternFactory = (spec) => {
  const pitch = clamp(Math.min(spec.uw, spec.uh), 0.06, 1);
  return {
    spanX: 18,
    spanY: 18,
    minFeatureIn: Math.max(0.12, pitch),
    render(s: Surface) {
      const { w, h, sx, sy, rgb, height } = s;
      const rng = specRng(spec, 90);
      // Tuft lattice (rounded so it tiles), each tuft a heathered tone.
      const nx = Math.max(1, Math.round(18 / pitch));
      const ny = nx;
      const ntones = 64;
      const tones: Vec3[] = [];
      for (let k = 0; k < ntones; k++) tones.push(pickTone(rng, spec, { light: 0.1, hue: 0.03, blend: 1 }));
      const pile = fbmField(w, h, cellsFor(w, 5 * sx), cellsFor(h, 5 * sy), 3, 0.5, spec.seed ^ 0x901);
      const fuzz = new Float32Array(w * h);
      addWhiteNoise(fuzz, w, h, spec.seed ^ 0x902, 1);
      const seed = spec.seed;
      const cw = w / nx;
      const ch = h / ny;
      for (let y = 0; y < h; y++) {
        const ty = Math.floor(y / ch);
        const fy = (y + 0.5) / ch - ty - 0.5;
        for (let x = 0; x < w; x++) {
          const tx = Math.floor(x / cw);
          const fx = (x + 0.5) / cw - tx - 0.5;
          const tuft = hash3(tx % nx, ty % ny, seed);
          const t = tones[tuft & (ntones - 1)];
          const i = y * w + x;
          const dome = 1 - (fx * fx + fy * fy) * 2;
          const k = (1 + pile[i] * 0.05 + fuzz[i] * 0.07) * (0.92 + 0.08 * dome);
          const p = i * 3;
          rgb[p] = t[0] * k;
          rgb[p + 1] = t[1] * k;
          rgb[p + 2] = t[2] * k;
          height[i] = dome * 0.02 + pile[i] * 0.02;
        }
      }
      return { bump: 0.5, ao: 3, aoRadiusIn: Math.max(0.1, pitch) };
    },
  };
};

// ---------------------------------------------------------------------------
// Marble
// ---------------------------------------------------------------------------

/** Veins of `spec` over the whole surface; `tiles` > 0 shifts the field per tile so veins break at joints. */
export const marble: PatternFactory = (spec) => {
  const unit = Math.max(spec.uw, spec.uh);
  const tiled = spec.joint !== null && spec.joint.widthIn > 0 && unit <= 48;
  const n = tiled ? clamp(Math.round(48 / unit), 1, 8) : 1;
  const span = tiled ? n * unit : 48;
  return {
    spanX: span,
    spanY: span,
    minFeatureIn: tiled ? Math.max(0.05, spec.joint!.widthIn) : 0.08,
    render(s: Surface) {
      const { w, h, sx, sy, rgb, height } = s;
      const ppi = (sx + sy) / 2;
      const rng = specRng(spec, 100);
      const base = spec.palette[0];
      const vein = spec.palette.length > 1 ? spec.palette[1] : scale3(base, 0.45);
      const accent = spec.palette.length > 2 ? spec.palette[2] : mix3(base, vein, 0.4);
      const turb = fbmField(w, h, cellsFor(w, 9 * sx), cellsFor(h, 9 * sy), 5, 0.55, spec.seed ^ 0xa01, 'abs');
      const turb2 = fbmField(w, h, cellsFor(w, 4 * sx), cellsFor(h, 4 * sy), 4, 0.6, spec.seed ^ 0xa02);
      const cloud = fbmField(w, h, cellsFor(w, 12 * sx), cellsFor(h, 12 * sy), 4, 0.55, spec.seed ^ 0xa03);
      const crystal = new Float32Array(w * h);
      addWhiteNoise(crystal, w, h, spec.seed ^ 0xa04, 1);
      // Main vein direction: integer cycles across the tile keep it periodic.
      const fxA = rng.chance(0.5) ? 1 : 2;
      const fyA = rng.chance(0.5) ? 1 : -1;
      const fxB = rng.int(3) + 2;
      const fyB = rng.chance(0.5) ? 2 : 3;
      const phaseA = rng.next() * 6.283;
      const phaseB = rng.next() * 6.283;
      const strength = 0.55 + 0.45 * spec.variation;
      const tileOff: number[] = [];
      for (let k = 0; k < n * n; k++) tileOff.push(rng.int(w), rng.int(h));
      const half = tiled ? jointWidth(spec, 0.0625) / 2 : 0;
      const jc = tiled ? jointColor(spec, scale3(base, 0.8)) : base;
      for (let y = 0; y < h; y++) {
        const yIn = (y + 0.5) / sy;
        for (let x = 0; x < w; x++) {
          const xIn = (x + 0.5) / sx;
          let j = y * w + x;
          let edge = Infinity;
          if (tiled) {
            const tid = Math.min(n - 1, Math.floor(xIn / unit)) + Math.min(n - 1, Math.floor(yIn / unit)) * n;
            let xx = x + tileOff[tid * 2];
            if (xx >= w) xx -= w;
            let yy = y + tileOff[tid * 2 + 1];
            if (yy >= h) yy -= h;
            j = yy * w + xx;
            edge = gridEdge(xIn, yIn, unit, half);
          }
          const X = (j % w) / w;
          const Y = Math.floor(j / w) / h;
          const a = Math.abs(Math.sin(6.283 * (fxA * X + fyA * Y) + phaseA + turb[j] * 7));
          const b = Math.abs(Math.sin(6.283 * (fxB * X + fyB * Y) + phaseB + turb2[j] * 5 + turb[j] * 3));
          const main = Math.pow(1 - smoothstep(0, 0.09, a), 2) * strength;
          const thin = Math.pow(1 - smoothstep(0, 0.035, b), 2) * 0.55 * strength;
          const haze = (1 - smoothstep(0, 0.45, a)) * 0.18 * strength;
          const cl = clamp(0.5 + cloud[j], 0, 1);
          let r = base[0] + (accent[0] - base[0]) * cl * 0.35;
          let g = base[1] + (accent[1] - base[1]) * cl * 0.35;
          let bb = base[2] + (accent[2] - base[2]) * cl * 0.35;
          const vm = Math.min(1, main + thin + haze);
          r += (vein[0] - r) * vm;
          g += (vein[1] - g) * vm;
          bb += (vein[2] - bb) * vm;
          const k = 1 + crystal[y * w + x] * 0.012;
          const i = y * w + x;
          const p = i * 3;
          if (edge < Infinity) {
            const cov = clamp(edge * ppi + 0.5, 0, 1);
            rgb[p] = r * k * cov + jc[0] * (1 - cov);
            rgb[p + 1] = g * k * cov + jc[1] * (1 - cov);
            rgb[p + 2] = bb * k * cov + jc[2] * (1 - cov);
            height[i] = -0.05 * (1 - cov);
          } else {
            rgb[p] = r * k;
            rgb[p + 1] = g * k;
            rgb[p + 2] = bb * k;
          }
        }
      }
      return { bump: tiled ? 1 : 0, ao: tiled ? 1 : 0, aoRadiusIn: 0.15 };
    },
  };
};

// ---------------------------------------------------------------------------
// Terrazzo
// ---------------------------------------------------------------------------

export const terrazzo: PatternFactory = (spec) => {
  const unit = Math.min(spec.uw, spec.uh);
  const tiled = spec.joint !== null && spec.joint.widthIn > 0 && unit >= 6;
  const chip = clamp(tiled ? 0.5 : unit, 0.1, 3);
  const n = tiled ? clamp(Math.round(36 / unit), 1, 6) : 1;
  const span = tiled ? n * unit : clamp(chip * 36, 12, 36);
  return {
    spanX: span,
    spanY: span,
    minFeatureIn: Math.max(0.06, chip * 0.25),
    render(s: Surface) {
      const { w, h, sx, sy, rgb, height } = s;
      const ppi = (sx + sy) / 2;
      const rng = specRng(spec, 110);
      const matrix = spec.palette[0];
      const chipPal: Vec3[] =
        spec.palette.length > 1
          ? spec.palette.slice(1)
          : [scale3(matrix, 0.45), scale3(matrix, 0.75), mix3(matrix, [0.9, 0.9, 0.9], 0.5)];
      const cloud = fbmField(w, h, cellsFor(w, 6 * sx), cellsFor(h, 6 * sy), 3, 0.5, spec.seed ^ 0xb01);
      const fine = new Float32Array(w * h);
      addWhiteNoise(fine, w, h, spec.seed ^ 0xb02, 1);
      const seed = spec.seed;
      for (let i = 0, p = 0; i < w * h; i++, p += 3) {
        // Matrix with fine aggregate dust.
        const hsh = hash3(i, 7, seed) & 255;
        const dust = hsh < 14 ? chipPal[hsh % chipPal.length] : null;
        const k = 1 + cloud[i] * 0.03 + fine[i] * 0.015;
        const c = dust ? mix3(matrix, dust, 0.6) : matrix;
        rgb[p] = c[0] * k;
        rgb[p + 1] = c[1] * k;
        rgb[p + 2] = c[2] * k;
        height[i] = 0;
      }
      // Chips: random convex polygons, many small and a few large.
      const area = span * span;
      const coverage = 0.38 + 0.12 * spec.variation;
      let covered = 0;
      const vx = new Float64Array(8);
      const vy = new Float64Array(8);
      const nx = new Float64Array(8);
      const ny = new Float64Array(8);
      const nd = new Float64Array(8);
      let guard = 0;
      while (covered < area * coverage && guard++ < 200000) {
        const size = chip * (0.35 + 1.4 * Math.pow(rng.next(), 3));
        const r = (size / 2) * ppi;
        const cx = rng.next() * w;
        const cy = rng.next() * h;
        const tone = mix3(chipPal[rng.int(chipPal.length)], matrix, rng.next() * 0.15);
        const shade = Math.exp(rng.normal() * 0.12);
        const m = 5 + rng.int(3);
        const rot = rng.next() * 6.283;
        for (let q = 0; q < m; q++) {
          const ang = rot + (q / m) * 6.283 + (rng.next() - 0.5) * 0.7;
          const rr = r * rng.range(0.7, 1.15);
          vx[q] = Math.cos(ang) * rr;
          vy[q] = Math.sin(ang) * rr;
        }
        // Edge normals (CCW polygon in y-down space → outward normals).
        for (let q = 0; q < m; q++) {
          const q2 = (q + 1) % m;
          const ex = vx[q2] - vx[q];
          const ey = vy[q2] - vy[q];
          const len = Math.hypot(ex, ey) || 1;
          nx[q] = ey / len;
          ny[q] = -ex / len;
          nd[q] = nx[q] * vx[q] + ny[q] * vy[q];
        }
        covered += Math.PI * (size / 2) ** 2 * 0.8;
        const ext = Math.ceil(r * 1.2) + 1;
        for (let py = Math.floor(cy - ext); py <= cy + ext; py++) {
          const yy = ((py % h) + h) % h;
          const dy = py + 0.5 - cy;
          for (let px = Math.floor(cx - ext); px <= cx + ext; px++) {
            const dx = px + 0.5 - cx;
            // Convex SDF: max over edges of signed distance (≤ 0 inside).
            let d = -Infinity;
            for (let q = 0; q < m; q++) {
              const e = nx[q] * dx + ny[q] * dy - nd[q];
              if (e > d) d = e;
            }
            // Polygon may be wound either way; flip if the centre reads outside.
            const cov = clamp(0.5 - d, 0, 1);
            if (cov <= 0) continue;
            const i = yy * w + (((px % w) + w) % w);
            const p = i * 3;
            const k = shade * (1 + fine[i] * 0.04);
            rgb[p] += (tone[0] * k - rgb[p]) * cov;
            rgb[p + 1] += (tone[1] * k - rgb[p + 1]) * cov;
            rgb[p + 2] += (tone[2] * k - rgb[p + 2]) * cov;
          }
        }
      }
      if (tiled) {
        const half = jointWidth(spec, 0.125) / 2;
        const jc = jointColor(spec, scale3(matrix, 0.75));
        for (let y = 0; y < h; y++) {
          const yIn = (y + 0.5) / sy;
          for (let x = 0; x < w; x++) {
            const e = gridEdge((x + 0.5) / sx, yIn, unit, half);
            const cov = clamp(e * ppi + 0.5, 0, 1);
            if (cov >= 1) continue;
            const i = y * w + x;
            const p = i * 3;
            rgb[p] = rgb[p] * cov + jc[0] * (1 - cov);
            rgb[p + 1] = rgb[p + 1] * cov + jc[1] * (1 - cov);
            rgb[p + 2] = rgb[p + 2] * cov + jc[2] * (1 - cov);
            height[i] = -0.05 * (1 - cov);
          }
        }
      }
      void luminance;
      return { bump: tiled ? 1 : 0, ao: tiled ? 1 : 0, aoRadiusIn: 0.15 };
    },
  };
};

/** Mean palette color (exported for tests / swatches of continuous surfaces). */
export function surfaceMean(spec: NormSpec): Vec3 {
  return paletteMean(spec.palette);
}
