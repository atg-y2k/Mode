/**
 * Board-based patterns: wood planks, deck boards, shiplap, lap siding (rows
 * of boards with staggered end joints) and the vertical board & batten and
 * standing-seam metal profiles.
 */
import { addStreaks, cellsFor, fbmField } from './noise';
import { grainScale, makeGrain, plainTone, woodTone, type Grain } from './wood';
import type { PatternFactory, PatternPlan } from './plan';
import type { Rng } from './rng';
import { jointColor, jointWidth, pickTone, specRng, type NormSpec } from './spec';
import { clamp, fmod, smoothstep, type Surface, type Vec3 } from './surface';

// ---------------------------------------------------------------------------
// Row layout
// ---------------------------------------------------------------------------

function circDist(a: number, b: number, p: number): number {
  const d = Math.abs(a - b) % p;
  return Math.min(d, p - d);
}

/**
 * Sorted end-joint positions (inches in [0, period)) per row. Joints within a
 * row stay ≥ minBoard apart and away from the joints of the neighbouring
 * rows (including the wrap from the last row to the first) so no "H" joints
 * line up — the way boards are actually laid.
 */
export function rowJoints(
  rng: Rng,
  rows: number,
  period: number,
  count: (row: number) => number,
  minStagger: number,
  minBoard: number,
): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const n = Math.max(1, count(r));
    const prev = r > 0 ? out[r - 1] : [];
    const next = r === rows - 1 && rows > 1 ? out[0] : [];
    let best: number[] = [];
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 48; attempt++) {
      const js: number[] = [];
      for (let k = 0; k < n; k++) js.push(rng.next() * period);
      js.sort((a, b) => a - b);
      let score = Infinity;
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) score = Math.min(score, circDist(js[a], js[b], period) / minBoard);
        for (const q of prev) score = Math.min(score, circDist(js[a], q, period) / minStagger);
        for (const q of next) score = Math.min(score, circDist(js[a], q, period) / minStagger);
      }
      if (score >= 1) {
        best = js;
        break;
      }
      if (score > bestScore) {
        bestScore = score;
        best = js;
      }
    }
    out.push(best);
  }
  return out;
}

export interface BoardCell {
  /** Row index and board index within the tile. */
  row: number;
  id: number;
  /** Face length along the board, inches. */
  len: number;
}

/**
 * Visits every pixel of horizontal board rows. `cb(i, board, u, v)` gets the
 * pixel index and its position on the board face in inches: u along the
 * board from its start joint, v across the row from its top edge.
 */
export function forEachBoardPixel(
  s: Surface,
  pitch: number,
  period: number,
  joints: number[][],
  cb: (i: number, board: BoardCell, u: number, v: number) => void,
): BoardCell[][] {
  const rows = joints.length;
  const boards: BoardCell[][] = [];
  let id = 0;
  for (let r = 0; r < rows; r++) {
    const js = joints[r];
    const list: BoardCell[] = [];
    for (let k = 0; k < js.length; k++) {
      const end = k + 1 < js.length ? js[k + 1] : js[0] + period;
      list.push({ row: r, id: id++, len: end - js[k] });
    }
    boards.push(list);
  }
  const { w, h, sx, sy } = s;
  for (let y = 0; y < h; y++) {
    const yIn = (y + 0.5) / sy;
    const r = Math.min(rows - 1, Math.floor(yIn / pitch));
    const v = yIn - r * pitch;
    const js = joints[r];
    const list = boards[r];
    const n = js.length;
    // Largest k with js[k] <= x; before the first joint x belongs to the
    // last board of the row, which wraps around the tile edge.
    let k = -1;
    for (let x = 0; x < w; x++) {
      const xIn = (x + 0.5) / sx;
      while (k + 1 < n && xIn >= js[k + 1]) k++;
      const kk = k < 0 ? n - 1 : k;
      cb(y * w + x, list[kk], fmod(xIn - js[kk], period), v);
    }
  }
  return boards;
}

// ---------------------------------------------------------------------------
// Horizontal board rows (planks, deck, shiplap)
// ---------------------------------------------------------------------------

interface RowBoardsOptions {
  boardW: number;
  len: number;
  rows: number;
  period: number;
  /** Gap along the long edges and at the ends, inches. */
  sideGap: number;
  endGap: number;
  gapColor: Vec3 | null;
  /** Gap color as a multiple of the board color when gapColor is null. */
  gapDarken: number;
  gapDepth: number;
  bevel: number;
  bevelDepth: number;
  /** 0 = painted (fibers only), 1 = full grain figure. */
  grain: number;
  fiberAmp: number;
  /** Tone variation scale relative to the spec's variation. */
  toneScale: number;
  jointsPerRow: (row: number, rng: Rng) => number;
  /** Fastener pairs at this joist spacing (inches), e.g. deck screws. */
  screwsEvery?: number;
}

function rowBoards(spec: NormSpec, o: RowBoardsOptions): PatternPlan {
  const pitch = o.boardW + o.sideGap;
  return {
    spanX: o.period,
    spanY: pitch * o.rows,
    minFeatureIn: o.boardW / 3,
    render(s) {
      const rng = specRng(spec, 1);
      const joints = rowJoints(
        rng,
        o.rows,
        o.period,
        (r) => o.jointsPerRow(r, rng),
        Math.min(o.period * 0.18, 16),
        Math.min(o.period * 0.3, 24),
      );
      const ppi = (s.sx + s.sy) / 2;
      const sc = grainScale(ppi, o.fiberAmp);
      const grains: Grain[] = [];
      const grng = specRng(spec, 2);
      const plain = o.grain < 0.15;
      const { rgb, height } = s;
      const faceW = o.boardW;
      const screwR = 0.11;
      forEachBoardPixel(s, pitch, o.period, joints, (i, b, u, vRow) => {
        let g = grains[b.id];
        if (!g) {
          g = makeGrain(grng, spec, faceW, b.len, o.grain, o.toneScale);
          grains[b.id] = g;
        }
        const v = vRow - o.sideGap / 2;
        const uf = u - o.endGap / 2;
        const lenF = b.len - o.endGap;
        const da = Math.min(v, faceW - v);
        const dl = Math.min(uf, lenF - uf);
        const edge = Math.min(da, dl);
        const cov = clamp(edge * ppi + 0.5, 0, 1);
        let t = plain ? plainTone(g, sc, u, v) : woodTone(g, sc, u, v);
        let hgt = -o.bevelDepth * (1 - smoothstep(0, o.bevel, edge));
        if (o.screwsEvery) {
          // Two fasteners per joist crossing, ~3/4" in from each edge.
          const xIn = (i % s.w + 0.5) / s.sx;
          const jx = fmod(xIn + o.screwsEvery / 2, o.screwsEvery) - o.screwsEvery / 2;
          const sv = Math.min(Math.abs(v - 0.8), Math.abs(v - (faceW - 0.8)));
          const d2 = jx * jx + sv * sv;
          if (d2 < 4 * screwR * screwR) {
            const sd = Math.sqrt(d2);
            const c = clamp((screwR - sd) * ppi + 0.5, 0, 1);
            t *= 1 - 0.55 * c;
            hgt -= 0.04 * c;
          }
        }
        const p = i * 3;
        const gc = o.gapColor;
        const k = o.gapDarken;
        const r = g.color[0] * t;
        const gg = g.color[1] * t;
        const bb = g.color[2] * t;
        rgb[p] = (gc ? gc[0] : g.color[0] * k) * (1 - cov) + r * cov;
        rgb[p + 1] = (gc ? gc[1] : g.color[1] * k) * (1 - cov) + gg * cov;
        rgb[p + 2] = (gc ? gc[2] : g.color[2] * k) * (1 - cov) + bb * cov;
        height[i] = cov < 1 ? hgt * cov - o.gapDepth * (1 - cov) : hgt;
      });
      return { bump: 1, ao: 1.4, aoRadiusIn: Math.max(0.25, o.sideGap * 2) };
    },
  };
}

/** Plank geometry from a spec: width = shorter side, length = longer side. */
function plankDims(spec: NormSpec, minLen: number): { boardW: number; len: number } {
  const boardW = clamp(Math.min(spec.uw, spec.uh), 1, 24);
  let len = Math.max(spec.uw, spec.uh);
  if (len < boardW * 3) len = Math.max(minLen, boardW * 8);
  return { boardW, len: clamp(len, boardW * 2, 240) };
}

export const woodPlanks: PatternFactory = (spec) => {
  const { boardW, len } = plankDims(spec, 48);
  const period = len >= 36 ? Math.min(len, 120) : Math.ceil(36 / len) * len;
  const rows = clamp(Math.ceil(80 / boardW), 8, 24);
  const seam = jointWidth(spec, 0.02);
  return rowBoards(spec, {
    boardW,
    len,
    rows,
    period,
    sideGap: seam,
    endGap: seam,
    gapColor: spec.joint ? jointColor(spec, [0, 0, 0]) : null,
    gapDarken: 0.28,
    gapDepth: 0.04,
    bevel: 0.07,
    bevelDepth: 0.025,
    grain: 0.55 + 0.45 * spec.variation,
    fiberAmp: 0.07,
    toneScale: 1,
    jointsPerRow: (_r, rng) => (period > len * 1.01 ? Math.round(period / len) : rng.chance(0.55) ? 2 : 1),
  });
};

export const deckBoards: PatternFactory = (spec) => {
  const { boardW, len } = plankDims(spec, 144);
  const period = clamp(Math.round(len / 16) * 16, 48, 128);
  const rows = clamp(Math.ceil(40 / boardW), 6, 14);
  return rowBoards(spec, {
    boardW,
    len,
    rows,
    period,
    sideGap: jointWidth(spec, 0.22),
    endGap: Math.max(0.06, jointWidth(spec, 0.22) * 0.4),
    gapColor: jointColor(spec, [0.012, 0.009, 0.007]),
    gapDarken: 0.1,
    gapDepth: 0.75,
    bevel: 0.14,
    bevelDepth: 0.06,
    grain: 0.45 + 0.4 * spec.variation,
    fiberAmp: 0.11,
    toneScale: 1,
    jointsPerRow: (_r, rng) => (rng.chance(0.4) ? 2 : 1),
    screwsEvery: 16,
  });
};

export const shiplap: PatternFactory = (spec) => {
  const boardW = clamp(Math.min(spec.uw, spec.uh), 2.5, 16);
  const rawLen = Math.max(spec.uw, spec.uh);
  const len = rawLen >= boardW * 3 ? rawLen : 96;
  const period = clamp(len, 48, 120);
  return rowBoards(spec, {
    boardW,
    len,
    rows: clamp(Math.ceil(44 / boardW), 5, 14),
    period,
    sideGap: jointWidth(spec, 0.14),
    endGap: 0.03,
    gapColor: spec.joint ? spec.joint.color : null,
    gapDarken: 0.16,
    gapDepth: 0.4,
    bevel: 0.05,
    bevelDepth: 0.02,
    grain: 0.08,
    fiberAmp: 0.018,
    toneScale: 0.15,
    jointsPerRow: () => 1,
  });
};

// ---------------------------------------------------------------------------
// Lap siding
// ---------------------------------------------------------------------------

export const lapSiding: PatternFactory = (spec) => {
  const small = Math.min(spec.uw, spec.uh);
  const reveal = clamp(small <= 14 ? small : 7, 3, 14);
  const big = Math.max(spec.uw, spec.uh);
  const len = big >= 36 ? big : 144;
  const period = clamp(len, 48, 120);
  const rows = clamp(Math.ceil(42 / reveal), 4, 12);
  return {
    spanX: period,
    spanY: reveal * rows,
    minFeatureIn: reveal / 3,
    render(s) {
      const rng = specRng(spec, 1);
      const joints = rowJoints(rng, rows, period, () => 1, Math.min(period * 0.2, 24), period);
      const tones = new Map<number, Vec3>();
      const trng = specRng(spec, 3);
      const muted: NormSpec = { ...spec, variation: spec.variation * 0.25 };
      const fibers = new Float32Array(s.w * s.h);
      addStreaks(fibers, s.w, s.h, s.sx * 2.5, spec.seed ^ 0x51, 1);
      addStreaks(fibers, s.w, s.h, s.sx * 0.5, spec.seed ^ 0x52, 0.5);
      const ppi = (s.sx + s.sy) / 2;
      const shadowLen = clamp(reveal * 0.1, 0.25, 0.9);
      const thick = 0.45;
      const { rgb, height } = s;
      forEachBoardPixel(s, reveal, period, joints, (i, b, u, v) => {
        let c = tones.get(b.id);
        if (!c) {
          c = pickTone(trng, muted, { light: 0.12, hue: 0.02, blend: 0.2 });
          tones.set(b.id, c);
        }
        // Lap shadow under the course above, then the board tilting toward the light.
        let k = 0.4 + 0.6 * smoothstep(0, shadowLen, v);
        k *= 0.95 + 0.07 * (v / reveal);
        k *= 1 + fibers[i] * 0.022;
        // Rounded butt edge catching light at the bottom of each course.
        if (reveal - v < 0.12) k *= 1.05;
        // Butt joints: a fine dark seam.
        const dl = Math.min(u, b.len - u);
        const seam = clamp(0.5 - (dl - 0.025) * ppi, 0, 1);
        k *= 1 - 0.6 * seam;
        const p = i * 3;
        rgb[p] = c[0] * k;
        rgb[p + 1] = c[1] * k;
        rgb[p + 2] = c[2] * k;
        // Board thickens toward its butt, then steps back at the next course.
        height[i] = thick * (v / reveal) - 0.02 * seam;
      });
      return { bump: 0.35, ao: 0.6, aoRadiusIn: 0.6 };
    },
  };
};

// ---------------------------------------------------------------------------
// Vertical profiles: board & batten, standing seam
// ---------------------------------------------------------------------------

export const boardBatten: PatternFactory = (spec) => {
  const spacing = clamp(spec.uw <= 36 ? spec.uw : Math.min(spec.uw, spec.uh), 4, 30);
  const batten = clamp(spacing * 0.2, 1.5, 3.5);
  const cols = clamp(Math.ceil(48 / spacing), 3, 10);
  return {
    spanX: spacing * cols,
    spanY: 48,
    minFeatureIn: batten / 2,
    render(s) {
      const { w, h, sx, sy, rgb, height } = s;
      const trng = specRng(spec, 4);
      const muted: NormSpec = { ...spec, variation: spec.variation * 0.3 };
      const boardTone: Vec3[] = [];
      const battenTone: Vec3[] = [];
      for (let c = 0; c < cols; c++) {
        boardTone.push(pickTone(trng, muted, { light: 0.1, hue: 0.02, blend: 0.2 }));
        battenTone.push(pickTone(trng, muted, { light: 0.08, hue: 0.02, blend: 0.2 }));
      }
      const fibers = new Float32Array(w * h);
      addStreaks(fibers, w, h, sy * 2.5, spec.seed ^ 0x61, 1, true);
      addStreaks(fibers, w, h, sy * 0.5, spec.seed ^ 0x62, 0.5, true);
      const half = batten / 2;
      const raise = 0.75;
      const round = 0.12;
      const shadowW = 0.7;
      for (let x = 0; x < w; x++) {
        const xIn = (x + 0.5) / sx;
        const col = Math.min(cols - 1, Math.floor(xIn / spacing));
        const lx = xIn - col * spacing; // 0 at the seam under the batten
        const dSeam = Math.min(lx, spacing - lx);
        // Which column's batten covers this x (the one centred on the nearest seam).
        const bcol = lx < spacing / 2 ? col : (col + 1) % cols;
        const onBatten = dSeam < half;
        const cov = clamp((half - dSeam) * sx + 0.5, 0, 1);
        const edgeIn = half - dSeam;
        const bh = raise * smoothstep(0, round, edgeIn);
        // Cast shadow to the right of each batten (light from the left).
        const right = lx - half; // distance right of the batten's right edge (when lx small)
        const sh = !onBatten && lx < spacing / 2 ? 0.5 + 0.5 * smoothstep(0, shadowW, right) : 1;
        const bt = battenTone[bcol];
        const bd = boardTone[col];
        for (let y = 0; y < h; y++) {
          const i = y * w + x;
          const f = 1 + fibers[i] * 0.02;
          const p = i * 3;
          const kb = sh * f;
          rgb[p] = (bd[0] * kb) * (1 - cov) + bt[0] * f * cov;
          rgb[p + 1] = (bd[1] * kb) * (1 - cov) + bt[1] * f * cov;
          rgb[p + 2] = (bd[2] * kb) * (1 - cov) + bt[2] * f * cov;
          height[i] = onBatten ? bh : 0;
        }
      }
      return { bump: 0.8, ao: 0.6, aoRadiusIn: 0.6 };
    },
  };
};

export const standingSeam: PatternFactory = (spec) => {
  const panel = clamp(spec.uw <= 30 ? spec.uw : Math.min(spec.uw, spec.uh), 8, 30);
  const cols = clamp(Math.ceil(56 / panel), 3, 8);
  return {
    spanX: panel * cols,
    spanY: 60,
    minFeatureIn: 0.5,
    render(s) {
      const { w, h, sx, sy, rgb, height } = s;
      const trng = specRng(spec, 5);
      const muted: NormSpec = { ...spec, variation: spec.variation * 0.25 };
      const tones: Vec3[] = [];
      for (let c = 0; c < cols; c++) tones.push(pickTone(trng, muted, { light: 0.08, hue: 0.01, blend: 0.15 }));
      // Oil canning: broad, soft undulation stretched along the panel.
      const oil = fbmField(w, h, cellsFor(w, panel * 0.5 * sx), cellsFor(h, 22 * sy), 2, 0.5, spec.seed ^ 0x71);
      const brushed = new Float32Array(w * h);
      addStreaks(brushed, w, h, sy * 3, spec.seed ^ 0x72, 1, true);
      const seamW = 1.0;
      const seamH = 1.2;
      for (let x = 0; x < w; x++) {
        const xIn = (x + 0.5) / sx;
        const col = Math.min(cols - 1, Math.floor(xIn / panel));
        const lx = xIn - col * panel; // seam at lx = 0
        const d = Math.min(lx, panel - lx);
        // Seam: a rounded rib; the pan has two faint pencil ribs.
        const rib = seamH * (1 - smoothstep(seamW * 0.3, seamW * 0.55, d));
        const pencil = 0.05 * (Math.exp(-((lx - panel / 3) ** 2) / 0.02) + Math.exp(-((lx - (2 * panel) / 3) ** 2) / 0.02));
        const right = lx > panel / 2 ? lx - panel : lx; // signed distance from nearest seam centre
        const shadow = right > 0 ? 0.7 + 0.3 * smoothstep(seamW * 0.5, seamW * 0.5 + 0.9, right) : 1;
        const tone = tones[lx < panel / 2 ? col : (col + 1) % cols];
        for (let y = 0; y < h; y++) {
          const i = y * w + x;
          const k = shadow * (1 + oil[i] * 0.05 + brushed[i] * 0.012);
          const p = i * 3;
          rgb[p] = tone[0] * k;
          rgb[p + 1] = tone[1] * k;
          rgb[p + 2] = tone[2] * k;
          height[i] = rib + pencil;
        }
      }
      return { bump: 0.9, diffuse: 0.6 };
    },
  };
};
