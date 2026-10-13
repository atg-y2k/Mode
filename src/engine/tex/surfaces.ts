/**
 * Continuous surfaces driven mostly by periodic noise: concrete, stucco,
 * carpet, marble and terrazzo.
 */
import { addFbm, addStreaks, addWhiteNoise, cellsFor, fbmField } from './noise';
import type { PatternFactory } from './plan';
import { hash3 } from './rng';
import { jointColor, jointWidth, paletteMean, pickTone, specRng } from './spec';
import { clamp, mix3, scale3, smoothstep, type Surface, type Vec3 } from './surface';

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
  const span = joints ? clamp(slab, 18, 240) * slabs : 60;
  return {
    spanX: span,
    spanY: span,
    minFeatureIn: 0.5,
    render(s: Surface) {
      const { w, h, sx, sy, rgb, height } = s;
      const ppi = (sx + sy) / 2;
      const rng = specRng(spec, 70);
      const v = spec.variation;
      const tones: Vec3[] = [];
      for (let k = 0; k < 4; k++) tones.push(pickTone(rng, spec, { light: 0.05, hue: 0.015, blend: 0.4 }));
      // Cloudy cure variation, trowel blotches, sand/aggregate grain.
      const big = fbmField(w, h, cellsFor(w, 18 * sx), cellsFor(h, 18 * sy), 5, 0.6, spec.seed ^ 0x701);
      const mid = fbmField(w, h, cellsFor(w, 1.6 * sx), cellsFor(h, 1.6 * sy), 3, 0.6, spec.seed ^ 0x702);
      const fine = new Float32Array(w * h);
      addWhiteNoise(fine, w, h, spec.seed ^ 0x703, 1);
      const broom = new Float32Array(w * h);
      addStreaks(broom, w, h, sx * 3, spec.seed ^ 0x704, 1);
      const jc = joints ? jointColor(spec, [0, 0, 0]) : ([0, 0, 0] as Vec3);
      const half = joints ? jointWidth(spec, 0.25) / 2 : 0;
      const seed = spec.seed;
      // Fine grain fades as it drops below pixel size, so coarse tiles aren't noisy.
      const grainAmp = 0.05 * clamp(ppi / 12, 0.3, 1);
      const bigAmp = 0.07 + 0.09 * v;
      for (let y = 0; y < h; y++) {
        const yIn = (y + 0.5) / sy;
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const xIn = (x + 0.5) / sx;
          const slabId = joints ? (Math.floor(xIn / slab) + Math.floor(yIn / slab) * 2) & 3 : 0;
          const t = tones[slabId];
          const hsh = hash3(x, y, seed) & 255;
          const speck = hsh < 5 ? -0.14 : hsh > 251 ? 0.08 : 0;
          const bg = big[i];
          const k =
            1 + bg * bigAmp + Math.max(0, bg - 0.25) * -0.25 * v + mid[i] * 0.04 + fine[i] * grainAmp + broom[i] * 0.014 + speck * clamp(ppi / 10, 0.3, 1);
          let r = t[0] * k;
          let g = t[1] * k;
          let b = t[2] * k;
          let hgt = mid[i] * 0.01 + fine[i] * 0.004;
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
  spanX: 30,
  spanY: 30,
  minFeatureIn: 0.3,
  render(s: Surface) {
    const { w, h, sx, sy, rgb, height } = s;
    const rng = specRng(spec, 80);
    const t = pickTone(rng, spec, { light: 0.02, hue: 0.01, blend: 0.3 });
    const pal2 = spec.palette.length > 1 ? spec.palette[1] : scale3(t, 0.94);
    const mott = fbmField(w, h, cellsFor(w, 8 * sx), cellsFor(h, 8 * sy), 4, 0.55, spec.seed ^ 0x801);
    // Sand-float grain: dense small bumps.
    const sand = new Float32Array(w * h);
    addFbm(sand, w, h, cellsFor(w, 0.3 * sx), cellsFor(h, 0.3 * sy), 3, 0.6, spec.seed ^ 0x802, 1);
    addWhiteNoise(sand, w, h, spec.seed ^ 0x803, 0.3);
    // Trowel texture: soft, low swirls (no hard-edged patches).
    const trowel = fbmField(w, h, cellsFor(w, 2.2 * sx), cellsFor(h, 1.6 * sy), 3, 0.55, spec.seed ^ 0x804);
    const amp = 0.5 + 0.5 * spec.variation;
    for (let i = 0, p = 0; i < w * h; i++, p += 3) {
      const m = mott[i];
      const c = mix3(t, pal2, clamp(0.5 + m * 1.6, 0, 1) * 0.4);
      const tr = smoothstep(-0.3, 0.45, trowel[i]);
      const k = 1 + m * 0.045 + sand[i] * 0.02 * (1.1 - tr * 0.5);
      rgb[p] = c[0] * k;
      rgb[p + 1] = c[1] * k;
      rgb[p + 2] = c[2] * k;
      height[i] = (sand[i] * 0.045 * (1.1 - tr * 0.6) + tr * 0.04) * amp;
    }
    return { bump: 1, ao: 5, aoRadiusIn: 0.12 };
  },
});

// ---------------------------------------------------------------------------
// Carpet
// ---------------------------------------------------------------------------

export const carpet: PatternFactory = (spec) => {
  const pile = clamp(Math.min(spec.uw, spec.uh), 0.05, 1);
  return {
    spanX: 18,
    spanY: 18,
    minFeatureIn: 0.3,
    render(s: Surface) {
      const { w, h, sx, sy, rgb, height } = s;
      const pal = spec.palette;
      // Heather: neighbouring yarn colors drift through soft blobs at tuft scale.
      const pick = fbmField(w, h, cellsFor(w, Math.max(0.2, pile) * sx), cellsFor(h, Math.max(0.2, pile) * sy), 2, 0.6, spec.seed ^ 0x901);
      const shade = fbmField(w, h, cellsFor(w, 7 * sx), cellsFor(h, 7 * sy), 3, 0.5, spec.seed ^ 0x902);
      const tufts = new Float32Array(w * h);
      addFbm(tufts, w, h, cellsFor(w, Math.max(0.08, pile * 0.6) * sx), cellsFor(h, Math.max(0.08, pile * 0.6) * sy), 2, 0.5, spec.seed ^ 0x903, 1);
      addWhiteNoise(tufts, w, h, spec.seed ^ 0x904, 0.6);
      const n = pal.length;
      const mean = paletteMean(pal);
      const contrast = 0.06 + 0.08 * spec.variation;
      for (let i = 0, p = 0; i < w * h; i++, p += 3) {
        let c: Vec3 = mean;
        if (n > 1) {
          // Mostly the blended yarn, drifting toward individual palette yarns.
          const f = clamp((pick[i] * 0.5 + 0.5) * (n - 1), 0, n - 1 - 1e-3);
          const k = Math.floor(f);
          c = mix3(mean, mix3(pal[k], pal[k + 1], f - k), 0.55);
        }
        const k = 1 + tufts[i] * contrast + shade[i] * 0.05;
        rgb[p] = c[0] * k;
        rgb[p + 1] = c[1] * k;
        rgb[p + 2] = c[2] * k;
        height[i] = tufts[i] * 0.03;
      }
      return { bump: 0.35, ao: 2, aoRadiusIn: 0.1 };
    },
  };
};

// ---------------------------------------------------------------------------
// Marble
// ---------------------------------------------------------------------------

/**
 * Veined marble: a few main veins following one direction, warped by smooth
 * noise and fading in and out along their length, thin crossing veins, soft
 * clouds. With an explicit joint and a unit ≤ 48 in it is laid as tiles,
 * each tile showing a different part of the stone.
 */
export const marble: PatternFactory = (spec) => {
  const unit = Math.max(spec.uw, spec.uh);
  const tiled = spec.joint !== null && spec.joint.widthIn > 0 && unit <= 48;
  const n = tiled ? clamp(Math.round(48 / unit), 1, 8) : 1;
  const span = tiled ? n * unit : 48;
  return {
    spanX: span,
    spanY: span,
    minFeatureIn: 0.5,
    render(s: Surface) {
      const { w, h, sx, sy, rgb, height } = s;
      const ppi = (sx + sy) / 2;
      const rng = specRng(spec, 100);
      const base = spec.palette[0];
      const vein = spec.palette.length > 1 ? spec.palette[1] : scale3(base, 0.45);
      const accent = spec.palette.length > 2 ? spec.palette[2] : mix3(base, vein, 0.35);
      // Smooth flow for the main veins, finer warp for ragged vein edges.
      const warp = fbmField(w, h, cellsFor(w, 22 * sx), cellsFor(h, 22 * sy), 3, 0.45, spec.seed ^ 0xa01);
      const warp2 = fbmField(w, h, cellsFor(w, 4 * sx), cellsFor(h, 4 * sy), 4, 0.6, spec.seed ^ 0xa02);
      const fade = fbmField(w, h, cellsFor(w, 12 * sx), cellsFor(h, 12 * sy), 3, 0.5, spec.seed ^ 0xa03);
      const cloud = fbmField(w, h, cellsFor(w, 14 * sx), cellsFor(h, 14 * sy), 4, 0.55, spec.seed ^ 0xa05);
      // Integer cycles across the tile keep the sinusoid periodic.
      const fxA = 1 + rng.int(2);
      const fyA = rng.chance(0.5) ? 1 : -1;
      const fxB = 2 + rng.int(3);
      const fyB = rng.chance(0.5) ? 3 : -2;
      const phA = rng.next() * 6.283;
      const phB = rng.next() * 6.283;
      const strength = 0.6 + 0.4 * spec.variation;
      const tileOff: number[] = [];
      for (let k = 0; k < n * n; k++) tileOff.push(rng.int(w), rng.int(h));
      const half = tiled ? jointWidth(spec, 0.0625) / 2 : 0;
      const jc = tiled ? jointColor(spec, scale3(base, 0.8)) : base;
      const crystal = new Float32Array(w * h);
      addWhiteNoise(crystal, w, h, spec.seed ^ 0xa04, 1);
      const TAU = 6.283185307;
      for (let y = 0; y < h; y++) {
        const yIn = (y + 0.5) / sy;
        for (let x = 0; x < w; x++) {
          const xIn = (x + 0.5) / sx;
          let xx = x;
          let yy = y;
          let edge = Infinity;
          if (tiled) {
            const tid = Math.min(n - 1, Math.floor(xIn / unit)) + Math.min(n - 1, Math.floor(yIn / unit)) * n;
            xx += tileOff[tid * 2];
            if (xx >= w) xx -= w;
            yy += tileOff[tid * 2 + 1];
            if (yy >= h) yy -= h;
            edge = gridEdge(xIn, yIn, unit, half);
          }
          const j = yy * w + xx;
          const X = (xx + 0.5) / w;
          const Y = (yy + 0.5) / h;
          const wa = warp[j];
          const w2 = warp2[j];
          const a = Math.abs(Math.sin(TAU * (fxA * X + fyA * Y) + phA + wa * 2.8 + w2 * 0.22));
          const b = Math.abs(Math.sin(TAU * (fxB * X + fyB * Y) + phB + wa * 2 + w2 * 0.35));
          const fd = fade[j];
          const along = clamp(0.6 + fd * 1.8, 0, 1);
          const wA = 0.025 + 0.04 * clamp(0.5 + fd * 1.5, 0, 1);
          const core = 1 - smoothstep(0, wA, a);
          const main = (core * 0.8 + (1 - smoothstep(0, wA * 7, a)) * 0.2) * along;
          const thin = (1 - smoothstep(0, 0.012, b)) * 0.45 * clamp(0.15 - fd * 1.5, 0, 1);
          const vm = Math.min(1, (main + thin) * strength);
          const cl = clamp(0.5 + cloud[j] * 1.2, 0, 1) * 0.3;
          let r = base[0] + (accent[0] - base[0]) * cl;
          let g = base[1] + (accent[1] - base[1]) * cl;
          let bb = base[2] + (accent[2] - base[2]) * cl;
          r += (vein[0] - r) * vm;
          g += (vein[1] - g) * vm;
          bb += (vein[2] - bb) * vm;
          const i = y * w + x;
          const k = 1 + crystal[i] * 0.01;
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
    minFeatureIn: chip / 3,
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
      return { bump: tiled ? 1 : 0, ao: tiled ? 1 : 0, aoRadiusIn: 0.15 };
    },
  };
};
