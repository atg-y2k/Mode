/**
 * Grid-laid units with joints: ceramic tile grid, subway (running bond),
 * hexagon tile and brick.
 */
import { addFbm, addWhiteNoise, cellsFor, fbmField } from './noise';
import type { PatternFactory } from './plan';
import { hash3 } from './rng';
import { jointColor, jointWidth, paletteMean, pickTone, specRng, type NormSpec } from './spec';
import { clamp, mix3, smoothstep, type Surface, type Vec3 } from './surface';

/**
 * Visits every pixel of a grid of `cols`×`rows` units (unitW×unitH inches)
 * separated by `joint`, each row shifted by rowShift(row) inches. The
 * callback gets the unit id, the position on the unit face (inches from its
 * top-left corner) and the signed distance to the face edge (negative in
 * the joint).
 */
export function forEachGridPixel(
  s: Surface,
  unitW: number,
  unitH: number,
  joint: number,
  cols: number,
  rows: number,
  rowShift: (row: number) => number,
  cb: (i: number, id: number, u: number, v: number, edge: number) => void,
): void {
  const px = unitW + joint;
  const py = unitH + joint;
  const half = joint / 2;
  const shifts = new Float64Array(rows);
  for (let r = 0; r < rows; r++) shifts[r] = rowShift(r);
  const { w, h, sx, sy } = s;
  const spanX = cols * px;
  for (let y = 0; y < h; y++) {
    const yIn = (y + 0.5) / sy;
    const r = Math.min(rows - 1, Math.floor(yIn / py));
    const v = yIn - r * py - half;
    const dv = Math.min(v, unitH - v);
    const shift = shifts[r];
    for (let x = 0; x < w; x++) {
      let xx = (x + 0.5) / sx - shift;
      xx -= Math.floor(xx / spanX) * spanX;
      const c = Math.min(cols - 1, Math.floor(xx / px));
      const u = xx - c * px - half;
      const du = Math.min(u, unitW - u);
      cb(y * w + x, r * cols + c, u, v, du < dv ? du : dv);
    }
  }
}

/** Default grout: a slightly darker, grayer version of the tile body. */
function defaultGrout(spec: NormSpec): Vec3 {
  const m = paletteMean(spec.palette);
  const l = 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
  const gray: Vec3 = [l, l * 0.98, l * 0.94];
  return mix3(m, gray, 0.6).map((c) => c * 0.72 + 0.012) as Vec3;
}

interface CeramicOptions {
  unitW: number;
  unitH: number;
  joint: number;
  cols: number;
  rows: number;
  rowShift: (r: number) => number;
  /** Rounded "cushion" edge radius and depth, inches. */
  cushion: number;
  cushionDepth: number;
  /** Height undulation of the glaze (handmade look), inches. */
  wave: number;
  toneLight: number;
  mottle: number;
}

function ceramic(spec: NormSpec, o: CeramicOptions) {
  return {
    spanX: o.cols * (o.unitW + o.joint),
    spanY: o.rows * (o.unitH + o.joint),
    minFeatureIn: Math.max(0.06, Math.min(o.joint, o.cushion) * 1.2),
    render(s: Surface) {
      const rng = specRng(spec, 10);
      const n = o.cols * o.rows;
      const tones: Vec3[] = [];
      for (let k = 0; k < n; k++) tones.push(pickTone(rng, spec, { light: o.toneLight, hue: 0.02, blend: 0.5 }));
      const grout = jointColor(spec, defaultGrout(spec));
      const { w, h, sx, sy, rgb, height } = s;
      const ppi = (sx + sy) / 2;
      const mottle = fbmField(w, h, cellsFor(w, 2.5 * sx), cellsFor(h, 2.5 * sy), 3, 0.55, spec.seed ^ 0x101);
      const sand = new Float32Array(w * h);
      addWhiteNoise(sand, w, h, spec.seed ^ 0x102, 1);
      let wave: Float32Array | null = null;
      if (o.wave > 0) wave = fbmField(w, h, cellsFor(w, 1.6 * sx), cellsFor(h, 1.6 * sy), 2, 0.5, spec.seed ^ 0x103);
      forEachGridPixel(s, o.unitW, o.unitH, o.joint, o.cols, o.rows, o.rowShift, (i, id, _u, _v, edge) => {
        const cov = clamp(edge * ppi + 0.5, 0, 1);
        const t = tones[id];
        const k = 1 + mottle[i] * o.mottle;
        const gk = 1 + sand[i] * 0.07;
        const p = i * 3;
        rgb[p] = grout[0] * gk * (1 - cov) + t[0] * k * cov;
        rgb[p + 1] = grout[1] * gk * (1 - cov) + t[1] * k * cov;
        rgb[p + 2] = grout[2] * gk * (1 - cov) + t[2] * k * cov;
        const e = clamp(edge / o.cushion, 0, 1);
        const face = -o.cushionDepth * (1 - e) * (1 - e) + (wave ? wave[i] * o.wave : 0);
        height[i] = face * cov - 0.06 * (1 - cov);
      });
      return { bump: 1, ao: 1.2, aoRadiusIn: Math.max(0.15, o.joint * 2.5) };
    },
  };
}

export const tileGrid: PatternFactory = (spec) => {
  const unitW = clamp(spec.uw, 0.5, 72);
  const unitH = clamp(spec.uh, 0.5, 72);
  const joint = jointWidth(spec, unitW >= 8 ? 0.125 : 0.0625);
  const cols = clamp(Math.ceil(40 / (unitW + joint)), 3, 24);
  const rows = clamp(Math.ceil(40 / (unitH + joint)), 3, 24);
  return ceramic(spec, {
    unitW,
    unitH,
    joint,
    cols,
    rows,
    rowShift: () => 0,
    cushion: clamp(Math.min(unitW, unitH) * 0.02, 0.03, 0.12),
    cushionDepth: 0.03,
    wave: 0,
    toneLight: 0.07,
    mottle: 0.025 + 0.05 * spec.variation,
  });
};

export const subway: PatternFactory = (spec) => {
  const unitW = clamp(Math.max(spec.uw, spec.uh), 1, 48);
  const unitH = clamp(Math.min(spec.uw, spec.uh), 0.5, 24);
  const joint = jointWidth(spec, 0.0625);
  const cols = clamp(Math.ceil(30 / (unitW + joint)), 3, 16);
  const rows = clamp(Math.ceil(30 / (unitH + joint) / 2) * 2, 4, 24);
  const pitch = unitW + joint;
  return ceramic(spec, {
    unitW,
    unitH,
    joint,
    cols,
    rows,
    rowShift: (r) => (r % 2) * pitch * 0.5,
    cushion: clamp(unitH * 0.07, 0.08, 0.3),
    cushionDepth: 0.06,
    wave: 0.012 + 0.03 * spec.variation,
    toneLight: 0.08,
    mottle: 0.02 + 0.03 * spec.variation,
  });
};

// ---------------------------------------------------------------------------
// Hexagon tile
// ---------------------------------------------------------------------------

export const hexTile: PatternFactory = (spec) => {
  const across = clamp(spec.uw, 0.5, 36);
  const joint = jointWidth(spec, across >= 6 ? 0.125 : 0.0625);
  const pitchX = across + joint;
  const pitchY = (pitchX * Math.sqrt(3)) / 2;
  const cols = clamp(Math.ceil(36 / pitchX), 3, 30);
  const rows = clamp(Math.ceil(36 / pitchY / 2) * 2, 2, 30);
  const spanX = cols * pitchX;
  const spanY = rows * pitchY;
  return {
    spanX,
    spanY,
    minFeatureIn: Math.max(0.05, joint * 1.2),
    render(s) {
      const rng = specRng(spec, 11);
      const tones: Vec3[] = [];
      for (let k = 0; k < cols * rows; k++) tones.push(pickTone(rng, spec, { light: 0.07, hue: 0.02, blend: 0.5 }));
      const grout = jointColor(spec, defaultGrout(spec));
      const { w, h, sx, sy, rgb, height } = s;
      const ppi = (sx + sy) / 2;
      const mottle = fbmField(w, h, cellsFor(w, 2.5 * sx), cellsFor(h, 2.5 * sy), 3, 0.55, spec.seed ^ 0x111);
      const sand = new Float32Array(w * h);
      addWhiteNoise(sand, w, h, spec.seed ^ 0x112, 1);
      const half = across / 2;
      const cushion = clamp(across * 0.03, 0.03, 0.12);
      const s3 = Math.sqrt(3) / 2;
      for (let y = 0; y < h; y++) {
        const yIn = (y + 0.5) / sy;
        const r0 = Math.round(yIn / pitchY);
        for (let x = 0; x < w; x++) {
          const xIn = (x + 0.5) / sx;
          // Nearest hexagon centre among the three closest rows.
          let best = Infinity;
          let bid = 0;
          for (let dr = -1; dr <= 1; dr++) {
            const r = r0 + dr;
            const cy = r * pitchY;
            const shift = ((r % 2) + 2) % 2 === 1 ? pitchX / 2 : 0;
            const c = Math.round((xIn - shift) / pitchX);
            const cx = c * pitchX + shift;
            const ddx = Math.abs(xIn - cx);
            const ddy = Math.abs(yIn - cy);
            const d = Math.max(ddx, 0.5 * ddx + s3 * ddy);
            if (d < best) {
              best = d;
              const rr = ((r % rows) + rows) % rows;
              const cc = ((c % cols) + cols) % cols;
              bid = rr * cols + cc;
            }
          }
          const edge = half - best;
          const i = y * w + x;
          const cov = clamp(edge * ppi + 0.5, 0, 1);
          const t = tones[bid];
          const k = 1 + mottle[i] * (0.025 + 0.05 * spec.variation);
          const gk = 1 + sand[i] * 0.07;
          const p = i * 3;
          rgb[p] = grout[0] * gk * (1 - cov) + t[0] * k * cov;
          rgb[p + 1] = grout[1] * gk * (1 - cov) + t[1] * k * cov;
          rgb[p + 2] = grout[2] * gk * (1 - cov) + t[2] * k * cov;
          const e = clamp(edge / cushion, 0, 1);
          height[i] = -0.03 * (1 - e) * (1 - e) * cov - 0.06 * (1 - cov);
        }
      }
      return { bump: 1, ao: 1.2, aoRadiusIn: Math.max(0.15, joint * 2.5) };
    },
  };
};

// ---------------------------------------------------------------------------
// Brick (running bond)
// ---------------------------------------------------------------------------

export const brick: PatternFactory = (spec) => {
  const unitW = clamp(Math.max(spec.uw, spec.uh), 2, 24);
  const unitH = clamp(Math.min(spec.uw, spec.uh), 1, 12);
  const joint = jointWidth(spec, 0.375);
  const pitch = unitW + joint;
  const cols = clamp(Math.ceil(40 / pitch), 3, 12);
  const rows = clamp(Math.ceil(36 / (unitH + joint) / 2) * 2, 4, 24);
  return {
    spanX: cols * pitch,
    spanY: rows * (unitH + joint),
    minFeatureIn: Math.max(0.1, joint * 0.8),
    render(s) {
      const rng = specRng(spec, 12);
      const n = cols * rows;
      const tones: Vec3[] = [];
      const flash: number[] = [];
      const hgt: number[] = [];
      for (let k = 0; k < n; k++) {
        tones.push(pickTone(rng, spec, { light: 0.24, hue: 0.06, blend: 0.6 }));
        // Darker "flashed" end on some bricks: signed strength, sign = which end.
        flash.push(rng.chance(0.35 + 0.3 * spec.variation) ? rng.range(-1, 1) : 0);
        hgt.push(rng.range(-0.04, 0.04));
      }
      const mortar = jointColor(spec, [0.42, 0.4, 0.36]);
      const { w, h, sx, sy, rgb, height } = s;
      const ppi = (sx + sy) / 2;
      const mottle = fbmField(w, h, cellsFor(w, 1.5 * sx), cellsFor(h, 1.5 * sy), 3, 0.6, spec.seed ^ 0x121);
      const edgeNoise = fbmField(w, h, cellsFor(w, 0.8 * sx), cellsFor(h, 0.8 * sy), 2, 0.5, spec.seed ^ 0x122);
      const grain = new Float32Array(w * h);
      addWhiteNoise(grain, w, h, spec.seed ^ 0x123, 1);
      addFbm(grain, w, h, cellsFor(w, 0.25 * sx), cellsFor(h, 0.25 * sy), 2, 0.5, spec.seed ^ 0x124, 0.8);
      const seed = spec.seed;
      forEachGridPixel(s, unitW, unitH, joint, cols, rows, (r) => (r % 2) * pitch * 0.5, (i, id, u, _v, edge0) => {
        const edge = edge0 + edgeNoise[i] * 0.07;
        const cov = clamp(edge * ppi + 0.5, 0, 1);
        const t = tones[id];
        const f = flash[id];
        let k = 1 + mottle[i] * 0.09 + grain[i] * 0.05;
        if (f !== 0) {
          const end = f > 0 ? u / unitW : 1 - u / unitW;
          k *= 1 - Math.abs(f) * 0.35 * smoothstep(0.55, 1, end);
        }
        // Sparse dark pits.
        if ((hash3(i, id, seed) & 1023) < 6) k *= 0.6;
        const mk = 1 + grain[i] * 0.09;
        const p = i * 3;
        rgb[p] = mortar[0] * mk * (1 - cov) + t[0] * k * cov;
        rgb[p + 1] = mortar[1] * mk * (1 - cov) + t[1] * k * cov;
        rgb[p + 2] = mortar[2] * mk * (1 - cov) + t[2] * k * cov;
        const e = clamp(edge / 0.12, 0, 1);
        height[i] = (hgt[id] - 0.06 * (1 - e) * (1 - e)) * cov - 0.28 * (1 - cov) + grain[i] * 0.006;
      });
      return { bump: 1, ao: 2.2, aoRadiusIn: Math.max(0.3, joint * 1.5) };
    },
  };
};
