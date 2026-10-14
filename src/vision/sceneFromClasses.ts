/**
 * Offline scene map (no Claude) from semantic segmentation, pure:
 * ADE20K labels (+ CLIPSeg probabilities for what ADE20K lacks — roof,
 * driveway, patio, mulched beds) → per-kind masks → smoothed connected
 * components → zones with simplified outlines in photo px, plus a category
 * guess from the class mix.
 */
import { newId } from '../../shared/ids';
import { CONTEXT_ZONE_KINDS, spaceKindOf, type SceneMap, type SceneZone, type SpaceType, type ZoneKind } from '../../shared/types';
import { growMask, shrinkMask } from '../engine/mask';
import type { Mask } from '../engine/types';
import { ZONE_KIND_LABELS } from '../ui/studio/panels/zones';
import { ADE, ADE20K_LABELS, guessCategory, zoneKindForClass } from './ade20k';
import { labelComponents, largestContour, type Component } from './contours';
import { classShares, type ClassMap } from './scoring';

/** CLIPSeg text prompts for exterior classes ADE20K does not have. */
export const CLIP_PROMPTS = {
  roof: 'a roof',
  driveway: 'a driveway',
  mulch: 'a mulched garden bed',
  patio: 'a paved patio',
  lawn: 'a lawn',
} as const;
export type ClipKey = keyof typeof CLIP_PROMPTS;

/** A CLIPSeg prompt standing in for one ADE20K class (scene map without SegFormer). */
export interface ClipClass {
  prompt: string;
  /** ADE20K class name the prompt's pixels are labelled with. */
  ade: string;
  /** Also feeds this CLIP override (roof, driveway…) in kindGrid. */
  clip?: ClipKey;
}

/**
 * Prompts for a scene map from CLIPSeg alone (used when the SegFormer
 * licence is declined). Each pixel takes the most likely prompt above a
 * threshold; the prompts map onto ADE20K classes so the usual pipeline
 * (kind mapping, smoothing, roof / driveway / patio / mulch overrides)
 * applies unchanged. Roofs are labelled as building first and become roofs
 * through the override, like with SegFormer.
 */
export const CLIP_ONLY_CLASSES: { exterior: readonly ClipClass[]; interior: readonly ClipClass[] } = {
  exterior: [
    { prompt: 'the walls of a house', ade: 'house' },
    { prompt: CLIP_PROMPTS.roof, ade: 'house', clip: 'roof' },
    { prompt: 'the sky', ade: 'sky' },
    { prompt: 'a tree', ade: 'tree' },
    { prompt: CLIP_PROMPTS.lawn, ade: 'grass', clip: 'lawn' },
    { prompt: 'shrubs and flowers', ade: 'plant' },
    { prompt: CLIP_PROMPTS.mulch, ade: 'earth', clip: 'mulch' },
    { prompt: 'a window', ade: 'windowpane' },
    { prompt: 'a front door', ade: 'door' },
    { prompt: 'a fence', ade: 'fence' },
    { prompt: 'a street', ade: 'road' },
    { prompt: CLIP_PROMPTS.driveway, ade: 'road', clip: 'driveway' },
    { prompt: 'a sidewalk', ade: 'sidewalk' },
    { prompt: 'a garden path', ade: 'path' },
    { prompt: CLIP_PROMPTS.patio, ade: 'floor', clip: 'patio' },
    { prompt: 'front steps', ade: 'stairs' },
    { prompt: 'a car', ade: 'car' },
  ],
  interior: [
    { prompt: 'a wall', ade: 'wall' },
    { prompt: 'a floor', ade: 'floor' },
    { prompt: 'a ceiling', ade: 'ceiling' },
    { prompt: 'a window', ade: 'windowpane' },
    { prompt: 'a door', ade: 'door' },
    { prompt: 'kitchen cabinets', ade: 'cabinet' },
    { prompt: 'a countertop', ade: 'countertop' },
    { prompt: 'a fireplace', ade: 'fireplace' },
    { prompt: 'stairs', ade: 'stairs' },
    { prompt: 'a sofa', ade: 'sofa' },
    { prompt: 'a table', ade: 'table' },
    { prompt: 'a bed', ade: 'bed' },
    { prompt: 'a rug', ade: 'rug' },
    { prompt: 'a lamp', ade: 'lamp' },
    { prompt: 'a person', ade: 'person' },
  ],
};

/** Label of class-map pixels no prompt claimed (not an ADE20K class: maps to no zone). */
export const UNLABELED = 255;

/**
 * A class map from CLIPSeg probabilities (one plane per entry of `classes`,
 * all on the same width×height grid): each pixel gets the ADE20K class of its
 * most likely prompt when that probability reaches `threshold`, else
 * UNLABELED. Also returns the override planes (roof, driveway…) for kindGrid.
 */
export function classMapFromClip(
  probs: readonly Float32Array[],
  classes: readonly ClipClass[],
  width: number,
  height: number,
  threshold = 0.35,
): { classes: ClassMap; clip: ClipMaps } {
  const n = width * height;
  const labels = new Uint8Array(n).fill(UNLABELED);
  const ids = classes.map((c) => {
    const id = ADE[c.ade];
    if (id === undefined) throw new Error(`Unknown ADE20K class "${c.ade}"`);
    return id;
  });
  const planes = classes.map((_, k) => probs[k]).filter((p): p is Float32Array => !!p && p.length >= n);
  if (planes.length === classes.length) {
    for (let i = 0; i < n; i++) {
      let best = -1;
      let bestP = threshold;
      for (let k = 0; k < planes.length; k++) {
        const p = planes[k][i];
        if (p >= bestP) {
          bestP = p;
          best = k;
        }
      }
      if (best >= 0) labels[i] = ids[best];
    }
  }
  const clip: ClipMaps = { width, height, probs: {} };
  classes.forEach((c, k) => {
    if (c.clip && probs[k]) clip.probs[c.clip] = probs[k];
  });
  return { classes: { width, height, labels }, clip };
}

/** CLIPSeg probabilities resampled to the class map's grid. */
export interface ClipMaps {
  width: number;
  height: number;
  probs: Partial<Record<ClipKey, Float32Array>>;
}

export interface OfflineZone {
  kind: ZoneKind;
  label: string;
  description: string;
  /** Photo px, clockwise. */
  polygon: { x: number; y: number }[];
  /** Share of the photo (0..1). */
  area: number;
  editable: boolean;
}

const set = (...names: string[]) => new Set(names.map((n) => ADE[n]));
const ROOF_BASE = set('building', 'house', 'wall', 'hovel', 'awning', 'canopy', 'ceiling');
const DRIVE_BASE = set('road', 'sidewalk', 'path', 'earth', 'floor', 'land', 'dirt track');
const PATIO_BASE = set('floor', 'path', 'sidewalk', 'earth', 'rock', 'sand', 'land');
const BED_BASE = set('earth', 'plant', 'flower', 'grass', 'rock', 'sand', 'land', 'field');
const LAWN_BASE = set('earth', 'land', 'field', 'plant');

const THIN_KINDS = new Set<ZoneKind>(['countertop', 'backsplash', 'trim', 'fence', 'walkway', 'sidewalk', 'steps', 'stairs']);

/** Minimum component size per kind as a share of the frame. */
function minAreaFor(kind: ZoneKind): number {
  switch (kind) {
    case 'windows':
    case 'window':
    case 'front-door':
    case 'door':
    case 'garage-door':
    case 'columns':
    case 'steps':
    case 'light-fixture':
    case 'mailbox':
      return 0.0008;
    case 'sky':
    case 'street':
    case 'neighbor':
      return 0.01;
    default:
      return 0.005;
  }
}

function maxCountFor(kind: ZoneKind): number {
  switch (kind) {
    case 'windows':
    case 'window':
      return 8;
    case 'furniture':
      return 6;
    case 'facade':
    case 'roof':
    case 'sky':
    case 'ceiling':
    case 'floor':
      return 2;
    default:
      return 3;
  }
}

/** Per-pixel zone kind index (0 = none) from labels and CLIPSeg overrides. */
export function kindGrid(classes: ClassMap, interior: boolean, clip?: ClipMaps): { grid: Uint8Array; kinds: ZoneKind[] } {
  const kinds: ZoneKind[] = [];
  const index = new Map<ZoneKind, number>();
  const idx = (k: ZoneKind) => {
    let i = index.get(k);
    if (i === undefined) {
      kinds.push(k);
      i = kinds.length;
      index.set(k, i);
    }
    return i;
  };
  const byClass = new Int16Array(256).fill(-1);
  for (let c = 0; c < ADE20K_LABELS.length; c++) {
    const k = zoneKindForClass(c, interior);
    if (k) byClass[c] = idx(k);
  }
  const { labels } = classes;
  const grid = new Uint8Array(labels.length);
  const p = clip && clip.width === classes.width && clip.height === classes.height && !interior ? clip.probs : undefined;
  const roofI = idx('roof');
  const driveI = idx('driveway');
  const patioI = idx('patio');
  const bedI = idx('planting-bed');
  const lawnI = idx('lawn');
  for (let i = 0; i < labels.length; i++) {
    const c = labels[i];
    let k = byClass[c] > 0 ? byClass[c] : 0;
    if (p) {
      const roof = p.roof?.[i] ?? 0;
      const drive = p.driveway?.[i] ?? 0;
      const patio = p.patio?.[i] ?? 0;
      const mulch = p.mulch?.[i] ?? 0;
      const lawn = p.lawn?.[i] ?? 0;
      if (roof > 0.5 && ROOF_BASE.has(c)) k = roofI;
      else if (drive > 0.45 && drive >= patio && DRIVE_BASE.has(c)) k = driveI;
      else if (patio > 0.5 && PATIO_BASE.has(c)) k = patioI;
      else if (mulch > 0.45 && mulch > lawn && BED_BASE.has(c)) k = bedI;
      else if (lawn > 0.55 && LAWN_BASE.has(c)) k = lawnI;
    }
    grid[i] = k;
  }
  return { grid, kinds };
}

function positionWord(cx: number, width: number): string {
  return cx < width / 3 ? 'left' : cx > (width * 2) / 3 ? 'right' : 'center';
}

interface Found {
  kind: ZoneKind;
  comp: Component;
  mask: Mask;
  classes: string;
}

/** Most common class names inside a component (for the zone description). */
function dominantClasses(labels: Uint8Array, compLabels: Int32Array, label: number, c: Component, width: number): string {
  const counts = new Map<number, number>();
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0; x <= c.x1; x++) {
      const i = y * width + x;
      if (compLabels[i] === label && labels[i] !== UNLABELED) counts.set(labels[i], (counts.get(labels[i]) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .filter(([, n], i) => i === 0 || n > c.area * 0.15)
    .map(([id]) => ADE20K_LABELS[id])
    .join(', ');
}

function componentMask(compLabels: Int32Array, label: number, width: number, height: number): Mask {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < compLabels.length; i++) if (compLabels[i] === label) data[i] = 255;
  return { width, height, data };
}

/**
 * Zones found in the class map. `photo` is the photo size the polygons are
 * scaled to. Context kinds (sky, street, neighbor) are not editable.
 */
export function zonesFromClasses(classes: ClassMap, photo: { width: number; height: number }, interior: boolean, clip?: ClipMaps): OfflineZone[] {
  const { width: W, height: H } = classes;
  const total = W * H;
  if (total === 0) return [];
  const { grid, kinds } = kindGrid(classes, interior, clip);
  if (!interior) separateFreestandingWalls(classes, grid, kinds);
  // Light smoothing radius relative to the grid (≈ 0.4% of the long edge).
  const r = Math.max(1, Math.round(Math.max(W, H) * 0.004));
  const found: Found[] = [];
  for (let ki = 1; ki <= kinds.length; ki++) {
    const kind = kinds[ki - 1];
    const m: Mask = { width: W, height: H, data: new Uint8Array(total) };
    let any = 0;
    for (let i = 0; i < total; i++) if (grid[i] === ki) {
      m.data[i] = 255;
      any++;
    }
    if (any < total * minAreaFor(kind)) continue;
    // Small or thin parts (windows, countertops seen edge-on, distant paths) skip the opening pass.
    const small = minAreaFor(kind) < 0.005 || THIN_KINDS.has(kind);
    // Close small gaps, then open away specks (thin parts like windows get a gentler pass).
    growMask(m, r);
    shrinkMask(m, r);
    if (!small) {
      shrinkMask(m, r);
      growMask(m, r);
    }
    for (let i = 0; i < total; i++) m.data[i] = m.data[i] >= 128 ? 255 : 0;
    const { labels: compLabels, components } = labelComponents(m);
    const big = components.filter((c) => c.area >= total * minAreaFor(kind)).sort((a, b) => b.area - a.area);
    for (const c of big.slice(0, maxCountFor(kind))) {
      found.push({
        kind,
        comp: c,
        mask: componentMask(compLabels, c.label, W, H),
        classes: dominantClasses(classes.labels, compLabels, c.label, c, W),
      });
    }
  }

  const kept = reclassify(found, W, interior);

  const sx = photo.width / W;
  const sy = photo.height / H;
  const zones: OfflineZone[] = [];
  const byKind = new Map<ZoneKind, Found[]>();
  for (const f of kept) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  for (const [kind, list] of byKind) {
    const labels = componentLabels(
      ZONE_KIND_LABELS[kind],
      list.map((f) => ({ area: f.comp.area, cx: (f.comp.x0 + f.comp.x1) / 2 })),
      W,
    );
    list.forEach((f, li) => {
      const polygon = largestContour(f.mask, { tolerancePx: 0.9, scaleX: sx, scaleY: sy });
      if (polygon.length < 3) return;
      const label = labels[li];
      const area = f.comp.area / total;
      const pct = area >= 0.01 ? `about ${Math.round(area * 100)}% of the photo` : 'a small part of the photo';
      zones.push({
        kind,
        label,
        description: `Found on this device (no AI): ${f.classes || ZONE_KIND_LABELS[kind].toLowerCase()} · ${pct}.`,
        polygon: polygon.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
        area,
        editable: !CONTEXT_ZONE_KINDS.includes(kind),
      });
    });
  }
  zones.sort((a, b) => b.area - a.area);
  return zones.slice(0, 28);
}

/**
 * Labels for several components of one kind: when one clearly dominates it
 * keeps the plain name ("Lawn"), the others get their side of the photo
 * ("Lawn — left"); repeats are numbered ("Windows — left 2").
 */
export function componentLabels(base: string, comps: readonly { area: number; cx: number }[], width: number): string[] {
  if (comps.length === 1) return [base];
  const byArea = comps.map((c, i) => ({ ...c, i })).sort((a, b) => b.area - a.area);
  const dominant = byArea[0].area >= byArea[1].area * 2.5 ? byArea[0].i : -1;
  const used = new Map<string, number>();
  const out: string[] = new Array(comps.length);
  const byX = comps.map((c, i) => ({ ...c, i })).sort((a, b) => a.cx - b.cx);
  for (const c of byX) {
    if (c.i === dominant) {
      out[c.i] = base;
      continue;
    }
    const pos = positionWord(c.cx, width);
    const n = (used.get(pos) ?? 0) + 1;
    used.set(pos, n);
    out[c.i] = `${base} — ${pos}${n > 1 ? ` ${n}` : ''}`;
  }
  return out;
}

/**
 * Outdoors, ADE20K's "wall" is the house wall or a freestanding garden /
 * retaining wall. A wall blob that is low in the frame and much wider than
 * tall becomes a retaining wall; the rest stays part of the facade.
 */
function separateFreestandingWalls(classes: ClassMap, grid: Uint8Array, kinds: ZoneKind[]): void {
  const { width: W, height: H, labels } = classes;
  const wallKind = kinds.indexOf('retaining-wall') + 1 || kinds.push('retaining-wall');
  const walls = { width: W, height: H, data: new Uint8Array(W * H) };
  for (let i = 0; i < labels.length; i++) if (labels[i] === ADE.wall) walls.data[i] = 255;
  const { labels: comp, components } = labelComponents(walls);
  for (const c of components) {
    const w = c.x1 - c.x0 + 1;
    const h = c.y1 - c.y0 + 1;
    if (!(w >= h * 2.5 && c.y0 >= H * 0.45 && h <= H * 0.25)) continue;
    for (let y = c.y0; y <= c.y1; y++) {
      for (let x = c.x0; x <= c.x1; x++) {
        const i = y * W + x;
        if (comp[i] === c.label) grid[i] = wallKind;
      }
    }
  }
}

/**
 * Kind fixes that need the whole picture: the main building vs neighbours
 * (and slivers such as a chimney split off by the roof, dropped), the front
 * door vs other / garage doors, and walks CLIPSeg took for drives or patios.
 */
function reclassify(found: Found[], W: number, interior: boolean): Found[] {
  if (interior) return found;
  const drop = new Set<Found>();
  const facades = found.filter((f) => f.kind === 'facade').sort((a, b) => b.comp.area - a.comp.area);
  const main = facades[0];
  for (const f of facades.slice(1)) {
    const gap = Math.max(f.comp.x0 - main.comp.x1, main.comp.x0 - f.comp.x1, 0);
    if (f.comp.area < main.comp.area * 0.35 && gap > W * 0.02) f.kind = 'neighbor';
    else if (f.comp.area < main.comp.area * 0.1) drop.add(f);
  }
  const doors = found.filter((f) => f.kind === 'front-door').sort((a, b) => b.comp.area - a.comp.area);
  let front = false;
  for (const d of doors) {
    const w = d.comp.x1 - d.comp.x0 + 1;
    const h = d.comp.y1 - d.comp.y0 + 1;
    if (w / h > 1.3) d.kind = 'garage-door';
    else if (!front) front = true;
    else d.kind = 'door';
  }
  const kept = found.filter((f) => !drop.has(f));
  walksFromDrivesAndPatios(kept, W);
  return kept;
}

/** Pixels per row of a component, middle value over its rows (its typical width, robust to perspective). */
function medianRowSpan(f: Found, W: number): number {
  const { comp, mask } = f;
  const spans: number[] = [];
  for (let y = comp.y0; y <= comp.y1; y++) {
    let n = 0;
    for (let x = comp.x0, i = y * W + comp.x0; x <= comp.x1; x++, i++) if (mask.data[i]) n++;
    if (n) spans.push(n);
  }
  spans.sort((a, b) => a - b);
  return spans.length ? spans[spans.length >> 1] : 0;
}

/** True when a pixel of `b` lies within `d` px of a pixel of `a`. */
function touches(a: Found, b: Found, W: number, d = 2): boolean {
  const x0 = Math.max(a.comp.x0 - d, b.comp.x0);
  const x1 = Math.min(a.comp.x1 + d, b.comp.x1);
  const y0 = Math.max(a.comp.y0 - d, b.comp.y0);
  const y1 = Math.min(a.comp.y1 + d, b.comp.y1);
  if (x0 > x1 || y0 > y1) return false;
  const H = a.mask.height;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!b.mask.data[y * W + x]) continue;
      for (let yy = Math.max(0, y - d); yy <= Math.min(H - 1, y + d); yy++) {
        for (let xx = Math.max(0, x - d); xx <= Math.min(W - 1, x + d); xx++) if (a.mask.data[yy * W + xx]) return true;
      }
    }
  }
  return false;
}

const ENTRY_KINDS = new Set<ZoneKind>(['front-door', 'steps', 'porch']);

/**
 * "A driveway" (CLIPSeg) also fires on a front walk. A drive-labelled part is
 * a walkway when it is narrow — its typical width under 12% of the frame and
 * under a fifth of the house's width when the house was found (a walk is
 * 3–5 ft, a drive 10 ft or more) — or when it leads to the front door, steps
 * or porch rather than a garage door.
 *
 * "A paved patio" fires on a wide flagstone walk too. A patio-labelled part
 * is a walkway only when it is a strip leading to the entry: it touches the
 * front door, steps or porch (not a garage door), its typical width is under
 * a quarter of the frame, and it runs up the frame for at least 60% of that
 * width — a walk recedes toward the house, a patio seen from the yard is
 * wide and shallow.
 */
function walksFromDrivesAndPatios(found: Found[], W: number): void {
  const paved = found.filter((f) => f.kind === 'driveway' || f.kind === 'patio');
  if (paved.length === 0) return;
  const house = found.filter((f) => f.kind === 'facade' || f.kind === 'roof');
  const houseW = house.length ? Math.max(...house.map((f) => f.comp.x1)) - Math.min(...house.map((f) => f.comp.x0)) + 1 : 0;
  const narrowLimit = houseW >= W * 0.25 ? Math.min(W * 0.12, houseW * 0.2) : W * 0.12;
  const entries = found.filter((f) => ENTRY_KINDS.has(f.kind));
  const garages = found.filter((f) => f.kind === 'garage-door');
  for (const f of paved) {
    const span = medianRowSpan(f, W);
    const toEntry = span < W * 0.25 && entries.some((e) => touches(f, e, W)) && !garages.some((g) => touches(f, g, W));
    const strip = f.comp.y1 - f.comp.y0 + 1 >= span * 0.6;
    if (f.kind === 'driveway' ? span < narrowLimit || toEntry : toEntry && strip) f.kind = 'walkway';
  }
}

/** Areas people usually change that the on-device models often miss (any listed kind counts as found). */
type Expected = { kinds: readonly ZoneKind[]; label: string };
const FRONT_OF_HOUSE: readonly Expected[] = [
  { kinds: ['front-door'], label: 'front door' },
  { kinds: ['porch'], label: 'porch' },
  { kinds: ['windows'], label: 'windows' },
  { kinds: ['planting-bed'], label: 'planting beds' },
  { kinds: ['driveway', 'walkway'], label: 'driveway' },
];
const EXPECTED_BY_CATEGORY: Partial<Record<SpaceType, readonly Expected[]>> = {
  'front-exterior': FRONT_OF_HOUSE,
  'front-yard': FRONT_OF_HOUSE,
  'other-exterior': FRONT_OF_HOUSE,
  'back-exterior': [FRONT_OF_HOUSE[2], FRONT_OF_HOUSE[3]],
  'side-exterior': [FRONT_OF_HOUSE[2], FRONT_OF_HOUSE[3]],
  backyard: [FRONT_OF_HOUSE[3]],
  'side-yard': [FRONT_OF_HOUSE[3]],
  garden: [FRONT_OF_HOUSE[3]],
};
const EXPECTED_INTERIOR: readonly Expected[] = [
  { kinds: ['ceiling'], label: 'ceiling' },
  { kinds: ['window'], label: 'windows' },
  { kinds: ['door'], label: 'door' },
];

/** What the map of a `category` photo usually has but `zones` lack ("front door", "porch"…). */
export function offlineMissing(zones: readonly Pick<OfflineZone, 'kind'>[], category: SpaceType): string[] {
  const expected = spaceKindOf(category) === 'interior' ? EXPECTED_INTERIOR : (EXPECTED_BY_CATEGORY[category] ?? []);
  const found = new Set(zones.map((z) => z.kind));
  return expected.filter((e) => !e.kinds.some((k) => found.has(k))).map((e) => e.label);
}

/**
 * One-line summary of what the offline map found. With the photo's category,
 * it also names the usual areas it did not find (the models have no reliable
 * classes for doors, porches or beds) and how to add them.
 */
export function offlineSummary(zones: readonly Pick<OfflineZone, 'kind' | 'editable'>[], category?: SpaceType): string {
  const counts = new Map<ZoneKind, number>();
  for (const z of zones) counts.set(z.kind, (counts.get(z.kind) ?? 0) + 1);
  const parts = [...counts.entries()].map(([k, n]) => (n > 1 ? `${n}× ${ZONE_KIND_LABELS[k].toLowerCase()}` : ZONE_KIND_LABELS[k].toLowerCase()));
  if (parts.length === 0) return 'Mapped on this device without AI — no clear areas were found; outline the areas to change by hand.';
  const missing = category ? offlineMissing(zones, category) : [];
  const notFound = missing.length ? ` Not found: ${missing.join(', ')} — use Tap to select to add them.` : '';
  return `Mapped on this device without AI: ${parts.join(', ')}.${notFound} No style or architecture notes — those need Claude.`;
}

export const OFFLINE_MODEL_LABEL = 'On-device (SegFormer-B2';

/**
 * A SceneMap from offline zones (no architecture reading, no paths).
 * `usedSegformer` false = mapped with CLIPSeg alone (SegFormer licence declined).
 */
export function buildOfflineScene(zones: readonly OfflineZone[], category: SpaceType, usedClip: boolean, now = Date.now(), usedSegformer = true): SceneMap {
  const sceneZones: SceneZone[] = zones.map((z) => ({
    id: newId('zone'),
    kind: z.kind,
    label: z.label,
    description: z.description,
    polygon: z.polygon,
    editable: z.editable,
    source: 'ai',
  }));
  return {
    category,
    summary: offlineSummary(zones, category),
    viewpoint: '',
    style: '',
    boundaries: '',
    lighting: '',
    orientation: '',
    architecture: { style: '', features: [], materials: [], proportions: '', designLanguage: [], purpose: [] },
    zones: sceneZones,
    paths: [],
    keep: [],
    opportunities: [],
    createdAt: now,
    model: usedSegformer ? `${OFFLINE_MODEL_LABEL}${usedClip ? ' + CLIPSeg' : ''}, no AI)` : 'On-device (CLIPSeg, no AI)',
  };
}

/**
 * The category an offline map stores: the space type the user chose. The
 * on-device guess (class shares only — CLIPSeg alone without SegFormer)
 * replaces it only when the type is generic ("Other exterior / interior")
 * and the guess is specific and on the same side (inside / outside).
 */
export function offlineSceneCategory(guess: SpaceType, spaceType: SpaceType): SpaceType {
  const generic = spaceType === 'other-exterior' || spaceType === 'other-interior';
  return generic && !/^other/.test(guess) && spaceKindOf(guess) === spaceKindOf(spaceType) ? guess : spaceType;
}

/** Category guess for an offline map. */
export function offlineCategory(classes: ClassMap, interior: boolean): SpaceType {
  return guessCategory(classShares(classes), interior);
}
