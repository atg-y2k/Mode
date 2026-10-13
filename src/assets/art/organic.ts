/**
 * Organic building blocks shared by plant (and some decor) art: foliage tone
 * ramps, scalloped leaf-cluster blobs, layered canopies with volume shading,
 * leaf texture, flowers, branching trunks and pots.
 *
 * Lighting convention for every illustration: soft key light from the upper
 * left, so lit faces are top-left and shadow sides bottom-right.
 */
import { PathW, SvgDoc, el, ellipsePath, g, leafPath, path, rect, smoothClosed, smoothOpen, taper, use, type Attrs, type Stop } from './svg';
import { clamp, f, hexToHsl, luminance, tone, type Pt, type Rng } from './util';

// ---------------------------------------------------------------------------
// Tones
// ---------------------------------------------------------------------------

export interface FoliageTones {
  deep: string;
  dark: string;
  mid: string;
  light: string;
  hi: string;
}

/** Five-step tone ramp from the main foliage color (+ optional highlight color). */
export function foliageTones(foliage: string, foliage2?: string): FoliageTones {
  const light = foliage2 ?? tone(foliage, 0.24);
  return {
    deep: tone(foliage, -0.58),
    dark: tone(foliage, -0.3),
    mid: foliage,
    light,
    hi: tone(light, 0.3),
  };
}

/** Default light direction (unit-ish vector toward the key light). */
export const LIGHT: Pt = { x: -0.5, y: -0.86 };

// ---------------------------------------------------------------------------
// Layers: merge many small shapes of the same fill into one <path>.
// ---------------------------------------------------------------------------

export class Layers {
  private readonly order: string[] = [];
  private readonly map = new Map<string, { fill: string; opacity: number; d: string[] }>();

  /** Optionally pre-declare draw order. */
  constructor(keys: { fill: string; opacity?: number }[] = []) {
    for (const k of keys) this.slot(k.fill, k.opacity ?? 1);
  }

  private slot(fill: string, opacity: number): { d: string[] } {
    const key = `${fill}|${opacity}`;
    let s = this.map.get(key);
    if (!s) {
      s = { fill, opacity, d: [] };
      this.map.set(key, s);
      this.order.push(key);
    }
    return s;
  }

  add(fill: string, d: string, opacity = 1): void {
    if (d) this.slot(fill, opacity).d.push(d);
  }

  render(attrs?: Attrs): string[] {
    const out: string[] = [];
    for (const key of this.order) {
      const s = this.map.get(key)!;
      if (!s.d.length) continue;
      out.push(path(s.d.join(''), s.fill, { opacity: s.opacity < 1 ? s.opacity : undefined, ...attrs }));
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Blobs
// ---------------------------------------------------------------------------

/**
 * Closed "cloud" outline: rounded bumps separated by small notches, like the
 * edge of a cluster of leaves. Returns a single compact subpath.
 */
export function scallopBlob(rng: Rng, cx: number, cy: number, rx: number, ry: number, lobes = 9, rough = 0.16): string {
  const n = Math.max(5, Math.round(lobes));
  const phase = rng() * Math.PI * 2;
  const w1 = rng.range(0.03, 0.09);
  const w2 = rng.range(0.02, 0.06);
  const p1 = rng() * 6.283;
  const p2 = rng() * 6.283;
  const radius = (a: number): number => 1 + w1 * Math.sin(2 * a + p1) + w2 * Math.sin(3 * a + p2);
  const angles: number[] = [];
  for (let i = 0; i < n; i++) angles.push(phase + ((i + (rng() - 0.5) * 0.55) / n) * Math.PI * 2);
  const vx: number[] = [];
  const vy: number[] = [];
  for (const a of angles) {
    const k = radius(a) * (1 - rough * 0.45);
    vx.push(cx + Math.cos(a) * rx * k);
    vy.push(cy + Math.sin(a) * ry * k);
  }
  const p = new PathW(0).M(vx[0], vy[0]);
  for (let i = 0; i < n; i++) {
    const a0 = angles[i];
    const a1 = i + 1 < n ? angles[i + 1] : angles[0] + Math.PI * 2;
    const am = (a0 + a1) / 2;
    const j = (i + 1) % n;
    const k = radius(am) * (1 + rough * rng.range(0.45, 1.05));
    const px = cx + Math.cos(am) * rx * k;
    const py = cy + Math.sin(am) * ry * k;
    // Quadratic control so the curve's midpoint lands on the peak.
    p.Q(2 * px - (vx[i] + vx[j]) / 2, 2 * py - (vy[i] + vy[j]) / 2, vx[j], vy[j]);
  }
  return p.Z().toString();
}

/** Soft irregular blob (no notches), for pebbles, soil, rocks, water. */
export function softBlob(rng: Rng, cx: number, cy: number, rx: number, ry: number, n = 10, wobble = 0.12): string {
  const phase = rng() * Math.PI * 2;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const k = 1 + (rng() * 2 - 1) * wobble;
    pts.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k });
  }
  return smoothClosed(pts, 1);
}

// ---------------------------------------------------------------------------
// Canopy
// ---------------------------------------------------------------------------

export interface Clump {
  x: number;
  y: number;
  r: number;
  /** Vertical squash (ry = r * sy). */
  sy?: number;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanopyOpts {
  tones: FoliageTones;
  /** Edge lobes per clump (min, max). */
  lobes?: [number, number];
  rough?: number;
  /** Sort clumps top → bottom so lower ones overlap (default true). */
  sort?: boolean;
  /** Global volume shading strength (default 1). */
  volume?: number;
  /** Darker underside strength (default 1). */
  underside?: number;
  /** Leaf-speck texture multiplier (default 1, 0 = none). */
  texture?: number;
  /** Leaf speck length in px (default from clump size). */
  speck?: number;
  /** Highlight blob opacity (default 0.75). */
  shine?: number;
}

export interface CanopyResult {
  silId: string;
  clip: string;
  bounds: Bounds;
}

export function clumpBounds(clumps: Clump[], pad = 1.2): Bounds {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of clumps) {
    const ry = c.r * (c.sy ?? 1);
    x0 = Math.min(x0, c.x - c.r * pad);
    x1 = Math.max(x1, c.x + c.r * pad);
    y0 = Math.min(y0, c.y - ry * pad);
    y1 = Math.max(y1, c.y + ry * pad);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Volume shading stops: soft highlight toward the light, darker far side. */
function volumeStops(t: FoliageTones, vol: number): Stop[] {
  return [
    { o: 0, c: t.hi, a: 0.28 * vol },
    { o: 0.38, c: t.hi, a: 0 },
    { o: 0.62, c: t.deep, a: 0 },
    { o: 1, c: t.deep, a: 0.55 * vol },
  ];
}

/** Overlay volume shading (radial + underside) clipped to a silhouette. */
export function shadeVolume(doc: SvgDoc, clip: string, b: Bounds, t: FoliageTones, vol = 1, under = 1): void {
  const radial = doc.radial(
    volumeStops(t, vol),
    b.x + b.w * (0.5 + LIGHT.x * 0.3),
    b.y + b.h * (0.5 + LIGHT.y * 0.3),
    Math.max(b.w, b.h) * 0.78,
    { user: true },
  );
  const parts = [rect(b.x, b.y, b.w, b.h, radial)];
  if (under > 0) {
    const lin = doc.linear(
      [
        { o: 0, c: t.deep, a: 0 },
        { o: 1, c: t.deep, a: 0.6 * under },
      ],
      0,
      b.y + b.h * 0.55,
      0,
      b.y + b.h,
      { user: true },
    );
    parts.push(rect(b.x, b.y, b.w, b.h, lin));
  }
  doc.add(g(parts, { 'clip-path': clip }));
}

/**
 * Layered foliage mass: a deep-toned silhouette (union of all clumps), then
 * per clump a dark body, a mid-tone lit face and a highlight toward the light,
 * then global volume shading (radial highlight + darker underside) clipped to
 * the silhouette, and finally small leaf specks for texture.
 */
export function canopy(doc: SvgDoc, rng: Rng, clumps: Clump[], o: CanopyOpts): CanopyResult {
  const t = o.tones;
  const [lMin, lMax] = o.lobes ?? [7, 11];
  const rough = o.rough ?? 0.16;
  const L = LIGHT;
  const bounds = clumpBounds(clumps);

  const sil = clumps.map((c) => scallopBlob(rng, c.x, c.y, c.r * 1.05, c.r * (c.sy ?? 1) * 1.05, rng.int(lMin, lMax), rough)).join('');
  const silId = doc.shared(sil);
  doc.add(use(silId, { fill: t.deep }));

  const order = o.sort === false ? clumps : [...clumps].sort((a, b) => a.y - b.y);
  const shine = o.shine ?? 0.75;
  const parts: string[] = [];
  for (const c of order) {
    const sy = c.sy ?? 1;
    const lobes = rng.int(lMin, lMax);
    parts.push(
      path(scallopBlob(rng, c.x + L.x * c.r * 0.04, c.y + L.y * c.r * 0.04, c.r * 0.95, c.r * sy * 0.93, lobes, rough), t.dark),
      path(scallopBlob(rng, c.x + L.x * c.r * 0.17, c.y + L.y * c.r * 0.17, c.r * 0.76, c.r * sy * 0.74, lobes, rough), t.mid),
      path(
        scallopBlob(rng, c.x + L.x * c.r * 0.38, c.y + L.y * c.r * 0.4, c.r * 0.4, c.r * sy * 0.38, Math.max(5, lobes - 3), rough),
        t.light,
        shine < 1 ? { opacity: shine } : undefined,
      ),
    );
  }
  doc.add(...parts);

  const clip = doc.clip(use(silId));
  shadeVolume(doc, clip, bounds, t, o.volume ?? 1, o.underside ?? 1);
  const texture = o.texture ?? 1;
  if (texture > 0) doc.add(...leafSpecks(rng, clumps, t, texture, o.speck));
  return { silId, clip, bounds };
}

/** Small leaf marks across clumps: highlights on lit sides, dark ones in shadow. */
export function leafSpecks(rng: Rng, clumps: Clump[], t: FoliageTones, amount = 1, size?: number): string[] {
  const lay = new Layers([{ fill: t.deep, opacity: 0.5 }, { fill: t.light, opacity: 0.8 }, { fill: t.hi, opacity: 0.75 }]);
  for (const c of clumps) {
    const sy = c.sy ?? 1;
    const count = Math.round(((c.r * c.r * sy) / 150) * amount);
    const s = size ?? clamp(c.r * 0.15, 2.4, 6.5);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const rr = Math.sqrt(rng()) * 0.92;
      const dx = Math.cos(a) * rr;
      const dy = Math.sin(a) * rr;
      const lit = dx * LIGHT.x + dy * LIGHT.y;
      const ang = rng() * Math.PI * 2;
      const len = s * rng.range(0.7, 1.25);
      const d = leafPath({ x: c.x + dx * c.r, y: c.y + dy * c.r * sy }, ang, len, len * 0.55, 0, 1);
      if (lit > 0.35) {
        if (rng.chance(0.3)) lay.add(t.hi, d, 0.75);
        else lay.add(t.light, d, 0.8);
      } else if (lit < -0.15) lay.add(t.deep, d, 0.5);
    }
  }
  return lay.render();
}

// ---------------------------------------------------------------------------
// Flowers
// ---------------------------------------------------------------------------

export type FlowerStyle = 'blossom' | 'cluster' | 'spike' | 'daisy' | 'berry' | 'star';

export interface FlowerTones {
  shade: string;
  base: string;
  light: string;
  center: string;
}

export function flowerTones(color: string): FlowerTones {
  const lum = luminance(color);
  const [h, s] = hexToHsl(color);
  const yellowish = s > 0.35 && h >= 30 && h <= 70;
  return {
    shade: tone(color, lum > 0.6 ? -0.3 : -0.42),
    base: color,
    light: tone(color, 0.45),
    center: yellowish ? '#7a4a1c' : '#e9c64b',
  };
}

/** Accumulates flowers of one color into a few tone layers. */
export class FlowerPainter {
  readonly lay: Layers;
  constructor(
    readonly tones: FlowerTones,
    private readonly rng: Rng,
  ) {
    this.lay = new Layers([
      { fill: tones.shade },
      { fill: tones.base },
      { fill: tones.light, opacity: 0.9 },
      { fill: tones.center },
    ]);
  }

  private circ(fill: string, x: number, y: number, r: number, opacity = 1): void {
    this.lay.add(fill, ellipsePath(x, y, r, r), opacity);
  }

  /** Five round petals around a stamen dot (s = flower radius). */
  blossom(x: number, y: number, s: number): void {
    const t = this.tones;
    const a0 = this.rng() * Math.PI * 2;
    this.circ(t.shade, x + s * 0.14, y + s * 0.18, s * 1.02);
    for (let k = 0; k < 5; k++) {
      const a = a0 + (k * Math.PI * 2) / 5;
      this.circ(t.base, x + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5, s * 0.44);
    }
    this.circ(t.light, x - s * 0.22, y - s * 0.26, s * 0.3);
    this.circ(t.center, x, y, s * 0.2);
  }

  /** Rounded head of many small florets (hydrangea, phlox, lilac, yarrow). */
  cluster(x: number, y: number, s: number, florets = 14): void {
    const t = this.tones;
    this.circ(t.shade, x + s * 0.06, y + s * 0.08, s);
    for (let i = 0; i < florets; i++) {
      const a = this.rng() * Math.PI * 2;
      const rr = Math.sqrt(this.rng()) * s * 0.74;
      const fx = x + Math.cos(a) * rr;
      const fy = y + Math.sin(a) * rr;
      const lit = (Math.cos(a) * LIGHT.x + Math.sin(a) * LIGHT.y) * (rr / s);
      const fill = lit > 0.15 ? t.light : lit < -0.35 ? t.shade : t.base;
      const fr = s * this.rng.range(0.2, 0.27);
      this.circ(fill, fx, fy, fr);
      this.circ(t.shade, fx + fr * 0.1, fy + fr * 0.1, fr * 0.28, 0.9);
    }
  }

  /** Vertical spike of florets from (x,y) upward (lavender, salvia, veronica). */
  spike(x: number, y: number, len: number, s: number, lean = 0): void {
    const t = this.tones;
    const n = Math.max(4, Math.round(len / (s * 0.9)));
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const r = s * (1 - k * 0.55);
      const px = x + lean * len * k * k + (i % 2 ? 1 : -1) * r * 0.45;
      const py = y - len * k;
      this.circ(t.shade, px + r * 0.2, py + r * 0.15, r * 0.95);
      this.circ(i % 3 === 0 ? t.light : t.base, px, py, r * 0.78);
    }
  }

  /** Ray flower with a raised center cone (coneflower, black-eyed Susan, daisy). */
  daisy(x: number, y: number, s: number, center = '#4b2e17'): void {
    const t = this.tones;
    const n = this.rng.int(9, 13);
    const a0 = this.rng() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k * Math.PI * 2) / n;
      const d = leafPath({ x, y }, a, s, s * 0.34, 0, 1);
      if (Math.sin(a) > 0.3) this.lay.add(t.shade, d);
      else this.lay.add(Math.cos(a) < -0.3 ? t.light : t.base, d, 0.95);
    }
    this.lay.add(center, ellipsePath(x, y - s * 0.05, s * 0.3, s * 0.27));
    this.lay.add(t.light, ellipsePath(x - s * 0.09, y - s * 0.14, s * 0.1, s * 0.08), 0.6);
  }

  /** Round berry / fruit / bud with a glint. */
  berry(x: number, y: number, s: number): void {
    const t = this.tones;
    this.circ(t.shade, x, y, s);
    this.circ(t.base, x - s * 0.12, y - s * 0.12, s * 0.8);
    this.circ(t.light, x - s * 0.35, y - s * 0.38, s * 0.28, 0.9);
  }

  /** Small star-shaped flower (jasmine, clematis, creeping phlox) seen face-on. */
  star(x: number, y: number, s: number): void {
    const t = this.tones;
    const n = this.rng.chance(0.5) ? 5 : 6;
    const a0 = this.rng() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k * Math.PI * 2) / n;
      this.lay.add(t.shade, leafPath({ x: x + s * 0.1, y: y + s * 0.12 }, a, s, s * 0.6, 0, 1));
      this.lay.add(Math.cos(a) * LIGHT.x + Math.sin(a) * LIGHT.y > 0.3 ? t.light : t.base, leafPath({ x, y }, a, s * 0.92, s * 0.55, 0, 1));
    }
    this.circ(t.center, x, y, s * 0.18);
  }

  render(): string[] {
    return this.lay.render();
  }
}

/**
 * Random points on the lit / outer surface of a set of clumps (where flowers
 * and fruit show), biased toward the light.
 */
export function surfacePoints(rng: Rng, clumps: Clump[], n: number, inner = 0.35, outer = 0.92): Pt[] {
  const out: Pt[] = [];
  if (!clumps.length) return out;
  let guard = 0;
  while (out.length < n && guard++ < n * 30) {
    const c = clumps[Math.floor(rng() * clumps.length)];
    const a = rng() * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    if (dx * LIGHT.x + dy * LIGHT.y < -0.55 && rng.chance(0.75)) continue;
    const rr = rng.range(inner, outer);
    out.push({ x: c.x + dx * c.r * rr, y: c.y + dy * c.r * (c.sy ?? 1) * rr });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trunks and branches
// ---------------------------------------------------------------------------

export interface Branch {
  pts: Pt[];
  w0: number;
  w1: number;
  depth: number;
}

export interface BranchOpts {
  depth: number;
  /** Angular spread of children (radians). */
  spread: number;
  /** Child length factor. */
  decay: number;
  /** Children per branch [min, max]. */
  kids: [number, number];
  /** Pull toward vertical (positive = upward). */
  up?: number;
  /** Curvature amount. */
  curve?: number;
}

/** Recursive branching structure from `base` going in direction `ang` (radians). */
export function grow(rng: Rng, base: Pt, ang: number, len: number, w: number, o: BranchOpts, depth = 0): Branch[] {
  const out: Branch[] = [];
  const bend = (rng() * 2 - 1) * (o.curve ?? 0.18) * len;
  const end = { x: base.x + Math.cos(ang) * len, y: base.y + Math.sin(ang) * len };
  const mid = {
    x: (base.x + end.x) / 2 - Math.sin(ang) * bend,
    y: (base.y + end.y) / 2 + Math.cos(ang) * bend,
  };
  const pts: Pt[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const u = 1 - t;
    pts.push({ x: u * u * base.x + 2 * u * t * mid.x + t * t * end.x, y: u * u * base.y + 2 * u * t * mid.y + t * t * end.y });
  }
  const w1 = w * (depth < o.depth ? 0.62 : 0.25);
  out.push({ pts, w0: w, w1, depth });
  if (depth >= o.depth) return out;
  const kids = rng.int(o.kids[0], o.kids[1]);
  for (let k = 0; k < kids; k++) {
    const t = kids === 1 ? 1 : rng.range(0.6, 1);
    const i = Math.min(6, Math.round(t * 6));
    const side = kids === 1 ? rng.range(-0.5, 0.5) : (k / (kids - 1)) * 2 - 1;
    let a = ang + side * o.spread + (rng() - 0.5) * 0.3;
    a += (-Math.PI / 2 - a) * (o.up ?? 0.2);
    const cw = w1 * rng.range(0.75, 0.95) * (t < 0.95 ? 0.85 : 1);
    out.push(...grow(rng, pts[i], a, len * o.decay * rng.range(0.8, 1.1), cw, o, depth + 1));
  }
  return out;
}

/** Branch tips (end points), for placing foliage clumps. */
export function tips(branches: Branch[], minDepth = 1): Pt[] {
  return branches.filter((b) => b.depth >= minDepth).map((b) => b.pts[b.pts.length - 1]);
}

/**
 * Draw branches: main trunk (depth 0) with a horizontal bark gradient and
 * subtle bark lines; limbs with a slightly darker tone and a lit edge.
 */
export function drawBranches(doc: SvgDoc, rng: Rng, branches: Branch[], bark: string, opts: { lines?: boolean } = {}): void {
  const trunk = branches.filter((b) => b.depth === 0);
  const limbs = branches.filter((b) => b.depth > 0);
  if (limbs.length) {
    const limbD = limbs.map((b) => taper(b.pts, b.w0, b.w1, { ease: 0.8 })).join('');
    const joints = limbs.map((b) => ellipsePath(b.pts[0].x, b.pts[0].y, b.w0 * 0.5, b.w0 * 0.5)).join('');
    doc.add(path(limbD + joints, tone(bark, -0.18)));
  }
  const grad = barkGradient(doc, bark);
  for (const b of trunk) doc.add(path(taper(b.pts, b.w0, b.w1, { ease: 0.7 }), grad));
  const lit = limbs
    .filter((b) => b.w0 > 3)
    .map((b) => taper(b.pts.map((p) => ({ x: p.x - b.w0 * 0.18, y: p.y })), b.w0 * 0.35, b.w1 * 0.3, { ease: 0.8 }))
    .join('');
  if (lit) doc.add(path(lit, tone(bark, 0.25), { opacity: 0.55 }));
  if (opts.lines !== false) {
    for (const b of trunk) {
      const lines: string[] = [];
      const n = Math.max(2, Math.round(b.w0 / 7));
      for (let i = 0; i < n; i++) {
        const off = (rng() - 0.5) * 0.6;
        const count = rng.int(3, 6);
        const seg = b.pts.slice(0, count).map((p, j) => {
          const t = j / (b.pts.length - 1);
          const w = b.w0 + (b.w1 - b.w0) * t;
          return { x: p.x + off * w + (rng() - 0.5) * 1.2, y: p.y - (j === count - 1 ? rng() * 8 : 0) };
        });
        lines.push(taper(seg, 1.4, 0.4));
      }
      doc.add(path(lines.join(''), tone(bark, -0.45), { opacity: 0.45 }));
    }
  }
}

/** Cylindrical bark gradient (light left, dark right). */
export function barkGradient(doc: SvgDoc, bark: string): string {
  return doc.linear(
    [
      { o: 0, c: tone(bark, -0.15) },
      { o: 0.25, c: tone(bark, 0.22) },
      { o: 0.55, c: bark },
      { o: 1, c: tone(bark, -0.5) },
    ],
    0,
    0,
    1,
    0,
  );
}

// ---------------------------------------------------------------------------
// Pots
// ---------------------------------------------------------------------------

export interface PotGeom {
  cx: number;
  /** Ground contact y. */
  baseY: number;
  /** Rim outer width. */
  w: number;
  /** Total height including rim. */
  h: number;
  /** Bottom width as a fraction of rim width (default 0.72). */
  taper?: number;
  /** Rim band height fraction (default 0.15). */
  rim?: number;
}

/** Cylinder shading stops for a color (light left of center, dark right). */
export function cylinderStops(c: string, gloss = 0.5): Stop[] {
  return [
    { o: 0, c: tone(c, -0.42) },
    { o: 0.1, c: tone(c, -0.14) },
    { o: 0.3, c: tone(c, 0.12 + gloss * 0.25) },
    { o: 0.45, c: tone(c, 0.05) },
    { o: 0.75, c: tone(c, -0.22) },
    { o: 1, c: tone(c, -0.5) },
  ];
}

export function potTopY(p: PotGeom): number {
  return p.baseY - p.h;
}

/** Rim ellipse vertical radius. */
export function potRy(p: PotGeom): number {
  return p.w * 0.085;
}

/** Back part of a pot: inner rim + soil (draw before the plant). */
export function potBack(doc: SvgDoc, p: PotGeom, color: string, soil = '#3b2a1e'): void {
  const top = potTopY(p);
  const ry = potRy(p);
  const rx = p.w / 2;
  doc.add(
    path(ellipsePath(p.cx, top, rx, ry), tone(color, -0.35)),
    path(ellipsePath(p.cx, top + ry * 0.12, rx * 0.88, ry * 0.78), soil),
    path(ellipsePath(p.cx - rx * 0.1, top + ry * 0.2, rx * 0.55, ry * 0.4), tone(soil, 0.12), { opacity: 0.6 }),
  );
}

/** Front of a pot: body, rim-overhang shadow and rim band (draw after stems). */
export function potFront(doc: SvgDoc, p: PotGeom, color: string, opts: { gloss?: number } = {}): void {
  const top = potTopY(p);
  const ry = potRy(p);
  const rx = p.w / 2;
  const rimH = p.h * (p.rim ?? 0.15);
  const bodyTopRx = rx * 0.94;
  const botRx = rx * (p.taper ?? 0.72);
  const botRy = ry * (botRx / rx);
  const yRim = top + rimH;
  const body =
    `M${f(p.cx - bodyTopRx)} ${f(yRim)}` +
    `L${f(p.cx - botRx)} ${f(p.baseY - botRy)}` +
    `A${f(botRx)} ${f(botRy)} 0 0 0 ${f(p.cx + botRx)} ${f(p.baseY - botRy)}` +
    `L${f(p.cx + bodyTopRx)} ${f(yRim)}Z`;
  const gloss = opts.gloss ?? 0.4;
  doc.add(path(body, doc.linear(cylinderStops(color, gloss), 0, 0, 1, 0)));
  // Base darkening (ambient occlusion toward the ground).
  doc.add(
    path(
      body,
      doc.linear(
        [
          { o: 0.55, c: tone(color, -0.6), a: 0 },
          { o: 1, c: tone(color, -0.6), a: 0.4 },
        ],
        0,
        0,
        0,
        1,
      ),
    ),
  );
  // Shadow under the rim overhang.
  const sh =
    `M${f(p.cx - bodyTopRx)} ${f(yRim - 1)}` +
    `A${f(bodyTopRx)} ${f(ry)} 0 0 0 ${f(p.cx + bodyTopRx)} ${f(yRim - 1)}` +
    `L${f(p.cx + bodyTopRx * 0.985)} ${f(yRim + rimH * 0.35)}` +
    `A${f(bodyTopRx * 0.985)} ${f(ry)} 0 0 1 ${f(p.cx - bodyTopRx * 0.985)} ${f(yRim + rimH * 0.35)}Z`;
  doc.add(path(sh, tone(color, -0.65), { opacity: 0.35 }));
  // Rim band (front half).
  const rimD =
    `M${f(p.cx - rx)} ${f(top)}` +
    `A${f(rx)} ${f(ry)} 0 0 0 ${f(p.cx + rx)} ${f(top)}` +
    `L${f(p.cx + rx)} ${f(top + rimH)}` +
    `A${f(rx)} ${f(ry)} 0 0 1 ${f(p.cx - rx)} ${f(top + rimH)}Z`;
  doc.add(path(rimD, doc.linear(cylinderStops(tone(color, 0.08), gloss + 0.15), 0, 0, 1, 0)));
  // Lip highlight.
  doc.add(
    el('path', {
      d: `M${f(p.cx - rx * 0.96)} ${f(top + ry * 0.25)}A${f(rx * 0.97)} ${f(ry * 0.9)} 0 0 0 ${f(p.cx + rx * 0.5)} ${f(top + ry * 0.85)}`,
      fill: 'none',
      stroke: tone(color, 0.6),
      'stroke-width': 1.2,
      'stroke-opacity': 0.55,
      'stroke-linecap': 'round',
    }),
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Smooth open curve as a stroke (for very thin wires/tendrils, ≤ 1.5px). */
export function wire(pts: Pt[], color: string, width = 1.2, attrs?: Attrs): string {
  return path(smoothOpen(pts), 'none', {
    stroke: color,
    'stroke-width': Math.min(1.5, width),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    ...attrs,
  });
}
