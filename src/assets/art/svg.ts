/**
 * Minimal SVG document builder + geometry helpers used by every art module.
 *
 * Every def (gradient, clip path, filter, shared path) gets an id built from
 * the document prefix (a hash of the spec) and a counter, so several outputs
 * can be inlined into one HTML document without id collisions.
 */
import { clamp, f, f2, type Pt } from './util';

export type Attrs = Record<string, string | number | undefined | null | false>;

function attrString(attrs: Attrs | undefined): string {
  if (!attrs) return '';
  let s = '';
  for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    s += ` ${k}="${typeof v === 'number' ? f2(v) : v}"`;
  }
  return s;
}

/** Generic element. `children` undefined → self-closing. */
export function el(tag: string, attrs?: Attrs, children?: string | string[]): string {
  const a = attrString(attrs);
  if (children === undefined) return `<${tag}${a}/>`;
  const c = Array.isArray(children) ? children.join('') : children;
  return `<${tag}${a}>${c}</${tag}>`;
}

export const path = (d: string, fill: string, attrs?: Attrs): string => el('path', { d, fill, ...attrs });

export const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string, attrs?: Attrs): string =>
  el('ellipse', { cx: f(cx), cy: f(cy), rx: f(Math.max(0, rx)), ry: f(Math.max(0, ry)), fill, ...attrs });

export const circle = (cx: number, cy: number, r: number, fill: string, attrs?: Attrs): string =>
  el('circle', { cx: f(cx), cy: f(cy), r: f(Math.max(0, r)), fill, ...attrs });

export const rect = (x: number, y: number, w: number, h: number, fill: string, attrs?: Attrs): string =>
  el('rect', { x: f(x), y: f(y), width: f(Math.max(0, w)), height: f(Math.max(0, h)), fill, ...attrs });

export const g = (children: string | string[], attrs?: Attrs): string => el('g', attrs, children);

/** Gradient stop: offset 0..1, color, optional opacity. */
export interface Stop {
  o: number;
  c: string;
  a?: number;
}

function stops(list: Stop[]): string {
  return list
    .map((s) =>
      el('stop', {
        offset: f2(clamp(s.o, 0, 1)),
        'stop-color': s.c,
        'stop-opacity': s.a === undefined || s.a >= 1 ? undefined : f2(clamp(s.a, 0, 1)),
      }),
    )
    .join('');
}

export interface GradOpts {
  /** Coordinates in user space (absolute) instead of the shape's bounding box (0..1). */
  user?: boolean;
  transform?: string;
  spread?: 'pad' | 'reflect' | 'repeat';
}

/**
 * Minimum size of the larger output dimension. Drawings use compact design
 * coordinates (the viewBox); flat items get larger intrinsic width/height so
 * consumers that rasterize at the natural size still get crisp pixels.
 */
export const MIN_EXTENT = 360;

/** Intrinsic output size for a drawing of w × h design units (see MIN_EXTENT). */
export function outputSize(w: number, h: number): { width: number; height: number } {
  const rw = Math.max(1, Math.round(w));
  const rh = Math.max(1, Math.round(h));
  const s = Math.max(1, MIN_EXTENT / Math.max(rw, rh));
  return { width: Math.max(1, Math.round(rw * s)), height: Math.max(1, Math.round(rh * s)) };
}

export class SvgDoc {
  private readonly defs: string[] = [];
  private readonly body: string[] = [];
  private counter = 0;

  constructor(
    readonly w: number,
    readonly h: number,
    private readonly prefix: string,
  ) {}

  /** New unique id. */
  uid(): string {
    return `${this.prefix}${(this.counter++).toString(36)}`;
  }

  add(...els: string[]): void {
    for (const e of els) if (e) this.body.push(e);
  }

  /** Raw def markup; caller supplies the id inside. */
  def(markup: string): void {
    this.defs.push(markup);
  }

  linear(list: Stop[], x1: number, y1: number, x2: number, y2: number, opts: GradOpts = {}): string {
    const id = this.uid();
    const fmt = opts.user ? f : f2;
    this.defs.push(
      el(
        'linearGradient',
        {
          id,
          x1: fmt(x1),
          y1: fmt(y1),
          x2: fmt(x2),
          y2: fmt(y2),
          gradientUnits: opts.user ? 'userSpaceOnUse' : undefined,
          gradientTransform: opts.transform,
          spreadMethod: opts.spread,
        },
        stops(list),
      ),
    );
    return `url(#${id})`;
  }

  radial(
    list: Stop[],
    cx: number,
    cy: number,
    r: number,
    opts: GradOpts & { fx?: number; fy?: number } = {},
  ): string {
    const id = this.uid();
    const fmt = opts.user ? f : f2;
    this.defs.push(
      el(
        'radialGradient',
        {
          id,
          cx: fmt(cx),
          cy: fmt(cy),
          r: fmt(r),
          fx: opts.fx === undefined ? undefined : fmt(opts.fx),
          fy: opts.fy === undefined ? undefined : fmt(opts.fy),
          gradientUnits: opts.user ? 'userSpaceOnUse' : undefined,
          gradientTransform: opts.transform,
          spreadMethod: opts.spread,
        },
        stops(list),
      ),
    );
    return `url(#${id})`;
  }

  /** Clip path from shapes (paths/use elements). Returns `url(#id)`. */
  clip(inner: string): string {
    const id = this.uid();
    this.defs.push(el('clipPath', { id }, inner));
    return `url(#${id})`;
  }

  /** Gaussian blur filter with a generous filter region. Returns `url(#id)`. */
  blur(std: number): string {
    const id = this.uid();
    this.defs.push(
      el(
        'filter',
        { id, x: '-50%', y: '-50%', width: '200%', height: '200%', 'color-interpolation-filters': 'sRGB' },
        el('feGaussianBlur', { stdDeviation: f2(std) }),
      ),
    );
    return `url(#${id})`;
  }

  /** Store a path in <defs> (no fill) and return its id, to be drawn via `use()` and/or clipped to. */
  shared(d: string): string {
    const id = this.uid();
    this.defs.push(el('path', { id, d }));
    return id;
  }

  /** Intrinsic width attribute of the output (viewBox stays in design units). */
  get outWidth(): number {
    return outputSize(this.w, this.h).width;
  }

  /** Intrinsic height attribute of the output. */
  get outHeight(): number {
    return outputSize(this.w, this.h).height;
  }

  toString(): string {
    const w = Math.round(this.w);
    const h = Math.round(this.h);
    const defs = this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.outWidth}" height="${this.outHeight}" viewBox="0 0 ${w} ${h}">` +
      defs +
      this.body.join('') +
      '</svg>'
    );
  }
}

/** `<use>` of a shared def. */
export const use = (id: string, attrs?: Attrs): string => el('use', { href: `#${id}`, ...attrs });


// ---------------------------------------------------------------------------
// Path geometry
// ---------------------------------------------------------------------------

/** Number → shortest SVG token at a given precision factor (k = 10^decimals). */
function tok(v: number, k: number): string {
  const r = Math.round(v * k) / k;
  return r === 0 ? '0' : String(r);
}

/**
 * Compact path writer: takes absolute coordinates, emits the first point of
 * each subpath absolute and everything else relative, rounded to `dec`
 * decimals without drift (deltas are taken between rounded points), and
 * omits separators before negative numbers.
 */
export class PathW {
  private out = '';
  private x = 0;
  private y = 0;
  private sx = 0;
  private sy = 0;
  private readonly k: number;

  constructor(dec = 1) {
    this.k = 10 ** dec;
  }

  private rd(v: number): number {
    return Math.round(v * this.k) / this.k;
  }

  private nums(vals: number[]): string {
    let s = '';
    for (let i = 0; i < vals.length; i++) {
      const t = tok(vals[i], this.k);
      s += i === 0 || t[0] === '-' ? t : ' ' + t;
    }
    return s;
  }

  /** Relative delta between rounded absolute values. */
  private dx(v: number): number {
    return Math.round((this.rd(v) - this.x) * this.k) / this.k;
  }
  private dy(v: number): number {
    return Math.round((this.rd(v) - this.y) * this.k) / this.k;
  }
  private moveTo(x: number, y: number): void {
    this.x = this.rd(x);
    this.y = this.rd(y);
  }

  M(x: number, y: number): this {
    this.moveTo(x, y);
    this.sx = this.x;
    this.sy = this.y;
    this.out += 'M' + this.nums([this.x, this.y]);
    return this;
  }
  L(x: number, y: number): this {
    this.out += 'l' + this.nums([this.dx(x), this.dy(y)]);
    this.moveTo(x, y);
    return this;
  }
  Q(x1: number, y1: number, x: number, y: number): this {
    this.out += 'q' + this.nums([this.dx(x1), this.dy(y1), this.dx(x), this.dy(y)]);
    this.moveTo(x, y);
    return this;
  }
  C(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.out += 'c' + this.nums([this.dx(x1), this.dy(y1), this.dx(x2), this.dy(y2), this.dx(x), this.dy(y)]);
    this.moveTo(x, y);
    return this;
  }
  /** Elliptical arc to (x, y). */
  A(rx: number, ry: number, rot: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number): this {
    this.out += 'a' + this.nums([this.rd(rx), this.rd(ry), rot]) + ` ${large} ${sweep} ` + this.nums([this.dx(x), this.dy(y)]);
    this.moveTo(x, y);
    return this;
  }
  Z(): this {
    this.out += 'z';
    this.x = this.sx;
    this.y = this.sy;
    return this;
  }
  toString(): string {
    return this.out;
  }
}

/** Straight polygon (closed). */
export function polygon(pts: Pt[], dec = 1): string {
  if (!pts.length) return '';
  const p = new PathW(dec).M(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) p.L(pts[i].x, pts[i].y);
  return p.Z().toString();
}

/**
 * Smooth closed curve through-ish the control points using a quadratic
 * B-spline (midpoints as on-curve anchors). Compact output, no overshoot.
 */
export function smoothClosed(pts: Pt[], dec = 0): string {
  const n = pts.length;
  if (n < 3) return polygon(pts, dec);
  const mx = (i: number): number => (pts[i % n].x + pts[(i + 1) % n].x) / 2;
  const my = (i: number): number => (pts[i % n].y + pts[(i + 1) % n].y) / 2;
  const p = new PathW(dec).M(mx(n - 1), my(n - 1));
  for (let i = 0; i < n; i++) p.Q(pts[i].x, pts[i].y, mx(i), my(i));
  return p.Z().toString();
}

/** Append a Catmull-Rom spline through `pts` (starting at the current point pts[0]). */
function catmull(p: PathW, pts: Pt[]): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    p.C(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    );
  }
}

/** Catmull-Rom spline through points (open), as cubic Béziers. */
export function smoothOpen(pts: Pt[], dec = 1): string {
  if (pts.length < 2) return '';
  const p = new PathW(dec).M(pts[0].x, pts[0].y);
  catmull(p, pts);
  return p.toString();
}

/** Point on a quadratic Bézier. */
export function quadAt(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}

/** Sample a Catmull-Rom spline through control points into a polyline (n samples per span). */
export function splinePts(ctrl: Pt[], n = 8): Pt[] {
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

/**
 * Filled tapered "stroke" along a centerline (trunks, branches, stems, grass
 * blades). Width interpolates w0 → w1 with an easing exponent. Returns a
 * closed path; `round` gives rounded ends.
 */
export function taper(center: Pt[], w0: number, w1: number, opts: { round?: boolean; ease?: number; dec?: number } = {}): string {
  const n = center.length;
  if (n < 2) return '';
  const dec = opts.dec ?? 1;
  const ease = opts.ease ?? 1;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = center[Math.max(0, i - 1)];
    const b = center[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const t = i / (n - 1);
    const w = (w0 + (w1 - w0) * Math.pow(t, ease)) / 2;
    left.push({ x: center[i].x - dy * w, y: center[i].y + dx * w });
    right.push({ x: center[i].x + dy * w, y: center[i].y - dx * w });
  }
  const back = right.reverse();
  if (opts.round) return smoothClosed([...left, ...back], dec);
  // Smooth sides, sharp ends: Catmull-Rom along each side.
  const p = new PathW(dec).M(left[0].x, left[0].y);
  catmull(p, left);
  p.L(back[0].x, back[0].y);
  catmull(p, back);
  return p.Z().toString();
}

/**
 * Leaf shape (pointed ellipse) from base point along angle `ang` (radians, 0 =
 * right, -π/2 = up) with length and max width; `bend` curves it sideways.
 */
export function leafPath(base: Pt, ang: number, len: number, width: number, bend = 0, dec = 1): string {
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const px = -sin;
  const py = cos;
  const bx = px * bend * len;
  const by = py * bend * len;
  const at = (along: number, side: number, b: number): [number, number] => [
    base.x + cos * len * along + px * width * side + bx * b,
    base.y + sin * len * along + py * width * side + by * b,
  ];
  const [c1x, c1y] = at(0.3, 0.62, 0.6);
  const [c2x, c2y] = at(0.75, 0.5, 1);
  const [c3x, c3y] = at(0.75, -0.5, 1);
  const [c4x, c4y] = at(0.3, -0.62, 0.6);
  const [tx, ty] = at(1, 0, 0.8);
  return new PathW(dec).M(base.x, base.y).C(c1x, c1y, c2x, c2y, tx, ty).C(c3x, c3y, c4x, c4y, base.x, base.y).Z().toString();
}

/** Rounded rectangle path with independent top/bottom radii. */
export function roundRect(x: number, y: number, w: number, h: number, rTop: number, rBottom = rTop): string {
  const rt = Math.min(rTop, w / 2, h / 2);
  const rb = Math.min(rBottom, w / 2, h / 2);
  return new PathW(1)
    .M(x + rt, y)
    .L(x + w - rt, y)
    .Q(x + w, y, x + w, y + rt)
    .L(x + w, y + h - rb)
    .Q(x + w, y + h, x + w - rb, y + h)
    .L(x + rb, y + h)
    .Q(x, y + h, x, y + h - rb)
    .L(x, y + rt)
    .Q(x, y, x + rt, y)
    .Z()
    .toString();
}

/** Ellipse as a path (for merging into multi-subpath paths). */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number, dec = 1): string {
  const k = 10 ** dec;
  const a = tok(rx, k);
  const b = tok(ry, k);
  const d = tok(2 * rx, k);
  return `M${tok(cx - rx, k)} ${tok(cy, k)}a${a} ${b} 0 1 0 ${d} 0a${a} ${b} 0 1 0-${d} 0z`;
}
