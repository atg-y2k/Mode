/**
 * Parquet patterns: herringbone and chevron, laid at 45° with the spine
 * running vertically in the tile (rotate the treatment to turn it).
 */
import type { PatternFactory } from './plan';
import { jointWidth, specRng, type NormSpec } from './spec';
import { clamp, type Surface, type Vec3 } from './surface';
import { grainScale, makeGrain, woodTone, type Grain } from './wood';

const SQ2 = Math.SQRT2;

function plankSize(spec: NormSpec): { W: number; L: number } {
  const W = clamp(Math.min(spec.uw, spec.uh), 0.75, 16);
  let L = Math.max(spec.uw, spec.uh);
  if (L < W * 2) L = W * 5;
  return { W, L: clamp(L, W * 2, 96) };
}

interface PlankHit {
  id: number;
  u: number;
  v: number;
  len: number;
}

/** Shared per-pixel shading for parquet: grain, seams and micro-bevel. */
function shadePlanks(
  s: Surface,
  spec: NormSpec,
  count: number,
  W: number,
  L: number,
  locate: (xIn: number, yIn: number, out: PlankHit) => void,
): void {
  const { w, h, sx, sy, rgb, height } = s;
  const ppi = (sx + sy) / 2;
  const sc = grainScale(ppi, 0.06);
  const rng = specRng(spec, 120);
  const grains: Grain[] = [];
  for (let k = 0; k < count; k++) grains.push(makeGrain(rng, spec, W, L, 0.5 + 0.4 * spec.variation));
  const seam = jointWidth(spec, 0.02);
  const gap: Vec3 | null = spec.joint ? spec.joint.color : null;
  const hit: PlankHit = { id: 0, u: 0, v: 0, len: 0 };
  for (let y = 0; y < h; y++) {
    const yIn = (y + 0.5) / sy;
    for (let x = 0; x < w; x++) {
      locate((x + 0.5) / sx, yIn, hit);
      const g = grains[hit.id];
      const edge = Math.min(hit.u, hit.len - hit.u, hit.v, W - hit.v) - seam / 2;
      const cov = clamp(edge * ppi + 0.5, 0, 1);
      const t = woodTone(g, sc, hit.u, hit.v);
      const i = y * w + x;
      const p = i * 3;
      const c = g.color;
      rgb[p] = (gap ? gap[0] : c[0] * 0.28) * (1 - cov) + c[0] * t * cov;
      rgb[p + 1] = (gap ? gap[1] : c[1] * 0.28) * (1 - cov) + c[1] * t * cov;
      rgb[p + 2] = (gap ? gap[2] : c[2] * 0.28) * (1 - cov) + c[2] * t * cov;
      const e = clamp(edge / 0.07, 0, 1);
      height[i] = -0.025 * (1 - e) * (1 - e) * cov - 0.04 * (1 - cov);
    }
  }
}

/**
 * Herringbone: the axis-aligned staircase lattice — horizontal plank
 * [0,L]×[0,W] and vertical plank [L,L+W]×[W−L,W] repeated by (W,W) and
 * (L,−L) — rotated 45° so the lattice becomes rectangular: √2·L wide and
 * √2·W tall per period.
 */
export const herringbone: PatternFactory = (spec) => {
  const { W, L } = plankSize(spec);
  const px = SQ2 * L;
  const py = SQ2 * W;
  const mx = clamp(Math.round(40 / px), 1, 6);
  const my = clamp(Math.round(48 / py), 2, 40);
  return {
    spanX: mx * px,
    spanY: my * py,
    minFeatureIn: W / 2,
    render(s) {
      shadePlanks(s, spec, mx * my * 2, W, L, (xIn, yIn, out) => {
        // Screen → pattern coordinates (inverse 45° rotation).
        const P = (xIn + yIn) / SQ2;
        const Q = (yIn - xIn) / SQ2;
        const a0 = Math.floor((P + Q) / (2 * W));
        const b0 = Math.floor((P - Q) / (2 * L));
        for (let da = -2; da <= 1; da++) {
          for (let db = -1; db <= 1; db++) {
            const a = a0 + da;
            const b = b0 + db;
            const ox = a * W + b * L;
            const oy = a * W - b * L;
            const lx = P - ox;
            const ly = Q - oy;
            // Tile-unique id: translations by the tile span shift a by my and b by mx.
            const base = ((((a % my) + my) % my) * mx + (((b % mx) + mx) % mx)) * 2;
            if (lx >= 0 && lx < L && ly >= 0 && ly < W) {
              out.id = base;
              out.u = lx;
              out.v = ly;
              out.len = L;
              return;
            }
            if (lx >= L && lx < L + W && ly >= W - L && ly < W) {
              out.id = base + 1;
              out.u = W - ly; // along the vertical plank
              out.v = lx - L;
              out.len = L;
              return;
            }
          }
        }
        out.id = 0;
        out.u = L / 2;
        out.v = W / 2;
        out.len = L;
      });
      return { bump: 1, ao: 1.2, aoRadiusIn: 0.25 };
    },
  };
};

/**
 * Chevron: columns of 45° planks with vertical end cuts; alternate columns
 * mirror so the planks meet in a V. Column width C = L/√2.
 */
export const chevron: PatternFactory = (spec) => {
  const { W, L } = plankSize(spec);
  const C = L / SQ2;
  const py = SQ2 * W;
  const mx = clamp(Math.round(40 / (2 * C)), 1, 6);
  const my = clamp(Math.round(48 / py), 2, 40);
  const cols = mx * 2;
  return {
    spanX: cols * C,
    spanY: my * py,
    minFeatureIn: W / 2,
    render(s) {
      shadePlanks(s, spec, cols * my, W, L, (xIn, yIn, out) => {
        const col = Math.min(cols - 1, Math.floor(xIn / C));
        const lx = xIn - col * C;
        const mirrored = col % 2 === 1;
        const t = ((mirrored ? C - lx : lx) + yIn) / SQ2;
        const k = Math.floor(t / W);
        out.id = col * my + (((k % my) + my) % my);
        out.v = t - k * W;
        // Along the plank: from the column edge it starts at, scaled to plank length.
        out.u = (mirrored ? C - lx : lx) * SQ2;
        out.len = L;
      });
      return { bump: 1, ao: 1.2, aoRadiusIn: 0.25 };
    },
  };
};
