/**
 * Decor, furniture and hardscape illustrations for every DecorForm. Drawn in
 * a slightly-from-above front view with a key light from the upper left:
 * top faces lighter, right / under faces darker.
 *
 * Color roles: `color` is the main material (wood, paint, stone, fabric);
 * `color2` is the secondary one where a form has it:
 *  - bench / dining-set / coffee-table: frame & legs (dining-set: tabletop + cushions)
 *  - lounge-chair / sofa / armchair: cushions / throw pillows
 *  - window-box: flower color (the box is shown planted)
 *  - rug: border & pattern;  awning: alternate stripe;  mailbox: flag
 *  - house-numbers: numerals;  wall-art: accent color;  boulder: moss
 * Variants chosen by seed: fence-panel seed % 2 → 0 privacy boards, 1 pickets;
 * mirror seed % 3 → 0 arched, 1 round, 2 rectangular; rug & wall-art patterns.
 */
import type { ArtResult, DecorArt, DecorForm } from '../../../shared/art';
import { FlowerPainter, Layers, canopy, flowerTones, foliageTones, potBack, potFront, softBlob, type Clump } from './organic';
import { PathW, SvgDoc, ellipsePath, g, leafPath, outputSize, path, polygon, rect, roundRect, splinePts, taper, type Stop } from './svg';
import { clamp, f, lerp, luminance, makeRng, mix, normHex, tone, type Pt, type Rng } from './util';

interface DcCtx {
  doc: SvgDoc;
  rng: Rng;
  color: string;
  color2?: string;
  seed: number;
  w: number;
  h: number;
  /** Ground / mounting contact y. */
  baseY: number;
}

interface DecorDef {
  w: number;
  h: number;
  /** Size override by seed (variants with different proportions). */
  size?: (seed: number) => { w: number; h: number };
  draw(c: DcCtx): void;
}

// ---------------------------------------------------------------------------
// Shading helpers
// ---------------------------------------------------------------------------

/** Vertical light → dark gradient (bbox units). */
const vGrad = (doc: SvgDoc, c: string, top = 0.15, bottom = -0.22): string =>
  doc.linear(
    [
      { o: 0, c: tone(c, top) },
      { o: 1, c: tone(c, bottom) },
    ],
    0,
    0,
    0,
    1,
  );

/** Horizontal light → dark gradient (bbox units). */
const hGrad = (doc: SvgDoc, c: string, left = 0.12, right = -0.25): string =>
  doc.linear(
    [
      { o: 0, c: tone(c, left) },
      { o: 1, c: tone(c, right) },
    ],
    0,
    0,
    1,
    0,
  );

/** Rounded cylinder (light streak left of center). */
function cylStops(c: string): Stop[] {
  return [
    { o: 0, c: tone(c, -0.35) },
    { o: 0.25, c: tone(c, 0.2) },
    { o: 0.5, c },
    { o: 1, c: tone(c, -0.45) },
  ];
}

/** Soft dark contact line under an object resting on the ground/floor. */
function contact(doc: SvgDoc, cx: number, y: number, rx: number, ry = 4): string {
  const fill = doc.radial(
    [
      { o: 0, c: '#000000', a: 0.35 },
      { o: 1, c: '#000000', a: 0 },
    ],
    0.5,
    0.5,
    0.5,
  );
  return path(ellipsePath(cx, y, rx, ry), fill);
}

/** Drop shadow behind a wall-hung object. */
function wallShadow(d: string): string {
  return path(d, '#000000', { opacity: 0.22, transform: 'translate(3 5)' });
}

/**
 * 2.5D box: front face at (x, y, w, h) plus top face and right side face
 * receding by `depth` (oblique projection up and to the right).
 */
function box(doc: SvgDoc, x: number, y: number, w: number, h: number, depth: number, color: string, opts: { top?: boolean; side?: boolean } = {}): void {
  const dx = depth * 0.42;
  const dy = -depth * 0.32;
  if (opts.side !== false) doc.add(path(polygon([{ x: x + w, y }, { x: x + w + dx, y: y + dy }, { x: x + w + dx, y: y + h + dy }, { x: x + w, y: y + h }]), tone(color, -0.32)));
  if (opts.top !== false) doc.add(path(polygon([{ x, y }, { x: x + dx, y: y + dy }, { x: x + w + dx, y: y + dy }, { x: x + w, y }]), tone(color, 0.22)));
  doc.add(rect(x, y, w, h, vGrad(doc, color, 0.06, -0.14)));
}

/** Wood plank with a few grain lines. */
function plank(doc: SvgDoc, rng: Rng, x: number, y: number, w: number, h: number, color: string, vertical: boolean, r = 1.5): string[] {
  const out = [path(roundRect(x, y, w, h, r), vertical ? hGrad(doc, color, 0.1, -0.18) : vGrad(doc, color, 0.14, -0.18))];
  const lines: string[] = [];
  const n = Math.max(1, Math.round((vertical ? w : h) / 7));
  for (let i = 0; i < n; i++) {
    if (vertical) {
      const gx = x + w * rng.range(0.2, 0.8);
      lines.push(taper([{ x: gx, y: y + h * rng.range(0, 0.3) }, { x: gx + rng.range(-1.5, 1.5), y: y + h * rng.range(0.6, 1) }], 1, 0.4));
    } else {
      const gy = y + h * rng.range(0.25, 0.75);
      lines.push(taper([{ x: x + w * rng.range(0, 0.3), y: gy }, { x: x + w * rng.range(0.6, 1), y: gy + rng.range(-1.5, 1.5) }], 1, 0.4));
    }
  }
  out.push(path(lines.join(''), tone(color, -0.4), { opacity: 0.35 }));
  return out;
}

const DEFAULT_WOOD = '#8a6a4f';
const GREEN = '#4f7f3a';

// ---------------------------------------------------------------------------
// Planters
// ---------------------------------------------------------------------------

function planterRound(c: DcCtx): void {
  const geom = { cx: c.w / 2, baseY: c.baseY, w: c.w * 0.92, h: c.h * 0.9 };
  c.doc.add(contact(c.doc, geom.cx, c.baseY - 2, geom.w * 0.38));
  potBack(c.doc, geom, c.color);
  potFront(c.doc, geom, c.color, { gloss: 0.55 });
}

/** Tapered square / rectangular planter with soil, seen slightly from above. */
function squarePlanter(c: DcCtx, wFrac: number, depthPx: number, taperFrac: number, feet: boolean): void {
  const { doc, color, baseY } = c;
  const cx = c.w / 2 - depthPx * 0.21;
  const topW = c.w * wFrac;
  const botW = topW * taperFrac;
  const dx = depthPx * 0.42;
  const dy = -depthPx * 0.32;
  const yTop = baseY - c.h * 0.86 - dy;
  const yBot = baseY - (feet ? 8 : 0);
  const xl = cx - topW / 2;
  const xr = cx + topW / 2;
  const bl = cx - botW / 2;
  const br = cx + botW / 2;
  doc.add(contact(doc, cx + dx / 2, baseY - 1, botW * 0.6));
  // Side face (right), top rim with soil, front face.
  doc.add(path(polygon([{ x: xr, y: yTop }, { x: xr + dx, y: yTop + dy }, { x: br + dx * 0.8, y: yBot + dy * 0.8 }, { x: br, y: yBot }]), vGrad(doc, tone(color, -0.3), 0.05, -0.2)));
  doc.add(path(polygon([{ x: xl, y: yTop }, { x: xl + dx, y: yTop + dy }, { x: xr + dx, y: yTop + dy }, { x: xr, y: yTop }]), tone(color, 0.25)));
  const ins = 6;
  doc.add(
    path(
      polygon([
        { x: xl + ins, y: yTop - 2 },
        { x: xl + dx + ins * 0.6, y: yTop + dy + 3 },
        { x: xr + dx - ins, y: yTop + dy + 3 },
        { x: xr - ins * 0.6, y: yTop - 2 },
      ]),
      '#3b2a1e',
    ),
  );
  doc.add(path(polygon([{ x: xl, y: yTop }, { x: xr, y: yTop }, { x: br, y: yBot }, { x: bl, y: yBot }]), vGrad(doc, color, 0.1, -0.2)));
  doc.add(path(polygon([{ x: xl, y: yTop }, { x: xr, y: yTop }, { x: xr - 1, y: yTop + 9 }, { x: xl + 1, y: yTop + 9 }]), tone(color, 0.15)));
  doc.add(path(polygon([{ x: xl, y: yTop + 9 }, { x: xr, y: yTop + 9 }, { x: xr - 1, y: yTop + 13 }, { x: xl + 1, y: yTop + 13 }]), tone(color, -0.35), { opacity: 0.4 }));
  if (feet) {
    for (const fx of [bl + 6, br - 20]) doc.add(rect(fx, yBot, 14, baseY - yBot, tone(color, -0.35)));
  }
}

function windowBox(c: DcCtx): void {
  const { doc, rng, color, w, baseY } = c;
  const boxTop = baseY - c.h * 0.42;
  const bx = w * 0.05;
  const bw = w * 0.86;
  const bh = c.h * 0.3;
  // Brackets under the box.
  for (const x of [bx + bw * 0.15, bx + bw * 0.85]) {
    doc.add(path(polygon([{ x: x - 6, y: boxTop + bh }, { x: x + 6, y: boxTop + bh }, { x: x + 6, y: baseY }, { x: x - 6, y: boxTop + bh + 8 }]), tone(color, -0.25)));
  }
  // Plants behind the front board.
  const t = foliageTones(GREEN, '#7fae4f');
  const clumps: Clump[] = [];
  for (let i = 0; i < 9; i++) clumps.push({ x: bx + 18 + (i / 8) * (bw - 26), y: boxTop - rng.range(6, 22), r: rng.range(20, 28), sy: 0.85 });
  canopy(doc, rng, clumps, { tones: t, texture: 0.8, volume: 0.7 });
  const fp = new FlowerPainter(flowerTones(c.color2 ?? '#e8668a'), rng);
  for (let i = 0; i < 22; i++) fp.blossom(bx + 14 + rng() * (bw - 20), boxTop - rng.range(4, 40), rng.range(5, 7.5));
  doc.add(...fp.render());
  box(doc, bx, boxTop, bw, bh, 24, color, { top: false });
  // Trim boards and trailing greenery over the front.
  doc.add(rect(bx - 3, boxTop - 2, bw + 6, 8, vGrad(doc, color, 0.25, -0.05)), rect(bx - 3, boxTop + bh - 6, bw + 6, 7, vGrad(doc, color, 0, -0.3)));
  const vines = new Layers([{ fill: t.dark }, { fill: t.mid }, { fill: t.light }]);
  for (let v = 0; v < 6; v++) {
    const x = bx + 20 + (v / 5) * (bw - 40) + rng.range(-8, 8);
    const len = rng.range(18, bh + 20);
    for (let k = 0; k < len; k += 8) vines.add(rng.pick([t.dark, t.mid, t.light]), leafPath({ x: x + Math.sin(k * 0.2) * 3, y: boxTop + k }, Math.PI / 2 + rng.range(-1, 1), rng.range(8, 12), 6, 0, 1));
  }
  doc.add(...vines.render());
}

function raisedBed(c: DcCtx): void {
  const { doc, rng, color, w, baseY } = c;
  const depth = 46;
  const x = w * 0.03;
  const bw = w * 0.86;
  const bh = c.h * 0.42;
  const y = baseY - bh;
  doc.add(contact(doc, x + bw / 2 + 10, baseY - 1, bw * 0.55));
  const dx = depth * 0.42;
  const dy = -depth * 0.32;
  // Back rim, soil, plants, then the front boards over the plant bases.
  doc.add(path(polygon([{ x, y }, { x: x + dx, y: y + dy }, { x: x + bw + dx, y: y + dy }, { x: x + bw, y }]), tone(color, -0.1)));
  doc.add(path(polygon([{ x: x + 6, y: y - 1 }, { x: x + dx + 5, y: y + dy + 5 }, { x: x + bw + dx - 6, y: y + dy + 5 }, { x: x + bw - 5, y: y - 1 }]), '#3a2a1f'));
  const t = foliageTones('#5b8f3a', '#9cc35a');
  const lay = new Layers([{ fill: t.deep }, { fill: t.dark }, { fill: t.mid }, { fill: t.light }]);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 6; i++) {
      const px = x + 22 + row * dx * 0.6 + (i / 5) * (bw - 40);
      const py = y + dy * (0.75 - row * 0.45) + 4;
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (k / 6 - 0.5) * 2.4;
        lay.add(k % 2 ? t.mid : t.light, leafPath({ x: px, y: py }, a, rng.range(13, 19), 9, 0, 1));
      }
      lay.add(t.dark, leafPath({ x: px, y: py }, -Math.PI / 2, 10, 7, 0, 1));
    }
  }
  doc.add(...lay.render());
  doc.add(path(polygon([{ x: x + bw, y }, { x: x + bw + dx, y: y + dy }, { x: x + bw + dx, y: baseY + dy }, { x: x + bw, y: baseY }]), tone(color, -0.32)));
  for (let i = 0; i < 2; i++) doc.add(...plank(doc, rng, x, y + (bh / 2) * i, bw, bh / 2 - 1, color, false, 1));
  doc.add(rect(x - 2, y - 2, 12, bh + 2, vGrad(doc, tone(color, -0.08))), rect(x + bw - 10, y - 2, 12, bh + 2, vGrad(doc, tone(color, -0.08))));
}

// ---------------------------------------------------------------------------
// Seating & tables
// ---------------------------------------------------------------------------

function bench(c: DcCtx): void {
  const { doc, rng, color, w, h, baseY } = c;
  const frame = c.color2 ?? tone(color, -0.3);
  const x0 = w * 0.06;
  const x1 = w * 0.94;
  const seatY = baseY - h * 0.42;
  doc.add(contact(doc, w / 2, baseY - 1, w * 0.42));
  // Back legs/posts and back slats.
  doc.add(rect(x0 + 10, baseY - h * 0.95, 12, h * 0.95 - 4, vGrad(doc, frame)), rect(x1 - 22, baseY - h * 0.95, 12, h * 0.95 - 4, vGrad(doc, frame)));
  for (let i = 0; i < 3; i++) doc.add(...plank(doc, rng, x0 + 16, baseY - h * 0.9 + i * 22, x1 - x0 - 32, 16, color, false));
  // Seat (top surface visible) with slats.
  const depth = 40;
  for (let i = 0; i < 4; i++) {
    const yy = seatY - depth * 0.3 + i * (depth * 0.3 / 3) - 6;
    doc.add(path(roundRect(x0 + 4 + i * 2, yy, x1 - x0 - 8 - i * 4, 7, 2), vGrad(doc, color, 0.25, 0)));
  }
  doc.add(...plank(doc, rng, x0, seatY, x1 - x0, 12, color, false));
  // Front legs + arms.
  for (const lx of [x0 + 4, x1 - 18]) {
    doc.add(rect(lx, seatY + 10, 14, baseY - seatY - 10, hGrad(doc, frame)));
    doc.add(rect(lx - 2, seatY - h * 0.28, 14, h * 0.28, hGrad(doc, frame)));
    doc.add(path(roundRect(lx - 8, seatY - h * 0.31, 30, 9, 3), vGrad(doc, color, 0.25, -0.1)));
  }
  doc.add(rect(x0 + 8, baseY - h * 0.16, x1 - x0 - 16, 6, vGrad(doc, frame)));
}

function adirondack(c: DcCtx): void {
  const { doc, rng, color, w, h, baseY } = c;
  const cx = w / 2;
  doc.add(contact(doc, cx, baseY - 1, w * 0.42));
  // Fanned back slats, tallest in the middle.
  const n = 7;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) - 0.5;
    const top = baseY - h * (0.97 - Math.abs(u) * 0.28);
    const bx = cx + u * w * 0.34;
    const tx = cx + u * w * 0.5;
    const sw = 16;
    const d = new PathW(1)
      .M(bx - sw / 2, baseY - h * 0.35)
      .L(tx - sw / 2, top + sw / 2)
      .Q(tx, top - 3, tx + sw / 2, top + sw / 2)
      .L(bx + sw / 2, baseY - h * 0.35)
      .Z()
      .toString();
    doc.add(path(d, hGrad(doc, tone(color, -0.06 + Math.abs(u) * 0.1), 0.12, -0.2)));
  }
  doc.add(rect(cx - w * 0.3, baseY - h * 0.62, w * 0.6, 10, vGrad(doc, tone(color, -0.2))));
  // Seat slats (sloping back).
  for (let i = 0; i < 3; i++) doc.add(path(roundRect(cx - w * 0.3 + i * 2, baseY - h * 0.4 + i * 8, w * 0.6 - i * 4, 7, 2), vGrad(doc, color, 0.25, 0)));
  // Arms: wide planks seen slightly from above, front legs below.
  for (const side of [-1, 1]) {
    const ax = cx + side * w * 0.36;
    doc.add(rect(ax - 8, baseY - h * 0.47, 16, h * 0.47 - 2, hGrad(doc, color)));
    const arm = polygon([
      { x: ax - 22, y: baseY - h * 0.5 },
      { x: ax + 22, y: baseY - h * 0.5 },
      { x: ax + 18 + side * 4, y: baseY - h * 0.56 },
      { x: ax - 18 + side * 4, y: baseY - h * 0.56 },
    ]);
    doc.add(path(arm, tone(color, 0.22)), rect(ax - 22, baseY - h * 0.5, 44, 8, vGrad(doc, color)));
  }
  doc.add(...plank(doc, rng, cx - w * 0.3, baseY - h * 0.33, w * 0.6, 14, color, false));
}

function loungeChair(c: DcCtx): void {
  const { doc, color, w, h, baseY } = c;
  const cushion = c.color2 ?? '#eee8dc';
  const legH = h * 0.22;
  const deckY = baseY - legH;
  const x0 = w * 0.04;
  const x1 = w * 0.96;
  const hinge = x0 + w * 0.3;
  doc.add(contact(doc, w / 2, baseY - 1, w * 0.45));
  // Legs and the flat frame.
  for (const lx of [x0 + 14, hinge, x1 - 24]) doc.add(rect(lx, deckY, 10, legH - 2, hGrad(doc, tone(color, -0.1))));
  doc.add(path(roundRect(hinge - 6, deckY - 10, x1 - hinge + 6, 14, 3), vGrad(doc, color)));
  // Inclined backrest slab from the hinge up and back toward the head end.
  const top = { x: x0 + 18, y: baseY - h * 0.95 };
  const ang = Math.atan2(top.y - (deckY - 4), top.x - hinge);
  const nx = Math.sin(ang);
  const ny = -Math.cos(ang);
  const th = 13;
  const slab = polygon([
    { x: hinge, y: deckY - 3 },
    { x: top.x, y: top.y },
    { x: top.x - nx * th, y: top.y - ny * th },
    { x: hinge - nx * th, y: deckY - 3 - ny * th },
  ]);
  doc.add(path(slab, vGrad(doc, tone(color, -0.1), 0.1, -0.25)));
  // Prop strut holding the backrest up.
  const mid = { x: lerp(hinge, top.x, 0.55), y: lerp(deckY - 3, top.y, 0.55) };
  doc.add(path(taper([{ x: mid.x - nx * 4, y: mid.y - ny * 4 }, { x: hinge - (hinge - x0) * 0.75, y: deckY - 2 }], 5, 5), tone(color, -0.3)));
  // Cushions: back pad on the slab, seat pad on the frame.
  const ct = 14;
  const back = new PathW(1)
    .M(hinge + 6, deckY - 9)
    .L(top.x + nx * 2 + 4, top.y + 2)
    .Q(top.x + nx * (ct + 6), top.y + ny * (ct + 6) - 2, top.x + nx * ct + 8, top.y + ny * ct + 6)
    .L(hinge + nx * ct + 10, deckY - 9 + ny * ct)
    .Z()
    .toString();
  doc.add(path(back, vGrad(doc, cushion, 0.25, -0.15)));
  doc.add(path(roundRect(hinge + 4, deckY - 10 - ct, x1 - hinge - 6, ct + 2, 6), vGrad(doc, cushion, 0.2, -0.2)));
  doc.add(path(taper([{ x: hinge + 10, y: deckY - 9 - ct }, { x: x1 - 8, y: deckY - 9 - ct }], 2.5, 2.5), tone(cushion, 0.35), { opacity: 0.8 }));
  for (const sx of [hinge + (x1 - hinge) * 0.35, hinge + (x1 - hinge) * 0.68]) doc.add(path(taper([{ x: sx, y: deckY - 8 - ct }, { x: sx - 2, y: deckY - 9 }], 1.6, 1.2), tone(cushion, -0.35), { opacity: 0.6 }));
}

function chairSide(doc: SvgDoc, x: number, baseY: number, h: number, facing: 1 | -1, frame: string, cushion: string): void {
  const seatY = baseY - h * 0.45;
  const backX = facing === 1 ? x : x + 54;
  doc.add(rect(x, seatY, 6, baseY - seatY, hGrad(doc, frame)), rect(x + 48, seatY, 6, baseY - seatY, hGrad(doc, frame)));
  doc.add(rect(backX, baseY - h, 6, h - (baseY - seatY) + 4, hGrad(doc, frame)));
  doc.add(path(roundRect(x - 2, seatY - 6, 60, 10, 3), vGrad(doc, cushion, 0.2, -0.15)));
  doc.add(path(roundRect(facing === 1 ? backX + 4 : backX - 12, baseY - h * 0.95, 14, h * 0.42, 4), vGrad(doc, cushion, 0.15, -0.2)));
}

function diningSet(c: DcCtx): void {
  const { doc, rng, color, w, h, baseY } = c;
  const top = c.color2 ?? tone(color, 0.25);
  const cx = w / 2;
  doc.add(contact(doc, cx, baseY - 1, w * 0.46));
  chairSide(doc, w * 0.04, baseY, h * 0.86, 1, color, top);
  chairSide(doc, w * 0.96 - 54, baseY, h * 0.86, -1, color, top);
  // Table: legs, apron, top surface.
  const tw = w * 0.5;
  const tTop = baseY - h * 0.62;
  for (const lx of [cx - tw / 2 + 8, cx + tw / 2 - 20]) doc.add(rect(lx, tTop + 10, 12, baseY - tTop - 10, hGrad(doc, color)));
  doc.add(path(polygon([{ x: cx - tw / 2, y: tTop }, { x: cx - tw / 2 + 18, y: tTop - 14 }, { x: cx + tw / 2 + 18, y: tTop - 14 }, { x: cx + tw / 2, y: tTop }]), tone(top, 0.18)));
  doc.add(...plank(doc, rng, cx - tw / 2, tTop, tw, 10, top, false, 1));
  // A small vase as a centerpiece for scale.
  doc.add(path(roundRect(cx - 6, tTop - 26, 12, 20, 4), vGrad(doc, '#e9e4da')));
  doc.add(path(ellipsePath(cx, tTop - 30, 9, 7), GREEN));
}

/** Upholstered seating (sofa / armchair) seen from the front. */
function upholstered(c: DcCtx, seats: number): void {
  const { doc, color, w, h, baseY } = c;
  const pillow = c.color2;
  const legH = h * 0.08;
  const bot = baseY - legH;
  const armW = w * (seats === 1 ? 0.16 : 0.09);
  const x0 = w * 0.02;
  const x1 = w * 0.98;
  doc.add(contact(doc, w / 2, baseY - 1, w * 0.46));
  // Legs.
  for (const lx of [x0 + armW * 0.4, x1 - armW * 0.4 - 8]) doc.add(path(polygon([{ x: lx, y: bot }, { x: lx + 9, y: bot }, { x: lx + 7, y: baseY }, { x: lx + 2, y: baseY }]), '#3a2a1f'));
  // Back frame and back cushions.
  const backTop = baseY - h * 0.97;
  doc.add(path(roundRect(x0 + armW * 0.5, backTop, x1 - x0 - armW, h * 0.6, 14, 4), vGrad(doc, tone(color, -0.12), 0.08, -0.25)));
  const innerX0 = x0 + armW;
  const innerX1 = x1 - armW;
  const cw = (innerX1 - innerX0) / seats;
  for (let i = 0; i < seats; i++) {
    doc.add(path(roundRect(innerX0 + i * cw + 3, backTop + h * 0.08, cw - 6, h * 0.42, 12), vGrad(doc, color, 0.14, -0.18)));
  }
  // Seat cushions: top surface + front face.
  const seatTop = baseY - h * 0.45;
  for (let i = 0; i < seats; i++) {
    const sx = innerX0 + i * cw + 2;
    doc.add(path(roundRect(sx, seatTop - 10, cw - 4, 20, 8), tone(color, 0.18)));
    doc.add(path(roundRect(sx, seatTop + 4, cw - 4, h * 0.2, 6, 8), vGrad(doc, color, 0.05, -0.25)));
    doc.add(path(taper([{ x: sx + 10, y: seatTop + 6 }, { x: sx + cw - 14, y: seatTop + 6 }], 2, 2), tone(color, 0.3), { opacity: 0.6 }));
  }
  // Base rail.
  doc.add(path(roundRect(x0 + armW * 0.5, bot - h * 0.1, x1 - x0 - armW, h * 0.1, 3), vGrad(doc, tone(color, -0.15), 0, -0.3)));
  // Arms.
  for (const [ax, side] of [
    [x0, -1],
    [x1 - armW, 1],
  ] as const) {
    doc.add(path(roundRect(ax, baseY - h * 0.66, armW, h * 0.66 - legH, armW * 0.45, 4), side < 0 ? hGrad(doc, color, 0.12, -0.1) : hGrad(doc, color, -0.05, -0.3)));
    doc.add(path(ellipsePath(ax + armW / 2, baseY - h * 0.62, armW / 2 - 2, 7), tone(color, 0.22), { opacity: 0.8 }));
  }
  // Throw pillows.
  if (pillow) {
    for (const [px, rot] of [
      [innerX0 + 8, -12],
      [innerX1 - 8 - h * 0.26, 12],
    ] as const) {
      const s = h * 0.26;
      doc.add(
        g([path(roundRect(0, 0, s, s, s * 0.3), vGrad(doc, pillow, 0.18, -0.22)), path(taper([{ x: s * 0.2, y: s * 0.5 }, { x: s * 0.8, y: s * 0.5 }], 1.5, 1.5), tone(pillow, -0.3), { opacity: 0.5 })], {
          transform: `translate(${f(px)} ${f(seatTop - s * 0.85)}) rotate(${rot} ${f(s / 2)} ${f(s / 2)})`,
        }),
      );
    }
  }
}

function coffeeTable(c: DcCtx): void {
  const { doc, rng, color, w, h, baseY } = c;
  const frame = c.color2 ?? tone(color, -0.35);
  const x0 = w * 0.04;
  const x1 = w * 0.9;
  const depth = 60;
  const dx = depth * 0.42;
  const dy = -depth * 0.32;
  const topY = baseY - h * 0.66;
  doc.add(contact(doc, w / 2 + dx / 2, baseY - 1, w * 0.45));
  // Back legs, shelf, front legs.
  for (const lx of [x0 + 8 + dx, x1 - 18 + dx]) doc.add(rect(lx, topY + dy + 8, 10, baseY + dy - topY - 8, tone(frame, -0.2)));
  doc.add(path(polygon([{ x: x0 + 6, y: baseY - h * 0.2 }, { x: x0 + 6 + dx, y: baseY - h * 0.2 + dy }, { x: x1 - 6 + dx, y: baseY - h * 0.2 + dy }, { x: x1 - 6, y: baseY - h * 0.2 }]), tone(color, 0.05)));
  doc.add(rect(x0 + 6, baseY - h * 0.2, x1 - x0 - 12, 6, vGrad(doc, color)));
  for (const lx of [x0 + 4, x1 - 16]) doc.add(rect(lx, topY + 8, 12, baseY - topY - 8, hGrad(doc, frame)));
  // Top slab.
  doc.add(path(polygon([{ x: x0, y: topY }, { x: x0 + dx, y: topY + dy }, { x: x1 + dx, y: topY + dy }, { x: x1, y: topY }]), doc.linear([{ o: 0, c: tone(color, 0.3) }, { o: 1, c: tone(color, 0.1) }], 0, 0, 1, 1)));
  doc.add(path(polygon([{ x: x1, y: topY }, { x: x1 + dx, y: topY + dy }, { x: x1 + dx, y: topY + dy + 12 }, { x: x1, y: topY + 12 }]), tone(color, -0.3)));
  doc.add(...plank(doc, rng, x0, topY, x1 - x0, 12, color, false, 1));
}

// ---------------------------------------------------------------------------
// Rugs, fire, shade
// ---------------------------------------------------------------------------

function rug(c: DcCtx): void {
  const { doc, rng, color, w, h, baseY } = c;
  const border = c.color2 ?? (luminance(color) > 0.4 ? tone(color, -0.45) : tone(color, 0.45));
  const front = { l: w * 0.02, r: w * 0.98, y: baseY - 4 };
  const back = { l: w * 0.14, r: w * 0.86, y: baseY - h * 0.9 };
  /** Floor-plane mapping: u across (0..1), v depth (0 front → 1 back). */
  const P = (u: number, v: number): Pt => {
    const vy = 1 - (1 - v) * (1 - v) * 0.15 - (1 - v) * 0.85; // slight perspective compression
    const l = lerp(front.l, back.l, v);
    const r = lerp(front.r, back.r, v);
    return { x: lerp(l, r, u), y: lerp(front.y, back.y, clamp(vy, 0, 1)) };
  };
  const quad = (u0: number, v0: number, u1: number, v1: number): string => polygon([P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)]);
  doc.add(path(quad(0, 0, 1, 1), tone(color, -0.25), { transform: 'translate(0 3)', opacity: 0.5 }));
  doc.add(path(quad(0, 0, 1, 1), border));
  doc.add(path(quad(0.06, 0.08, 0.94, 0.92), color));
  doc.add(path(quad(0.03, 0.04, 0.97, 0.96), 'none', { stroke: tone(border, 0.35), 'stroke-width': 1.2, 'stroke-opacity': 0.7 }));
  const pat = new Layers([{ fill: border, opacity: 0.85 }, { fill: tone(color, 0.25), opacity: 0.7 }]);
  const variant = c.seed % 3;
  if (variant === 0) {
    // Central medallion + corner motifs.
    pat.add(border, polygon([P(0.5, 0.2), P(0.72, 0.5), P(0.5, 0.8), P(0.28, 0.5)]), 0.85);
    pat.add(tone(color, 0.25), polygon([P(0.5, 0.32), P(0.62, 0.5), P(0.5, 0.68), P(0.38, 0.5)]), 0.7);
    for (const [u, v] of [
      [0.14, 0.2],
      [0.86, 0.2],
      [0.14, 0.8],
      [0.86, 0.8],
    ]) {
      pat.add(border, polygon([P(u, v - 0.07), P(u + 0.04, v), P(u, v + 0.07), P(u - 0.04, v)]), 0.85);
    }
  } else if (variant === 1) {
    // Bands.
    for (let i = 0; i < 5; i++) {
      const v0 = 0.16 + i * 0.15;
      pat.add(i % 2 ? tone(color, 0.25) : border, quad(0.06, v0, 0.94, v0 + 0.05), i % 2 ? 0.7 : 0.85);
    }
  } else {
    // Diamond lattice.
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 4; j++) {
        const u = 0.12 + i * 0.127;
        const v = 0.2 + j * 0.2;
        pat.add(rng.chance(0.5) ? border : tone(color, 0.25), polygon([P(u, v - 0.06), P(u + 0.035, v), P(u, v + 0.06), P(u - 0.035, v)]), 0.8);
      }
    }
  }
  doc.add(...pat.render());
  // Light falloff toward the back and fringe at both ends.
  doc.add(path(quad(0, 0, 1, 1), doc.linear([{ o: 0, c: '#000000', a: 0.12 }, { o: 1, c: '#ffffff', a: 0.1 }], 0, 1, 0, 0)));
  const fringe: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    const a = P(u, 0);
    fringe.push(taper([a, { x: a.x + rng.range(-1, 1), y: a.y + 5 }], 1.2, 0.8));
    const b = P(u, 1);
    fringe.push(taper([b, { x: b.x + rng.range(-1, 1), y: b.y - 3 }], 1, 0.6));
  }
  doc.add(path(fringe.join(''), mix(border, '#f2ece0', 0.6)));
}

function firePit(c: DcCtx): void {
  const { doc, rng, color, w, h, baseY } = c;
  const cx = w / 2;
  const rx = w * 0.46;
  const ry = rx * 0.26;
  const bandH = h * 0.26;
  const topY = baseY - bandH - ry;
  doc.add(contact(doc, cx, baseY - 2, rx * 1.02, 6));
  // Inner bowl (back), embers and logs.
  doc.add(path(ellipsePath(cx, topY, rx, ry), tone(color, 0.15)));
  doc.add(path(ellipsePath(cx, topY + 2, rx * 0.84, ry * 0.75), '#231a14'));
  doc.add(path(ellipsePath(cx, topY + 4, rx * 0.6, ry * 0.45), doc.radial([{ o: 0, c: '#ffb347' }, { o: 0.6, c: '#c2410c', a: 0.8 }, { o: 1, c: '#7c2d12', a: 0 }], 0.5, 0.5, 0.5)));
  const logs = [
    { a: -0.3, x: cx - 30 },
    { a: 0.35, x: cx + 30 },
    { a: 0.05, x: cx },
  ];
  for (const lg of logs) {
    doc.add(g(path(roundRect(-42, -7, 84, 14, 7), vGrad(doc, '#6b4a33', 0.1, -0.35)), { transform: `translate(${f(lg.x)} ${f(topY + 2)}) rotate(${f((lg.a * 180) / Math.PI)})` }));
  }
  // Flames: layered tongues (outer orange → inner pale yellow).
  const flame = (fx: number, fh: number, fw: number, lean: number): string =>
    new PathW(1)
      .M(fx - fw / 2, topY + 2)
      .C(fx - fw * 0.6, topY - fh * 0.4, fx + lean * 0.4 - fw * 0.15, topY - fh * 0.7, fx + lean, topY - fh)
      .C(fx + lean * 0.5 + fw * 0.2, topY - fh * 0.6, fx + fw * 0.6, topY - fh * 0.35, fx + fw / 2, topY + 2)
      .Z()
      .toString();
  const tongues = [
    { x: cx - 26, h: h * 0.42, w: 34, l: -8 },
    { x: cx + 24, h: h * 0.46, w: 36, l: 10 },
    { x: cx, h: h * 0.6, w: 46, l: rng.range(-6, 6) },
  ];
  doc.add(path(ellipsePath(cx, topY - h * 0.15, w * 0.32, h * 0.25), doc.radial([{ o: 0, c: '#ffd27a', a: 0.45 }, { o: 1, c: '#ff8a00', a: 0 }], 0.5, 0.6, 0.5)));
  for (const t of tongues) doc.add(path(flame(t.x, t.h, t.w, t.l), '#f97316', { opacity: 0.92 }));
  for (const t of tongues) doc.add(path(flame(t.x + t.l * 0.1, t.h * 0.72, t.w * 0.66, t.l * 0.7), '#fbbf24'));
  for (const t of tongues) doc.add(path(flame(t.x + t.l * 0.15, t.h * 0.42, t.w * 0.36, t.l * 0.4), '#fff4c2'));
  // Front band (stone ring) with block texture, then the lit rim.
  const band = new PathW(1)
    .M(cx - rx, topY)
    .C(cx - rx, topY + ry * 1.33, cx + rx, topY + ry * 1.33, cx + rx, topY)
    .L(cx + rx, topY + bandH)
    .C(cx + rx, topY + bandH + ry * 1.33, cx - rx, topY + bandH + ry * 1.33, cx - rx, topY + bandH)
    .Z()
    .toString();
  doc.add(path(band, doc.linear(cylStops(color), 0, 0, 1, 0)));
  const joints: string[] = [];
  for (let row = 0; row < 3; row++) {
    const v = (row + 1) / 3;
    const y = topY + bandH * v;
    joints.push(taper(splinePts([{ x: cx - rx, y }, { x: cx, y: y + ry * 0.98 }, { x: cx + rx, y }], 6), 1.4, 1.4));
    const off = row % 2 ? 0.5 : 0;
    for (let k = 0; k < 7; k++) {
      const u = (k + off + 0.5) / 7.5;
      const ang = Math.PI - u * Math.PI;
      const x = cx + Math.cos(ang) * rx;
      const yb = y + Math.sin(ang) * ry * 0.98;
      joints.push(taper([{ x, y: yb - bandH / 3 + 2 }, { x, y: yb - 1 }], 1.4, 1.4));
    }
  }
  doc.add(path(joints.join(''), tone(color, -0.45), { opacity: 0.6 }));
  doc.add(path(ellipsePath(cx, topY, rx, ry), 'none', { stroke: '#ffcf8a', 'stroke-width': 1.5, 'stroke-opacity': 0.55 }));
}

function umbrella(c: DcCtx): void {
  const { doc, color, w, h, baseY } = c;
  const pole = c.color2 ?? '#e9e3d6';
  const cx = w / 2;
  const apexY = h * 0.03;
  const hemY = h * 0.3;
  const rx = w * 0.48;
  doc.add(contact(doc, cx, baseY - 2, w * 0.14));
  // Underside visible below the hem.
  doc.add(path(ellipsePath(cx, hemY, rx * 0.98, h * 0.05), tone(color, -0.45)));
  doc.add(rect(cx - 4, hemY - 10, 8, baseY - hemY - 6, doc.linear(cylStops(pole), 0, 0, 1, 0)));
  doc.add(path(ellipsePath(cx, baseY - 6, w * 0.13, 7), tone('#3a3a3a', 0.1)), path(roundRect(cx - w * 0.13, baseY - 12, w * 0.26, 8, 3), vGrad(doc, '#3a3a3a')));
  // Canopy panels (alternating light) with scalloped hem.
  const panels = 6;
  for (let i = 0; i < panels; i++) {
    const u0 = i / panels;
    const u1 = (i + 1) / panels;
    const x0 = cx - rx + u0 * rx * 2;
    const x1 = cx - rx + u1 * rx * 2;
    const sag = (u: number): number => hemY + Math.sin(u * Math.PI) * h * 0.035;
    const d = new PathW(1)
      .M(cx, apexY)
      .Q(lerp(cx, x0, 0.55), apexY + (hemY - apexY) * 0.3, x0, sag(u0))
      .Q((x0 + x1) / 2, sag((u0 + u1) / 2) + h * 0.03, x1, sag(u1))
      .Q(lerp(cx, x1, 0.55), apexY + (hemY - apexY) * 0.3, cx, apexY)
      .Z()
      .toString();
    const lightness = 0.2 - Math.abs((u0 + u1) / 2 - 0.35) * 0.7;
    doc.add(path(d, vGrad(doc, tone(color, lightness), 0.12, -0.12)));
  }
  doc.add(path(roundRect(cx - 10, apexY - 6, 20, 14, 5), vGrad(doc, color, 0.2, -0.2)), path(ellipsePath(cx, apexY - 8, 4, 4), pole));
}

function pergola(c: DcCtx): void {
  const { doc, rng, color, w, h, baseY } = c;
  const post = 18;
  const frontY = h * 0.18;
  const backBase = baseY - h * 0.12;
  const backTop = frontY - h * 0.08;
  const fl = w * 0.08;
  const fr = w * 0.92 - post;
  const bl = w * 0.2;
  const br = w * 0.8 - post * 0.8;
  // Back posts and back beam.
  doc.add(rect(bl, backTop, post * 0.8, backBase - backTop, hGrad(doc, tone(color, -0.15))), rect(br, backTop, post * 0.8, backBase - backTop, hGrad(doc, tone(color, -0.15))));
  doc.add(...plank(doc, rng, w * 0.12, backTop - 4, w * 0.76, 14, tone(color, -0.1), false, 1));
  // Rafters from back beam to front beam, with overhanging tails.
  const n = 9;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const bx = lerp(w * 0.14, w * 0.84, u);
    const fx = lerp(w * 0.03, w * 0.95, u);
    const d = polygon([
      { x: bx, y: backTop - 10 },
      { x: bx + 7, y: backTop - 10 },
      { x: fx + 12, y: frontY - 18 },
      { x: fx + 12, y: frontY - 4 },
      { x: fx, y: frontY - 4 },
      { x: fx, y: frontY - 18 },
    ]);
    doc.add(path(d, vGrad(doc, color, 0.2, -0.2)));
  }
  // Front posts and beam.
  for (const x of [fl, fr]) {
    doc.add(...plank(doc, rng, x, frontY, post, baseY - frontY, color, true, 1));
    doc.add(path(polygon([{ x: x - 4, y: baseY }, { x: x + post + 4, y: baseY }, { x: x + post + 2, y: baseY - 10 }, { x: x - 2, y: baseY - 10 }]), tone(color, -0.2)));
  }
  doc.add(...plank(doc, rng, w * 0.01, frontY - 6, w * 0.98, 20, color, false, 2));
  // Rafter tails resting on the front beam (notched ends).
  const tails = 11;
  for (let i = 0; i < tails; i++) {
    const x = lerp(w * 0.03, w * 0.95, i / (tails - 1));
    const d = polygon([
      { x, y: frontY - 6 },
      { x, y: frontY - 30 },
      { x: x + 10, y: frontY - 30 },
      { x: x + 10, y: frontY - 14 },
      { x: x + 6, y: frontY - 6 },
    ]);
    doc.add(path(d, hGrad(doc, color, 0.15, -0.2)));
  }
  doc.add(contact(doc, fl + post / 2, baseY - 1, 18), contact(doc, fr + post / 2, baseY - 1, 18));
}

// ---------------------------------------------------------------------------
// Stone & water
// ---------------------------------------------------------------------------

function boulder(c: DcCtx): void {
  const { doc, rng, color, w, h, baseY } = c;
  const cx = w / 2;
  // Rounded, irregular outline with a flattened bottom resting on the ground.
  const pts: Pt[] = [];
  const n = 14;
  const lean = rng.range(-0.12, 0.12);
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI;
    const k = rng.range(0.86, 1.06);
    const lift = -Math.sin(a);
    pts.push({ x: cx + Math.cos(a) * w * 0.47 * k + lift * lean * w * 0.3, y: baseY - lift * h * 0.9 * k - 1 });
  }
  pts.push({ x: cx + w * 0.4, y: baseY + 1 }, { x: cx - w * 0.4, y: baseY + 1 });
  const outline = smoothClosedPts(pts);
  doc.add(contact(doc, cx, baseY - 2, w * 0.47, 6));
  doc.add(path(outline, color));
  const clip = doc.clip(path(outline, '#000'));
  // Soft planes: lit top-left face, shaded right face, darker base.
  const peak = { x: cx + lean * w * 0.3 + rng.range(-10, 10), y: baseY - h * 0.92 };
  const faces = [
    path(polygon([{ x: 0, y: 0 }, { x: peak.x + 6, y: 0 }, { x: peak.x - w * 0.05, y: baseY - h * 0.45 }, { x: 0, y: baseY - h * 0.38 }]), tone(color, 0.22), { opacity: 0.75 }),
    path(polygon([{ x: peak.x + 6, y: 0 }, { x: w, y: 0 }, { x: w, y: baseY }, { x: peak.x + w * 0.12, y: baseY }, { x: peak.x + w * 0.04, y: baseY - h * 0.5 }]), tone(color, -0.32), { opacity: 0.7 }),
    rect(0, 0, w, h, doc.radial([{ o: 0, c: '#ffffff', a: 0.22 }, { o: 0.5, c: '#ffffff', a: 0 }, { o: 1, c: '#000000', a: 0.35 }], 0.32, 0.18, 0.95)),
    rect(0, 0, w, h, doc.linear([{ o: 0.65, c: '#000000', a: 0 }, { o: 1, c: '#000000', a: 0.35 }], 0, 0, 0, 1)),
  ];
  // Speckles, cracks and optional moss, all clipped to the rock.
  const sp = new Layers([{ fill: tone(color, 0.45), opacity: 0.55 }, { fill: tone(color, -0.5), opacity: 0.45 }]);
  for (let i = 0; i < 80; i++) {
    const x = cx + (rng() * 2 - 1) * w * 0.45;
    const y = baseY - rng() * h * 0.9;
    const light = rng.chance(0.5);
    sp.add(light ? tone(color, 0.45) : tone(color, -0.5), ellipsePath(x, y, rng.range(0.6, 1.6), rng.range(0.6, 1.3)), light ? 0.55 : 0.45);
  }
  const crack = taper(
    [
      { x: peak.x - w * 0.08, y: baseY - h * 0.6 },
      { x: peak.x - w * 0.02, y: baseY - h * 0.42 },
      { x: peak.x - w * 0.06, y: baseY - h * 0.22 },
    ],
    1.5,
    0.4,
  );
  const parts = [...faces, ...sp.render(), path(crack, tone(color, -0.55), { opacity: 0.55 })];
  if (c.color2) {
    const moss = new Layers([{ fill: tone(c.color2, -0.2) }, { fill: c.color2 }]);
    for (let i = 0; i < 6; i++) {
      const x = cx + rng.range(-0.3, 0.3) * w;
      const y = baseY - h * 0.88 + Math.abs(x - peak.x) * 0.45 + rng.range(0, 10);
      moss.add(i % 2 ? c.color2 : tone(c.color2, -0.2), softBlob(rng, x, y, rng.range(12, 24), rng.range(4, 8), 9, 0.25));
    }
    parts.push(...moss.render());
  }
  doc.add(g(parts, { 'clip-path': clip }));
}

/** Smooth closed outline through points (quadratic B-spline). */
function smoothClosedPts(pts: Pt[]): string {
  const n = pts.length;
  const mid = (i: number): Pt => ({ x: (pts[i % n].x + pts[(i + 1) % n].x) / 2, y: (pts[i % n].y + pts[(i + 1) % n].y) / 2 });
  const m0 = mid(n - 1);
  const p = new PathW(1).M(m0.x, m0.y);
  for (let i = 0; i < n; i++) {
    const m = mid(i);
    p.Q(pts[i].x, pts[i].y, m.x, m.y);
  }
  return p.Z().toString();
}

/** Water surface ellipse with a reflection gradient and ripple highlight. */
function water(doc: SvgDoc, cx: number, cy: number, rx: number, ry: number): string[] {
  return [
    path(ellipsePath(cx, cy, rx, ry), doc.linear([{ o: 0, c: '#9ec9dc' }, { o: 0.6, c: '#5f97b3' }, { o: 1, c: '#3f7591' }], 0, 0, 1, 1)),
    path(ellipsePath(cx - rx * 0.25, cy - ry * 0.2, rx * 0.35, ry * 0.25), '#ffffff', { opacity: 0.35 }),
    path(ellipsePath(cx + rx * 0.2, cy + ry * 0.15, rx * 0.5, ry * 0.4), 'none', { stroke: '#e6f4fa', 'stroke-width': 1, 'stroke-opacity': 0.5 }),
  ];
}

/** Stone bowl: lip ellipse with water, curved body below. */
function bowl(doc: SvgDoc, color: string, cx: number, y: number, rx: number, depth: number): void {
  const ry = rx * 0.24;
  const body = new PathW(1)
    .M(cx - rx, y)
    .C(cx - rx * 0.95, y + depth * 0.9, cx - rx * 0.4, y + depth, cx, y + depth)
    .C(cx + rx * 0.4, y + depth, cx + rx * 0.95, y + depth * 0.9, cx + rx, y)
    .Z()
    .toString();
  doc.add(path(body, doc.linear(cylStops(color), 0, 0, 1, 0)));
  doc.add(path(ellipsePath(cx, y, rx, ry), tone(color, 0.25)));
  doc.add(...water(doc, cx, y + 1, rx * 0.86, ry * 0.75));
}

/** Turned pedestal between y0 (top) and y1 (bottom). */
function pedestal(doc: SvgDoc, color: string, cx: number, y0: number, y1: number, w: number): void {
  const hgt = y1 - y0;
  const d = new PathW(1)
    .M(cx - w * 0.3, y0)
    .C(cx - w * 0.3, y0 + hgt * 0.3, cx - w * 0.18, y0 + hgt * 0.45, cx - w * 0.2, y0 + hgt * 0.6)
    .C(cx - w * 0.24, y0 + hgt * 0.8, cx - w * 0.5, y0 + hgt * 0.85, cx - w * 0.5, y1)
    .L(cx + w * 0.5, y1)
    .C(cx + w * 0.5, y0 + hgt * 0.85, cx + w * 0.24, y0 + hgt * 0.8, cx + w * 0.2, y0 + hgt * 0.6)
    .C(cx + w * 0.18, y0 + hgt * 0.45, cx + w * 0.3, y0 + hgt * 0.3, cx + w * 0.3, y0)
    .Z()
    .toString();
  doc.add(path(d, doc.linear(cylStops(color), 0, 0, 1, 0)));
}

function birdbath(c: DcCtx): void {
  const { doc, color, w, h, baseY } = c;
  const cx = w / 2;
  doc.add(contact(doc, cx, baseY - 2, w * 0.3));
  doc.add(path(roundRect(cx - w * 0.28, baseY - 14, w * 0.56, 14, 3), vGrad(doc, color)));
  pedestal(doc, color, cx, h * 0.32, baseY - 12, w * 0.42);
  bowl(doc, color, cx, h * 0.22, w * 0.47, h * 0.12);
}

function fountain(c: DcCtx): void {
  const { doc, color, w, h, baseY } = c;
  const cx = w / 2;
  doc.add(contact(doc, cx, baseY - 2, w * 0.46, 6));
  // Lower basin: wall band + water.
  const rx = w * 0.47;
  const topY = baseY - h * 0.2;
  const ry = rx * 0.24;
  pedestal(doc, color, cx, h * 0.35, topY + 4, w * 0.22);
  const band = new PathW(1)
    .M(cx - rx, topY)
    .C(cx - rx, topY + ry * 1.33, cx + rx, topY + ry * 1.33, cx + rx, topY)
    .L(cx + rx, baseY - ry * 0.4)
    .C(cx + rx, baseY + ry * 0.9, cx - rx, baseY + ry * 0.9, cx - rx, baseY - ry * 0.4)
    .Z()
    .toString();
  doc.add(path(ellipsePath(cx, topY, rx, ry), tone(color, 0.25)), ...water(doc, cx, topY + 1, rx * 0.9, ry * 0.75));
  // Upper bowl and finial with a small jet.
  bowl(doc, color, cx, h * 0.28, w * 0.3, h * 0.08);
  pedestal(doc, color, cx, h * 0.14, h * 0.29, w * 0.12);
  doc.add(path(ellipsePath(cx, h * 0.13, 7, 6), doc.linear(cylStops(color), 0, 0, 1, 0)));
  // Falling water sheets from the upper bowl into the basin.
  const waterCol = '#dff1f8';
  const sheets: string[] = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const x0 = cx + side * w * (0.24 + k * 0.025);
      const x1 = cx + side * w * (0.3 + k * 0.05);
      sheets.push(taper(splinePts([{ x: x0, y: h * 0.29 }, { x: lerp(x0, x1, 0.7), y: h * 0.36 }, { x: x1, y: topY + 4 }], 5), 3, 1.2));
    }
  }
  sheets.push(taper([{ x: cx, y: h * 0.12 }, { x: cx, y: h * 0.02 }], 2.4, 0.8));
  doc.add(path(sheets.join(''), waterCol, { opacity: 0.75 }));
  doc.add(path(band, doc.linear(cylStops(color), 0, 0, 1, 0)));
  doc.add(path(ellipsePath(cx, topY, rx, ry), 'none', { stroke: tone(color, 0.35), 'stroke-width': 1.5 }));
}

// ---------------------------------------------------------------------------
// Fences, arbors, trellises
// ---------------------------------------------------------------------------

function fencePanel(c: DcCtx): void {
  const { doc, rng, color, w, h, baseY } = c;
  const post = 20;
  const picket = c.seed % 2 === 1;
  const x0 = post;
  const x1 = w - post;
  const top = baseY - h * (picket ? 0.7 : 0.95);
  // Rails behind the boards.
  for (const ry of picket ? [0.25, 0.75] : [0.15, 0.85]) {
    const y = top + (baseY - top) * ry;
    doc.add(rect(x0, y - 6, x1 - x0, 12, vGrad(doc, tone(color, -0.25))));
  }
  const bw = picket ? 22 : 28;
  const gap = picket ? 16 : 1.5;
  const n = Math.floor((x1 - x0 + gap) / (bw + gap));
  const startX = x0 + (x1 - x0 - (n * (bw + gap) - gap)) / 2;
  for (let i = 0; i < n; i++) {
    const x = startX + i * (bw + gap);
    const shade = tone(color, rng.range(-0.08, 0.06));
    const bTop = top + (picket ? 0 : rng.range(0, 2));
    const d = picket
      ? polygon([{ x, y: bTop + 14 }, { x: x + bw / 2, y: bTop }, { x: x + bw, y: bTop + 14 }, { x: x + bw, y: baseY - 6 }, { x, y: baseY - 6 }])
      : polygon([{ x, y: bTop + 6 }, { x: x + 6, y: bTop }, { x: x + bw - 6, y: bTop }, { x: x + bw, y: bTop + 6 }, { x: x + bw, y: baseY - 2 }, { x, y: baseY - 2 }]);
    doc.add(path(d, hGrad(doc, shade, 0.1, -0.15)));
    if (!picket) doc.add(rect(x + bw - 1.5, bTop + 4, 1.5, baseY - bTop - 6, tone(color, -0.5), { opacity: 0.5 }));
    const gl = taper([{ x: x + bw * rng.range(0.3, 0.7), y: bTop + 12 }, { x: x + bw * rng.range(0.3, 0.7), y: baseY - 12 }], 1, 0.6);
    doc.add(path(gl, tone(color, -0.35), { opacity: 0.3 }));
  }
  // Posts with caps.
  for (const px of [0, w - post]) {
    doc.add(...plank(doc, rng, px, top - 12, post, baseY - top + 10, tone(color, -0.05), true, 1));
    doc.add(path(polygon([{ x: px - 3, y: top - 10 }, { x: px + post / 2, y: top - 22 }, { x: px + post + 3, y: top - 10 }]), tone(color, 0.15)));
  }
  doc.add(contact(doc, w / 2, baseY - 1, w * 0.48, 3));
}

function arbor(c: DcCtx): void {
  const { doc, rng, color, w, h, baseY } = c;
  const sideW = w * 0.2;
  const archTop = h * 0.04;
  const springY = h * 0.3;
  const lat = tone(color, -0.08);
  for (const x0 of [w * 0.02, w * 0.98 - sideW]) {
    // Lattice side panel between two posts.
    const parts: string[] = [];
    for (let i = 1; i < 4; i++) parts.push(rect(x0 + (sideW / 4) * i - 2, springY, 4, baseY - springY - 4, lat));
    for (let j = 1; j < 9; j++) parts.push(rect(x0, springY + ((baseY - springY) / 9) * j, sideW, 4, lat));
    doc.add(...parts);
    doc.add(...plank(doc, rng, x0 - 4, springY - 10, 12, baseY - springY + 10, color, true, 1), ...plank(doc, rng, x0 + sideW - 8, springY - 10, 12, baseY - springY + 10, color, true, 1));
  }
  // Arched top: two concentric arcs joined by radial slats.
  const cx = w / 2;
  const outerR = w / 2 - 2;
  const innerR = w / 2 - sideW * 0.7;
  const arc = (r: number, y: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI + (i / 24) * Math.PI;
      out.push({ x: cx + Math.cos(a) * r, y: y + Math.sin(a) * (y - archTop) * (r / outerR) });
    }
    return out;
  };
  const slats: string[] = [];
  const o = arc(outerR - 6, springY);
  const inn = arc(innerR, springY);
  for (let i = 2; i < 24; i += 2) slats.push(taper([inn[i], o[i]], 4, 4));
  doc.add(path(slats.join(''), lat));
  doc.add(path(taper(arc(outerR - 6, springY), 12, 12), vGrad(doc, color, 0.2, -0.1)));
  doc.add(path(taper(arc(innerR, springY), 10, 10), vGrad(doc, color, 0.1, -0.2)));
  for (const x of [w * 0.06, w * 0.94]) doc.add(contact(doc, x, baseY - 1, 16));
}

function trellis(c: DcCtx): void {
  const { doc, color, w, h, baseY } = c;
  const cx = w / 2;
  const fan = 7;
  const slats: string[] = [];
  const topY = h * 0.06;
  for (let i = 0; i < fan; i++) {
    const u = i / (fan - 1) - 0.5;
    const tx = cx + u * w * 0.9;
    const ty = topY + Math.abs(u) * h * 0.18;
    slats.push(taper([{ x: cx + u * 14, y: baseY - 2 }, { x: tx, y: ty }], 6, 5));
  }
  for (const v of [0.25, 0.48, 0.7]) {
    const pts: Pt[] = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10 - 0.5;
      const t = 1 - v;
      pts.push({ x: cx + u * 14 + (u * w * 0.9 - u * 14) * t, y: lerp(baseY - 2, topY + Math.abs(u) * h * 0.18, t) });
    }
    slats.push(taper(pts, 5, 5));
  }
  doc.add(path(slats.join(''), tone(color, -0.45), { opacity: 0.35, transform: 'translate(2 3)' }));
  doc.add(path(slats.join(''), vGrad(doc, color, 0.15, -0.2)));
}

// ---------------------------------------------------------------------------
// Facade details
// ---------------------------------------------------------------------------

function mailbox(c: DcCtx): void {
  const { doc, rng, color, w, h, baseY } = c;
  const flag = c.color2 ?? '#c8102e';
  const postX = w * 0.42;
  doc.add(contact(doc, postX + 8, baseY - 1, 18));
  doc.add(...plank(doc, rng, postX, h * 0.38, 18, baseY - h * 0.38, '#6b5444', true, 1));
  doc.add(rect(postX - 30, h * 0.36, 78, 10, vGrad(doc, '#6b5444')));
  // Box body (rounded top) receding to the right, door on the left.
  const bx = w * 0.12;
  const by = h * 0.08;
  const bw = w * 0.76;
  const bh = h * 0.28;
  const body = new PathW(1)
    .M(bx, by + bh)
    .L(bx, by + bh * 0.42)
    .C(bx, by - bh * 0.05, bx + bw, by - bh * 0.05, bx + bw, by + bh * 0.42)
    .L(bx + bw, by + bh)
    .Z()
    .toString();
  doc.add(path(body, vGrad(doc, color, 0.3, -0.3)));
  doc.add(path(body, doc.linear([{ o: 0, c: '#ffffff', a: 0 }, { o: 0.3, c: '#ffffff', a: 0.18 }, { o: 0.45, c: '#ffffff', a: 0 }], 0, 0, 0, 1)));
  const door = new PathW(1)
    .M(bx - 6, by + bh + 2)
    .L(bx - 6, by + bh * 0.42)
    .C(bx - 6, by + bh * 0.02, bx + 30, by + bh * 0.02, bx + 30, by + bh * 0.42)
    .L(bx + 30, by + bh + 2)
    .Z()
    .toString();
  doc.add(path(door, hGrad(doc, color, 0.15, -0.35)));
  doc.add(path(roundRect(bx + 8, by + bh * 0.55, 10, 6, 2), '#b9b9b9'));
  // Flag (raised) on the right side.
  doc.add(rect(bx + bw - 26, by + bh * 0.15 - 30, 5, 40, flag), rect(bx + bw - 26, by + bh * 0.15 - 30, 26, 14, flag));
}

/** Glyph polylines for numerals on a 0.6 × 1 grid; `loops` are closed ellipses (cx, cy, rx, ry). */
const DIGITS: Record<string, { lines: Pt[][]; loops?: [number, number, number, number][] }> = {
  '0': { lines: [], loops: [[0.3, 0.5, 0.25, 0.47]] },
  '1': { lines: [[{ x: 0.12, y: 0.2 }, { x: 0.36, y: 0.03 }, { x: 0.36, y: 0.98 }]] },
  '2': {
    lines: [
      splinePts([{ x: 0.05, y: 0.22 }, { x: 0.3, y: 0.03 }, { x: 0.55, y: 0.25 }, { x: 0.42, y: 0.52 }, { x: 0.05, y: 0.97 }], 4),
      [{ x: 0.05, y: 0.97 }, { x: 0.58, y: 0.97 }],
    ],
  },
  '3': {
    lines: [
      splinePts([{ x: 0.05, y: 0.14 }, { x: 0.3, y: 0.03 }, { x: 0.53, y: 0.2 }, { x: 0.48, y: 0.4 }, { x: 0.24, y: 0.48 }], 4),
      splinePts([{ x: 0.24, y: 0.48 }, { x: 0.53, y: 0.6 }, { x: 0.54, y: 0.84 }, { x: 0.3, y: 0.98 }, { x: 0.03, y: 0.88 }], 4),
    ],
  },
  '4': { lines: [[{ x: 0.44, y: 0.98 }, { x: 0.44, y: 0.03 }, { x: 0.03, y: 0.68 }, { x: 0.6, y: 0.68 }]] },
  '5': {
    lines: [
      [{ x: 0.55, y: 0.03 }, { x: 0.12, y: 0.03 }, { x: 0.08, y: 0.45 }],
      splinePts([{ x: 0.08, y: 0.45 }, { x: 0.3, y: 0.38 }, { x: 0.55, y: 0.55 }, { x: 0.52, y: 0.85 }, { x: 0.28, y: 0.98 }, { x: 0.03, y: 0.9 }], 4),
    ],
  },
  '6': {
    lines: [
      splinePts(
        [
          { x: 0.5, y: 0.05 },
          { x: 0.24, y: 0.06 },
          { x: 0.06, y: 0.38 },
          { x: 0.06, y: 0.72 },
          { x: 0.28, y: 0.98 },
          { x: 0.52, y: 0.84 },
          { x: 0.53, y: 0.62 },
          { x: 0.3, y: 0.46 },
          { x: 0.07, y: 0.6 },
        ],
        4,
      ),
    ],
  },
  '7': { lines: [[{ x: 0.03, y: 0.03 }, { x: 0.58, y: 0.03 }, { x: 0.2, y: 0.98 }]] },
  '8': {
    lines: [],
    loops: [
      [0.3, 0.26, 0.21, 0.23],
      [0.3, 0.73, 0.26, 0.25],
    ],
  },
};
DIGITS['9'] = {
  lines: DIGITS['6'].lines.map((l) => l.map((p) => ({ x: 0.6 - p.x, y: 1 - p.y }))),
};

function houseNumbers(c: DcCtx): void {
  const { doc, color, w, h } = c;
  const ink = c.color2 ?? (luminance(color) > 0.35 ? '#1f1f1f' : '#f4f1ea');
  const plate = roundRect(w * 0.03, h * 0.08, w * 0.94, h * 0.84, 10);
  doc.add(wallShadow(plate), path(plate, vGrad(doc, color, 0.12, -0.18)));
  doc.add(path(roundRect(w * 0.03 + 3, h * 0.08 + 3, w * 0.94 - 6, h * 0.84 - 6, 8), 'none', { stroke: tone(color, 0.35), 'stroke-width': 1.2, 'stroke-opacity': 0.7 }));
  const digits = String(100 + (Math.abs(c.seed) % 900));
  const gh = h * 0.56;
  const gw = gh * 0.6;
  const gap = gh * 0.22;
  const total = digits.length * gw + (digits.length - 1) * gap;
  const sw = gh * 0.12;
  let x = (w - total) / 2;
  const y = h * 0.22;
  const strokes: string[] = [];
  const loops: string[] = [];
  for (const ch of digits) {
    const gl = DIGITS[ch];
    for (const line of gl.lines) {
      const pts = line.map((p) => ({ x: x + (p.x / 0.6) * gw, y: y + p.y * gh }));
      if (pts.length <= 4) {
        // Straight polyline: one quad per segment + round joints (clean corners).
        for (let i = 0; i < pts.length - 1; i++) strokes.push(taper([pts[i], pts[i + 1]], sw, sw));
        for (const p of pts) strokes.push(ellipsePath(p.x, p.y, sw / 2, sw / 2));
      } else {
        strokes.push(taper(pts, sw, sw));
        strokes.push(ellipsePath(pts[0].x, pts[0].y, sw / 2, sw / 2), ellipsePath(pts[pts.length - 1].x, pts[pts.length - 1].y, sw / 2, sw / 2));
      }
    }
    for (const [lx, ly, rx, ry] of gl.loops ?? []) {
      const cx = x + (lx / 0.6) * gw;
      const cy = y + ly * gh;
      const ox = (rx / 0.6) * gw;
      const oy = ry * gh;
      loops.push(ellipsePath(cx, cy, ox + sw / 2, oy + sw / 2) + ellipsePath(cx, cy, Math.max(1, ox - sw / 2), Math.max(1, oy - sw / 2)));
    }
    x += gw + gap;
  }
  const st = strokes.join('');
  const lp = loops.join('');
  doc.add(g([path(st, '#000000'), lp ? path(lp, '#000000', { 'fill-rule': 'evenodd' }) : ''], { opacity: 0.25, transform: 'translate(1.5 2)' }));
  doc.add(path(st, ink));
  if (lp) doc.add(path(lp, ink, { 'fill-rule': 'evenodd' }));
}

function shutters(c: DcCtx): void {
  const { doc, color, w, h, baseY } = c;
  const sw = w * 0.27;
  const top = baseY - h * 0.98;
  for (const x0 of [0, w - sw]) {
    doc.add(wallShadow(roundRect(x0, top, sw, baseY - top, 1)));
    doc.add(rect(x0, top, sw, baseY - top, vGrad(doc, color, 0.05, -0.15)));
    // Two louvered panels between stiles and rails.
    const st = sw * 0.14;
    const panels = [
      [top + st, top + (baseY - top) * 0.47],
      [top + (baseY - top) * 0.53, baseY - st],
    ];
    for (const [y0, y1] of panels) {
      doc.add(rect(x0 + st, y0, sw - st * 2, y1 - y0, tone(color, -0.4)));
      const n = Math.floor((y1 - y0) / 9);
      for (let i = 0; i < n; i++) {
        const y = y0 + i * ((y1 - y0) / n);
        doc.add(rect(x0 + st, y + 1, sw - st * 2, (y1 - y0) / n - 2, vGrad(doc, color, 0.28, -0.12)));
      }
    }
    doc.add(rect(x0 + 1, top + 1, 1.5, baseY - top - 2, tone(color, 0.4), { opacity: 0.6 }));
    // Shutter dog (hardware).
    doc.add(path(ellipsePath(x0 < w / 2 ? x0 + sw - 6 : x0 + 6, top + (baseY - top) * 0.7, 3, 3), '#2b2b2b'));
  }
}

function awning(c: DcCtx): void {
  const { doc, color, w, h } = c;
  const alt = c.color2 ?? '#f4efe4';
  const backY = h * 0.04;
  const frontY = h * 0.62;
  const bl = w * 0.08;
  const br = w * 0.92;
  const fl = w * 0.02;
  const fr = w * 0.98;
  const n = 9;
  // Side panels (shade).
  doc.add(path(polygon([{ x: bl, y: backY }, { x: fl, y: frontY }, { x: fl + 3, y: frontY + h * 0.18 }]), tone(color, -0.35)));
  doc.add(path(polygon([{ x: br, y: backY }, { x: fr, y: frontY }, { x: fr - 3, y: frontY + h * 0.18 }]), tone(color, -0.45)));
  // Sloped top with converging stripes.
  for (let i = 0; i < n; i++) {
    const u0 = i / n;
    const u1 = (i + 1) / n;
    const col = i % 2 ? alt : color;
    const d = polygon([
      { x: lerp(bl, br, u0), y: backY },
      { x: lerp(bl, br, u1), y: backY },
      { x: lerp(fl, fr, u1), y: frontY },
      { x: lerp(fl, fr, u0), y: frontY },
    ]);
    doc.add(path(d, vGrad(doc, col, 0.12, -0.05)));
  }
  // Valance with scalloped edge.
  const vh = h * 0.2;
  for (let i = 0; i < n; i++) {
    const x0 = lerp(fl, fr, i / n);
    const x1 = lerp(fl, fr, (i + 1) / n);
    const col = i % 2 ? alt : color;
    const d = new PathW(1)
      .M(x0, frontY)
      .L(x1, frontY)
      .L(x1, frontY + vh * 0.7)
      .Q((x0 + x1) / 2, frontY + vh * 1.15, x0, frontY + vh * 0.7)
      .Z()
      .toString();
    doc.add(path(d, vGrad(doc, col, 0.05, -0.2)));
  }
  doc.add(rect(fl, frontY - 2, fr - fl, 5, tone(color, -0.3), { opacity: 0.6 }));
  doc.add(path(polygon([{ x: bl, y: backY }, { x: br, y: backY }, { x: fr, y: frontY }, { x: fl, y: frontY }]), doc.linear([{ o: 0, c: '#000000', a: 0.15 }, { o: 1, c: '#ffffff', a: 0.08 }], 0, 0, 0, 1)));
}

function mirror(c: DcCtx): void {
  const { doc, color, w, h, baseY } = c;
  const variant = c.seed % 3;
  const fw = Math.max(10, w * 0.07);
  const cx = w / 2;
  const glassGrad = doc.linear(
    [
      { o: 0, c: '#dfe7ea' },
      { o: 0.45, c: '#aebfc6' },
      { o: 0.55, c: '#c6d3d8' },
      { o: 1, c: '#7f949c' },
    ],
    0,
    0,
    1,
    1,
  );
  const frameGrad = doc.linear(cylStops(color), 0, 0, 1, 1);
  let outer: string;
  let inner: string;
  if (variant === 1) {
    const r = Math.min(w, baseY) / 2 - 4;
    const cy = baseY - r;
    outer = ellipsePath(cx, cy, r, r);
    inner = ellipsePath(cx, cy, r - fw, r - fw);
  } else if (variant === 0) {
    const x0 = w * 0.06;
    const x1 = w * 0.94;
    const top = h * 0.02;
    const ar = (x1 - x0) / 2;
    outer = new PathW(1).M(x0, baseY).L(x0, top + ar).Q(x0, top, cx, top).Q(x1, top, x1, top + ar).L(x1, baseY).Z().toString();
    inner = new PathW(1)
      .M(x0 + fw, baseY - fw)
      .L(x0 + fw, top + ar)
      .Q(x0 + fw, top + fw, cx, top + fw)
      .Q(x1 - fw, top + fw, x1 - fw, top + ar)
      .L(x1 - fw, baseY - fw)
      .Z()
      .toString();
  } else {
    outer = roundRect(w * 0.06, h * 0.02, w * 0.88, baseY - h * 0.02, 3);
    inner = roundRect(w * 0.06 + fw, h * 0.02 + fw, w * 0.88 - fw * 2, baseY - h * 0.02 - fw * 2, 2);
  }
  doc.add(wallShadow(outer), path(outer, frameGrad), path(inner, glassGrad));
  // Reflection streaks.
  const clip = doc.clip(path(inner, '#000'));
  doc.add(
    g(
      [
        path(polygon([{ x: w * 0.2, y: h }, { x: w * 0.42, y: h }, { x: w * 0.95, y: 0 }, { x: w * 0.73, y: 0 }]), '#ffffff', { opacity: 0.22 }),
        path(polygon([{ x: w * 0.48, y: h }, { x: w * 0.54, y: h }, { x: w * 1.07, y: 0 }, { x: w * 1.01, y: 0 }]), '#ffffff', { opacity: 0.18 }),
      ],
      { 'clip-path': clip },
    ),
  );
  doc.add(path(inner, 'none', { stroke: tone(color, -0.5), 'stroke-width': 1.2, 'stroke-opacity': 0.6 }));
}

function wallArt(c: DcCtx): void {
  const { doc, rng, color, w, h, baseY } = c;
  const accent = c.color2 ?? tone(color, 0.45);
  const frameCol = c.seed % 2 ? '#2a2623' : '#b58d5f';
  const fw = 9;
  const x0 = w * 0.04;
  const y0 = h * 0.03;
  const fwid = w * 0.92;
  const fh = baseY - y0;
  const outer = roundRect(x0, y0, fwid, fh, 2);
  doc.add(wallShadow(outer), path(outer, doc.linear(cylStops(frameCol), 0, 0, 1, 1)));
  // Mat and canvas.
  doc.add(rect(x0 + fw, y0 + fw, fwid - fw * 2, fh - fw * 2, '#f4f1ea'));
  const ax = x0 + fw + 14;
  const ay = y0 + fw + 14;
  const aw = fwid - fw * 2 - 28;
  const ah = fh - fw * 2 - 28;
  doc.add(rect(ax, ay, aw, ah, mix(color, '#f2ede4', 0.75)));
  const clip = doc.clip(rect(ax, ay, aw, ah, '#000'));
  const shapes: string[] = [];
  const palette = [color, accent, tone(color, -0.35), mix(color, accent, 0.5), '#2b2b2b'];
  const variant = c.seed % 3;
  if (variant === 0) {
    // Soft abstract arches / sun.
    shapes.push(path(ellipsePath(ax + aw * 0.68, ay + ah * 0.32, aw * 0.14, aw * 0.14), accent));
    for (let i = 0; i < 3; i++) {
      const r = aw * (0.5 - i * 0.12);
      shapes.push(path(new PathW(1).M(ax + aw * 0.3 - r, ay + ah).A(r, r, 0, 0, 1, ax + aw * 0.3 + r, ay + ah).Z().toString(), palette[i % 3]));
    }
  } else if (variant === 1) {
    // Overlapping organic blobs.
    for (let i = 0; i < 5; i++) {
      shapes.push(path(softBlob(rng, ax + aw * rng.range(0.15, 0.85), ay + ah * rng.range(0.2, 0.85), aw * rng.range(0.12, 0.28), ah * rng.range(0.12, 0.28), 8, 0.25), palette[i % palette.length], { opacity: 0.88 }));
    }
  } else {
    // Landscape bands.
    for (let i = 0; i < 4; i++) {
      const yy = ay + ah * (0.35 + i * 0.17);
      const d = new PathW(1).M(ax, yy).Q(ax + aw * 0.3, yy - ah * rng.range(0.05, 0.2), ax + aw * 0.6, yy).Q(ax + aw * 0.85, yy + ah * 0.08, ax + aw, yy - ah * 0.05).L(ax + aw, ay + ah).L(ax, ay + ah).Z().toString();
      shapes.push(path(d, palette[i % 4]));
    }
    shapes.push(path(ellipsePath(ax + aw * 0.75, ay + ah * 0.22, aw * 0.07, aw * 0.07), accent));
  }
  doc.add(g(shapes, { 'clip-path': clip }));
  doc.add(rect(ax, ay, aw, ah, doc.linear([{ o: 0, c: '#ffffff', a: 0.12 }, { o: 1, c: '#000000', a: 0.06 }], 0, 0, 1, 1)));
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const DEFS: Record<DecorForm, DecorDef> = {
  'planter-round': { w: 220, h: 190, draw: planterRound },
  'planter-square': { w: 200, h: 200, draw: (c) => squarePlanter(c, 0.72, 46, 0.82, false) },
  'planter-trough': { w: 380, h: 140, draw: (c) => squarePlanter(c, 0.86, 44, 0.94, true) },
  'window-box': { w: 380, h: 190, draw: windowBox },
  bench: { w: 380, h: 210, draw: bench },
  'outdoor-chair': { w: 240, h: 250, draw: adirondack },
  'lounge-chair': { w: 400, h: 180, draw: loungeChair },
  'dining-set': { w: 420, h: 230, draw: diningSet },
  sofa: { w: 440, h: 200, draw: (c) => upholstered(c, 3) },
  armchair: { w: 230, h: 200, draw: (c) => upholstered(c, 1) },
  'coffee-table': { w: 340, h: 130, draw: coffeeTable },
  rug: { w: 440, h: 160, draw: rug },
  'fire-pit': { w: 300, h: 220, draw: firePit },
  umbrella: { w: 340, h: 360, draw: umbrella },
  pergola: { w: 440, h: 380, draw: pergola },
  boulder: { w: 270, h: 170, draw: boulder },
  birdbath: { w: 200, h: 230, draw: birdbath },
  fountain: { w: 280, h: 340, draw: fountain },
  'raised-bed': { w: 380, h: 170, draw: raisedBed },
  'fence-panel': { w: 440, h: 250, draw: fencePanel },
  arbor: { w: 320, h: 400, draw: arbor },
  mailbox: { w: 170, h: 320, draw: mailbox },
  'house-numbers': { w: 280, h: 110, draw: houseNumbers },
  'shutters-pair': { w: 320, h: 330, draw: shutters },
  awning: { w: 380, h: 170, draw: awning },
  trellis: { w: 200, h: 400, draw: trellis },
  mirror: {
    w: 200,
    h: 300,
    size: (seed) => (seed % 3 === 1 ? { w: 240, h: 244 } : seed % 3 === 2 ? { w: 200, h: 280 } : { w: 200, h: 300 }),
    draw: mirror,
  },
  'wall-art': { w: 260, h: 200, size: (seed) => (seed % 4 === 3 ? { w: 200, h: 260 } : { w: 260, h: 200 }), draw: wallArt },
};

function decorLayout(spec: DecorArt): { def: DecorDef; seed: number; w: number; h: number; baseY: number } {
  const def = DEFS[spec.form] ?? DEFS['planter-round'];
  const seed = typeof spec.seed === 'number' && Number.isFinite(spec.seed) ? Math.abs(Math.trunc(spec.seed)) : 0;
  const { w, h } = def.size ? def.size(seed) : def;
  return { def, seed, w, h, baseY: h - 3 };
}

/** Output size and anchor of a decor spec without drawing it. */
export function decorSize(spec: DecorArt): Omit<ArtResult, 'svg'> {
  const { w, h, baseY } = decorLayout(spec);
  return { ...outputSize(w, h), anchorY: baseY / h };
}

export function renderDecor(spec: DecorArt, prefix: string, rngSeed: number): ArtResult {
  const { def, seed, w, h, baseY } = decorLayout(spec);
  const color = normHex(spec.color, DEFAULT_WOOD);
  const color2 = spec.color2 === undefined ? undefined : normHex(spec.color2, '') || undefined;
  const doc = new SvgDoc(w, h, prefix);
  def.draw({ doc, rng: makeRng(rngSeed), color, color2, seed, w, h, baseY });
  return { svg: doc.toString(), width: doc.outWidth, height: doc.outHeight, anchorY: baseY / h };
}
