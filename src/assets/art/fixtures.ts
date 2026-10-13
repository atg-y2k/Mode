/**
 * Light fixture illustrations for every FixtureForm: metal parts use
 * cylindrical finish gradients with a specular streak; glass and fabric
 * shades are slightly translucent and shown lit (warm inner glow), since the
 * compositor adds the actual light spill separately.
 */
import type { ArtResult, FixtureArt, FixtureForm } from '../../../shared/art';
import { SvgDoc, ellipsePath, el, g, outputSize, path, rect, roundRect, smoothOpen, splinePts, taper, PathW, type Stop } from './svg';
import { f, luminance, mix, normHex, tone, type Pt } from './util';

interface FxCtx {
  doc: SvgDoc;
  finish: string;
  shade: string;
  /** Whether the spec provided a shade color (else a neutral default is used). */
  customShade: boolean;
  w: number;
  h: number;
}

interface FixtureDef {
  w: number;
  h: number;
  /** Where light emits, 0..1 from the top of the art. */
  emitterY: number;
  /** Base / mounting contact, 0..1 from the top (default 1 = bottom edge). */
  anchorY?: number;
  draw(c: FxCtx): void;
}

const DEFAULT_SHADE = '#f3ead8';
const WARM_CORE = '#fffaf0';
const WARM_MID = '#ffe2a0';
const WARM_EDGE = '#ffc861';

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** Brushed-metal stops: dark rim, specular streak left of center, falloff to the right. */
export function metalStops(finish: string): Stop[] {
  const lum = luminance(finish);
  const spec = lum < 0.04 ? mix(finish, '#b9b9b9', 0.5) : lum < 0.25 ? tone(finish, 0.55) : tone(finish, 0.72);
  return [
    { o: 0, c: tone(finish, -0.55) },
    { o: 0.16, c: tone(finish, -0.08) },
    { o: 0.32, c: spec },
    { o: 0.44, c: tone(finish, 0.12) },
    { o: 0.72, c: tone(finish, -0.25) },
    { o: 1, c: tone(finish, -0.6) },
  ];
}

const metalH = (c: FxCtx, finish = c.finish): string => c.doc.linear(metalStops(finish), 0, 0, 1, 0);
const metalV = (c: FxCtx, finish = c.finish): string => c.doc.linear(metalStops(finish), 0, 0, 0, 1);

/** Lit translucent glass / fabric: warm glowing center fading to the tinted edge. */
function litGlass(c: FxCtx, color = c.shade, strength = 1): string {
  return c.doc.radial(
    [
      { o: 0, c: WARM_CORE, a: 0.95 },
      { o: 0.35, c: mix(color, WARM_MID, 0.45 * strength), a: 0.9 },
      { o: 1, c: tone(color, -0.18), a: 0.78 },
    ],
    0.5,
    0.55,
    0.6,
  );
}

/** Soft glow disc (radial, transparent edge) around a bulb. */
function glow(c: FxCtx, x: number, y: number, r: number, a = 0.85): string {
  const fill = c.doc.radial(
    [
      { o: 0, c: WARM_CORE, a },
      { o: 0.3, c: WARM_MID, a: a * 0.7 },
      { o: 1, c: WARM_EDGE, a: 0 },
    ],
    0.5,
    0.5,
    0.5,
  );
  return path(ellipsePath(x, y, r, r), fill);
}

/** Small bright bulb with a glint. */
function bulb(c: FxCtx, x: number, y: number, r: number): string[] {
  return [glow(c, x, y, r * 2.6, 0.7), path(ellipsePath(x, y, r, r), WARM_CORE), path(ellipsePath(x - r * 0.3, y - r * 0.35, r * 0.35, r * 0.3), '#ffffff', { opacity: 0.9 })];
}

/** Glass highlight streak (thin crescent). */
function glint(x: number, y0: number, y1: number, width: number, opacity = 0.45): string {
  return path(taper([{ x, y: y0 }, { x: x - width * 0.4, y: (y0 + y1) / 2 }, { x, y: y1 }], width, width * 0.3), '#ffffff', { opacity });
}

/** Thin hanging cord / chain from the top. */
function cord(c: FxCtx, x: number, y0: number, y1: number): string[] {
  const col = luminance(c.finish) < 0.1 ? '#1d1d1d' : tone(c.finish, -0.4);
  return [rect(x - 1.1, y0, 2.2, y1 - y0, col), rect(x - 0.4, y0, 0.6, y1 - y0, '#ffffff', { opacity: 0.25 })];
}

/** Small ceiling canopy at the top of a pendant. */
function canopyCap(c: FxCtx, x: number, y: number, w: number): string {
  return path(roundRect(x - w / 2, y, w, w * 0.18, 2, w * 0.08), metalH(c));
}

/** Wall backplate (rounded rect). */
function backplate(c: FxCtx, x: number, y: number, w: number, h: number): string[] {
  return [
    path(roundRect(x - w / 2 + 1.5, y + 2, w, h, w * 0.25), '#000000', { opacity: 0.18 }),
    path(roundRect(x - w / 2, y, w, h, w * 0.25), metalH(c)),
  ];
}

// ---------------------------------------------------------------------------
// Ceiling fixtures
// ---------------------------------------------------------------------------

function recessed(c: FxCtx): void {
  const { doc, w } = c;
  const cx = w / 2;
  const cy = 30;
  const trim = c.finish;
  doc.add(
    path(ellipsePath(cx, cy, w * 0.46, 24), doc.linear(metalStops(trim), 0, 0, 0, 1)),
    path(ellipsePath(cx, cy - 1, w * 0.4, 19), tone(trim, -0.45)),
    path(ellipsePath(cx, cy - 3, w * 0.36, 15), doc.linear([{ o: 0, c: '#222222' }, { o: 1, c: '#6d6d6d' }], 0, 0, 0, 1)),
    path(ellipsePath(cx, cy, w * 0.24, 10), c.doc.radial([{ o: 0, c: WARM_CORE }, { o: 0.6, c: WARM_MID }, { o: 1, c: WARM_EDGE, a: 0.6 }], 0.5, 0.5, 0.5)),
    path(ellipsePath(cx - w * 0.06, cy - 3, w * 0.08, 3), '#ffffff', { opacity: 0.7 }),
  );
}

function pendantDome(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  doc.add(canopyCap(c, cx, 0, w * 0.3), ...cord(c, cx, w * 0.05, h * 0.42));
  const top = h * 0.42;
  const bot = h * 0.9;
  const rx = w * 0.47;
  const ry = rx * 0.16;
  const inner = c.customShade ? c.shade : '#f4f1ea';
  // Inner surface (visible through the bottom opening), then the bulb glow.
  doc.add(path(ellipsePath(cx, bot, rx * 0.97, ry), litGlass(c, inner)));
  doc.add(...bulb(c, cx, bot - ry * 0.2, w * 0.07));
  // Dome body.
  const body = new PathW(1)
    .M(cx - w * 0.06, top)
    .C(cx - w * 0.06, top - 6, cx + w * 0.06, top - 6, cx + w * 0.06, top)
    .C(cx + w * 0.12, top + 8, cx + rx * 0.55, top + (bot - top) * 0.25, cx + rx * 0.8, bot - (bot - top) * 0.35)
    .C(cx + rx * 0.95, bot - (bot - top) * 0.12, cx + rx, bot - 3, cx + rx, bot)
    .C(cx + rx * 0.6, bot - ry * 1.2, cx - rx * 0.6, bot - ry * 1.2, cx - rx, bot)
    .C(cx - rx, bot - 3, cx - rx * 0.95, bot - (bot - top) * 0.12, cx - rx * 0.8, bot - (bot - top) * 0.35)
    .C(cx - rx * 0.55, top + (bot - top) * 0.25, cx - w * 0.12, top + 8, cx - w * 0.06, top)
    .Z()
    .toString();
  doc.add(path(body, metalH(c)));
  doc.add(path(body, doc.linear([{ o: 0, c: '#ffffff', a: 0.12 }, { o: 0.5, c: '#ffffff', a: 0 }, { o: 1, c: '#000000', a: 0.18 }], 0, 0, 0, 1)));
  // Rim lip.
  doc.add(
    el('path', {
      d: `M${f(cx - rx)} ${f(bot)}A${f(rx)} ${f(ry)} 0 0 0 ${f(cx + rx)} ${f(bot)}`,
      fill: 'none',
      stroke: tone(c.finish, 0.4),
      'stroke-width': 1.5,
      'stroke-opacity': 0.8,
    }),
  );
}

function pendantGlobe(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  const r = w * 0.45;
  const cy = h - r - 4;
  doc.add(canopyCap(c, cx, 0, w * 0.32), ...cord(c, cx, w * 0.05, cy - r + 6));
  // Socket cap.
  doc.add(path(roundRect(cx - w * 0.09, cy - r - 8, w * 0.18, 18, 3, 6), metalH(c)));
  const glassCol = c.customShade ? c.shade : '#f4efe4';
  doc.add(path(ellipsePath(cx, cy, r, r), litGlass(c, glassCol, 1.1)));
  doc.add(...bulb(c, cx, cy + r * 0.05, r * 0.2));
  doc.add(
    path(ellipsePath(cx, cy, r, r), doc.radial([{ o: 0.6, c: '#000000', a: 0 }, { o: 1, c: tone(glassCol, -0.5), a: 0.35 }], 0.5, 0.5, 0.5)),
    glint(cx - r * 0.55, cy - r * 0.6, cy + r * 0.2, r * 0.14, 0.55),
  );
}

function pendantCage(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  doc.add(canopyCap(c, cx, 0, w * 0.34), ...cord(c, cx, w * 0.06, h * 0.4));
  const top = h * 0.4;
  const bot = h - 6;
  const rx = w * 0.42;
  doc.add(path(roundRect(cx - w * 0.1, top - 6, w * 0.2, 22, 3, 5), metalH(c)));
  // Edison bulb (amber glass, filament) inside the cage.
  const by = top + (bot - top) * 0.52;
  doc.add(glow(c, cx, by, w * 0.42, 0.55));
  const bulbD = new PathW(1)
    .M(cx - w * 0.07, top + 18)
    .C(cx - w * 0.07, top + 34, cx - w * 0.2, by - 20, cx - w * 0.2, by + 6)
    .C(cx - w * 0.2, by + 34, cx + w * 0.2, by + 34, cx + w * 0.2, by + 6)
    .C(cx + w * 0.2, by - 20, cx + w * 0.07, top + 34, cx + w * 0.07, top + 18)
    .Z()
    .toString();
  doc.add(path(bulbD, doc.radial([{ o: 0, c: '#fff4d6', a: 0.95 }, { o: 1, c: '#e8a64a', a: 0.6 }], 0.5, 0.6, 0.6)));
  doc.add(
    el('path', {
      d: smoothOpen([{ x: cx - 7, y: by - 18 }, { x: cx - 4, y: by + 8 }, { x: cx, y: by - 4 }, { x: cx + 4, y: by + 8 }, { x: cx + 7, y: by - 18 }]),
      fill: 'none',
      stroke: '#ff9f2e',
      'stroke-width': 1.2,
    }),
    glint(cx - w * 0.12, by - 12, by + 12, 4, 0.6),
  );
  // Cage: vertical ribs (curved) + rings, drawn as thin filled strokes.
  const wire = luminance(c.finish) < 0.1 ? '#1b1b1b' : tone(c.finish, -0.2);
  const ribs: string[] = [];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    const k = Math.cos(u * Math.PI);
    const pts: Pt[] = [];
    for (let j = 0; j <= 8; j++) {
      const v = j / 8;
      const bulge = Math.sin(v * Math.PI) * 0.85 + 0.15;
      pts.push({ x: cx + k * rx * bulge, y: top + 12 + v * (bot - top - 12) });
    }
    ribs.push(taper(pts, 2, 2));
  }
  for (const v of [0.35, 0.65, 1]) {
    const y = top + 12 + v * (bot - top - 12);
    const bulge = Math.sin(v * Math.PI) * 0.85 + 0.15;
    ribs.push(taper([{ x: cx - rx * bulge, y }, { x: cx, y: y + 5 }, { x: cx + rx * bulge, y }], 2, 2));
  }
  doc.add(path(ribs.join(''), wire));
  doc.add(path(ellipsePath(cx, bot, w * 0.06, 3), wire));
}

function chandelier(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  doc.add(canopyCap(c, cx, 0, w * 0.2), ...cord(c, cx, w * 0.03, h * 0.28));
  const hubY = h * 0.6;
  // Central column with turned details.
  const col = new PathW(1)
    .M(cx - 6, h * 0.28)
    .L(cx + 6, h * 0.28)
    .C(cx + 6, h * 0.36, cx + 20, h * 0.42, cx + 18, h * 0.5)
    .C(cx + 16, h * 0.56, cx + 30, hubY, cx + 26, hubY + 14)
    .C(cx + 20, hubY + 30, cx + 8, h * 0.8, cx + 4, h * 0.9)
    .L(cx - 4, h * 0.9)
    .C(cx - 8, h * 0.8, cx - 20, hubY + 30, cx - 26, hubY + 14)
    .C(cx - 30, hubY, cx - 16, h * 0.56, cx - 18, h * 0.5)
    .C(cx - 20, h * 0.42, cx - 6, h * 0.36, cx - 6, h * 0.28)
    .Z()
    .toString();
  // Arms: back arms first (shorter, higher), then front arms over the column.
  const arms = [
    { reach: 0.3, lift: 0.05, back: true },
    { reach: 0.44, lift: 0, back: false },
    { reach: 0.22, lift: 0.02, back: false },
  ];
  const armCol = metalV(c);
  const drawArm = (side: number, a: { reach: number; lift: number }): void => {
    const end = { x: cx + side * w * a.reach, y: hubY - h * 0.1 - h * a.lift };
    const pts = splinePts(
      [
        { x: cx + side * 10, y: hubY + 10 },
        { x: cx + side * w * a.reach * 0.45, y: hubY + h * 0.08 },
        { x: end.x - side * 6, y: end.y + h * 0.1 },
        { x: end.x, y: end.y + 6 },
      ],
      6,
    );
    doc.add(path(taper(pts, 5, 4), armCol));
    // Bobeche, candle sleeve, flame bulb.
    const sleeve = c.customShade ? c.shade : '#f6f2ea';
    doc.add(path(ellipsePath(end.x, end.y + 6, 13, 4.5), metalH(c)));
    doc.add(path(roundRect(end.x - 5, end.y - 22, 10, 28, 1.5), doc.linear([{ o: 0, c: tone(sleeve, -0.2) }, { o: 0.35, c: '#ffffff' }, { o: 1, c: tone(sleeve, -0.3) }], 0, 0, 1, 0)));
    doc.add(glow(c, end.x, end.y - 32, 22, 0.7));
    const flame = new PathW(1).M(end.x, end.y - 44).C(end.x + 7, end.y - 34, end.x + 6, end.y - 22, end.x, end.y - 22).C(end.x - 6, end.y - 22, end.x - 7, end.y - 34, end.x, end.y - 44).Z().toString();
    doc.add(path(flame, doc.radial([{ o: 0, c: '#ffffff' }, { o: 1, c: WARM_MID }], 0.5, 0.7, 0.6)));
  };
  for (const side of [-1, 1]) drawArm(side, arms[0]);
  doc.add(path(col, metalH(c)));
  for (const side of [-1, 1]) {
    drawArm(side, arms[1]);
    drawArm(side, arms[2]);
  }
  doc.add(path(ellipsePath(cx, h * 0.92, 6, 6), metalH(c)));
}

function flushMount(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  doc.add(path(roundRect(cx - w * 0.47, 0, w * 0.94, h * 0.18, 2, 4), metalV(c)));
  const glass = c.customShade ? c.shade : '#f6f1e7';
  const d = new PathW(1)
    .M(cx - w * 0.45, h * 0.18)
    .C(cx - w * 0.45, h * 0.75, cx - w * 0.2, h * 0.92, cx, h * 0.92)
    .C(cx + w * 0.2, h * 0.92, cx + w * 0.45, h * 0.75, cx + w * 0.45, h * 0.18)
    .Z()
    .toString();
  doc.add(path(d, litGlass(c, glass, 1.1)));
  doc.add(path(d, doc.linear([{ o: 0, c: '#000000', a: 0.18 }, { o: 0.4, c: '#000000', a: 0 }], 0, 0, 0, 1)));
  doc.add(glint(cx - w * 0.3, h * 0.25, h * 0.7, 6, 0.4));
  doc.add(path(ellipsePath(cx, h * 0.92, 7, 5), metalH(c)));
}

function track(c: FxCtx): void {
  const { doc, w, h } = c;
  doc.add(path(roundRect(4, 4, w - 8, h * 0.14, 3), metalV(c)));
  const heads = [
    { x: w * 0.2, ang: 0.5 },
    { x: w * 0.5, ang: 0.1 },
    { x: w * 0.8, ang: -0.45 },
  ];
  for (const hd of heads) {
    const y0 = 4 + h * 0.14;
    doc.add(path(roundRect(hd.x - 3.5, y0, 7, h * 0.18, 1), metalH(c)));
    const pivot = { x: hd.x, y: y0 + h * 0.2 };
    doc.add(path(ellipsePath(pivot.x, pivot.y, 6, 6), metalH(c)));
    // Cylinder head pointing down at an angle.
    const len = h * 0.55;
    const r = h * 0.17;
    const deg = (hd.ang * 180) / Math.PI;
    doc.add(
      g(
        [
          path(roundRect(-r, -6, r * 2, len, 4, 2), metalH(c)),
          path(ellipsePath(0, len - 6, r * 0.92, r * 0.32), doc.radial([{ o: 0, c: WARM_CORE }, { o: 0.7, c: WARM_MID }, { o: 1, c: WARM_EDGE, a: 0.7 }], 0.5, 0.5, 0.5)),
        ],
        { transform: `translate(${f(pivot.x)} ${f(pivot.y)}) rotate(${f(deg)})` },
      ),
    );
  }
}

function ceilingFan(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  doc.add(canopyCap(c, cx, 0, w * 0.12), path(roundRect(cx - 3.5, w * 0.02, 7, h * 0.3, 2), metalH(c)));
  const hubY = h * 0.42;
  const bladeCol = luminance(c.finish) < 0.08 ? '#2c2622' : mix(c.finish, '#5b4332', 0.55);
  // Blades in perspective: back blades thinner, front blades wider.
  const blades = [
    { a: -2.6, back: true },
    { a: -0.55, back: true },
    { a: 1.57, back: false },
    { a: 0.2, back: false },
    { a: 2.95, back: false },
  ];
  const drawBlade = (ang: number): void => {
    const L = w * 0.47;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang) * 0.22;
    const tip = { x: cx + dx * L, y: hubY + dy * L + 6 };
    const wid = 20 + Math.abs(Math.sin(ang)) * 26;
    const base = { x: cx + dx * 30, y: hubY + dy * 30 + 3 };
    const nx = -dy;
    const ny = dx;
    const nl = Math.hypot(nx, ny) || 1;
    const ox = (nx / nl) * wid * 0.5;
    const oy = (ny / nl) * wid * 0.5 * 0.55 + wid * 0.1;
    const d = new PathW(1)
      .M(base.x - ox * 0.6, base.y - oy * 0.6)
      .L(tip.x - ox, tip.y - oy)
      .Q(tip.x + dx * 8, tip.y + dy * 8, tip.x + ox, tip.y + oy)
      .L(base.x + ox * 0.6, base.y + oy * 0.6)
      .Z()
      .toString();
    doc.add(path(d, doc.linear([{ o: 0, c: tone(bladeCol, 0.2) }, { o: 1, c: tone(bladeCol, -0.3) }], 0, 0, 0, 1)));
    doc.add(path(roundRect(base.x - 9, base.y - 3, 18, 6, 2), metalV(c)));
  };
  for (const b of blades.filter((b) => b.back)) drawBlade(b.a);
  // Motor housing.
  doc.add(path(ellipsePath(cx, hubY, w * 0.11, h * 0.14), metalH(c)));
  doc.add(path(roundRect(cx - w * 0.11, hubY - 4, w * 0.22, 10, 3), metalV(c)));
  for (const b of blades.filter((b) => !b.back)) drawBlade(b.a);
  // Light kit bowl.
  const glass = c.customShade ? c.shade : '#f5f0e6';
  const bowl = new PathW(1)
    .M(cx - w * 0.08, hubY + h * 0.12)
    .C(cx - w * 0.08, hubY + h * 0.42, cx + w * 0.08, hubY + h * 0.42, cx + w * 0.08, hubY + h * 0.12)
    .Z()
    .toString();
  doc.add(path(roundRect(cx - w * 0.085, hubY + h * 0.08, w * 0.17, h * 0.05, 2), metalV(c)));
  doc.add(path(bowl, litGlass(c, glass, 1.2)));
  doc.add(glint(cx - w * 0.045, hubY + h * 0.16, hubY + h * 0.3, 3, 0.5));
}

// ---------------------------------------------------------------------------
// Wall fixtures
// ---------------------------------------------------------------------------

function sconce(c: FxCtx, up: boolean): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  doc.add(...backplate(c, cx, h * 0.38, w * 0.22, h * 0.36));
  // Arm reaching forward (seen front-on: a short collar).
  doc.add(path(roundRect(cx - w * 0.07, h * 0.5, w * 0.14, h * 0.08, 3), metalV(c)));
  const shadeCol = c.customShade ? c.shade : DEFAULT_SHADE;
  const topW = up ? w * 0.92 : w * 0.38;
  const botW = up ? w * 0.4 : w * 0.92;
  const y0 = up ? h * 0.08 : h * 0.56;
  const y1 = up ? h * 0.56 : h * 0.94;
  const ry = Math.max(topW, botW) * 0.09;
  const body = new PathW(1)
    .M(cx - topW / 2, y0)
    .L(cx + topW / 2, y0)
    .L(cx + botW / 2, y1)
    .Q(cx, y1 + ry * 2, cx - botW / 2, y1)
    .Z()
    .toString();
  if (up) {
    // Glow spilling from the open top, then the inside rim.
    doc.add(glow(c, cx, y0, w * 0.5, 0.6));
    doc.add(path(ellipsePath(cx, y0, topW / 2, ry), litGlass(c, shadeCol, 1.3)));
  }
  doc.add(path(body, c.customShade ? litGlass(c, shadeCol) : metalH(c)));
  if (!c.customShade) doc.add(path(body, doc.linear([{ o: 0, c: '#ffffff', a: 0.1 }, { o: 1, c: '#000000', a: 0.2 }], 0, 0, 0, 1)));
  doc.add(glint(cx - topW * 0.3, y0 + 4, y1 - 4, 4, 0.35));
  if (!up) {
    doc.add(path(ellipsePath(cx, y1, botW / 2, ry), litGlass(c, shadeCol, 1.3)));
    doc.add(...bulb(c, cx, y1 - 2, w * 0.06));
  }
}

function wallLantern(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  doc.add(...backplate(c, cx, h * 0.12, w * 0.3, h * 0.82));
  const lw = w * 0.86;
  const top = h * 0.2;
  const bodyTop = h * 0.34;
  const bodyBot = h * 0.8;
  // Roof (pyramid) + finial.
  doc.add(path(ellipsePath(cx, top - 10, 5, 5), metalH(c)), path(roundRect(cx - 3, top - 8, 6, 12, 1), metalH(c)));
  const roof = new PathW(1).M(cx - lw * 0.18, top).L(cx + lw * 0.18, top).L(cx + lw / 2 + 4, bodyTop).L(cx - lw / 2 - 4, bodyTop).Z().toString();
  doc.add(path(roof, metalH(c)), path(roof, doc.linear([{ o: 0, c: '#ffffff', a: 0.12 }, { o: 1, c: '#000000', a: 0.25 }], 0, 0, 0, 1)));
  doc.add(path(roundRect(cx - lw / 2 - 5, bodyTop - 2, lw + 10, 8, 2), metalV(c)));
  // Glass panels with candle bulb.
  const gx = cx - lw / 2 + 6;
  const gw = lw - 12;
  const glassCol = c.customShade ? c.shade : '#f3e6c4';
  doc.add(rect(gx, bodyTop + 6, gw, bodyBot - bodyTop - 10, litGlass(c, glassCol, 1.2)));
  doc.add(...bulb(c, cx, (bodyTop + bodyBot) / 2 + 4, w * 0.06));
  doc.add(rect(cx - 3, (bodyTop + bodyBot) / 2 + 10, 6, (bodyBot - bodyTop) * 0.3, '#f4efe6'));
  // Frame mullions.
  const frame = metalH(c);
  doc.add(
    rect(gx - 4, bodyTop + 4, 6, bodyBot - bodyTop - 6, frame),
    rect(gx + gw - 2, bodyTop + 4, 6, bodyBot - bodyTop - 6, frame),
    rect(cx - 1.5, bodyTop + 6, 3, bodyBot - bodyTop - 10, tone(c.finish, -0.2), { opacity: 0.8 }),
    glint(gx + gw * 0.22, bodyTop + 14, bodyBot - 14, 4, 0.4),
  );
  // Bottom cap.
  doc.add(path(roundRect(cx - lw / 2 - 2, bodyBot - 4, lw + 4, 10, 2), metalV(c)));
  const base = new PathW(1).M(cx - lw * 0.42, bodyBot + 6).L(cx + lw * 0.42, bodyBot + 6).L(cx + lw * 0.14, h * 0.9).L(cx - lw * 0.14, h * 0.9).Z().toString();
  doc.add(path(base, metalH(c)), path(ellipsePath(cx, h * 0.93, 4, 4), metalH(c)));
}

function stepLight(c: FxCtx): void {
  const { doc, w, h } = c;
  doc.add(path(roundRect(w * 0.06 + 1.5, h * 0.1 + 2, w * 0.88, h * 0.8, 6), '#000000', { opacity: 0.18 }));
  doc.add(path(roundRect(w * 0.06, h * 0.1, w * 0.88, h * 0.8, 6), metalV(c)));
  // Louvered opening with glow.
  const ox = w * 0.16;
  const oy = h * 0.3;
  const ow = w * 0.68;
  const oh = h * 0.42;
  doc.add(rect(ox, oy, ow, oh, doc.linear([{ o: 0, c: '#5a4a32' }, { o: 1, c: WARM_MID }], 0, 0, 0, 1), { rx: 3 }));
  for (let i = 0; i < 3; i++) {
    const y = oy + (oh / 3) * i + 1;
    doc.add(rect(ox, y, ow, oh / 3 - 5, metalV(c), { rx: 1.5 }));
  }
  doc.add(rect(ox, oy + oh - 4, ow, 4, WARM_CORE, { opacity: 0.9 }));
}

function floodLight(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  doc.add(...backplate(c, cx, h * 0.04, w * 0.24, h * 0.3));
  doc.add(path(roundRect(cx - w * 0.05, h * 0.2, w * 0.1, h * 0.22, 3), metalH(c)));
  doc.add(path(roundRect(cx - w * 0.3, h * 0.36, w * 0.6, h * 0.1, 4), metalV(c)));
  for (const side of [-1, 1]) {
    const px = cx + side * w * 0.25;
    const py = h * 0.45;
    const hw = w * 0.21;
    const hh = h * 0.42;
    const ang = side * 14;
    doc.add(
      g(
        [
          path(roundRect(-hw, 0, hw * 2, hh, 6), metalH(c)),
          path(roundRect(-hw + 5, hh * 0.18, hw * 2 - 10, hh * 0.72, 4), doc.linear([{ o: 0, c: WARM_CORE }, { o: 0.6, c: WARM_MID }, { o: 1, c: WARM_EDGE }], 0, 0, 0, 1)),
          path(roundRect(-hw + 5, hh * 0.18, hw * 2 - 10, hh * 0.18, 3), '#ffffff', { opacity: 0.35 }),
        ],
        { transform: `translate(${f(px)} ${f(py)}) rotate(${ang})` },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Lamps
// ---------------------------------------------------------------------------

/** Lit drum shade from y0 to y1 (top width tw, bottom width bw). */
function drumShade(c: FxCtx, cx: number, y0: number, y1: number, tw: number, bw: number): void {
  const { doc } = c;
  const col = c.customShade ? c.shade : DEFAULT_SHADE;
  const ry0 = tw * 0.08;
  const ry1 = bw * 0.08;
  const body = new PathW(1)
    .M(cx - tw / 2, y0)
    .Q(cx, y0 + ry0 * 2, cx + tw / 2, y0)
    .L(cx + bw / 2, y1)
    .Q(cx, y1 + ry1 * 2, cx - bw / 2, y1)
    .Z()
    .toString();
  // Inner back of the shade glowing through the top opening.
  doc.add(path(ellipsePath(cx, y0, tw / 2, ry0), mix(col, WARM_MID, 0.6)));
  doc.add(path(body, doc.linear([{ o: 0, c: mix(col, WARM_MID, 0.25) }, { o: 0.35, c: mix(col, WARM_CORE, 0.55) }, { o: 0.75, c: col }, { o: 1, c: tone(col, -0.3) }], 0, 0, 1, 0)));
  // Warm transmission brightest near the bulb (middle) + darker top band.
  doc.add(path(body, doc.radial([{ o: 0, c: WARM_CORE, a: 0.55 }, { o: 1, c: WARM_MID, a: 0 }], 0.45, 0.6, 0.55)));
  doc.add(path(body, doc.linear([{ o: 0, c: '#000000', a: 0.12 }, { o: 0.3, c: '#000000', a: 0 }], 0, 0, 0, 1)));
  doc.add(path(ellipsePath(cx, y1, bw / 2 - 1, ry1), WARM_MID, { opacity: 0.55 }));
}

function floorLamp(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  const baseY = h - 4;
  doc.add(path(ellipsePath(cx, baseY - 6, w * 0.32, 7), metalH(c)), rect(cx - w * 0.32, baseY - 12, w * 0.64, 6, metalH(c)));
  doc.add(path(ellipsePath(cx, baseY - 12, w * 0.32, 7), tone(c.finish, 0.15)));
  doc.add(rect(cx - 3, h * 0.3, 6, baseY - 12 - h * 0.3, metalH(c)));
  doc.add(path(roundRect(cx - 6, h * 0.55, 12, 10, 3), metalH(c)));
  drumShade(c, cx, h * 0.04, h * 0.3, w * 0.76, w * 0.94);
}

function tableLamp(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  const baseY = h - 4;
  // Ginger-jar base in the finish color.
  const bodyTop = h * 0.52;
  const body = new PathW(1)
    .M(cx - w * 0.1, bodyTop)
    .C(cx - w * 0.36, bodyTop + h * 0.06, cx - w * 0.34, baseY - h * 0.12, cx - w * 0.2, baseY - 6)
    .L(cx + w * 0.2, baseY - 6)
    .C(cx + w * 0.34, baseY - h * 0.12, cx + w * 0.36, bodyTop + h * 0.06, cx + w * 0.1, bodyTop)
    .Z()
    .toString();
  doc.add(path(roundRect(cx - w * 0.2, baseY - 8, w * 0.4, 8, 2), tone(c.finish, -0.35)));
  doc.add(path(body, metalH(c)));
  doc.add(glint(cx - w * 0.15, bodyTop + 12, baseY - 18, 5, 0.35));
  doc.add(rect(cx - 2.5, h * 0.36, 5, bodyTop - h * 0.36, tone(c.finish, -0.3)));
  drumShade(c, cx, h * 0.04, h * 0.42, w * 0.62, w * 0.94);
}

// ---------------------------------------------------------------------------
// Outdoor / landscape fixtures
// ---------------------------------------------------------------------------

function pathLight(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  // Post.
  doc.add(rect(cx - 4, h * 0.3, 8, h * 0.68, metalH(c)));
  doc.add(path(ellipsePath(cx, h - 4, w * 0.16, 3.5), tone(c.finish, -0.4)));
  // Diffuser + hat.
  const glass = c.customShade ? c.shade : '#f6efdc';
  doc.add(glow(c, cx, h * 0.22, w * 0.42, 0.6));
  doc.add(path(roundRect(cx - w * 0.17, h * 0.13, w * 0.34, h * 0.17, 3), litGlass(c, glass, 1.2)));
  doc.add(path(roundRect(cx - w * 0.12, h * 0.29, w * 0.24, h * 0.03, 2), metalV(c)));
  const hat = new PathW(1).M(cx, h * 0.02).L(cx + w * 0.47, h * 0.13).Q(cx, h * 0.17, cx - w * 0.47, h * 0.13).Z().toString();
  doc.add(path(hat, metalH(c)), path(hat, doc.linear([{ o: 0, c: '#ffffff', a: 0.15 }, { o: 1, c: '#000000', a: 0.3 }], 0, 0, 0, 1)));
}

function bollard(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  const bw = w * 0.7;
  doc.add(path(roundRect(cx - bw / 2, h * 0.08, bw, h * 0.9, 4, 2), metalH(c)));
  // Louvered window with glow.
  const wy = h * 0.12;
  const wh = h * 0.16;
  doc.add(rect(cx - bw / 2 + 3, wy, bw - 6, wh, doc.linear([{ o: 0, c: WARM_CORE }, { o: 1, c: WARM_MID }], 0, 0, 0, 1)));
  for (let i = 0; i < 4; i++) doc.add(rect(cx - bw / 2 + 2, wy + (wh / 4) * i + 1, bw - 4, wh / 8, metalV(c)));
  doc.add(path(roundRect(cx - bw / 2 - 2, h * 0.04, bw + 4, h * 0.06, 3), metalV(c)));
  doc.add(path(ellipsePath(cx, h - 3, bw * 0.6, 3), tone(c.finish, -0.5), { opacity: 0.6 }));
}

function spotlight(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w * 0.42;
  // Ground stake + knuckle.
  doc.add(rect(cx - 3, h * 0.55, 6, h * 0.43, tone(c.finish, -0.3)));
  doc.add(path(ellipsePath(cx, h * 0.55, 7, 7), metalH(c)));
  // Cylinder head aimed up and to the right with a glare-shield snoot.
  const len = w * 0.55;
  const r = h * 0.13;
  doc.add(
    g(
      [
        path(roundRect(-r * 0.5, -r, len, r * 2, 5), metalV(c)),
        path(roundRect(len - r * 0.6, -r * 1.12, r * 0.8, r * 2.24, 3), metalV(c)),
        path(ellipsePath(len + r * 0.2, 0, r * 0.32, r * 0.95), doc.radial([{ o: 0, c: WARM_CORE }, { o: 0.6, c: WARM_MID }, { o: 1, c: WARM_EDGE, a: 0.7 }], 0.5, 0.5, 0.5)),
      ],
      { transform: `translate(${f(cx)} ${f(h * 0.5)}) rotate(-38)` },
    ),
  );
}

function wellLight(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  const cy = h * 0.5;
  doc.add(
    path(ellipsePath(cx, cy + 2, w * 0.48, h * 0.42), '#000000', { opacity: 0.25 }),
    path(ellipsePath(cx, cy, w * 0.47, h * 0.4), doc.linear(metalStops(c.finish), 0, 0, 0, 1)),
    path(ellipsePath(cx, cy, w * 0.36, h * 0.28), tone(c.finish, -0.5)),
    path(ellipsePath(cx, cy, w * 0.32, h * 0.24), doc.radial([{ o: 0, c: WARM_CORE }, { o: 0.55, c: WARM_MID }, { o: 1, c: WARM_EDGE, a: 0.8 }], 0.5, 0.5, 0.5)),
    path(ellipsePath(cx - w * 0.1, cy - h * 0.08, w * 0.1, h * 0.05), '#ffffff', { opacity: 0.6 }),
  );
}

function stringLights(c: FxCtx): void {
  const { doc, w, h } = c;
  const x0 = 6;
  const x1 = w - 6;
  const y0 = h * 0.08;
  const sag = h * 0.4;
  const at = (u: number): Pt => ({ x: x0 + (x1 - x0) * u, y: y0 + sag * 4 * u * (1 - u) });
  const pts: Pt[] = [];
  for (let i = 0; i <= 16; i++) pts.push(at(i / 16));
  const wireCol = luminance(c.finish) < 0.1 ? '#1e1e1e' : tone(c.finish, -0.3);
  doc.add(el('path', { d: smoothOpen(pts), fill: 'none', stroke: wireCol, 'stroke-width': 1.5, 'stroke-linecap': 'round' }));
  const n = 9;
  const glass = c.customShade ? c.shade : '#fff4dc';
  for (let i = 0; i < n; i++) {
    const p = at((i + 0.5) / n);
    doc.add(rect(p.x - 3.5, p.y, 7, 10, wireCol, { rx: 1.5 }));
    const by = p.y + 10 + 11;
    doc.add(glow(c, p.x, by, 24, 0.6));
    doc.add(path(ellipsePath(p.x, by, 10, 11), litGlass(c, glass, 1.2)));
    doc.add(path(ellipsePath(p.x - 3.5, by - 4, 3, 2.5), '#ffffff', { opacity: 0.8 }));
  }
}

function postLantern(c: FxCtx): void {
  const { doc, w, h } = c;
  const cx = w / 2;
  const baseY = h - 4;
  // Post with a flared base.
  const base = new PathW(1).M(cx - w * 0.3, baseY).L(cx + w * 0.3, baseY).L(cx + w * 0.12, baseY - h * 0.08).L(cx - w * 0.12, baseY - h * 0.08).Z().toString();
  doc.add(path(base, metalH(c)));
  doc.add(rect(cx - w * 0.07, h * 0.4, w * 0.14, baseY - h * 0.08 - h * 0.4, metalH(c)));
  doc.add(path(roundRect(cx - w * 0.12, h * 0.38, w * 0.24, 12, 2), metalV(c)));
  // Lantern head.
  const lw = w * 0.7;
  const top = h * 0.06;
  const bodyTop = h * 0.13;
  const bodyBot = h * 0.33;
  doc.add(path(ellipsePath(cx, top - 6, 4, 4), metalH(c)));
  const roof = new PathW(1).M(cx - lw * 0.15, top).L(cx + lw * 0.15, top).L(cx + lw / 2 + 4, bodyTop).L(cx - lw / 2 - 4, bodyTop).Z().toString();
  doc.add(path(roof, metalH(c)), path(roof, doc.linear([{ o: 0, c: '#ffffff', a: 0.12 }, { o: 1, c: '#000000', a: 0.25 }], 0, 0, 0, 1)));
  const glass = c.customShade ? c.shade : '#f3e6c4';
  const glassD = new PathW(1).M(cx - lw / 2 + 3, bodyTop + 2).L(cx + lw / 2 - 3, bodyTop + 2).L(cx + lw * 0.32, bodyBot).L(cx - lw * 0.32, bodyBot).Z().toString();
  doc.add(path(glassD, litGlass(c, glass, 1.2)));
  doc.add(...bulb(c, cx, (bodyTop + bodyBot) / 2, w * 0.07));
  const frame = metalH(c);
  doc.add(
    path(taper([{ x: cx - lw / 2 + 3, y: bodyTop + 2 }, { x: cx - lw * 0.32, y: bodyBot }], 4, 4), frame),
    path(taper([{ x: cx + lw / 2 - 3, y: bodyTop + 2 }, { x: cx + lw * 0.32, y: bodyBot }], 4, 4), frame),
    rect(cx - 1.2, bodyTop + 2, 2.4, bodyBot - bodyTop - 2, tone(c.finish, -0.2), { opacity: 0.8 }),
    path(roundRect(cx - lw * 0.36, bodyBot - 2, lw * 0.72, 8, 2), metalV(c)),
    glint(cx - lw * 0.25, bodyTop + 8, bodyBot - 6, 3, 0.4),
  );
}

function ledStrip(c: FxCtx): void {
  const { doc, w, h } = c;
  doc.add(path(roundRect(2, h * 0.2, w - 4, h * 0.6, 3), metalV(c)));
  const glowCol = c.customShade ? c.shade : WARM_MID;
  doc.add(rect(6, h * 0.42, w - 12, h * 0.3, doc.linear([{ o: 0, c: WARM_CORE }, { o: 1, c: glowCol }], 0, 0, 0, 1), { rx: 2 }));
  doc.add(rect(6, h * 0.44, w - 12, h * 0.08, '#ffffff', { opacity: 0.8 }));
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const DEFS: Record<FixtureForm, FixtureDef> = {
  recessed: { w: 200, h: 62, emitterY: 0.48, draw: recessed },
  'pendant-dome': { w: 220, h: 300, emitterY: 0.88, draw: pendantDome },
  'pendant-globe': { w: 180, h: 300, emitterY: 0.7, draw: pendantGlobe },
  'pendant-cage': { w: 170, h: 300, emitterY: 0.73, draw: pendantCage },
  chandelier: { w: 360, h: 320, emitterY: 0.5, draw: chandelier },
  'sconce-up': { w: 120, h: 200, emitterY: 0.12, draw: (c) => sconce(c, true) },
  'sconce-down': { w: 120, h: 200, emitterY: 0.92, draw: (c) => sconce(c, false) },
  'wall-lantern': { w: 150, h: 300, emitterY: 0.6, draw: wallLantern },
  'flush-mount': { w: 260, h: 90, emitterY: 0.6, draw: flushMount },
  track: { w: 360, h: 120, emitterY: 0.75, draw: track },
  'floor-lamp': { w: 160, h: 560, emitterY: 0.18, anchorY: 556 / 560, draw: floorLamp },
  'table-lamp': { w: 200, h: 270, emitterY: 0.3, anchorY: 266 / 270, draw: tableLamp },
  'led-strip': { w: 400, h: 30, emitterY: 0.55, draw: ledStrip },
  'path-light': { w: 90, h: 260, emitterY: 0.22, anchorY: 256 / 260, draw: pathLight },
  bollard: { w: 90, h: 240, emitterY: 0.2, anchorY: 237 / 240, draw: bollard },
  spotlight: { w: 150, h: 150, emitterY: 0.25, draw: spotlight },
  'well-light': { w: 180, h: 60, emitterY: 0.5, draw: wellLight },
  'string-lights': { w: 480, h: 150, emitterY: 0.5, draw: stringLights },
  'post-lantern': { w: 140, h: 520, emitterY: 0.23, anchorY: 516 / 520, draw: postLantern },
  'flood-light': { w: 200, h: 160, emitterY: 0.75, draw: floodLight },
  'step-light': { w: 120, h: 80, emitterY: 0.75, draw: stepLight },
  'ceiling-fan': { w: 420, h: 170, emitterY: 0.75, draw: ceilingFan },
};

/**
 * Where each fixture's light emits, 0..1 from the top of its art (for
 * LightInfo.emitterY). Kept in sync with the drawings above.
 */
export const FIXTURE_EMITTER_Y: Readonly<Record<FixtureForm, number>> = Object.fromEntries(
  Object.entries(DEFS).map(([k, v]) => [k, v.emitterY]),
) as Record<FixtureForm, number>;

/** Output size and anchor of a fixture spec without drawing it. */
export function fixtureSize(spec: FixtureArt): Omit<ArtResult, 'svg'> {
  const def = DEFS[spec.form] ?? DEFS.recessed;
  return { ...outputSize(def.w, def.h), anchorY: def.anchorY ?? 1 };
}

export function renderFixture(spec: FixtureArt, prefix: string): ArtResult {
  const def = DEFS[spec.form] ?? DEFS.recessed;
  const doc = new SvgDoc(def.w, def.h, prefix);
  const customShade = spec.shade !== undefined && normHex(spec.shade, '') !== '';
  const ctx: FxCtx = {
    doc,
    finish: normHex(spec.finish, '#2b2b2b'),
    shade: customShade ? normHex(spec.shade, DEFAULT_SHADE) : DEFAULT_SHADE,
    customShade,
    w: def.w,
    h: def.h,
  };
  def.draw(ctx);
  return { svg: doc.toString(), width: doc.outWidth, height: doc.outHeight, anchorY: def.anchorY ?? 1 };
}
