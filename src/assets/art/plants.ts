/**
 * Plant illustrations for every PlantForm. Each form draws into a "plant box"
 * (w × h above the ground/soil point) and optionally sits in a pot.
 *
 * Variants chosen by seed (documented so the catalog can pick them):
 *  - flowering-shrub:      seed % 2 → 0 flower heads (hydrangea, lilac), 1 blossoms (azalea, rose)
 *  - flowering-perennial:  seed % 3 → 0 spikes (lavender, salvia), 1 daisies (coneflower), 2 clusters (phlox, yarrow)
 *  - cactus:               seed % 2 → 0 column with arms, 1 barrel cluster
 */
import type { PlantArt, PlantForm } from '../../../shared/art';
import {
  FlowerPainter,
  LIGHT,
  Layers,
  barkGradient,
  canopy,
  clumpBounds,
  drawBranches,
  flowerTones,
  foliageTones,
  grow,
  leafSpecks,
  potBack,
  potFront,
  potRy,
  potTopY,
  scallopBlob,
  surfacePoints,
  tips,
  type Bounds,
  type Clump,
  type FlowerStyle,
  type FoliageTones,
  type PotGeom,
} from './organic';
import { SvgDoc, ellipsePath, g, leafPath, path, polygon, rect, smoothClosed, smoothOpen, taper, use } from './svg';
import { clamp, f, fi, lerp, makeRng, mix, normHex, tone, type Pt, type Rng } from './util';
import type { ArtResult } from '../../../shared/art';

// ---------------------------------------------------------------------------
// Spec normalization
// ---------------------------------------------------------------------------

export interface NormPlant {
  form: PlantForm;
  foliage: string;
  foliage2?: string;
  flower?: string;
  trunk?: string;
  pot?: string;
  density: number;
  seed: number;
}

export function normalizePlant(spec: PlantArt): NormPlant {
  const opt = (v: string | undefined): string | undefined => (v === undefined ? undefined : normHex(v, '') || undefined);
  return {
    form: spec.form,
    foliage: normHex(spec.foliage, '#4f7a3a'),
    foliage2: opt(spec.foliage2),
    flower: opt(spec.flower),
    trunk: opt(spec.trunk),
    pot: opt(spec.pot),
    density: clamp(Number.isFinite(spec.density) ? (spec.density as number) : 0.7, 0, 1),
    seed: Number.isFinite(spec.seed) ? spec.seed : 0,
  };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface PlantCtx {
  doc: SvgDoc;
  rng: Rng;
  spec: NormPlant;
  /** Ground / soil point x. */
  cx: number;
  /** Ground / soil point y (stems start here). */
  gy: number;
  /** Plant box above the ground point. */
  w: number;
  h: number;
  t: FoliageTones;
  density: number;
  potted: boolean;
  /** Width of exposed soil (pot inner width, or a sensible root spread in ground). */
  soilW: number;
  /** Draw the pot front now (idempotent; drawn automatically at the end otherwise). */
  potFront(): void;
}

interface PotSize {
  w: number;
  h: number;
  /** Plant box when potted (defaults to the in-ground box). */
  pw?: number;
  ph?: number;
}

interface PlantDef {
  w: number;
  h: number;
  pot?: PotSize;
  draw(c: PlantCtx): void;
}

const DEFAULT_BARK = '#6b5444';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Jittered hex-grid of clumps covering the region where `inside` is true. */
function fillRegion(
  rng: Rng,
  b: Bounds,
  r: number,
  inside: (x: number, y: number) => boolean,
  o: { jitter?: number; rVar?: number; sy?: number; step?: number } = {},
): Clump[] {
  const sy = o.sy ?? 1;
  const sx = r * (o.step ?? 1.1);
  const syStep = sx * 0.87 * sy;
  const jitter = o.jitter ?? 0.45;
  const rVar = o.rVar ?? 0.22;
  const out: Clump[] = [];
  let row = 0;
  for (let y = b.y; y <= b.y + b.h + 0.01; y += syStep, row++) {
    for (let x = b.x + (row % 2 ? sx / 2 : 0); x <= b.x + b.w + 0.01; x += sx) {
      const px = x + (rng() - 0.5) * sx * jitter;
      const py = y + (rng() - 0.5) * syStep * jitter;
      if (inside(px, py)) out.push({ x: px, y: py, r: r * (1 + (rng() * 2 - 1) * rVar), sy });
    }
  }
  return out;
}

/** Superellipse-ish dome: round top, fuller (squarer) bottom. */
function inDome(x: number, y: number, cx: number, cy: number, rx: number, ry: number, bottomPow = 2.6): boolean {
  const dx = Math.abs(x - cx) / rx;
  const dy = Math.abs(y - cy) / ry;
  const p = y > cy ? bottomPow : 2;
  return dx ** p + dy ** p <= 1;
}

/** Clumps for a mounded shrub silhouette standing on the ground at gy. */
function domeClumps(rng: Rng, cx: number, gy: number, rx: number, ry: number, r: number, sy = 1, bottomPow = 2.6): Clump[] {
  const cy = gy - ry;
  const ix = Math.max(r * 0.3, rx - r * 1.02);
  const iy = Math.max(r * 0.3, ry - r * sy * 1.02);
  const clumps = fillRegion(
    rng,
    { x: cx - ix, y: cy - iy, w: ix * 2, h: iy * 2 },
    r,
    (x, y) => inDome(x, y, cx, cy, ix, iy, bottomPow),
    { sy },
  );
  // Guarantee a full silhouette even with few grid points.
  if (clumps.length < 3) clumps.push({ x: cx, y: cy, r: Math.min(rx, ry) * 0.95, sy });
  return clumps;
}

/** A few short visible stems at the base of a shrub. */
function baseStems(c: PlantCtx, n: number, spread: number, height: number, width = 4): void {
  const { rng, cx, gy } = c;
  const bark = c.spec.trunk ?? tone(c.t.mid, -0.55);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = cx + (rng() * 2 - 1) * spread * 0.25;
    const x1 = cx + (rng() * 2 - 1) * spread;
    const top = gy - height * rng.range(0.7, 1);
    lines.push(taper([{ x: x0, y: gy + 1 }, { x: lerp(x0, x1, 0.45), y: lerp(gy, top, 0.5) }, { x: x1, y: top }], width, width * 0.5));
  }
  c.doc.add(path(lines.join(''), tone(bark, -0.1)));
}

// ---------------------------------------------------------------------------
// Shrubs
// ---------------------------------------------------------------------------

function roundShrub(c: PlantCtx, flowers?: FlowerStyle): void {
  const { rng, cx, gy, w, h, density } = c;
  const r = w * lerp(0.15, 0.1, density);
  baseStems(c, 4, w * 0.18, h * 0.3);
  const clumps = domeClumps(rng, cx, gy + r * 0.12, w * 0.48, h * 0.5, r);
  canopy(c.doc, rng, clumps, { tones: c.t, texture: lerp(0.7, 1.3, density) });
  if (flowers && c.spec.flower) {
    const fp = new FlowerPainter(flowerTones(c.spec.flower), rng);
    const pts = surfacePoints(rng, clumps, flowers === 'cluster' ? Math.round(lerp(10, 18, density)) : Math.round(lerp(30, 60, density)));
    pts.sort((a, b) => a.y - b.y);
    for (const p of pts) {
      if (flowers === 'cluster') fp.cluster(p.x, p.y, w * rng.range(0.07, 0.095), 16);
      else fp.blossom(p.x, p.y, w * rng.range(0.022, 0.03));
    }
    c.doc.add(...fp.render());
  }
}

function uprightShrub(c: PlantCtx): void {
  const { rng, cx, gy, w, h, density } = c;
  const r = w * lerp(0.17, 0.12, density);
  baseStems(c, 5, w * 0.16, h * 0.28);
  const cy = gy - h * 0.53;
  const rx = w * 0.46;
  const ry = h * 0.46;
  const ix = rx - r;
  const iy = ry - r * 1.1;
  const clumps = fillRegion(
    rng,
    { x: cx - ix, y: cy - iy, w: ix * 2, h: iy * 2 },
    r,
    (x, y) => {
      // Vase profile: narrower toward the base.
      const t = (y - (cy - iy)) / (2 * iy);
      const half = ix * (t < 0.55 ? 1 : 1 - (t - 0.55) * 0.9);
      return Math.abs(x - cx) <= half * Math.sqrt(Math.max(0, 1 - ((y - cy) / iy) ** 2)) + r * 0.2;
    },
    { sy: 1.15 },
  );
  canopy(c.doc, rng, clumps, { tones: c.t, texture: lerp(0.8, 1.3, density) });
}

function spreadingShrub(c: PlantCtx): void {
  const { rng, cx, gy, w, h, density } = c;
  const r = h * lerp(0.3, 0.22, density);
  const clumps: Clump[] = [];
  // Layered horizontal sprays: rows rising toward the middle.
  const rows = 3;
  for (let row = 0; row < rows; row++) {
    const k = row / (rows - 1);
    const y = gy - r * 0.55 - k * (h - r * 1.5);
    const half = w * 0.46 * (1 - k * 0.45);
    const n = Math.max(2, Math.round((half * 2) / (r * 1.15)));
    for (let i = 0; i < n; i++) {
      const x = cx - half + ((i + 0.5) / n) * half * 2 + (rng() - 0.5) * r * 0.5;
      clumps.push({ x, y: y + (rng() - 0.5) * r * 0.3, r: r * rng.range(0.85, 1.15) * (1 - k * 0.15), sy: 0.62 });
    }
  }
  // Tips reaching out at the sides.
  clumps.push({ x: cx - w * 0.44, y: gy - r * 0.45, r: r * 0.7, sy: 0.55 }, { x: cx + w * 0.44, y: gy - r * 0.5, r: r * 0.7, sy: 0.55 });
  canopy(c.doc, rng, clumps, { tones: c.t, lobes: [10, 15], rough: 0.24, texture: 1.2 });
}

function floweringShrub(c: PlantCtx): void {
  const style: FlowerStyle = c.spec.seed % 2 === 0 ? 'cluster' : 'blossom';
  roundShrub(c, c.spec.flower ? style : undefined);
}

function hedge(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const r = h * lerp(0.17, 0.12, density);
  const x0 = cx - w * 0.485 + r * 0.95;
  const x1 = cx + w * 0.485 - r * 0.95;
  const top = gy - h * 0.97 + r * 0.95;
  const bot = gy - r * 0.7;
  const clumps = fillRegion(rng, { x: x0, y: top, w: x1 - x0, h: bot - top }, r, () => true, {
    step: 0.95,
    jitter: 0.3,
    rVar: 0.12,
    sy: 0.9,
  });
  const res = canopy(doc, rng, clumps, { tones: t, volume: 0.45, texture: 1.4 });
  const b = res.bounds;
  // Sheared top catches the light; slight left→right falloff.
  const topLight = doc.linear(
    [
      { o: 0, c: t.hi, a: 0.42 },
      { o: 1, c: t.hi, a: 0 },
    ],
    0,
    b.y,
    0,
    b.y + b.h * 0.24,
    { user: true },
  );
  const side = doc.linear(
    [
      { o: 0, c: t.hi, a: 0.12 },
      { o: 0.5, c: t.hi, a: 0 },
      { o: 1, c: t.deep, a: 0.3 },
    ],
    b.x,
    0,
    b.x + b.w,
    0,
    { user: true },
  );
  doc.add(g([rect(b.x, b.y, b.w, b.h, topLight), rect(b.x, b.y, b.w, b.h, side)], { 'clip-path': res.clip }));
}

// ---------------------------------------------------------------------------
// Evergreens
// ---------------------------------------------------------------------------

function conicalEvergreen(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const bark = c.spec.trunk ?? DEFAULT_BARK;
  const top = gy - h * 0.99;
  const base = gy - h * 0.05;
  const hw = w * 0.47;
  doc.add(path(taper([{ x: cx, y: gy }, { x: cx, y: base - h * 0.1 }], w * 0.08, w * 0.05), barkGradient(doc, bark)));
  const tiers = Math.round(lerp(9, 13, density));
  const span = base - top;
  const tierH = (span / tiers) * 2.1;
  const widthAt = (y: number): number => hw * Math.pow(clamp((y - top) / span, 0, 1), 0.92);
  const skirts: string[] = [];
  const grad = doc.linear(
    [
      { o: 0, c: t.light },
      { o: 0.38, c: t.mid },
      { o: 0.72, c: t.dark },
      { o: 1, c: tone(t.dark, -0.25) },
    ],
    cx - hw,
    0,
    cx + hw,
    0,
    { user: true },
  );
  for (let i = 0; i < tiers; i++) {
    const k = i / tiers;
    const yb = base - span * k * 0.94;
    const half = widthAt(yb) * rng.range(0.94, 1.06) + 3;
    const apexY = yb - tierH * (i === tiers - 1 ? 1.6 : 1);
    const ax = cx + (rng() - 0.5) * 3;
    const droop = tierH * 0.18;
    // Bottom edge: needle tufts along a gentle smile curve.
    const pts: Pt[] = [];
    const n = Math.max(6, Math.round(half / 6));
    for (let j = n; j >= 0; j--) {
      const u = j / n;
      const x = cx - half + u * half * 2;
      const sag = droop * (1 - ((x - cx) / half) ** 2);
      const y = yb + sag + (j % 2 ? rng.range(2, 7) : rng.range(-2, 1));
      pts.push({ x: x + (rng() - 0.5) * 3, y });
    }
    const d =
      `M${f(cx - half)} ${f(yb + 2)}` +
      `Q${f(cx - half * 0.45)} ${f(apexY + tierH * 0.3)} ${f(ax)} ${f(apexY)}` +
      `Q${f(cx + half * 0.45)} ${f(apexY + tierH * 0.3)} ${f(cx + half)} ${f(yb + 2)}` +
      pts.map((p) => `L${f(p.x)} ${f(p.y)}`).join('') +
      'Z';
    skirts.push(d);
    // Shadow cast on the tier below, then the tier itself.
    if (i > 0) doc.add(path(d, t.deep, { transform: `translate(1 ${f(tierH * 0.22)})`, opacity: 0.75 }));
    doc.add(path(d, grad));
    // Lit upper surface of the tier.
    doc.add(
      path(
        `M${f(cx - half * 0.85)} ${f(yb - tierH * 0.05)}Q${f(cx - half * 0.4)} ${f(apexY + tierH * 0.35)} ${f(ax)} ${f(apexY + 2)}` +
          `Q${f(cx - half * 0.15)} ${f(apexY + tierH * 0.65)} ${f(cx - half * 0.2)} ${f(yb)}Z`,
        t.light,
        { opacity: 0.55 },
      ),
    );
  }
  const silId = doc.shared(skirts.join(''));
  const clip = doc.clip(use(silId));
  const b = { x: cx - hw - 4, y: top - 4, w: hw * 2 + 8, h: base - top + 12 };
  const vol = doc.radial(
    [
      { o: 0, c: t.hi, a: 0.25 },
      { o: 0.4, c: t.hi, a: 0 },
      { o: 0.7, c: t.deep, a: 0 },
      { o: 1, c: t.deep, a: 0.45 },
    ],
    cx - hw * 0.35,
    top + (base - top) * 0.35,
    (base - top) * 0.8,
    { user: true },
  );
  doc.add(g(rect(b.x, b.y, b.w, b.h, vol), { 'clip-path': clip }));
  // Needle texture.
  const lay = new Layers([{ fill: t.deep, opacity: 0.5 }, { fill: t.hi, opacity: 0.55 }]);
  const count = Math.round(lerp(140, 260, density));
  for (let i = 0; i < count; i++) {
    const y = lerp(top + 12, base, Math.sqrt(rng()));
    const half = widthAt(y) * 0.92;
    const x = cx + (rng() * 2 - 1) * half;
    const lit = (x - cx) / (half || 1) < -0.1;
    const ang = Math.PI / 2 + (x < cx ? 0.5 : -0.5) + (rng() - 0.5) * 0.8;
    lay.add(lit ? t.hi : t.deep, leafPath({ x, y }, ang, rng.range(4, 8), 1.6, 0, f), lit ? 0.55 : 0.5);
  }
  doc.add(...lay.render());
}

function columnar(c: PlantCtx): void {
  const { rng, cx, gy, w, h, density } = c;
  const r = w * lerp(0.26, 0.2, density);
  const top = gy - h * 0.99;
  const clumps: Clump[] = [];
  const profile = (u: number): number => {
    // u: 0 bottom → 1 top. Narrow base, fullest ~35%, pointed tip.
    if (u < 0.08) return 0.62 + u * 3.5;
    return Math.pow(Math.sin(Math.PI * clamp((1 - u) * 0.62 + 0.38, 0, 1)), 0.9) * 1.05;
  };
  const step = r * 0.62;
  for (let y = gy - r * 0.85; y > top + r * 0.6; y -= step) {
    const u = (gy - y) / (gy - top);
    const half = Math.max(r * 0.35, w * 0.47 * profile(u) - r * 0.95);
    const n = Math.max(1, Math.round((half * 2) / (r * 0.95)) + 1);
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? cx : cx - half + (i / (n - 1)) * half * 2;
      clumps.push({ x: x + (rng() - 0.5) * r * 0.3, y: y + (rng() - 0.5) * step * 0.4, r: r * rng.range(0.85, 1.1) * (u > 0.85 ? 1 - (u - 0.85) * 2.5 : 1), sy: 1.25 });
    }
  }
  clumps.push({ x: cx, y: top + r * 0.75, r: r * 0.55, sy: 1.6 });
  canopy(c.doc, rng, clumps, { tones: c.t, lobes: [7, 10], rough: 0.2, texture: 1.2 });
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

/** Cheap background foliage layer (silhouette + one tone) behind branches. */
function backFoliage(c: PlantCtx, clumps: Clump[]): void {
  const { doc, rng, t } = c;
  const sil = clumps.map((k) => scallopBlob(rng, k.x, k.y, k.r * 1.04, k.r * (k.sy ?? 1) * 1.04, rng.int(7, 10), 0.16)).join('');
  doc.add(path(sil, t.deep));
  const inner = clumps
    .map((k) => scallopBlob(rng, k.x + LIGHT.x * k.r * 0.2, k.y + LIGHT.y * k.r * 0.2, k.r * 0.7, k.r * (k.sy ?? 1) * 0.68, rng.int(6, 9), 0.16))
    .join('');
  doc.add(path(inner, t.dark, { opacity: 0.85 }));
}

function deciduousTree(c: PlantCtx): void {
  const { rng, cx, gy, w, h, density } = c;
  const bark = c.spec.trunk ?? DEFAULT_BARK;
  const trunkH = h * 0.36;
  const branches = grow(rng, { x: cx, y: gy }, -Math.PI / 2 + (rng() - 0.5) * 0.08, trunkH, w * 0.085, {
    depth: 3,
    spread: 0.85,
    decay: 0.62,
    kids: [2, 3],
    up: 0.3,
    curve: 0.14,
  });
  // Root flare.
  c.doc.add(path(taper([{ x: cx, y: gy + 1 }, { x: cx, y: gy - h * 0.06 }], w * 0.14, w * 0.085, { ease: 0.5 }), tone(bark, -0.05)));
  const crownCy = gy - h * 0.62;
  const crx = w * 0.47;
  const cry = h * 0.36;
  const r = w * lerp(0.12, 0.09, density);
  const clumps = fillRegion(
    rng,
    { x: cx - crx + r, y: crownCy - cry + r, w: (crx - r) * 2, h: (cry - r) * 2 },
    r,
    (x, y) => ((x - cx) / (crx - r)) ** 2 + ((y - crownCy) / (cry - r)) ** 2 <= 1,
  );
  for (const p of tips(branches, 2)) {
    if (((p.x - cx) / crx) ** 2 + ((p.y - crownCy) / cry) ** 2 < 1.15) clumps.push({ x: p.x, y: p.y, r: r * rng.range(0.9, 1.2) });
  }
  backFoliage(c, clumps);
  drawBranches(c.doc, rng, branches, bark);
  // Leave an opening low in the crown so the main fork reads through.
  const holeX = cx;
  const holeY = crownCy + cry * 0.55;
  const front = clumps.filter((k) => {
    const d = ((k.x - holeX) / (crx * 0.42)) ** 2 + ((k.y - holeY) / (cry * 0.5)) ** 2;
    return d > 1 || rng.chance(0.15);
  });
  canopy(c.doc, rng, front, { tones: c.t, texture: 1 });
  if (c.spec.flower) {
    const fp = new FlowerPainter(flowerTones(c.spec.flower), rng);
    for (const p of surfacePoints(rng, front, Math.round(lerp(40, 80, density)))) fp.blossom(p.x, p.y, w * 0.016);
    c.doc.add(...fp.render());
  }
}

function ornamentalTree(c: PlantCtx): void {
  const { rng, cx, gy, w, h, density } = c;
  const bark = c.spec.trunk ?? '#5a4a42';
  const stemsN = rng.int(2, 3);
  const branches = [];
  for (let i = 0; i < stemsN; i++) {
    const side = stemsN === 1 ? 0 : (i / (stemsN - 1)) * 2 - 1;
    branches.push(
      ...grow(rng, { x: cx + side * w * 0.02, y: gy }, -Math.PI / 2 + side * 0.38 + (rng() - 0.5) * 0.1, h * 0.3, w * 0.05, {
        depth: 2,
        spread: 1.1,
        decay: 0.75,
        kids: [2, 3],
        up: 0.05,
        curve: 0.25,
      }),
    );
  }
  const r = w * lerp(0.11, 0.085, density);
  // Layered, flattened tiers (Japanese maple / dogwood habit).
  const tiers = [
    { y: gy - h * 0.42, half: w * 0.46 },
    { y: gy - h * 0.62, half: w * 0.4 },
    { y: gy - h * 0.8, half: w * 0.28 },
  ];
  const clumps: Clump[] = [];
  for (const tier of tiers) {
    const n = Math.max(2, Math.round((tier.half * 2) / (r * 1.1)));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const x = cx - tier.half + u * tier.half * 2;
      const arch = Math.sin(u * Math.PI) * r * 0.5;
      clumps.push({ x: x + (rng() - 0.5) * r * 0.4, y: tier.y - arch + (rng() - 0.5) * r * 0.4, r: r * rng.range(0.9, 1.2), sy: 0.6 });
    }
  }
  clumps.push({ x: cx + (rng() - 0.5) * w * 0.05, y: gy - h * 0.9, r: r * 0.9, sy: 0.65 });
  backFoliage(c, clumps);
  drawBranches(c.doc, rng, branches, bark, { lines: false });
  // Bottom tier first so upper tiers overlap (layered look).
  const ordered = [...clumps].sort((a, b) => b.y - a.y);
  const front = ordered.filter(() => rng.chance(0.86));
  canopy(c.doc, rng, front, { tones: c.t, sort: false, texture: 1 });
  if (c.spec.flower) {
    const fp = new FlowerPainter(flowerTones(c.spec.flower), rng);
    const pts = surfacePoints(rng, front, Math.round(lerp(40, 90, density)), 0.2, 0.95);
    for (const p of pts) fp.blossom(p.x, p.y, w * rng.range(0.016, 0.022));
    c.doc.add(...fp.render());
  }
}

function weepingTree(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const bark = c.spec.trunk ?? DEFAULT_BARK;
  const domeCy = gy - h * 0.76;
  const domeRx = w * 0.4;
  const domeRy = h * 0.19;
  const domeTop = (x: number): number => {
    const u = clamp((x - cx) / (domeRx * 1.15), -1, 1);
    return domeCy - domeRy * Math.sqrt(1 - u * u) * 0.9 + domeRy * 0.25;
  };
  const strand = (x: number, len: number, wid: number): string => {
    const y0 = domeTop(x);
    const out = (x - cx) / (w * 0.5);
    const pts: Pt[] = [];
    const n = 9;
    const phase = rng() * 6.28;
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const px = x + out * w * 0.07 * Math.sin(u * Math.PI * 0.8) + Math.sin(u * 5 + phase) * 2;
      const py = y0 + len * u;
      pts.push({ x: px, y: py });
      const ww = wid * (1 - u * 0.55) * (1 + 0.22 * Math.sin(u * 17 + phase));
      left.push({ x: px - ww / 2 - (i % 2 ? 2 : 0), y: py });
      right.push({ x: px + ww / 2 + (i % 2 ? 0 : 2), y: py });
    }
    const tip = { x: pts[n].x, y: pts[n].y + wid * 0.5 };
    return smoothClosed([...left, tip, ...right.reverse()], fi);
  };
  const strands = (count: number, minLen: number, maxLen: number, fill: string, op = 1, center = 1): string => {
    const ds: string[] = [];
    for (let i = 0; i < count; i++) {
      const u = (i + rng()) / count;
      const x = cx - w * 0.46 + u * w * 0.92;
      const edge = Math.abs(x - cx) / (w * 0.46);
      if (center < 1 && edge < 0.3 && rng.chance(1 - center)) continue;
      const y0 = domeTop(x);
      const maxL = gy - h * 0.06 - y0;
      const len = clamp(lerp(minLen, maxLen, rng()) * (0.75 + edge * 0.35), 20, maxL);
      ds.push(strand(x, len, rng.range(12, 20)));
    }
    const d = ds.join('');
    doc.add(path(d, fill, { opacity: op < 1 ? op : undefined }));
    return d;
  };
  const count = Math.round(lerp(18, 30, density));
  const back = strands(count, h * 0.35, h * 0.62, t.deep);
  strands(Math.round(count * 0.7), h * 0.3, h * 0.55, t.dark, 0.9);
  // Trunk and arching limbs.
  const trunkTop = { x: cx + (rng() - 0.5) * w * 0.04, y: domeCy + domeRy * 0.2 };
  const trunk = taper(
    [{ x: cx, y: gy + 1 }, { x: lerp(cx, trunkTop.x, 0.5) + w * 0.01, y: lerp(gy, trunkTop.y, 0.5) }, trunkTop],
    w * 0.075,
    w * 0.04,
    { ease: 0.6 },
  );
  doc.add(path(trunk, barkGradient(doc, bark)));
  const limbs: string[] = [];
  for (let i = 0; i < 4; i++) {
    const side = i % 2 ? 1 : -1;
    const reach = w * rng.range(0.18, 0.32);
    limbs.push(
      taper(
        smoothPts([
          trunkTop,
          { x: trunkTop.x + side * reach * 0.4, y: trunkTop.y - h * rng.range(0.08, 0.13) },
          { x: trunkTop.x + side * reach, y: trunkTop.y - h * 0.02 },
          { x: trunkTop.x + side * reach * 1.1, y: trunkTop.y + h * 0.08 },
        ]),
        w * 0.028,
        w * 0.008,
      ),
    );
  }
  doc.add(path(limbs.join(''), tone(bark, -0.2)));
  // Crown dome.
  const r = w * 0.085;
  const dome = fillRegion(
    rng,
    { x: cx - domeRx + r, y: domeCy - domeRy + r * 0.5, w: (domeRx - r) * 2, h: (domeRy - r * 0.5) * 2 },
    r,
    (x, y) => ((x - cx) / (domeRx - r)) ** 2 + ((y - domeCy) / (domeRy - r * 0.5)) ** 2 <= 1,
    { sy: 0.8 },
  );
  if (dome.length < 3) dome.push({ x: cx, y: domeCy, r: domeRx * 0.6, sy: 0.6 });
  canopy(doc, rng, dome, { tones: t, texture: 0.8, underside: 0.5 });
  // Front curtains, thinner in the middle so the trunk shows.
  const front = strands(Math.round(count * 0.8), h * 0.25, h * 0.55, t.mid, 1, 0.35);
  const hiStr = strands(Math.round(count * 0.45), h * 0.15, h * 0.4, t.light, 0.85, 0.3);
  // Volume shading over all strands.
  const silId = doc.shared(back + front + hiStr);
  const clip = doc.clip(use(silId));
  const shade = doc.linear(
    [
      { o: 0, c: t.hi, a: 0.18 },
      { o: 0.45, c: t.hi, a: 0 },
      { o: 1, c: t.deep, a: 0.4 },
    ],
    cx - w * 0.5,
    gy - h,
    cx + w * 0.5,
    gy,
    { user: true },
  );
  doc.add(g(rect(cx - w / 2, gy - h, w, h, shade), { 'clip-path': clip }));
}

function smoothPts(ctrl: Pt[], n = 10): Pt[] {
  // Sample a Catmull-Rom spline through ctrl points into a polyline.
  const out: Pt[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let j = 0; j < n; j++) {
      const t = j / n;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

function pottedTree(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density } = c;
  const bark = c.spec.trunk ?? '#7a6250';
  const ballCy = gy - h * 0.66;
  const ballR = Math.min(w * 0.46, h * 0.33);
  const branches = grow(rng, { x: cx, y: gy + 2 }, -Math.PI / 2 + (rng() - 0.5) * 0.06, gy - ballCy - ballR * 0.2, w * 0.06, {
    depth: 2,
    spread: 0.8,
    decay: 0.5,
    kids: [2, 3],
    up: 0.3,
    curve: 0.2,
  });
  const r = ballR * lerp(0.36, 0.27, density);
  const clumps = fillRegion(
    rng,
    { x: cx - ballR + r, y: ballCy - ballR + r, w: (ballR - r) * 2, h: (ballR - r) * 2 },
    r,
    (x, y) => (x - cx) ** 2 + (y - ballCy) ** 2 <= (ballR - r) ** 2,
  );
  if (clumps.length < 3) clumps.push({ x: cx, y: ballCy, r: ballR * 0.9 });
  backFoliage(c, clumps);
  drawBranches(doc, rng, branches, bark, { lines: false });
  c.potFront();
  const front = clumps.filter((k) => k.y < ballCy + ballR * 0.35 || rng.chance(0.6));
  canopy(doc, rng, front, { tones: c.t, texture: 1 });
  if (c.spec.flower) {
    const fp = new FlowerPainter(flowerTones(c.spec.flower), rng);
    for (const p of surfacePoints(rng, front, Math.round(lerp(10, 20, density)), 0.2, 0.85)) fp.berry(p.x, p.y, w * 0.035);
    doc.add(...fp.render());
  }
}

// ---------------------------------------------------------------------------
// Palms
// ---------------------------------------------------------------------------

interface Frond {
  base: Pt;
  /** Azimuth around the crown (radians); sin < 0 is behind. */
  az: number;
  /** Elevation above horizontal (radians). */
  el: number;
  len: number;
  droop: number;
}

/** Pinnate frond: arching rachis with leaflets drooping on both sides. */
function frondPath(rng: Rng, fr: Frond, leafletLen: number, density: number): { leaf: string; rib: string } {
  const dx = Math.cos(fr.az) * Math.cos(fr.el);
  const up = Math.sin(fr.el) - Math.sin(fr.az) * Math.cos(fr.el) * 0.25;
  const L = fr.len * (0.55 + 0.45 * Math.hypot(dx, up));
  const P = (t: number): Pt => ({ x: fr.base.x + L * dx * t, y: fr.base.y - L * up * t + L * fr.droop * t * t });
  const n = Math.round(lerp(20, 30, density));
  const leaf: string[] = [];
  const ribPts: Pt[] = [];
  for (let i = 0; i <= 12; i++) ribPts.push(P(i / 12));
  for (let i = 1; i <= n; i++) {
    const t = 0.06 + (i / n) * 0.92;
    const p = P(t);
    const q = P(Math.min(1, t + 0.02));
    const tan = Math.atan2(q.y - p.y, q.x - p.x);
    const size = leafletLen * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.7) * (1 - t * 0.35);
    for (const side of [-1, 1]) {
      // Leaflets angle forward and hang under gravity.
      let a = tan + side * rng.range(0.85, 1.15);
      a += (Math.PI / 2 - a) * 0.28;
      leaf.push(leafPath(p, a, size * rng.range(0.85, 1.1), size * 0.16, side * 0.05, fi));
    }
  }
  leaf.push(leafPath(P(0.97), Math.atan2(P(1).y - P(0.95).y, P(1).x - P(0.95).x), leafletLen * 0.5, leafletLen * 0.1, 0, fi));
  return { leaf: leaf.join(''), rib: taper(ribPts, 3.2, 0.8) };
}

function drawFronds(c: PlantCtx, fronds: Frond[], leafletLen: number): void {
  const { doc, rng, t, density } = c;
  const sorted = [...fronds].sort((a, b) => Math.sin(a.az) - Math.sin(b.az));
  for (const fr of sorted) {
    const depth = Math.sin(fr.az);
    const lit = Math.cos(fr.az) * LIGHT.x * -1 < 0 ? 0.15 : 0;
    const fill = depth < -0.35 ? t.dark : depth > 0.45 ? t.light : rng.chance(0.5 + lit) ? t.mid : mix(t.mid, t.light, 0.4);
    const { leaf, rib } = frondPath(rng, fr, leafletLen, density);
    doc.add(path(leaf, fill), path(rib, tone(fill, -0.25)));
    if (depth > -0.35) doc.add(path(leaf, t.deep, { opacity: 0.18, transform: 'translate(1.5 2)' }));
  }
}

function palm(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  if (c.potted) {
    // Clumping palm in a container (areca / parlor / kentia habit).
    const fronds: Frond[] = [];
    const n = Math.round(lerp(8, 12, density));
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2 + rng() * 0.5;
      const baseX = cx + (rng() - 0.5) * c.soilW * 0.4;
      // Canes rising out of the soil before fronds open.
      const cane = h * rng.range(0.15, 0.4);
      const top = { x: baseX + Math.cos(az) * cane * 0.25, y: gy - cane };
      doc.add(path(taper([{ x: baseX, y: gy + 2 }, { x: lerp(baseX, top.x, 0.5), y: lerp(gy, top.y, 0.5) }, top], 5, 3), tone(t.dark, -0.1)));
      fronds.push({ base: top, az, el: rng.range(0.75, 1.25), len: h * rng.range(0.6, 0.8), droop: rng.range(0.55, 0.85) });
    }
    c.potFront();
    drawFronds(c, fronds, w * 0.16);
    return;
  }
  const bark = c.spec.trunk ?? '#8b7a66';
  const lean = (rng() - 0.5) * w * 0.16;
  const crown = { x: cx + lean, y: gy - h * 0.66 };
  const center = smoothPts([{ x: cx, y: gy }, { x: cx + lean * 0.2, y: gy - h * 0.3 }, { x: cx + lean * 0.65, y: gy - h * 0.52 }, crown], 8);
  const tw0 = w * 0.1;
  const tw1 = w * 0.065;
  doc.add(path(taper(center, tw0, tw1, { ease: 0.5 }), barkGradient(doc, bark)));
  // Leaf-scar rings.
  const rings: string[] = [];
  for (let i = 2; i < center.length - 1; i++) {
    const p = center[i];
    const u = i / (center.length - 1);
    const ww = lerp(tw0, tw1, Math.pow(u, 0.5)) * 0.48;
    for (let k = 0; k < 2; k++) {
      const y = p.y + k * 5;
      rings.push(taper([{ x: p.x - ww, y: y - 1 }, { x: p.x, y: y + 2.2 }, { x: p.x + ww, y: y - 1 }], 1.4, 1.1));
    }
  }
  doc.add(path(rings.join(''), tone(bark, -0.4), { opacity: 0.55 }));
  // Fronds: back, sides, then front-drooping.
  const n = Math.round(lerp(11, 15, density));
  const fronds: Frond[] = [];
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + rng() * 0.3;
    const front = Math.sin(az) > 0;
    fronds.push({
      base: { x: crown.x, y: crown.y + 4 },
      az,
      el: front ? rng.range(-0.25, 0.35) : rng.range(0.25, 0.85),
      len: h * rng.range(0.36, 0.44),
      droop: rng.range(0.45, 0.75),
    });
  }
  // Crown shaft / boots.
  doc.add(path(ellipsePath(crown.x, crown.y + 6, tw1 * 0.75, tw1 * 0.6), tone(bark, -0.25)));
  drawFronds(c, fronds, h * 0.12);
  if (c.spec.flower) {
    const fp = new FlowerPainter(flowerTones(c.spec.flower), rng);
    for (let i = 0; i < 4; i++) fp.berry(crown.x + (i - 1.5) * 9 + (rng() - 0.5) * 4, crown.y + 14 + (i % 2) * 6, 7);
    doc.add(...fp.render());
  }
}

// ---------------------------------------------------------------------------
// Grasses, perennials, groundcovers, ferns
// ---------------------------------------------------------------------------

function ornamentalGrass(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const n = Math.round(lerp(55, 95, density));
  const baseHalf = Math.min(c.soilW * 0.45, w * 0.13);
  const foliageH = c.spec.flower ? h * 0.72 : h * 0.95;
  const lay = new Layers([{ fill: t.deep }, { fill: t.dark }, { fill: t.mid }, { fill: t.light }, { fill: t.hi, opacity: 0.9 }]);
  const tonesByDepth = [t.deep, t.dark, t.mid, t.light, t.hi];
  for (let i = 0; i < n; i++) {
    const x0 = cx + (rng() * 2 - 1) * baseHalf;
    const lean = clamp(((x0 - cx) / (baseHalf || 1)) * 0.55 + rng.gauss() * 0.42, -1.35, 1.35);
    const len = foliageH * rng.range(0.6, 1.0) * (1 - Math.abs(lean) * 0.22);
    const dx = Math.sin(lean);
    const droop = 0.12 + Math.abs(dx) * 0.55;
    const pts: Pt[] = [];
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      pts.push({ x: x0 + dx * len * u * 1.05, y: gy - Math.cos(lean) * len * u + droop * len * u * u });
    }
    const depth = rng();
    const tone5 = tonesByDepth[Math.min(4, Math.floor(depth * depth * 5.2))];
    lay.add(tone5, taper(pts, rng.range(3.5, 6.5), 0.2, { fmt: fi }));
  }
  doc.add(path(ellipsePath(cx, gy - 3, baseHalf * 1.3, 6), t.deep, { opacity: 0.8 }));
  doc.add(...lay.render());
  if (c.spec.flower) {
    const ft = flowerTones(c.spec.flower);
    const plume = new Layers([{ fill: ft.shade }, { fill: ft.base }, { fill: ft.light, opacity: 0.9 }]);
    const stalks: string[] = [];
    const m = Math.round(lerp(8, 15, density));
    for (let i = 0; i < m; i++) {
      const x0 = cx + (rng() * 2 - 1) * baseHalf * 0.8;
      const lean = clamp(((x0 - cx) / (baseHalf || 1)) * 0.35 + rng.gauss() * 0.25, -0.75, 0.75);
      const len = h * rng.range(0.82, 0.98);
      const P = (u: number): Pt => ({ x: x0 + Math.sin(lean) * len * u, y: gy - Math.cos(lean) * len * u + Math.abs(Math.sin(lean)) * len * 0.25 * u * u });
      const pts = [0, 0.25, 0.5, 0.75, 1].map(P);
      stalks.push(taper(pts, 2.2, 1));
      // Feathery plume along the top 30%.
      for (let k = 0; k < 14; k++) {
        const u = 0.7 + (k / 13) * 0.3;
        const p = P(u);
        const size = h * 0.07 * Math.sin(Math.PI * clamp((u - 0.68) / 0.34, 0, 1)) + 3;
        const a = -Math.PI / 2 + lean + (rng() - 0.5) * 1.6;
        const which = k % 3 === 0 ? ft.shade : rng.chance(0.4) ? ft.light : ft.base;
        plume.add(which, leafPath(p, a, size, size * 0.45, 0, f), which === ft.light ? 0.9 : 1);
      }
    }
    doc.add(path(stalks.join(''), tone(ft.base, -0.35)));
    doc.add(...plume.render());
  }
}

function floweringPerennial(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const variant = c.spec.seed % 3;
  const moundH = h * 0.42;
  const r = w * 0.1;
  // Upright leaves around the mound edge.
  const leaves = new Layers([{ fill: t.dark }, { fill: t.mid }, { fill: t.light }]);
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI / 2 + (rng() * 2 - 1) * 1.35;
    const len = moundH * rng.range(0.7, 1.15);
    leaves.add(rng.pick([t.dark, t.mid, t.light]), leafPath({ x: cx + (rng() - 0.5) * w * 0.25, y: gy }, a, len, len * 0.22, (rng() - 0.5) * 0.25, fi));
  }
  doc.add(...leaves.render());
  const clumps = domeClumps(rng, cx, gy + r * 0.1, w * 0.4, moundH * 0.62, r, 0.9);
  // Flower stems first (behind the front of the mound).
  const flower = c.spec.flower;
  const stemColor = tone(t.mid, -0.2);
  const fp = flower ? new FlowerPainter(flowerTones(flower), rng) : undefined;
  const stemD: string[] = [];
  const heads: { x: number; y: number; s: number; lean: number }[] = [];
  if (fp) {
    const m = variant === 0 ? Math.round(lerp(14, 22, density)) : variant === 1 ? Math.round(lerp(8, 13, density)) : Math.round(lerp(7, 11, density));
    for (let i = 0; i < m; i++) {
      const x0 = cx + (rng() * 2 - 1) * w * 0.2;
      const lean = ((x0 - cx) / (w * 0.2)) * 0.35 + rng.gauss() * 0.12;
      const top = h * rng.range(variant === 0 ? 0.75 : 0.62, 0.97);
      const end = { x: x0 + Math.sin(lean) * top, y: gy - Math.cos(lean) * top };
      stemD.push(taper([{ x: x0, y: gy - moundH * 0.3 }, { x: lerp(x0, end.x, 0.6) - lean * 4, y: lerp(gy, end.y, 0.6) }, end], 2.4, 1.3));
      heads.push({ x: end.x, y: end.y, s: 1, lean });
    }
    doc.add(path(stemD.join(''), stemColor));
  }
  canopy(doc, rng, clumps, { tones: t, texture: 1, volume: 0.8 });
  if (fp) {
    heads.sort((a, b) => a.y - b.y);
    for (const hd of heads) {
      if (variant === 0) fp.spike(hd.x, hd.y + h * 0.26, h * 0.27, w * 0.022, hd.lean * 0.25);
      else if (variant === 1) fp.daisy(hd.x, hd.y, w * rng.range(0.045, 0.06));
      else fp.cluster(hd.x, hd.y, w * rng.range(0.045, 0.06), 12);
    }
    // A few low blooms on the mound itself.
    if (variant !== 0) for (const p of surfacePoints(rng, clumps, 5, 0.3, 0.8)) fp.blossom(p.x, p.y, w * 0.022);
    doc.add(...fp.render());
  }
}

function groundcover(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const r = h * lerp(0.32, 0.24, density);
  const clumps = domeClumps(rng, cx, gy + r * 0.15, w * 0.49, h * 0.55, r, 0.6, 3.5);
  canopy(doc, rng, clumps, { tones: t, texture: 1.5, lobes: [9, 13], rough: 0.2, speck: 3.2 });
  if (c.spec.flower) {
    const fp = new FlowerPainter(flowerTones(c.spec.flower), rng);
    const pts = surfacePoints(rng, clumps, Math.round(lerp(40, 90, density)), 0.1, 0.9);
    for (const p of pts) fp.star(p.x, p.y, rng.range(3.2, 4.6));
    doc.add(...fp.render());
  }
}

function fern(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const n = Math.round(lerp(12, 20, density));
  type F = { az: number; el: number; len: number; droop: number };
  const fronds: F[] = [];
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + rng() * 0.4;
    fronds.push({ az, el: rng.range(0.55, 1.2), len: Math.min(w * 0.5, h * 1.25) * rng.range(0.8, 1), droop: rng.range(0.45, 0.7) });
  }
  fronds.sort((a, b) => Math.sin(a.az) - Math.sin(b.az));
  let potDrawn = false;
  for (const fr of fronds) {
    const depth = Math.sin(fr.az);
    if (!potDrawn && depth > 0.2) {
      c.potFront();
      potDrawn = true;
    }
    const dx = Math.cos(fr.az) * Math.cos(fr.el);
    const up = Math.sin(fr.el);
    const L = fr.len;
    const base = { x: cx + dx * 4, y: gy - 2 };
    const P = (u: number): Pt => ({ x: base.x + L * dx * u * 1.05, y: base.y - L * up * u * 0.95 + L * fr.droop * u * u });
    const fill = depth < -0.3 ? t.dark : depth > 0.5 ? t.light : rng.chance(0.5) ? t.mid : mix(t.mid, t.light, 0.35);
    const pinnae: string[] = [];
    const m = Math.round(lerp(16, 24, density));
    for (let i = 1; i <= m; i++) {
      const u = 0.08 + (i / m) * 0.9;
      const p = P(u);
      const q = P(Math.min(1, u + 0.02));
      const tan = Math.atan2(q.y - p.y, q.x - p.x);
      const size = L * 0.16 * Math.pow(Math.sin(Math.PI * (0.08 + 0.92 * u)), 0.8) * (1 - u * 0.3) + 2;
      for (const side of [-1, 1]) {
        const a = tan + side * 1.05 + (Math.PI / 2 - (tan + side * 1.05)) * 0.12;
        pinnae.push(leafPath(p, a, size, size * 0.38, side * 0.06, fi));
      }
    }
    const rib = taper([0, 0.2, 0.4, 0.6, 0.8, 1].map(P), 2.4, 0.6);
    doc.add(path(pinnae.join(''), fill), path(rib, tone(fill, -0.3)));
  }
  if (!potDrawn) c.potFront();
  doc.add(path(ellipsePath(cx, gy - 3, w * 0.06, 5), t.deep, { opacity: 0.9 }));
}

// ---------------------------------------------------------------------------
// Succulents
// ---------------------------------------------------------------------------

function succulentRosette(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, density, t } = c;
  const C = { x: cx, y: gy - w * 0.11 };
  const R = w * 0.47;
  const rings = [
    { n: Math.round(lerp(10, 13, density)), L: R, el: 0.16, wf: 0.36 },
    { n: 9, L: R * 0.74, el: 0.48, wf: 0.4 },
    { n: 7, L: R * 0.5, el: 0.85, wf: 0.46 },
    { n: 5, L: R * 0.3, el: 1.15, wf: 0.55 },
  ];
  const tilt = 0.5;
  type Leaf = { depth: number; d: string; mid: string; tipD?: string; fill: string };
  const leaves: Leaf[] = [];
  rings.forEach((ring, ri) => {
    const phase = rng() * Math.PI * 2 + ri * 0.4;
    for (let i = 0; i < ring.n; i++) {
      const az = phase + (i / ring.n) * Math.PI * 2;
      const L = ring.L * rng.range(0.92, 1.05);
      const ce = Math.cos(ring.el);
      const tip = { x: C.x + Math.cos(az) * ce * L, y: C.y + Math.sin(az) * ce * L * tilt - Math.sin(ring.el) * L * 0.86 };
      const len = Math.hypot(tip.x - C.x, tip.y - C.y);
      const ang = Math.atan2(tip.y - C.y, tip.x - C.x);
      const width = L * ring.wf;
      const depth = Math.sin(az) * ce * L;
      const litK = -(Math.cos(az) * LIGHT.x * 0.6) + Math.sin(ring.el) * 0.6 - Math.sin(az) * 0.25;
      const fill = litK > 0.45 ? t.light : litK > 0.05 ? t.mid : litK > -0.3 ? t.dark : tone(t.dark, -0.15);
      const startOff = 0.08 * L;
      const base = { x: C.x + Math.cos(ang) * startOff, y: C.y + Math.sin(ang) * startOff };
      const d = leafPath(base, ang, len, width, 0, f);
      const mid = leafPath(base, ang, len * 0.86, width * 0.3, 0, f);
      const tipD = c.spec.flower ? leafPath({ x: base.x + Math.cos(ang) * len * 0.68, y: base.y + Math.sin(ang) * len * 0.68 }, ang, len * 0.33, width * 0.42, 0, f) : undefined;
      leaves.push({ depth, d, mid, tipD, fill });
    }
  });
  leaves.sort((a, b) => a.depth - b.depth);
  for (const lf of leaves) {
    doc.add(path(lf.d, t.deep, { transform: 'translate(1 2)', opacity: 0.45 }), path(lf.d, lf.fill));
    if (lf.tipD && c.spec.flower) doc.add(path(lf.tipD, c.spec.flower, { opacity: 0.55 }));
    doc.add(path(lf.mid, t.hi, { opacity: 0.28 }));
  }
}

function cactus(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, t } = c;
  const variant = c.spec.seed % 2;
  const spineCol = mix(t.hi, '#fff8e8', 0.6);
  const ribs = new Layers([{ fill: t.deep, opacity: 0.35 }, { fill: t.hi, opacity: 0.35 }]);
  const spines = new Layers([{ fill: spineCol, opacity: 0.85 }]);
  const bodyGrad = (): string =>
    doc.linear(
      [
        { o: 0, c: t.dark },
        { o: 0.25, c: t.light },
        { o: 0.5, c: t.mid },
        { o: 0.85, c: t.dark },
        { o: 1, c: t.deep },
      ],
      0,
      0,
      1,
      0,
    );
  const fp = c.spec.flower ? new FlowerPainter(flowerTones(c.spec.flower), rng) : undefined;
  if (variant === 0) {
    // Columnar cactus with arms.
    const bw = w * 0.3;
    const top = gy - h * 0.97;
    const parts: { center: Pt[]; width: number }[] = [];
    parts.push({ center: [{ x: cx, y: gy + 2 }, { x: cx + 1, y: (gy + top) / 2 }, { x: cx, y: top + bw / 2 }], width: bw });
    const arms = rng.int(1, 2);
    for (let i = 0; i < arms; i++) {
      const side = arms === 1 ? (rng.chance(0.5) ? -1 : 1) : i === 0 ? -1 : 1;
      const y0 = gy - h * rng.range(0.32, 0.5);
      const out = w * rng.range(0.25, 0.32);
      const yTop = y0 - h * rng.range(0.22, 0.32);
      const aw = bw * 0.62;
      const center = smoothPts(
        [
          { x: cx, y: y0 },
          { x: cx + side * out * 0.75, y: y0 + aw * 0.1 },
          { x: cx + side * out, y: y0 - aw * 0.7 },
          { x: cx + side * out, y: yTop + aw / 2 },
        ],
        5,
      );
      parts.push({ center, width: aw });
    }
    // Arms behind body: draw arms first.
    for (const p of [...parts.slice(1), parts[0]]) {
      const d = taper(p.center, p.width, p.width * 0.96, { round: true });
      const cap = p.center[p.center.length - 1];
      const capD = ellipsePath(cap.x, cap.y, p.width / 2, p.width / 2);
      doc.add(path(d + capD, bodyGrad()));
      // Ribs follow the part's centerline.
      for (let k = -2; k <= 2; k++) {
        const off = (k / 2.6) * (p.width / 2);
        const pts = p.center.map((q, i, arr) => {
          const a = arr[Math.max(0, i - 1)];
          const b = arr[Math.min(arr.length - 1, i + 1)];
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          return { x: q.x - ((b.y - a.y) / len) * off, y: q.y + ((b.x - a.x) / len) * off };
        });
        ribs.add(k <= 0 ? t.hi : t.deep, taper(pts, 1.8, 1.2));
        for (let i = 1; i < pts.length; i += 1) spines.add(spineCol, ellipsePath(pts[i].x, pts[i].y, 1, 1));
      }
      doc.add(...ribs.render(), ...spines.render());
      ribs.render().length = 0;
      if (fp) fp.blossom(cap.x + (rng() - 0.5) * 4, cap.y - p.width * 0.35, p.width * 0.22);
      // Reset layers for the next part.
      ribsReset(ribs, spines, t, spineCol);
    }
  } else {
    // Barrel cluster.
    const globes = [
      { x: cx, y: gy, r: w * 0.3 },
      { x: cx - w * 0.3, y: gy, r: w * 0.17 },
      { x: cx + w * 0.29, y: gy, r: w * 0.2 },
    ];
    for (const gl of [globes[1], globes[2], globes[0]]) {
      const ry = gl.r * 1.1;
      const cy = gl.y - ry * 0.98;
      const d = ellipsePath(gl.x, cy, gl.r, ry);
      doc.add(path(d, bodyGrad()));
      const lay = new Layers([{ fill: t.deep, opacity: 0.4 }, { fill: t.hi, opacity: 0.35 }, { fill: spineCol, opacity: 0.85 }]);
      for (let k = -3; k <= 3; k++) {
        const u = k / 3.6;
        const pts: Pt[] = [];
        for (let i = 0; i <= 10; i++) {
          const v = -Math.PI / 2 + (i / 10) * Math.PI;
          pts.push({ x: gl.x + Math.sin(Math.asin(clamp(u, -1, 1))) * Math.cos(v) * gl.r * 0.98, y: cy + Math.sin(v) * ry * 0.96 });
        }
        lay.add(k <= 0 ? t.hi : t.deep, taper(pts, 1.8, 1.2));
        for (let i = 1; i < pts.length - 1; i++) lay.add(spineCol, ellipsePath(pts[i].x, pts[i].y, 1.1, 1.1), 0.85);
      }
      doc.add(...lay.render());
      if (fp) for (let i = 0; i < 3; i++) fp.blossom(gl.x + (i - 1) * gl.r * 0.3, cy - ry * 0.9 + Math.abs(i - 1) * 3, gl.r * 0.16);
    }
  }
  if (fp) doc.add(...fp.render());
}

function ribsReset(ribs: Layers, spines: Layers, t: FoliageTones, spineCol: string): void {
  // Layers are append-only; emulate a reset by swapping internals via a fresh instance.
  Object.assign(ribs, new Layers([{ fill: t.deep, opacity: 0.35 }, { fill: t.hi, opacity: 0.35 }]));
  Object.assign(spines, new Layers([{ fill: spineCol, opacity: 0.85 }]));
}

// ---------------------------------------------------------------------------
// Vines
// ---------------------------------------------------------------------------

function vineTrellis(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const wood = '#e6dfd0';
  const top = gy - h * 0.98;
  const postW = w * 0.05;
  const xl = cx - w * 0.38;
  const xr = cx + w * 0.38;
  const woodV = doc.linear(
    [
      { o: 0, c: tone(wood, 0.3) },
      { o: 0.5, c: wood },
      { o: 1, c: tone(wood, -0.35) },
    ],
    0,
    0,
    1,
    0,
  );
  const woodH = doc.linear(
    [
      { o: 0, c: tone(wood, 0.3) },
      { o: 1, c: tone(wood, -0.3) },
    ],
    0,
    0,
    0,
    1,
  );
  // Lattice slats (behind posts).
  const slatW = w * 0.022;
  const lat: string[] = [];
  for (let i = 1; i < 5; i++) {
    const x = lerp(xl, xr, i / 5);
    lat.push(rect(x - slatW / 2, top + h * 0.06, slatW, gy - top - h * 0.12, woodV));
  }
  const rows = 8;
  for (let i = 1; i < rows; i++) {
    const y = lerp(top + h * 0.06, gy - h * 0.08, i / rows);
    lat.push(rect(xl, y - slatW / 2, xr - xl, slatW, woodH));
  }
  doc.add(...lat);
  // Posts + top cap.
  doc.add(rect(xl - postW / 2, top + 6, postW, gy - top - 5, woodV), rect(xr - postW / 2, top + 6, postW, gy - top - 5, woodV));
  doc.add(rect(xl - postW, top, xr - xl + postW * 2, h * 0.03, woodH, { rx: 2 }));
  // Vines.
  const stemCol = c.spec.trunk ?? tone(t.mid, -0.55);
  const n = Math.round(lerp(3, 5, density));
  const leafLay = new Layers([{ fill: t.deep, opacity: 0.5 }, { fill: t.dark }, { fill: t.mid }, { fill: t.light }]);
  const stemD: string[] = [];
  const flowerPts: Pt[] = [];
  for (let v = 0; v < n; v++) {
    const x0 = cx + (v / Math.max(1, n - 1) - 0.5) * w * 0.35 + (rng() - 0.5) * 10;
    const height = h * rng.range(0.75, 0.97);
    const ctrl: Pt[] = [{ x: x0, y: gy + 1 }];
    const segs = 5;
    for (let k = 1; k <= segs; k++) {
      const u = k / segs;
      ctrl.push({ x: clamp(x0 + Math.sin(u * 5 + v * 2) * w * 0.18 + (rng() - 0.5) * w * 0.1, xl, xr), y: gy - height * u });
    }
    const pts = smoothPts(ctrl, 6);
    stemD.push(taper(pts, 4, 1.2));
    for (let i = 2; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[i - 1];
      const tan = Math.atan2(p.y - q.y, p.x - q.x);
      for (const side of [-1, 1]) {
        if (rng() > lerp(0.6, 0.95, density)) continue;
        const a = tan + side * rng.range(0.7, 1.4);
        const len = rng.range(13, 22);
        const fill = rng.pick([t.dark, t.mid, t.mid, t.light]);
        const base = { x: p.x + rng.range(-2, 2), y: p.y };
        leafLay.add(t.deep, leafPath({ x: base.x + 1.5, y: base.y + 2 }, a, len, len * 0.75, side * 0.1, fi), 0.5);
        leafLay.add(fill, leafPath(base, a, len, len * 0.72, side * 0.1, fi));
      }
      if (rng.chance(0.3)) flowerPts.push({ x: p.x + rng.range(-10, 10), y: p.y + rng.range(-6, 6) });
    }
  }
  doc.add(path(stemD.join(''), stemCol));
  doc.add(...leafLay.render());
  if (c.spec.flower) {
    const fp = new FlowerPainter(flowerTones(c.spec.flower), rng);
    for (const p of flowerPts) fp.star(p.x, p.y, rng.range(6, 9));
    doc.add(...fp.render());
  }
}

// ---------------------------------------------------------------------------
// Houseplants
// ---------------------------------------------------------------------------

function broadLeaf(lay: Layers, rib: string[], t: FoliageTones, rng: Rng, base: Pt, ang: number, len: number, width: number, bend: number): void {
  const fill = rng.pick([t.dark, t.mid, t.mid, t.light]);
  const full = leafPath(base, ang, len, width, bend, f);
  lay.add(t.deep, leafPath({ x: base.x + 2, y: base.y + 3 }, ang, len, width, bend, f), 0.35);
  lay.add(fill, full);
  // Lit half: a narrower leaf offset toward the light.
  const px = -Math.sin(ang);
  const py = Math.cos(ang);
  const sideSign = px * LIGHT.x + py * LIGHT.y > 0 ? 1 : -1;
  const off = width * 0.22 * sideSign;
  lay.add(tone(fill, 0.22), leafPath({ x: base.x + px * off * 0.3, y: base.y + py * off * 0.3 }, ang, len * 0.92, width * 0.5, bend + sideSign * 0.1, f), 0.6);
  const tip = { x: base.x + Math.cos(ang) * len * 0.85, y: base.y + Math.sin(ang) * len * 0.85 };
  const mid = {
    x: (base.x + tip.x) / 2 + px * bend * len * 0.45,
    y: (base.y + tip.y) / 2 + py * bend * len * 0.45,
  };
  rib.push(taper([base, mid, tip], 2.2, 0.4));
}

function houseplantBroadleaf(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const n = Math.round(lerp(8, 13, density));
  const leaves: { base: Pt; ang: number; len: number; width: number; bend: number }[] = [];
  const stemD: string[] = [];
  for (let i = 0; i < n; i++) {
    const side = rng() * 2 - 1;
    const hf = rng.range(0.25, 0.85);
    const end = { x: cx + side * w * 0.25, y: gy - h * hf * 0.78 };
    const x0 = cx + side * c.soilW * 0.15;
    stemD.push(taper([{ x: x0, y: gy + 2 }, { x: lerp(x0, end.x, 0.4), y: lerp(gy, end.y, 0.6) }, end], 4.5, 2.6));
    const ang = -Math.PI / 2 + side * rng.range(0.4, 1.25);
    const len = h * rng.range(0.24, 0.32);
    leaves.push({ base: end, ang, len, width: len * rng.range(0.55, 0.7), bend: (rng() - 0.5) * 0.25 });
  }
  doc.add(path(stemD.join(''), tone(t.mid, -0.45)));
  c.potFront();
  leaves.sort((a, b) => a.base.y - b.base.y);
  for (const lf of leaves) {
    const lay = new Layers();
    const rib: string[] = [];
    broadLeaf(lay, rib, t, rng, lf.base, lf.ang, lf.len, lf.width, lf.bend);
    doc.add(...lay.render(), path(rib.join(''), t.hi, { opacity: 0.45 }));
  }
}

function swordLeaf(base: Pt, ang: number, len: number, width: number, bend: number, fmt = f): string {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const n = 10;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const off = bend * len * u * u;
    const cxp = base.x + dx * len * u - dy * off;
    const cyp = base.y + dy * len * u + dx * off;
    const ww = (width / 2) * (u < 0.12 ? 0.6 + u * 3.3 : 1 - Math.pow((u - 0.12) / 0.88, 2.4));
    left.push({ x: cxp - dy * ww * -1, y: cyp - dx * ww });
    right.push({ x: cxp + dy * ww * -1, y: cyp + dx * ww });
  }
  return smoothOpen(left, fmt) + smoothOpen(right.reverse(), fmt).replace(/^M/, 'L') + 'Z';
}

function houseplantUpright(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const n = Math.round(lerp(7, 11, density));
  const leaves: { x: number; ang: number; len: number; width: number; bend: number; depth: number }[] = [];
  for (let i = 0; i < n; i++) {
    const x = cx + (rng() * 2 - 1) * c.soilW * 0.3;
    const lean = ((x - cx) / (c.soilW * 0.3 || 1)) * 0.22 + rng.gauss() * 0.08;
    leaves.push({ x, ang: -Math.PI / 2 + lean, len: h * rng.range(0.55, 0.98), width: w * rng.range(0.13, 0.18), bend: (rng() - 0.5) * 0.18, depth: rng() });
  }
  leaves.sort((a, b) => a.depth - b.depth);
  for (const lf of leaves) {
    const base = { x: lf.x, y: gy + 4 };
    const fill = lf.depth < 0.3 ? t.dark : lf.depth > 0.75 ? t.light : t.mid;
    if (c.spec.foliage2) {
      doc.add(path(swordLeaf(base, lf.ang, lf.len, lf.width, lf.bend), c.spec.foliage2));
      doc.add(path(swordLeaf(base, lf.ang, lf.len * 0.95, lf.width * 0.72, lf.bend), lf.depth < 0.3 ? t.dark : t.mid));
    } else {
      doc.add(path(swordLeaf(base, lf.ang, lf.len, lf.width, lf.bend), fill));
    }
    // Cross-banding and a lit edge.
    const bands: string[] = [];
    const dx = Math.cos(lf.ang);
    const dy = Math.sin(lf.ang);
    for (let u = 0.12; u < 0.86; u += rng.range(0.05, 0.08)) {
      const off = lf.bend * lf.len * u * u;
      const p = { x: base.x + dx * lf.len * u - dy * off, y: base.y + dy * lf.len * u + dx * off };
      const ww = (lf.width / 2) * (1 - Math.pow((u - 0.12) / 0.88, 2.4)) * 0.8;
      bands.push(taper([{ x: p.x - ww, y: p.y + 2 }, { x: p.x, y: p.y - rng.range(1, 4) }, { x: p.x + ww, y: p.y + 2 }], 2.2, 1.2));
    }
    doc.add(path(bands.join(''), t.deep, { opacity: 0.3 }));
    doc.add(path(swordLeaf({ x: base.x - lf.width * 0.22, y: base.y }, lf.ang, lf.len * 0.9, lf.width * 0.25, lf.bend), t.hi, { opacity: 0.22 }));
  }
}

function heartLeaf(lay: Layers, t: FoliageTones, rng: Rng, p: Pt, ang: number, len: number): void {
  const fill = rng.pick([t.dark, t.mid, t.mid, t.light]);
  lay.add(t.deep, leafPath({ x: p.x + 1.2, y: p.y + 1.8 }, ang, len, len * 0.85, 0, f), 0.4);
  lay.add(fill, leafPath(p, ang, len, len * 0.82, 0, f));
  lay.add(t.hi, leafPath(p, ang - 0.12, len * 0.7, len * 0.3, 0, f), 0.25);
}

function houseplantTrailing(c: PlantCtx): void {
  const { doc, rng, cx, gy, h, density, t } = c;
  const leafLay = new Layers();
  // Mound of leaves on the soil.
  const moundN = Math.round(lerp(18, 30, density));
  for (let i = 0; i < moundN; i++) {
    const u = rng() * 2 - 1;
    const p = { x: cx + u * c.soilW * 0.48, y: gy - h * 0.25 * Math.sqrt(1 - u * u) * rng() };
    heartLeaf(leafLay, t, rng, p, -Math.PI / 2 + u * 1.3 + (rng() - 0.5) * 0.6, rng.range(16, 24));
  }
  doc.add(...leafLay.render());
  c.potFront();
  // Trailing vines spilling over the rim.
  const vines = Math.round(lerp(4, 8, density));
  const stemCol = tone(t.mid, -0.4);
  const vineLay = new Layers();
  const stemD: string[] = [];
  const drop = c.potted ? h * 0.15 + (c.soilW * 0.85) : h * 0.4;
  for (let v = 0; v < vines; v++) {
    const side = v % 2 ? 1 : -1;
    const start = { x: cx + side * c.soilW * rng.range(0.15, 0.5), y: gy - 2 };
    const over = { x: cx + side * (c.soilW * 0.55 + rng.range(2, 10)), y: gy + 6 };
    const len = drop * rng.range(0.55, 1);
    const end = c.potted
      ? { x: over.x + side * rng.range(-6, 16), y: Math.min(gy + len, c.gy + c.soilW * 0.9) }
      : { x: over.x + side * len, y: gy - rng.range(0, 6) };
    const pts = smoothPts([start, over, { x: lerp(over.x, end.x, 0.5) + rng.range(-6, 6), y: lerp(over.y, end.y, 0.5) }, end], 5);
    stemD.push(taper(pts, 2.2, 1));
    for (let i = 2; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[i - 1];
      const tan = Math.atan2(p.y - q.y, p.x - q.x);
      const sideA = i % 2 ? 1 : -1;
      heartLeaf(vineLay, t, rng, p, tan + sideA * 0.9, rng.range(11, 17) * (1 - (i / pts.length) * 0.35));
    }
  }
  doc.add(path(stemD.join(''), stemCol));
  doc.add(...vineLay.render());
}

// ---------------------------------------------------------------------------
// Beds
// ---------------------------------------------------------------------------

function flowerBed(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  // Mulch bed.
  const mulch = '#4a3427';
  const bedRy = h * 0.13;
  doc.add(path(ellipsePath(cx, gy - bedRy, w * 0.495, bedRy), mulch));
  const chips = new Layers([{ fill: tone(mulch, 0.25), opacity: 0.8 }, { fill: tone(mulch, -0.4), opacity: 0.8 }]);
  for (let i = 0; i < 120; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * 0.95;
    const x = cx + Math.cos(a) * w * 0.49 * rr;
    const y = gy - bedRy + Math.sin(a) * bedRy * rr;
    chips.add(rng.chance(0.5) ? tone(mulch, 0.25) : tone(mulch, -0.4), leafPath({ x, y }, rng() * 6.28, rng.range(3, 6), 1.8, 0, fi), 0.8);
  }
  doc.add(...chips.render());
  const r = h * 0.2;
  const clumps: Clump[] = [];
  const rows = [
    { y: gy - h * 0.55, half: w * 0.4, r: r * 1.05 },
    { y: gy - h * 0.38, half: w * 0.44, r },
    { y: gy - h * 0.2, half: w * 0.42, r: r * 0.9 },
  ];
  for (const row of rows) {
    const n = Math.round((row.half * 2) / (row.r * 1.15));
    for (let i = 0; i < n; i++) {
      const x = cx - row.half + ((i + 0.5) / n) * row.half * 2;
      clumps.push({ x: x + (rng() - 0.5) * row.r * 0.4, y: row.y + (rng() - 0.5) * row.r * 0.3, r: row.r * rng.range(0.85, 1.1), sy: 0.8 });
    }
  }
  canopy(doc, rng, clumps, { tones: t, texture: 1.1, volume: 0.7 });
  const flower = c.spec.flower ?? '#e86a8a';
  const fpA = new FlowerPainter(flowerTones(flower), rng);
  const fpB = new FlowerPainter(flowerTones(mix(flower, '#fff6ec', 0.65)), rng);
  const pts = surfacePoints(rng, clumps, Math.round(lerp(45, 85, density)), 0.15, 0.9).sort((a, b) => a.y - b.y);
  for (const p of pts) {
    const back = p.y < gy - h * 0.48;
    const fp = rng.chance(0.25) ? fpB : fpA;
    if (back && rng.chance(0.4)) fp.cluster(p.x, p.y, w * 0.022, 9);
    else fp.blossom(p.x, p.y, w * rng.range(0.012, 0.016));
  }
  doc.add(...fpA.render(), ...fpB.render());
  void leafSpecks;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const DEFS: Record<PlantForm, PlantDef> = {
  'round-shrub': { w: 360, h: 270, pot: { w: 190, h: 150, pw: 300, ph: 220 }, draw: (c) => roundShrub(c) },
  'upright-shrub': { w: 270, h: 360, pot: { w: 180, h: 150, pw: 230, ph: 300 }, draw: uprightShrub },
  'spreading-shrub': { w: 440, h: 200, pot: { w: 200, h: 140, pw: 320, ph: 150 }, draw: spreadingShrub },
  'flowering-shrub': { w: 360, h: 280, pot: { w: 190, h: 150, pw: 300, ph: 230 }, draw: floweringShrub },
  'conical-evergreen': { w: 240, h: 440, pot: { w: 170, h: 150, pw: 200, ph: 340 }, draw: conicalEvergreen },
  columnar: { w: 130, h: 460, pot: { w: 150, h: 140, pw: 110, ph: 360 }, draw: columnar },
  'deciduous-tree': { w: 460, h: 580, draw: deciduousTree },
  'ornamental-tree': { w: 440, h: 380, pot: { w: 200, h: 160, pw: 360, ph: 320 }, draw: ornamentalTree },
  'weeping-tree': { w: 440, h: 470, draw: weepingTree },
  palm: { w: 400, h: 580, pot: { w: 170, h: 150, pw: 360, ph: 360 }, draw: palm },
  'ornamental-grass': { w: 360, h: 320, pot: { w: 170, h: 140, pw: 300, ph: 270 }, draw: ornamentalGrass },
  'flowering-perennial': { w: 300, h: 280, pot: { w: 170, h: 130, pw: 260, ph: 230 }, draw: floweringPerennial },
  groundcover: { w: 420, h: 120, draw: groundcover },
  'succulent-rosette': { w: 260, h: 150, pot: { w: 180, h: 110, pw: 230, ph: 130 }, draw: succulentRosette },
  cactus: { w: 220, h: 340, pot: { w: 150, h: 110, pw: 200, ph: 290 }, draw: cactus },
  fern: { w: 380, h: 240, pot: { w: 160, h: 130, pw: 360, ph: 220 }, draw: fern },
  'vine-trellis': { w: 250, h: 440, draw: vineTrellis },
  hedge: { w: 480, h: 230, draw: hedge },
  'houseplant-broadleaf': { w: 300, h: 330, pot: { w: 160, h: 140, pw: 300, ph: 330 }, draw: houseplantBroadleaf },
  'houseplant-upright': { w: 210, h: 380, pot: { w: 140, h: 130, pw: 210, ph: 360 }, draw: houseplantUpright },
  'houseplant-trailing': { w: 300, h: 150, pot: { w: 170, h: 140, pw: 300, ph: 150 }, draw: houseplantTrailing },
  'potted-tree': { w: 280, h: 420, pot: { w: 180, h: 150, pw: 280, ph: 380 }, draw: pottedTree },
  'flower-bed': { w: 480, h: 170, draw: flowerBed },
};

/** Render a plant spec. `prefix` makes def ids unique per spec. */
export function renderPlant(raw: PlantArt, prefix: string, seed: number): ArtResult {
  const spec = normalizePlant(raw);
  const def = DEFS[spec.form] ?? DEFS['round-shrub'];
  const potted = !!spec.pot && !!def.pot;
  const pw = potted ? (def.pot!.pw ?? def.w) : def.w;
  const ph = potted ? (def.pot!.ph ?? def.h) : def.h;
  const pot = potted ? def.pot! : undefined;
  const padT = 6;
  const padB = 4;
  const W = Math.round(Math.max(pw, (pot?.w ?? 0) + 12));
  const H = Math.round(padT + ph + (pot ? pot.h : 0) + padB);
  const baseY = H - padB;
  const doc = new SvgDoc(W, H, prefix);
  const rng = makeRng(seed);
  const cx = W / 2;
  let geom: PotGeom | undefined;
  let gy = baseY;
  let soilW = pw * 0.3;
  if (pot && spec.pot) {
    geom = { cx, baseY, w: pot.w, h: pot.h };
    potBack(doc, geom, spec.pot);
    gy = potTopY(geom) + potRy(geom) * 0.35;
    soilW = pot.w * 0.86;
  }
  let frontDone = !geom;
  const ctx: PlantCtx = {
    doc,
    rng,
    spec,
    cx,
    gy,
    w: pw,
    h: gy - padT - (geom ? 0 : 0),
    t: foliageTones(spec.foliage, spec.foliage2),
    density: spec.density,
    potted,
    soilW,
    potFront() {
      if (frontDone || !geom || !spec.pot) return;
      frontDone = true;
      potFront(doc, geom, spec.pot);
    },
  };
  // Keep the box height as designed (the pot sits below it).
  ctx.h = ph;
  def.draw(ctx);
  ctx.potFront();
  return { svg: doc.toString(), width: W, height: H, anchorY: baseY / H };
}

// Re-exported for tests / contact sheets.
export { clumpBounds, polygon, scallopBlob };
