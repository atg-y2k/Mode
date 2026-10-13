/**
 * Plant illustrations for every PlantForm. Each form draws into a "plant box"
 * (w × h above the ground/soil point) and optionally sits in a pot.
 *
 * Variants chosen by seed (documented so the catalog can pick them):
 *  - flowering-shrub:      seed % 2 → 0 flower heads (hydrangea, lilac), 1 blossoms (azalea, rose)
 *  - flowering-perennial:  seed % 3 → 0 spikes (lavender, salvia), 1 daisies (coneflower), 2 clusters (phlox, yarrow)
 *  - cactus:               seed % 2 → 0 column with arms (saguaro), 1 barrel cluster
 */
import type { ArtResult, PlantArt, PlantForm } from '../../../shared/art';
import {
  FlowerPainter,
  LIGHT,
  Layers,
  barkGradient,
  canopy,
  drawBranches,
  flowerTones,
  foliageTones,
  grow,
  potBack,
  potFront,
  potRy,
  potTopY,
  scallopBlob,
  shadeVolume,
  speckPath,
  surfacePoints,
  tips,
  type Bounds,
  type Branch,
  type Clump,
  type FoliageTones,
  type PotGeom,
} from './organic';
import { PathW, SvgDoc, ellipsePath, g, leafPath, outputSize, path, rect, smoothClosed, splinePts, taper, use } from './svg';
import { clamp, lerp, makeRng, mix, normHex, tone, type Pt, type Rng } from './util';

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

function optHex(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const h = normHex(v, '');
  return h || undefined;
}

export function normalizePlant(spec: PlantArt): NormPlant {
  const density = typeof spec.density === 'number' && Number.isFinite(spec.density) ? spec.density : 0.7;
  return {
    form: spec.form,
    foliage: normHex(spec.foliage, '#4f7a3a'),
    foliage2: optHex(spec.foliage2),
    flower: optHex(spec.flower),
    trunk: optHex(spec.trunk),
    pot: optHex(spec.pot),
    density: clamp(density, 0, 1),
    seed: typeof spec.seed === 'number' && Number.isFinite(spec.seed) ? Math.abs(Math.trunc(spec.seed)) : 0,
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
  /** Width of exposed soil (pot inner width, or a sensible root spread in the ground). */
  soilW: number;
  /** Draw the pot front now (idempotent; drawn automatically at the end otherwise). */
  potFront(): void;
}

interface PlantDef {
  /** In-ground plant box. */
  w: number;
  h: number;
  /** Pot size and plant box when potted (undefined = never potted). */
  pot?: { w: number; h: number; pw: number; ph: number };
  draw(c: PlantCtx): void;
}

const DEFAULT_BARK = '#6b5444';
/** Max outward reach of a scallop blob relative to its radius (wobble × bumps). */
const BLOB_REACH = 1.35;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Jittered hex grid of clumps covering the region where `inside` is true. */
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
  const rVar = o.rVar ?? 0.2;
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

/**
 * Clumps for a mounded silhouette standing on the ground at gy, fitting in
 * a (2rx × ry) box: round top, fuller (squarer) bottom per `bottomPow`.
 */
function domeClumps(rng: Rng, cx: number, gy: number, rx: number, ry: number, r: number, sy = 1, bottomPow = 2.6): Clump[] {
  const cy = gy - ry / 2 - r * sy * 0.15;
  const ix = Math.max(r * 0.3, rx - r * BLOB_REACH);
  const iy = Math.max(r * sy * 0.3, ry / 2 - r * sy * 1.1);
  const clumps = fillRegion(
    rng,
    { x: cx - ix, y: cy - iy, w: ix * 2, h: iy * 2 },
    r,
    (x, y) => {
      const dx = Math.abs(x - cx) / ix;
      const dy = Math.abs(y - cy) / iy;
      const p = y > cy ? bottomPow : 2;
      return dx ** p + dy ** p <= 1;
    },
    { sy },
  );
  if (clumps.length < 3) clumps.push({ x: cx, y: cy, r: Math.min(rx, ry / 2) * 0.8, sy });
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

/** Cheap background foliage layer (silhouette + one tone) behind branches. */
function backFoliage(c: PlantCtx, clumps: Clump[]): void {
  const { doc, rng, t } = c;
  const sil = clumps.map((k) => scallopBlob(rng, k.x, k.y, k.r * 1.04, k.r * (k.sy ?? 1) * 1.04, rng.int(7, 10), 0.16)).join('');
  doc.add(path(sil, t.deep));
  const inner = clumps
    .map((k) => scallopBlob(rng, k.x + LIGHT.x * k.r * 0.2, k.y + LIGHT.y * k.r * 0.2, k.r * 0.7, k.r * (k.sy ?? 1) * 0.68, rng.int(6, 9), 0.16))
    .join('');
  doc.add(path(inner, t.dark, { opacity: 0.8 }));
}

function flowerPainter(c: PlantCtx, color = c.spec.flower): FlowerPainter | undefined {
  return color ? new FlowerPainter(flowerTones(color), c.rng) : undefined;
}

// ---------------------------------------------------------------------------
// Shrubs
// ---------------------------------------------------------------------------

function roundShrub(c: PlantCtx, flowers?: 'cluster' | 'blossom'): void {
  const { rng, cx, gy, w, h, density } = c;
  const r = w * lerp(0.15, 0.11, density);
  baseStems(c, 4, w * 0.18, h * 0.3);
  const clumps = domeClumps(rng, cx, gy + r * 0.25, w * 0.49, h * 0.98, r);
  canopy(c.doc, rng, clumps, { tones: c.t, texture: lerp(0.8, 1.3, density) });
  const fp = flowers ? flowerPainter(c) : undefined;
  if (fp) {
    const n = flowers === 'cluster' ? Math.round(lerp(18, 30, density)) : Math.round(lerp(30, 60, density));
    const pts = surfacePoints(rng, clumps, n).sort((a, b) => a.y - b.y);
    for (const p of pts) {
      if (flowers === 'cluster') fp.cluster(p.x, p.y, w * rng.range(0.036, 0.048), 16);
      else fp.blossom(p.x, p.y, w * rng.range(0.022, 0.03));
    }
    c.doc.add(...fp.render());
  }
}

function uprightShrub(c: PlantCtx): void {
  const { rng, cx, gy, w, h, density } = c;
  const r = w * lerp(0.17, 0.13, density);
  const sy = 1.15;
  baseStems(c, 5, w * 0.16, h * 0.3);
  const cy = gy - h * 0.55;
  const ix = w * 0.5 - r * BLOB_REACH;
  const iy = h * 0.45 - r * sy * BLOB_REACH;
  const clumps = fillRegion(
    rng,
    { x: cx - ix, y: cy - iy, w: ix * 2, h: iy * 2 },
    r,
    (x, y) => {
      // Vase profile: narrower toward the base.
      const v = (y - cy) / iy;
      const half = ix * Math.sqrt(Math.max(0, 1 - v * v)) * (v > 0.1 ? 1 - (v - 0.1) * 0.45 : 1);
      return Math.abs(x - cx) <= half + r * 0.2;
    },
    { sy },
  );
  canopy(c.doc, rng, clumps, { tones: c.t, texture: lerp(0.8, 1.3, density) });
}

function spreadingShrub(c: PlantCtx): void {
  const { rng, cx, gy, w, h, density } = c;
  const r = h * lerp(0.36, 0.3, density);
  const sy = 0.58;
  // Low mound of overlapping horizontal sprays (juniper, cotoneaster habit).
  const clumps = domeClumps(rng, cx, gy + r * sy * 0.3, w * 0.47, h * 0.95, r, sy, 5);
  for (const side of [-1, 1]) clumps.push({ x: cx + side * (w * 0.5 - r * 1.2), y: gy - r * sy * 0.9, r: r * 0.75, sy: 0.5 });
  canopy(c.doc, rng, clumps, { tones: c.t, lobes: [11, 16], rough: 0.26, texture: 1.2, volume: 0.9 });
}

function floweringShrub(c: PlantCtx): void {
  roundShrub(c, c.spec.flower ? (c.spec.seed % 2 === 0 ? 'cluster' : 'blossom') : undefined);
}

function hedge(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const r = h * lerp(0.2, 0.16, density);
  const sy = 0.9;
  const x0 = cx - w * 0.5 + r * BLOB_REACH;
  const x1 = cx + w * 0.5 - r * BLOB_REACH;
  const top = gy - h + r * sy * BLOB_REACH;
  const bot = gy - r * sy * 0.8;
  const clumps = fillRegion(rng, { x: x0, y: top, w: x1 - x0, h: bot - top }, r, () => true, { step: 0.92, jitter: 0.3, rVar: 0.12, sy });
  const res = canopy(doc, rng, clumps, { tones: t, volume: 0.45, texture: 1.3 });
  const b = res.bounds;
  // Sheared top catches the light; slight left → right falloff.
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
  const base = gy - h * 0.06;
  const hw = w * 0.42;
  doc.add(path(taper([{ x: cx, y: gy }, { x: cx, y: base - h * 0.1 }], w * 0.08, w * 0.05), barkGradient(doc, bark)));
  const tiers = Math.round(lerp(8, 11, density));
  const span = base - top;
  const tierH = (span / tiers) * 1.9;
  const widthAt = (y: number): number => hw * Math.pow(clamp((y - top) / span, 0, 1), 0.9);
  const grad = doc.linear(
    [
      { o: 0, c: t.light },
      { o: 0.4, c: t.mid },
      { o: 0.75, c: t.dark },
      { o: 1, c: tone(t.dark, -0.25) },
    ],
    cx - hw,
    0,
    cx + hw,
    0,
    { user: true },
  );
  const skirts: string[] = [];
  const tufts = new Layers([{ fill: t.light, opacity: 0.7 }, { fill: t.deep, opacity: 0.55 }]);
  for (let i = 0; i < tiers; i++) {
    const k = i / tiers;
    const yb = base - span * k * 0.93 + rng.range(-3, 3);
    const w0 = widthAt(yb);
    const halfL = w0 * rng.range(0.88, 1.12) + 4;
    const halfR = w0 * rng.range(0.88, 1.12) + 4;
    const apexY = yb - tierH * (i === tiers - 1 ? 1.5 : 1.1);
    const droop = tierH * rng.range(0.12, 0.24);
    // Upper outline, then the bottom edge right → left as drooping needle tufts.
    const p = new PathW(0).M(cx - halfL, yb + 4);
    p.Q(cx - halfL * 0.4, apexY + tierH * 0.3, cx + (rng() - 0.5) * 3, apexY);
    p.Q(cx + halfR * 0.4, apexY + tierH * 0.3, cx + halfR, yb + 4);
    p.L(cx + halfR + rng.range(3, 9), yb + droop * 0.6 + rng.range(2, 6));
    const n = Math.max(6, Math.round((halfL + halfR) / 7));
    for (let j = n; j >= 0; j--) {
      const x = cx - halfL + (j / n) * (halfL + halfR);
      const u = (x - cx) / (x < cx ? halfL : halfR);
      p.L(x + rng.range(-2, 2), yb + droop * (1 - u * u) + (j % 2 ? rng.range(3, 9) : rng.range(-2, 2)));
    }
    p.L(cx - halfL - rng.range(3, 9), yb + droop * 0.6 + rng.range(2, 6));
    const d = p.Z().toString();
    skirts.push(d);
    if (i > 0) doc.add(path(d, t.deep, { transform: `translate(${(rng() * 2).toFixed(1)} ${(tierH * 0.18).toFixed(1)})`, opacity: 0.6 }));
    doc.add(path(d, grad));
    // Needle tufts along the lower edge (lit on the left, shaded on the right).
    for (let j = 0; j < Math.round((halfL + halfR) / 9); j++) {
      const x = cx - halfL * 0.95 + rng() * (halfL + halfR) * 0.95;
      const u = (x - cx) / (x < cx ? halfL : halfR);
      const y = yb + droop * (1 - u * u) - rng.range(2, tierH * 0.45);
      const lit = u < 0.15;
      tufts.add(lit ? t.light : t.deep, leafPath({ x, y }, Math.PI / 2 + u * 0.7 + (rng() - 0.5) * 0.5, rng.range(6, 11), 2.4, 0, 1), lit ? 0.7 : 0.55);
    }
  }
  doc.add(...tufts.render());
  const clip = doc.clip(use(doc.shared(skirts.join(''))));
  shadeVolume(doc, clip, { x: cx - hw - 12, y: top - 4, w: hw * 2 + 24, h: base - top + 16 }, t, 0.9, 0.5);
}

function columnar(c: PlantCtx): void {
  const { rng, cx, gy, w, h, density } = c;
  const r = w * lerp(0.3, 0.25, density);
  const sy = 1.3;
  const top = gy - h + r * sy * 0.9;
  const maxHalf = w * 0.5 - r * BLOB_REACH;
  // Spindle: slightly narrower base, fullest near 30 %, tapering to a point.
  const profile = (u: number): number => (u < 0.3 ? lerp(0.8, 1, u / 0.3) : Math.pow(Math.cos(((u - 0.3) / 0.7) * (Math.PI / 2)), 0.75));
  const clumps: Clump[] = [];
  const step = r * sy * 0.7;
  for (let y = gy - r * sy * 0.8; y > top; y -= step) {
    const u = clamp((gy - y) / (gy - top), 0, 1);
    const half = Math.max(0, maxHalf * profile(u));
    const n = half < r * 0.5 ? 1 : 2 + (half > r * 1.2 ? 1 : 0);
    const scale = u > 0.75 ? lerp(1, 0.55, (u - 0.75) / 0.25) : 1;
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? cx : cx - half + (i / (n - 1)) * half * 2;
      clumps.push({ x: x + (rng() - 0.5) * r * 0.25, y: y + (rng() - 0.5) * step * 0.3, r: r * rng.range(0.85, 1.05) * scale, sy });
    }
  }
  clumps.push({ x: cx, y: top, r: r * 0.45, sy: 1.6 });
  canopy(c.doc, rng, clumps, { tones: c.t, lobes: [7, 10], rough: 0.2, texture: 1.1 });
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

function deciduousTree(c: PlantCtx): void {
  const { rng, cx, gy, w, h, density } = c;
  const bark = c.spec.trunk ?? DEFAULT_BARK;
  const branches = grow(rng, { x: cx, y: gy }, -Math.PI / 2 + (rng() - 0.5) * 0.08, h * 0.34, w * 0.08, {
    depth: 3,
    spread: 0.85,
    decay: 0.62,
    kids: [2, 3],
    up: 0.3,
    curve: 0.14,
  });
  // Root flare.
  c.doc.add(path(taper([{ x: cx, y: gy + 1 }, { x: cx, y: gy - h * 0.06 }], w * 0.13, w * 0.08, { ease: 0.5 }), tone(bark, -0.05)));
  const crownCy = gy - h * 0.6;
  const r = w * lerp(0.135, 0.11, density);
  const ix = w * 0.5 - r * BLOB_REACH;
  const iy = h * 0.4 - r * BLOB_REACH;
  const clumps = fillRegion(rng, { x: cx - ix, y: crownCy - iy, w: ix * 2, h: iy * 2 }, r, (x, y) => ((x - cx) / ix) ** 2 + ((y - crownCy) / iy) ** 2 <= 1);
  for (const p of tips(branches, 3)) {
    if (((p.x - cx) / ix) ** 2 + ((p.y - crownCy) / iy) ** 2 < 1) clumps.push({ x: p.x, y: p.y, r: r * rng.range(0.85, 1.1) });
  }
  backFoliage(c, clumps);
  drawBranches(c.doc, rng, branches, bark);
  // Leave an opening low in the crown so the main fork reads through.
  const holeY = crownCy + iy * 0.6;
  const front = clumps.filter((k) => ((k.x - cx) / (ix * 0.45)) ** 2 + ((k.y - holeY) / (iy * 0.45)) ** 2 > 1 || rng.chance(0.15));
  canopy(c.doc, rng, front, { tones: c.t, texture: 0.9 });
  const fp = flowerPainter(c);
  if (fp) {
    for (const p of surfacePoints(rng, front, Math.round(lerp(40, 80, density)))) fp.blossom(p.x, p.y, w * 0.014);
    c.doc.add(...fp.render());
  }
}

function ornamentalTree(c: PlantCtx): void {
  const { rng, cx, gy, w, h, density } = c;
  const bark = c.spec.trunk ?? '#5a4a42';
  const stems = rng.int(2, 3);
  const branches: Branch[] = [];
  for (let i = 0; i < stems; i++) {
    const side = (i / (stems - 1)) * 2 - 1;
    branches.push(
      ...grow(rng, { x: cx + side * w * 0.015, y: gy }, -Math.PI / 2 + side * 0.32 + (rng() - 0.5) * 0.1, h * 0.26, w * 0.045, {
        depth: 2,
        spread: 0.95,
        decay: 0.68,
        kids: [2, 3],
        up: 0.12,
        curve: 0.25,
      }),
    );
  }
  const r = w * lerp(0.11, 0.09, density);
  const sy = 0.62;
  // Layered, flattened tiers (Japanese maple / dogwood habit), slightly domed.
  const tiers = [
    { y: gy - h * 0.4, half: w * 0.5 - r * BLOB_REACH },
    { y: gy - h * 0.56, half: w * 0.45 - r * BLOB_REACH },
    { y: gy - h * 0.71, half: w * 0.36 - r * BLOB_REACH },
    { y: gy - h * 0.84, half: w * 0.22 - r },
  ];
  const clumps: Clump[] = [];
  tiers.forEach((tier, ti) => {
    const n = Math.max(2, Math.round((tier.half * 2) / (r * 0.85)) + 1);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const arch = Math.sin(u * Math.PI) * r * 0.35;
      clumps.push({
        x: cx - tier.half + u * tier.half * 2 + (rng() - 0.5) * r * 0.4,
        y: tier.y - arch + (rng() - 0.5) * r * 0.35,
        r: r * rng.range(0.9, 1.15) * (ti === 3 ? 0.9 : 1),
        sy,
      });
    }
  });
  clumps.push({ x: cx + (rng() - 0.5) * w * 0.05, y: gy - h + r * sy * 1.6, r: r * 0.85, sy });
  backFoliage(c, clumps);
  drawBranches(c.doc, rng, branches, bark, { lines: false });
  c.potFront();
  // Bottom tier first so upper tiers overlap (layered look); a few gaps let branches read.
  const ordered = [...clumps].sort((a, b) => b.y - a.y).filter(() => rng.chance(0.9));
  canopy(c.doc, rng, ordered, { tones: c.t, sort: false, texture: 1 });
  const fp = flowerPainter(c);
  if (fp) {
    for (const p of surfacePoints(rng, ordered, Math.round(lerp(50, 100, density)), 0.15, 0.95)) fp.blossom(p.x, p.y, w * rng.range(0.012, 0.016));
    c.doc.add(...fp.render());
  }
}

function weepingTree(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const bark = c.spec.trunk ?? DEFAULT_BARK;
  const span = w * 0.47;
  const crownTop = gy - h * 0.93;
  // Umbrella-shaped top outline.
  const topAt = (x: number): number => {
    const u = clamp((x - cx) / span, -1, 1);
    return crownTop + (1 - Math.sqrt(1 - u * u * 0.96)) * h * 0.3;
  };
  /** A hanging tongue of foliage: tapers downward, leafy ragged edges and a fringed tip. */
  const tongue = (xc: number, width: number, len: number): string => {
    const y0 = topAt(xc) + 10;
    const flare = ((xc - cx) / span) * w * 0.05;
    const n = Math.max(4, Math.round(len / 9));
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = xc + flare * u * u;
      const half = (width / 2) * (1 - 0.5 * u);
      const jag = i % 2 ? rng.range(1.5, 4) : -rng.range(0.5, 2);
      left.push({ x: x - half - jag, y: y0 + len * u });
      right.push({ x: x + half + jag, y: y0 + len * u + 2 });
    }
    // Fringed tip from the left edge's end toward the right edge's end.
    const tips: Pt[] = [];
    const k = Math.max(2, Math.round(width / 12));
    for (let j = 1; j < k; j++) {
      tips.push({ x: lerp(left[n].x, right[n].x, j / k), y: y0 + len + (j % 2 ? rng.range(6, 18) : rng.range(-4, 2)) });
    }
    return smoothClosed([...left, ...tips, ...right.reverse()], 0);
  };
  const tongues = (count: number, wMin: number, wMax: number, lenMin: number, lenMax: number, avoidCenter = 0): string => {
    const ds: string[] = [];
    for (let i = 0; i < count; i++) {
      let xc = cx - span * 0.92 + ((i + rng.range(0.1, 0.9)) / count) * span * 1.84;
      if (avoidCenter && Math.abs(xc - cx) < span * avoidCenter) xc = cx + (xc < cx ? -1 : 1) * span * rng.range(avoidCenter, avoidCenter + 0.2);
      const edge = Math.abs(xc - cx) / span;
      const maxLen = gy - h * 0.04 - (topAt(xc) + 10);
      ds.push(tongue(xc, rng.range(wMin, wMax), clamp(lerp(lenMin, lenMax, rng()) * (0.8 + edge * 0.3), 30, maxLen)));
    }
    return ds.join('');
  };
  const n0 = Math.round(lerp(9, 13, density));
  const backD = tongues(n0, w * 0.1, w * 0.17, h * 0.55, h * 0.8);
  doc.add(path(backD, t.deep));
  const midD = [tongues(Math.round(n0 * 0.9), w * 0.08, w * 0.14, h * 0.45, h * 0.72)];
  doc.add(path(midD[0], t.dark));
  // Trunk and arching limbs (visible through the open middle).
  const trunkTop = { x: cx + (rng() - 0.5) * w * 0.04, y: crownTop + h * 0.2 };
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
    const reach = w * rng.range(0.2, 0.34);
    const ctrl = [
      trunkTop,
      { x: trunkTop.x + side * reach * 0.4, y: trunkTop.y - h * rng.range(0.07, 0.11) },
      { x: trunkTop.x + side * reach, y: trunkTop.y - h * 0.02 },
      { x: trunkTop.x + side * reach * 1.1, y: trunkTop.y + h * 0.1 },
    ];
    limbs.push(taper(splinePts(ctrl), w * 0.026, w * 0.008));
  }
  doc.add(path(limbs.join(''), tone(bark, -0.2)));
  // Front tongues, leaving the middle open so the trunk reads.
  const frontD = [tongues(Math.round(n0 * 0.8), w * 0.08, w * 0.13, h * 0.4, h * 0.68, 0.22)];
  doc.add(path(frontD[0], t.mid));
  const hiD = [tongues(Math.round(n0 * 0.5), w * 0.05, w * 0.09, h * 0.2, h * 0.45, 0.3)];
  doc.add(path(hiD[0], t.light, { opacity: 0.85 }));
  const allD = backD + midD.join('') + frontD.join('') + hiD.join('');
  const clip = doc.clip(use(doc.shared(allD)));
  // Hanging strand lines + streaky leaf texture, clipped to the veils.
  const lay = new Layers([{ fill: t.deep, opacity: 0.35 }, { fill: t.hi, opacity: 0.55 }]);
  for (let i = 0; i < Math.round(lerp(16, 26, density)); i++) {
    const x = cx - span + rng() * span * 2;
    const y0 = topAt(x) + 12;
    const len = (gy - y0) * rng.range(0.5, 0.9);
    const pts = [0, 0.33, 0.66, 1].map((u) => ({ x: x + Math.sin(u * 3 + i) * 2 + ((x - cx) / span) * 5 * u, y: y0 + len * u }));
    lay.add(rng.chance(0.6) ? t.deep : t.hi, taper(pts, 1.6, 0.8), 0.35);
  }
  for (let i = 0; i < Math.round(lerp(150, 240, density)); i++) {
    const x = cx - span + rng() * span * 2;
    const y = lerp(topAt(x) + 12, gy - h * 0.06, rng());
    const lit = x < cx + (rng() - 0.3) * w * 0.4;
    lay.add(lit ? t.hi : t.deep, speckPath(x, y, Math.PI / 2 + (rng() - 0.5) * 0.4, rng.range(6, 11), 1.3), lit ? 0.55 : 0.35);
  }
  doc.add(g(lay.render(), { 'clip-path': clip }));
  shadeVolume(doc, clip, { x: cx - w / 2, y: crownTop, w, h: gy - crownTop }, t, 0.8, 0.7);
  // Umbrella crown of clumps along the top.
  const r = w * 0.075;
  const clumps: Clump[] = [];
  for (let row = 0; row < 2; row++) {
    const n = Math.round((span * 2 * (row ? 0.75 : 0.95)) / (r * 0.95));
    for (let i = 0; i < n; i++) {
      const x = cx - span * (row ? 0.75 : 0.95) + ((i + 0.5) / n) * span * 2 * (row ? 0.75 : 0.95);
      clumps.push({ x: x + rng.range(-4, 4), y: topAt(x) + r * (row ? 1.6 : 0.85) + rng.range(-3, 3), r: r * rng.range(0.85, 1.1), sy: 0.8 });
    }
  }
  canopy(doc, rng, clumps, { tones: t, texture: 0.8, underside: 0.3, volume: 0.8 });
}

function pottedTree(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density } = c;
  const bark = c.spec.trunk ?? '#7a6250';
  const ballR = Math.min(w * 0.46, h * 0.32);
  const ballCy = gy - h + ballR * 1.05;
  const trunkLen = gy - ballCy - ballR * 0.2;
  const branches = grow(rng, { x: cx, y: gy + 2 }, -Math.PI / 2 + (rng() - 0.5) * 0.06, trunkLen, w * 0.055, {
    depth: 2,
    spread: 0.8,
    decay: (ballR * 0.42) / trunkLen,
    kids: [2, 3],
    up: 0.3,
    curve: 0.2,
  });
  const r = ballR * lerp(0.38, 0.3, density);
  const ir = ballR - r * BLOB_REACH * 0.85;
  const clumps = fillRegion(rng, { x: cx - ir, y: ballCy - ir, w: ir * 2, h: ir * 2 }, r, (x, y) => (x - cx) ** 2 + (y - ballCy) ** 2 <= ir * ir);
  if (clumps.length < 3) clumps.push({ x: cx, y: ballCy, r: ballR * 0.8 });
  backFoliage(c, clumps);
  drawBranches(doc, rng, branches, bark, { lines: false });
  c.potFront();
  const front = clumps.filter((k) => k.y < ballCy + ballR * 0.35 || rng.chance(0.6));
  canopy(doc, rng, front, { tones: c.t, texture: 1 });
  const fp = flowerPainter(c);
  if (fp) {
    for (const p of surfacePoints(rng, front, Math.round(lerp(10, 20, density)), 0.2, 0.85)) fp.berry(p.x, p.y, w * 0.032);
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

/** Pinnate frond: arching rachis with leaflets hanging on both sides. */
function frondPath(rng: Rng, fr: Frond, leafletLen0: number, density: number, maxReach: number): { leaf: string; rib: string } {
  const dx = Math.cos(fr.az) * Math.cos(fr.el);
  const up = Math.sin(fr.el) - Math.sin(fr.az) * Math.cos(fr.el) * 0.25;
  let L = fr.len * (0.55 + 0.45 * Math.hypot(dx, up));
  let leafletLen = leafletLen0;
  // Shorten the frond (keeping its direction) so leaflet tips stay inside the canvas.
  const reach = Math.abs(dx) * L + leafletLen * 0.9;
  if (reach > maxReach) {
    const k = Math.max(0.3, maxReach / reach);
    L *= k;
    leafletLen *= k;
  }
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
      leaf.push(leafPath(p, a, size * rng.range(0.85, 1.1), size * 0.16, side * 0.05, 0));
    }
  }
  const e = P(1);
  const s = P(0.95);
  leaf.push(leafPath(P(0.97), Math.atan2(e.y - s.y, e.x - s.x), leafletLen * 0.5, leafletLen * 0.1, 0, 0));
  return { leaf: leaf.join(''), rib: taper(ribPts, 3.2, 0.8) };
}

function drawFronds(c: PlantCtx, fronds: Frond[], leafletLen: number): void {
  const { doc, rng, t, density } = c;
  const sorted = [...fronds].sort((a, b) => Math.sin(a.az) - Math.sin(b.az));
  for (const fr of sorted) {
    const depth = Math.sin(fr.az);
    const fill = depth < -0.35 ? t.dark : depth > 0.45 ? t.leaf : Math.cos(fr.az) < 0 ? mix(t.mid, t.leaf, 0.6) : t.mid;
    const maxReach = Math.min(fr.base.x, c.doc.w - fr.base.x) - 4;
    const { leaf, rib } = frondPath(rng, fr, leafletLen, density, maxReach);
    if (depth > -0.35) doc.add(path(leaf, t.deep, { opacity: 0.2, transform: 'translate(1.5 2.5)' }));
    doc.add(path(leaf, fill), path(rib, tone(fill, -0.25)));
  }
}

function palm(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  if (c.potted) {
    // Clumping palm in a container (areca / parlor / kentia habit).
    const fronds: Frond[] = [];
    const n = Math.round(lerp(8, 12, density));
    const canes: string[] = [];
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2 + rng() * 0.5;
      const baseX = cx + (rng() - 0.5) * c.soilW * 0.4;
      const cane = h * rng.range(0.12, 0.35);
      const top = { x: baseX + Math.cos(az) * cane * 0.25, y: gy - cane };
      canes.push(taper([{ x: baseX, y: gy + 2 }, { x: lerp(baseX, top.x, 0.5), y: lerp(gy, top.y, 0.5) }, top], 5, 3));
      fronds.push({ base: top, az, el: rng.range(0.8, 1.25), len: h * rng.range(0.62, 0.8), droop: rng.range(0.55, 0.85) });
    }
    doc.add(path(canes.join(''), tone(t.dark, -0.1)));
    c.potFront();
    drawFronds(c, fronds, w * 0.15);
    return;
  }
  const bark = c.spec.trunk ?? '#8b7a66';
  const lean = (rng() - 0.5) * w * 0.14;
  const crown = { x: cx + lean, y: gy - h * 0.63 };
  const center = splinePts([{ x: cx, y: gy }, { x: cx + lean * 0.2, y: gy - h * 0.3 }, { x: cx + lean * 0.65, y: gy - h * 0.5 }, crown], 8);
  const tw0 = w * 0.095;
  const tw1 = w * 0.06;
  doc.add(path(taper(center, tw0, tw1, { ease: 0.5 }), barkGradient(doc, bark)));
  // Leaf-scar rings.
  const rings: string[] = [];
  for (let i = 2; i < center.length - 1; i++) {
    const p = center[i];
    const ww = lerp(tw0, tw1, Math.pow(i / (center.length - 1), 0.5)) * 0.48;
    for (let k = 0; k < 2; k++) {
      const y = p.y + k * 5;
      rings.push(taper([{ x: p.x - ww, y: y - 1 }, { x: p.x, y: y + 2.2 }, { x: p.x + ww, y: y - 1 }], 1.4, 1.1));
    }
  }
  doc.add(path(rings.join(''), tone(bark, -0.4), { opacity: 0.5 }));
  doc.add(path(ellipsePath(crown.x, crown.y + 6, tw1 * 0.8, tw1 * 0.65), tone(bark, -0.25)));
  const fp = flowerPainter(c);
  if (fp) {
    // Hanging fruit bunch (dates / coconuts).
    for (let i = 0; i < 7; i++) fp.berry(crown.x - 6 + (i % 3) * 7 + rng.range(-2, 2), crown.y + 12 + Math.floor(i / 3) * 7, 5);
    doc.add(...fp.render());
  }
  const n = Math.round(lerp(11, 15, density));
  const fronds: Frond[] = [];
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + rng() * 0.3;
    const front = Math.sin(az) > 0;
    fronds.push({
      base: { x: crown.x, y: crown.y + 4 },
      az,
      el: front ? rng.range(-0.2, 0.35) : rng.range(0.3, 0.9),
      len: h * rng.range(0.4, 0.48),
      droop: rng.range(0.45, 0.72),
    });
  }
  drawFronds(c, fronds, h * 0.13);
}

// ---------------------------------------------------------------------------
// Grasses, perennials, groundcovers, ferns
// ---------------------------------------------------------------------------

function ornamentalGrass(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const n = Math.round(lerp(80, 130, density));
  const baseHalf = Math.min(c.soilW * 0.4, w * 0.12);
  const foliageH = c.spec.flower ? h * 0.7 : h * 0.97;
  const tonesByDepth = [t.deep, t.dark, t.mid, t.light, t.hi];
  const lay = new Layers(tonesByDepth.map((fill) => ({ fill })));
  for (let i = 0; i < n; i++) {
    const x0 = cx + (rng() * 2 - 1) * baseHalf;
    const lean = clamp(((x0 - cx) / (baseHalf || 1)) * 0.5 + rng.gauss() * 0.45, -1.4, 1.4);
    const len = foliageH * rng.range(0.6, 1.0) * (1 - Math.abs(lean) * 0.2);
    const dx = Math.sin(lean);
    const droop = 0.1 + Math.abs(dx) * 0.6;
    const pts: Pt[] = [];
    for (let k = 0; k <= 6; k++) {
      const u = k / 6;
      pts.push({ x: x0 + dx * len * u * 1.05, y: gy - Math.cos(lean) * len * u + droop * len * u * u });
    }
    const depth = rng();
    lay.add(tonesByDepth[Math.min(4, Math.floor(depth * depth * 5.2))], taper(pts, rng.range(3, 5.5), 0.2, { dec: 0 }));
  }
  doc.add(path(ellipsePath(cx, gy - 3, baseHalf * 1.4, 6), t.deep, { opacity: 0.85 }));
  doc.add(...lay.render());
  if (!c.spec.flower) return;
  const ft = flowerTones(c.spec.flower);
  const plume = new Layers([{ fill: ft.shade, opacity: 0.9 }, { fill: ft.base, opacity: 0.9 }, { fill: ft.light, opacity: 0.85 }]);
  const stalks: string[] = [];
  const m = Math.round(lerp(9, 16, density));
  for (let i = 0; i < m; i++) {
    const x0 = cx + (rng() * 2 - 1) * baseHalf * 0.8;
    const lean = clamp(((x0 - cx) / (baseHalf || 1)) * 0.35 + rng.gauss() * 0.22, -0.7, 0.7);
    const len = h * rng.range(0.8, 0.97);
    const P = (u: number): Pt => ({ x: x0 + Math.sin(lean) * len * u, y: gy - Math.cos(lean) * len * u + Math.abs(Math.sin(lean)) * len * 0.22 * u * u });
    stalks.push(taper([0, 0.25, 0.5, 0.75, 1].map(P), 2, 0.9));
    // Feathery plume: many fine strands along the top 28 % of the stalk.
    for (let k = 0; k < 18; k++) {
      const u = 0.72 + (k / 17) * 0.28;
      const p = P(u);
      const q = P(Math.min(1, u + 0.02));
      const dir = Math.atan2(q.y - p.y, q.x - p.x);
      const size = h * 0.06 * Math.sin(Math.PI * clamp((u - 0.7) / 0.32, 0.08, 1)) + 3;
      for (const side of [-1, 1]) {
        const lit = side < 0 ? rng.chance(0.6) : rng.chance(0.15);
        const fill = lit ? ft.light : k % 3 === 0 ? ft.shade : ft.base;
        plume.add(fill, leafPath(p, dir + side * rng.range(0.15, 0.45), size, size * 0.28, side * 0.1, 1), lit ? 0.85 : 0.9);
      }
    }
  }
  doc.add(path(stalks.join(''), mix(tone(ft.base, -0.3), t.dark, 0.55)));
  doc.add(...plume.render());
}

function floweringPerennial(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const variant = c.spec.seed % 3;
  const moundH = h * 0.36;
  // Flower stems first (they rise from inside the mound).
  const fp = flowerPainter(c);
  const heads: { x: number; y: number; lean: number }[] = [];
  if (fp) {
    const m = variant === 0 ? Math.round(lerp(16, 26, density)) : variant === 1 ? Math.round(lerp(9, 14, density)) : Math.round(lerp(8, 13, density));
    const stemD: string[] = [];
    for (let i = 0; i < m; i++) {
      const x0 = cx + (rng() * 2 - 1) * w * 0.18;
      const lean = ((x0 - cx) / (w * 0.18)) * 0.38 + rng.gauss() * 0.12;
      const top = h * rng.range(variant === 0 ? 0.72 : 0.6, 0.96) - (variant === 0 ? 0 : w * 0.05);
      const end = { x: x0 + Math.sin(lean) * top, y: gy - Math.cos(lean) * top };
      stemD.push(taper([{ x: x0, y: gy - moundH * 0.3 }, { x: lerp(x0, end.x, 0.6) - lean * 4, y: lerp(gy, end.y, 0.6) }, end], 2.4, 1.3));
      heads.push({ x: end.x, y: end.y, lean });
    }
    doc.add(path(stemD.join(''), tone(t.mid, -0.25)));
  }
  // Basal foliage: strap leaves around a low mound.
  const leaves = new Layers([{ fill: t.dark }, { fill: t.mid }, { fill: t.light }]);
  for (let i = 0; i < 22; i++) {
    const a = -Math.PI / 2 + (rng() * 2 - 1) * 1.0;
    const len = moundH * rng.range(0.75, 1.15);
    const fill = Math.cos(a) < -0.2 ? t.light : rng.chance(0.5) ? t.mid : t.dark;
    leaves.add(fill, leafPath({ x: cx + (rng() - 0.5) * w * 0.2, y: gy }, a, len, len * 0.24, (rng() - 0.5) * 0.3, 0));
  }
  doc.add(...leaves.render());
  const r = w * 0.085;
  const clumps = domeClumps(rng, cx, gy + r * 0.2, w * 0.42, moundH * 1.15, r, 0.85);
  canopy(doc, rng, clumps, { tones: t, texture: 1, volume: 0.8 });
  if (fp) {
    heads.sort((a, b) => a.y - b.y);
    for (const hd of heads) {
      if (variant === 0) fp.spike(hd.x, hd.y + h * 0.26, h * 0.27, w * 0.02, hd.lean * 0.25);
      else if (variant === 1) fp.daisy(hd.x, hd.y, w * rng.range(0.042, 0.055));
      else fp.cluster(hd.x, hd.y, w * rng.range(0.034, 0.044), 16, 0.7);
    }
    if (variant !== 0) for (const p of surfacePoints(rng, clumps, 6, 0.3, 0.8)) fp.blossom(p.x, p.y, w * 0.02);
    doc.add(...fp.render());
  }
}

function groundcover(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const r = h * lerp(0.42, 0.34, density);
  const clumps = domeClumps(rng, cx, gy + r * 0.2, w * 0.5, h * 1.05, r, 0.5, 6);
  canopy(doc, rng, clumps, { tones: t, texture: 1.2, lobes: [10, 14], rough: 0.2, speck: 3, volume: 0.8 });
  const fp = flowerPainter(c);
  if (fp) {
    for (const p of surfacePoints(rng, clumps, Math.round(lerp(40, 80, density)), 0.1, 0.85)) fp.star(p.x, p.y, rng.range(3, 4.4));
    doc.add(...fp.render());
  }
}

/**
 * Arching frond centerline: starts at elevation `el` and bends over as it
 * grows (angle decreases along the length), like a fern or grass blade.
 * `dirX` scales the horizontal component (cos of azimuth: sign + foreshortening).
 */
function archPts(base: Pt, dirX: number, el: number, len: number, bendOver: number, steps = 12): Pt[] {
  const pts: Pt[] = [{ x: base.x, y: base.y }];
  let x = base.x;
  let y = base.y;
  const ds = len / steps;
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) / steps;
    const th = el - bendOver * Math.pow(u, 1.4);
    x += Math.cos(th) * dirX * ds;
    y -= Math.sin(th) * ds;
    pts.push({ x, y });
  }
  return pts;
}

function fern(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const n = Math.round(lerp(14, 22, density));
  const fronds: { az: number; el: number; len: number; bend: number }[] = [];
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + rng() * 0.4;
    const front = Math.sin(az);
    fronds.push({ az, el: rng.range(1.05, 1.45) - Math.max(0, front) * 0.35, len: h * rng.range(0.85, 1.05), bend: rng.range(1.7, 2.3) });
  }
  fronds.sort((a, b) => Math.sin(a.az) - Math.sin(b.az));
  let potDrawn = false;
  for (const fr of fronds) {
    const depth = Math.sin(fr.az);
    if (!potDrawn && depth > 0.2) {
      c.potFront();
      potDrawn = true;
    }
    const dirX = Math.cos(fr.az) * 1.15;
    const base = { x: cx + Math.cos(fr.az) * 4, y: gy - 2 };
    const pts = archPts(base, dirX, fr.el, fr.len * (0.75 + 0.25 * Math.abs(Math.cos(fr.az))), fr.bend);
    // Keep the frond inside the canvas horizontally.
    const maxDx = Math.max(...pts.map((p) => Math.abs(p.x - cx)));
    const sx = maxDx > w * 0.48 ? (w * 0.48) / maxDx : 1;
    for (const p of pts) p.x = cx + (p.x - cx) * sx;
    const fill = depth < -0.3 ? t.dark : depth > 0.5 ? t.leaf : Math.cos(fr.az) < 0 ? mix(t.mid, t.leaf, 0.6) : t.mid;
    const pinnae: string[] = [];
    const L = fr.len;
    const m = Math.round(lerp(16, 24, density));
    const last = pts.length - 1;
    for (let i = 1; i <= m; i++) {
      const u = 0.1 + (i / m) * 0.88;
      const fi = u * last;
      const i0 = Math.min(last - 1, Math.floor(fi));
      const k = fi - i0;
      const p = { x: lerp(pts[i0].x, pts[i0 + 1].x, k), y: lerp(pts[i0].y, pts[i0 + 1].y, k) };
      const tan = Math.atan2(pts[i0 + 1].y - pts[i0].y, pts[i0 + 1].x - pts[i0].x);
      const size = L * 0.14 * Math.pow(Math.sin(Math.PI * (0.1 + 0.9 * u)), 0.8) * (1 - u * 0.3) + 2;
      for (const side of [-1, 1]) {
        const a = tan + side * 1.05;
        pinnae.push(leafPath(p, a + (Math.PI / 2 - a) * 0.12, size, size * 0.36, side * 0.06, 0));
      }
    }
    doc.add(path(pinnae.join(''), fill), path(taper(pts, 2.4, 0.6), tone(fill, -0.3)));
  }
  if (!potDrawn) c.potFront();
}

// ---------------------------------------------------------------------------
// Succulents
// ---------------------------------------------------------------------------

/** Spatulate succulent leaf: narrow base, widest around 70 %, pointed tip. */
function spoonLeaf(base: Pt, ang: number, len: number, width: number): string {
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const at = (along: number, side: number): [number, number] => [base.x + cos * len * along - sin * width * side, base.y + sin * len * along + cos * width * side];
  const [a1, b1] = at(0.25, 0.42);
  const [a2, b2] = at(0.85, 0.62);
  const [tx, ty] = at(1, 0);
  const [a3, b3] = at(0.85, -0.62);
  const [a4, b4] = at(0.25, -0.42);
  return new PathW(1).M(base.x, base.y).C(a1, b1, a2, b2, tx, ty).C(a3, b3, a4, b4, base.x, base.y).Z().toString();
}

function succulentRosette(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, density, t } = c;
  const maxL = w * 0.44;
  const C = { x: cx, y: gy - maxL * 0.5 };
  const camSin = 0.62;
  const camCos = 0.78;
  // Concentric rings, outer → inner: leaf count, length, elevation.
  const outerN = Math.round(lerp(11, 14, density));
  const rings = [
    { n: outerN, L: 1, el: 0.18 },
    { n: outerN - 2, L: 0.8, el: 0.42 },
    { n: outerN - 4, L: 0.6, el: 0.7 },
    { n: Math.max(4, outerN - 6), L: 0.42, el: 0.98 },
    { n: 4, L: 0.26, el: 1.22 },
  ];
  type Leaf = { depth: number; d: string; inner: string; fill: string };
  const leaves: Leaf[] = [];
  const phase = rng() * Math.PI * 2;
  rings.forEach((ring, ri) => {
    const off = phase + ri * (Math.PI / ring.n) + rng.range(-0.1, 0.1);
    for (let i = 0; i < ring.n; i++) {
      const az = off + (i / ring.n) * Math.PI * 2 + rng.range(-0.06, 0.06);
      const L = maxL * ring.L * rng.range(0.95, 1.04);
      const ce = Math.cos(ring.el);
      const dir = { x: Math.cos(az) * ce, y: Math.sin(az) * ce * camSin - Math.sin(ring.el) * camCos };
      const len = L * Math.max(0.4, Math.hypot(dir.x, dir.y));
      const ang = Math.atan2(dir.y, dir.x);
      const width = L * 0.42 * lerp(1, 0.8, Math.max(0, Math.sin(az)) * ce);
      const base = { x: C.x + Math.cos(ang) * L * 0.05, y: C.y + Math.sin(ang) * L * 0.05 };
      const lit = -Math.cos(az) * 0.28 - Math.sin(az) * 0.12 + (ri / rings.length) * 0.5 + rng.range(-0.06, 0.06);
      leaves.push({
        depth: Math.sin(az) * ce * L * 0.5 + ri * 0.5,
        fill: lit > 0.38 ? t.light : lit > 0.05 ? t.mid : lit > -0.22 ? t.dark : tone(t.dark, -0.15),
        d: spoonLeaf(base, ang, len, width),
        inner: spoonLeaf({ x: base.x + Math.cos(ang) * len * 0.06, y: base.y + Math.sin(ang) * len * 0.06 }, ang, len * 0.8, width * 0.58),
      });
    }
  });
  leaves.sort((a, b) => a.depth - b.depth);
  const sil: string[] = [];
  for (const lf of leaves) {
    doc.add(path(lf.d, t.deep, { transform: 'translate(0.6 1.6)', opacity: 0.6 }), path(lf.d, lf.fill), path(lf.inner, t.hi, { opacity: 0.2 }));
    sil.push(lf.d);
  }
  // Soft pruinose sheen toward the lit center.
  const clip = doc.clip(use(doc.shared(sil.join(''))));
  const sheen = doc.radial(
    [
      { o: 0, c: t.hi, a: 0.4 },
      { o: 0.5, c: t.hi, a: 0.08 },
      { o: 1, c: t.deep, a: 0.25 },
    ],
    C.x - maxL * 0.15,
    C.y - maxL * 0.2,
    maxL * 1.1,
    { user: true },
  );
  doc.add(g(rect(C.x - maxL * 1.1, C.y - maxL, maxL * 2.2, maxL * 1.8, sheen), { 'clip-path': clip }));
  // Arching bloom stalks with bell-shaped buds (echeveria / aloe flowering).
  const fp = flowerPainter(c);
  if (fp) {
    const stalks: string[] = [];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const top = { x: C.x + side * maxL * rng.range(0.7, 0.9), y: C.y - maxL * rng.range(0.55, 0.68) };
      const pts = splinePts([{ x: C.x + side * 3, y: C.y - 6 }, { x: C.x + side * maxL * 0.25, y: C.y - maxL * 0.78 }, top], 5);
      stalks.push(taper(pts, 2.6, 1.4));
      for (let k = 0; k < 5; k++) {
        const p = pts[Math.min(pts.length - 1, Math.round((0.55 + k * 0.1) * (pts.length - 1)))];
        fp.berry(p.x + side * 3, p.y + 4, 3.4 - k * 0.3);
      }
    }
    doc.add(path(stalks.join(''), mix(t.mid, c.spec.flower ?? t.mid, 0.4)));
    doc.add(...fp.render());
  }
}

/** Ribbed cactus body along a centerline: body gradient, ribs and spine dots. */
function ribbedPart(doc: SvgDoc, t: FoliageTones, center: Pt[], width: number, spine: string, grad: string): void {
  const cap = center[center.length - 1];
  doc.add(path(taper(center, width, width * 0.96, { round: true }) + ellipsePath(cap.x, cap.y, width / 2, width / 2), grad));
  const lay = new Layers([{ fill: t.hi, opacity: 0.35 }, { fill: t.deep, opacity: 0.35 }, { fill: spine, opacity: 0.85 }]);
  for (let k = -2; k <= 2; k++) {
    const off = (k / 2.6) * (width / 2);
    const pts = center.map((q, i, arr) => {
      const a = arr[Math.max(0, i - 1)];
      const b = arr[Math.min(arr.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: q.x - ((b.y - a.y) / len) * off, y: q.y + ((b.x - a.x) / len) * off };
    });
    lay.add(k <= 0 ? t.hi : t.deep, taper(pts, 1.8, 1.2), 0.35);
    for (let i = 1; i < pts.length; i++) lay.add(spine, ellipsePath(pts[i].x, pts[i].y, 1, 1), 0.85);
  }
  doc.add(...lay.render());
}

function cactus(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, t } = c;
  const spine = mix(t.hi, '#fff8e8', 0.6);
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
  const fp = flowerPainter(c);
  if (c.spec.seed % 2 === 0) {
    // Columnar cactus with arms (drawn behind the main column).
    const bw = w * 0.3;
    const top = gy - h * 0.97;
    const arms = rng.int(1, 2);
    const caps: { p: Pt; w: number }[] = [];
    for (let i = 0; i < arms; i++) {
      const side = arms === 1 ? (rng.chance(0.5) ? -1 : 1) : i === 0 ? -1 : 1;
      const y0 = gy - h * rng.range(0.32, 0.5);
      const out = w * rng.range(0.25, 0.32);
      const yTop = y0 - h * rng.range(0.22, 0.32);
      const aw = bw * 0.62;
      const center = splinePts(
        [
          { x: cx, y: y0 },
          { x: cx + side * out * 0.75, y: y0 + aw * 0.1 },
          { x: cx + side * out, y: y0 - aw * 0.7 },
          { x: cx + side * out, y: yTop + aw / 2 },
        ],
        5,
      );
      ribbedPart(doc, t, center, aw, spine, bodyGrad());
      caps.push({ p: center[center.length - 1], w: aw });
    }
    const main = [{ x: cx, y: gy + 2 }, { x: cx + 1, y: (gy + top) / 2 }, { x: cx, y: top + bw / 2 }];
    ribbedPart(doc, t, splinePts(main, 4), bw, spine, bodyGrad());
    caps.push({ p: main[2], w: bw });
    if (fp) for (const cp of caps) fp.blossom(cp.p.x + (rng() - 0.5) * 4, cp.p.y - cp.w * 0.38, cp.w * 0.2);
  } else {
    // Barrel cluster (small ones behind the big one).
    const globes = [
      { x: cx - w * 0.3, r: w * 0.17 },
      { x: cx + w * 0.29, r: w * 0.2 },
      { x: cx, r: w * 0.3 },
    ];
    for (const gl of globes) {
      const ry = gl.r * 1.1;
      const cy = gy - ry * 0.98;
      doc.add(path(ellipsePath(gl.x, cy, gl.r, ry), bodyGrad()));
      const lay = new Layers([{ fill: t.hi, opacity: 0.35 }, { fill: t.deep, opacity: 0.4 }, { fill: spine, opacity: 0.85 }]);
      for (let k = -3; k <= 3; k++) {
        const u = k / 3.6;
        const pts: Pt[] = [];
        for (let i = 0; i <= 10; i++) {
          const v = -Math.PI / 2 + (i / 10) * Math.PI;
          pts.push({ x: gl.x + u * Math.cos(v) * gl.r * 0.98, y: cy + Math.sin(v) * ry * 0.96 });
        }
        lay.add(k <= 0 ? t.hi : t.deep, taper(pts, 1.8, 1.2), k <= 0 ? 0.35 : 0.4);
        for (let i = 1; i < pts.length - 1; i++) lay.add(spine, ellipsePath(pts[i].x, pts[i].y, 1.1, 1.1), 0.85);
      }
      doc.add(...lay.render());
      if (fp) for (let i = 0; i < 3; i++) fp.blossom(gl.x + (i - 1) * gl.r * 0.3, cy - ry * 0.9 + Math.abs(i - 1) * 3, gl.r * 0.16);
    }
  }
  if (fp) doc.add(...fp.render());
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
  for (let i = 1; i < 5; i++) lat.push(rect(lerp(xl, xr, i / 5) - slatW / 2, top + h * 0.06, slatW, gy - top - h * 0.12, woodV));
  for (let i = 1; i < 8; i++) lat.push(rect(xl, lerp(top + h * 0.06, gy - h * 0.08, i / 8) - slatW / 2, xr - xl, slatW, woodH));
  doc.add(...lat);
  doc.add(rect(xl - postW / 2, top + 6, postW, gy - top - 5, woodV), rect(xr - postW / 2, top + 6, postW, gy - top - 5, woodV));
  doc.add(rect(xl - postW, top, xr - xl + postW * 2, h * 0.03, woodH, { rx: 2 }));
  // Vines with alternating leaves.
  const stemCol = c.spec.trunk ?? tone(t.mid, -0.55);
  const n = Math.round(lerp(3, 5, density));
  const leafLay = new Layers([{ fill: t.deep, opacity: 0.45 }, { fill: t.dark }, { fill: t.mid }, { fill: t.leaf }]);
  const stemD: string[] = [];
  const flowerPts: Pt[] = [];
  for (let v = 0; v < n; v++) {
    const x0 = cx + (v / Math.max(1, n - 1) - 0.5) * w * 0.35 + (rng() - 0.5) * 10;
    const height = h * rng.range(0.75, 0.97);
    const ctrl: Pt[] = [{ x: x0, y: gy + 1 }];
    for (let k = 1; k <= 5; k++) {
      const u = k / 5;
      ctrl.push({ x: clamp(x0 + Math.sin(u * 5 + v * 2) * w * 0.18 + (rng() - 0.5) * w * 0.1, xl, xr), y: gy - height * u });
    }
    const pts = splinePts(ctrl, 6);
    stemD.push(taper(pts, 4, 1.2));
    for (let i = 2; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[i - 1];
      const tan = Math.atan2(p.y - q.y, p.x - q.x);
      for (const side of [-1, 1]) {
        if (rng() > lerp(0.6, 0.95, density)) continue;
        const a = tan + side * rng.range(0.7, 1.4);
        const len = rng.range(13, 22);
        const base = { x: p.x + rng.range(-2, 2), y: p.y };
        leafLay.add(t.deep, leafPath({ x: base.x + 1.5, y: base.y + 2 }, a, len, len * 0.75, side * 0.1, 0), 0.45);
        leafLay.add(rng.pick([t.dark, t.mid, t.mid, t.leaf]), leafPath(base, a, len, len * 0.72, side * 0.1, 0));
      }
      if (rng.chance(0.3)) flowerPts.push({ x: p.x + rng.range(-10, 10), y: p.y + rng.range(-6, 6) });
    }
  }
  doc.add(path(stemD.join(''), stemCol));
  doc.add(...leafLay.render());
  const fp = flowerPainter(c);
  if (fp) {
    for (const p of flowerPts) fp.star(p.x, p.y, rng.range(6, 9));
    doc.add(...fp.render());
  }
}

// ---------------------------------------------------------------------------
// Houseplants
// ---------------------------------------------------------------------------

function broadLeaf(doc: SvgDoc, t: FoliageTones, rng: Rng, base: Pt, ang: number, len: number, width: number, bend: number): void {
  const fill = rng.pick([t.dark, t.mid, t.mid, t.leaf]);
  const px = -Math.sin(ang);
  const py = Math.cos(ang);
  const sideSign = px * LIGHT.x + py * LIGHT.y > 0 ? 1 : -1;
  const off = width * 0.22 * sideSign;
  const tip = { x: base.x + Math.cos(ang) * len * 0.85, y: base.y + Math.sin(ang) * len * 0.85 };
  const mid = { x: (base.x + tip.x) / 2 + px * bend * len * 0.45, y: (base.y + tip.y) / 2 + py * bend * len * 0.45 };
  doc.add(
    path(leafPath({ x: base.x + 2, y: base.y + 3 }, ang, len, width, bend, 1), t.deep, { opacity: 0.35 }),
    path(leafPath(base, ang, len, width, bend, 1), fill),
    // Lit half: a narrower leaf offset toward the light.
    path(leafPath({ x: base.x + px * off * 0.3, y: base.y + py * off * 0.3 }, ang, len * 0.92, width * 0.5, bend + sideSign * 0.1, 1), tone(fill, 0.22), {
      opacity: 0.6,
    }),
    path(taper([base, mid, tip], 2.2, 0.4), t.hi, { opacity: 0.45 }),
  );
}

function houseplantBroadleaf(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  const n = Math.round(lerp(8, 13, density));
  const leaves: { base: Pt; ang: number; len: number; width: number; bend: number }[] = [];
  const stemD: string[] = [];
  for (let i = 0; i < n; i++) {
    const side = rng() * 2 - 1;
    const end = { x: cx + side * w * 0.25, y: gy - h * rng.range(0.25, 0.85) * 0.78 };
    const x0 = cx + side * c.soilW * 0.15;
    stemD.push(taper([{ x: x0, y: gy + 2 }, { x: lerp(x0, end.x, 0.4), y: lerp(gy, end.y, 0.6) }, end], 4.5, 2.6));
    const len = h * rng.range(0.24, 0.32);
    leaves.push({ base: end, ang: -Math.PI / 2 + side * rng.range(0.4, 1.25), len, width: len * rng.range(0.55, 0.7), bend: (rng() - 0.5) * 0.25 });
  }
  doc.add(path(stemD.join(''), tone(t.mid, -0.45)));
  c.potFront();
  leaves.sort((a, b) => a.base.y - b.base.y);
  for (const lf of leaves) broadLeaf(doc, t, rng, lf.base, lf.ang, lf.len, lf.width, lf.bend);
}

/** Closed smooth outline from two side polylines (base → tip). */
function outlineFromSides(left: Pt[], right: Pt[]): string {
  const pts = [...left, ...right.slice().reverse()];
  const p = new PathW(1).M(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    p.Q(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  const last = pts[pts.length - 1];
  p.L(last.x, last.y);
  return p.Z().toString();
}

/** Strap / sword leaf with a pointed tip and slight bend. */
function swordLeaf(base: Pt, ang: number, len: number, width: number, bend: number): string {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const n = 8;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const off = bend * len * u * u;
    const px = base.x + dx * len * u - dy * off;
    const py = base.y + dy * len * u + dx * off;
    const ww = (width / 2) * (u < 0.12 ? 0.6 + u * 3.3 : 1 - Math.pow((u - 0.12) / 0.88, 2.4));
    left.push({ x: px + dy * ww, y: py - dx * ww });
    right.push({ x: px - dy * ww, y: py + dx * ww });
  }
  return outlineFromSides(left, right);
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
    const fill = lf.depth < 0.3 ? t.dark : lf.depth > 0.75 ? t.leaf : t.mid;
    if (c.spec.foliage2) {
      // Variegated margin.
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
  lay.add(t.deep, leafPath({ x: p.x + 1.2, y: p.y + 1.8 }, ang, len, len * 0.85, 0, 1), 0.4);
  lay.add(rng.pick([t.dark, t.mid, t.mid, t.leaf]), leafPath(p, ang, len, len * 0.82, 0, 1));
  lay.add(t.hi, leafPath(p, ang - 0.12, len * 0.7, len * 0.3, 0, 1), 0.25);
}

function houseplantTrailing(c: PlantCtx): void {
  const { doc, rng, cx, gy, h, density, t } = c;
  const spread = c.potted ? c.soilW * 0.55 : c.w * 0.3;
  if (!c.potted) {
    // In the ground the stems mound up and spill sideways: a low leafy base under the leaves.
    const base = domeClumps(rng, cx, gy + 4, spread * 1.15, h * 0.7, h * 0.22, 0.7, 4);
    canopy(doc, rng, base, { tones: t, texture: 0.6, volume: 0.7 });
  }
  const tones = [{ fill: t.deep, opacity: 0.4 }, { fill: t.dark }, { fill: t.mid }, { fill: t.leaf }, { fill: t.hi, opacity: 0.25 }];
  // Mound of leaves on the soil.
  const leafLay = new Layers(tones);
  const moundN = Math.round(lerp(30, 46, density) * (c.potted ? 1 : 1.5));
  const moundH = h * (c.potted ? 0.5 : 0.7);
  for (let i = 0; i < moundN; i++) {
    const u = rng() * 2 - 1;
    const p = { x: cx + u * spread, y: gy - moundH * Math.sqrt(1 - u * u) * Math.pow(rng(), 0.7) + 4 };
    heartLeaf(leafLay, t, rng, p, -Math.PI / 2 + u * 1.3 + (rng() - 0.5) * 0.7, rng.range(17, 25));
  }
  doc.add(...leafLay.render());
  c.potFront();
  // Trailing vines spilling over the rim (or along the ground).
  const vines = Math.round(lerp(5, 9, density));
  const vineLay = new Layers(tones);
  const stemD: string[] = [];
  const bottom = doc.h - 8;
  for (let v = 0; v < vines; v++) {
    const side = v % 2 ? 1 : -1;
    const start = { x: cx + side * spread * rng.range(0.3, 0.9), y: gy - 2 };
    let pts: Pt[];
    if (c.potted) {
      const over = { x: cx + side * (spread + rng.range(4, 12)), y: gy + 8 };
      const end = { x: over.x + side * rng.range(-4, 14), y: lerp(gy + 30, bottom, rng.range(0.4, 1)) };
      pts = splinePts([start, over, { x: lerp(over.x, end.x, 0.5) + rng.range(-5, 5), y: lerp(over.y, end.y, 0.5) }, end], 5);
    } else {
      const end = { x: cx + side * c.w * rng.range(0.38, 0.48), y: gy - rng.range(2, 8) };
      pts = splinePts([start, { x: lerp(start.x, end.x, 0.5), y: gy - rng.range(6, 16) }, end], 6);
    }
    stemD.push(taper(pts, 2.2, 1));
    for (let i = 2; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[i - 1];
      const tan = Math.atan2(p.y - q.y, p.x - q.x);
      heartLeaf(vineLay, t, rng, p, tan + (i % 2 ? 0.9 : -0.9), rng.range(11, 17) * (1 - (i / pts.length) * 0.35));
    }
  }
  doc.add(path(stemD.join(''), tone(t.mid, -0.4)));
  doc.add(...vineLay.render());
}

// ---------------------------------------------------------------------------
// Beds
// ---------------------------------------------------------------------------

function flowerBed(c: PlantCtx): void {
  const { doc, rng, cx, gy, w, h, density, t } = c;
  // Mulch bed.
  const mulch = '#4a3427';
  const bedRy = h * 0.14;
  doc.add(path(ellipsePath(cx, gy - bedRy, w * 0.495, bedRy), mulch));
  const chips = new Layers([{ fill: tone(mulch, 0.25), opacity: 0.8 }, { fill: tone(mulch, -0.4), opacity: 0.8 }]);
  for (let i = 0; i < 110; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * 0.95;
    const fill = rng.chance(0.5) ? tone(mulch, 0.25) : tone(mulch, -0.4);
    chips.add(fill, leafPath({ x: cx + Math.cos(a) * w * 0.49 * rr, y: gy - bedRy + Math.sin(a) * bedRy * rr }, rng() * 6.28, rng.range(3, 6), 1.8, 0, 0), 0.8);
  }
  doc.add(...chips.render());
  const r = h * 0.19;
  const clumps: Clump[] = [];
  const rows = [
    { y: gy - h * 0.52, half: w * 0.38, r: r * 1.05 },
    { y: gy - h * 0.37, half: w * 0.43, r },
    { y: gy - h * 0.22, half: w * 0.42, r: r * 0.9 },
  ];
  for (const row of rows) {
    const n = Math.round((row.half * 2) / (row.r * 1.2));
    for (let i = 0; i < n; i++) {
      const x = cx - row.half + ((i + 0.5) / n) * row.half * 2;
      clumps.push({ x: x + (rng() - 0.5) * row.r * 0.4, y: row.y + (rng() - 0.5) * row.r * 0.3, r: row.r * rng.range(0.85, 1.1), sy: 0.78 });
    }
  }
  canopy(doc, rng, clumps, { tones: t, texture: 0.9, volume: 0.7 });
  const flower = c.spec.flower ?? '#e86a8a';
  const fpA = new FlowerPainter(flowerTones(flower), rng);
  const fpB = new FlowerPainter(flowerTones(mix(flower, '#fff6ec', 0.65)), rng);
  const pts = surfacePoints(rng, clumps, Math.round(lerp(70, 120, density)), 0.1, 0.9).sort((a, b) => a.y - b.y);
  for (const p of pts) {
    const fp = rng.chance(0.25) ? fpB : fpA;
    if (p.y < gy - h * 0.5 && rng.chance(0.35)) fp.cluster(p.x, p.y, w * 0.018, 9);
    else fp.blossom(p.x, p.y, w * rng.range(0.01, 0.014));
  }
  doc.add(...fpA.render(), ...fpB.render());
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const DEFS: Record<PlantForm, PlantDef> = {
  'round-shrub': { w: 360, h: 270, pot: { w: 190, h: 150, pw: 300, ph: 220 }, draw: (c) => roundShrub(c) },
  'upright-shrub': { w: 270, h: 360, pot: { w: 180, h: 150, pw: 230, ph: 300 }, draw: uprightShrub },
  'spreading-shrub': { w: 440, h: 190, pot: { w: 200, h: 140, pw: 320, ph: 150 }, draw: spreadingShrub },
  'flowering-shrub': { w: 360, h: 280, pot: { w: 190, h: 150, pw: 300, ph: 230 }, draw: floweringShrub },
  'conical-evergreen': { w: 240, h: 440, pot: { w: 170, h: 150, pw: 200, ph: 340 }, draw: conicalEvergreen },
  columnar: { w: 130, h: 460, pot: { w: 150, h: 140, pw: 110, ph: 360 }, draw: columnar },
  'deciduous-tree': { w: 460, h: 580, draw: deciduousTree },
  'ornamental-tree': { w: 440, h: 380, pot: { w: 200, h: 160, pw: 360, ph: 320 }, draw: ornamentalTree },
  'weeping-tree': { w: 440, h: 470, draw: weepingTree },
  palm: { w: 520, h: 600, pot: { w: 170, h: 150, pw: 400, ph: 360 }, draw: palm },
  'ornamental-grass': { w: 360, h: 320, pot: { w: 170, h: 140, pw: 300, ph: 270 }, draw: ornamentalGrass },
  'flowering-perennial': { w: 300, h: 280, pot: { w: 170, h: 130, pw: 260, ph: 230 }, draw: floweringPerennial },
  groundcover: { w: 420, h: 110, draw: groundcover },
  'succulent-rosette': { w: 260, h: 150, pot: { w: 170, h: 110, pw: 230, ph: 135 }, draw: succulentRosette },
  cactus: { w: 220, h: 340, pot: { w: 150, h: 110, pw: 200, ph: 290 }, draw: cactus },
  fern: { w: 380, h: 260, pot: { w: 160, h: 130, pw: 360, ph: 240 }, draw: fern },
  'vine-trellis': { w: 250, h: 440, draw: vineTrellis },
  hedge: { w: 480, h: 230, draw: hedge },
  'houseplant-broadleaf': { w: 300, h: 330, pot: { w: 160, h: 140, pw: 300, ph: 330 }, draw: houseplantBroadleaf },
  'houseplant-upright': { w: 210, h: 380, pot: { w: 140, h: 130, pw: 210, ph: 360 }, draw: houseplantUpright },
  'houseplant-trailing': { w: 320, h: 130, pot: { w: 170, h: 140, pw: 300, ph: 120 }, draw: houseplantTrailing },
  'potted-tree': { w: 280, h: 420, pot: { w: 180, h: 150, pw: 280, ph: 380 }, draw: pottedTree },
  'flower-bed': { w: 480, h: 170, draw: flowerBed },
};

/** Canvas layout of a plant: drawing size, ground line and optional pot. */
function plantLayout(spec: NormPlant): { def: PlantDef; pot?: PlantDef['pot']; pw: number; ph: number; W: number; H: number; baseY: number } {
  const def = DEFS[spec.form] ?? DEFS['round-shrub'];
  const pot = spec.pot && def.pot ? def.pot : undefined;
  const pw = pot ? pot.pw : def.w;
  const ph = pot ? pot.ph : def.h;
  const padT = 6;
  const padB = 4;
  const W = Math.round(Math.max(pw, (pot?.w ?? 0) + 12));
  const H = Math.round(padT + ph + (pot ? pot.h : 0) + padB);
  return { def, pot, pw, ph, W, H, baseY: H - padB };
}

/** Output size and anchor of a plant spec without drawing it. */
export function plantSize(raw: PlantArt): Omit<ArtResult, 'svg'> {
  const { W, H, baseY } = plantLayout(normalizePlant(raw));
  return { ...outputSize(W, H), anchorY: baseY / H };
}

/** Render a plant spec. `prefix` makes def ids unique per spec; `seed` drives the PRNG. */
export function renderPlant(raw: PlantArt, prefix: string, seed: number): ArtResult {
  const spec = normalizePlant(raw);
  const { def, pot, pw, ph, W, H, baseY } = plantLayout(spec);
  const doc = new SvgDoc(W, H, prefix);
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
  const potColor = spec.pot;
  const ctx: PlantCtx = {
    doc,
    rng: makeRng(seed),
    spec,
    cx,
    gy,
    w: pw,
    h: ph,
    t: foliageTones(spec.foliage, spec.foliage2),
    density: spec.density,
    potted: !!pot,
    soilW,
    potFront() {
      if (frontDone || !geom || !potColor) return;
      frontDone = true;
      potFront(doc, geom, potColor);
    },
  };
  def.draw(ctx);
  ctx.potFront();
  return { svg: doc.toString(), width: doc.outWidth, height: doc.outHeight, anchorY: baseY / H };
}
