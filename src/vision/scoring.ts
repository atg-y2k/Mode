/**
 * Choosing and cleaning model masks, pure:
 * - IoU between a candidate mask and the zone's approximate polygon;
 * - agreement with the semantic (ADE20K) class map;
 * - the combined candidate score and the per-zone agreement shown in the UI;
 * - cleanup: drop specks, fill pinholes, clip runaway masks to a margin
 *   around the AI outline.
 */
import type { Pt, SceneZone } from '../../shared/types';
import { createMask, fillPolygon, growMask } from '../engine/mask';
import type { Mask } from '../engine/types';
import { labelComponents } from './contours';
import { neighbourRole, type Box } from './prompts';

/** Semantic labels (ADE20K class ids) at an analysis resolution covering the whole photo. */
export interface ClassMap {
  width: number;
  height: number;
  labels: Uint8Array;
}

/** Binary (0/255) raster of a polygon at `width`×`height`. */
export function rasterizePolygon(width: number, height: number, polygon: readonly Pt[]): Mask {
  const m = createMask(width, height);
  if (polygon.length >= 3) fillPolygon(m, [...polygon], 'add', false);
  return m;
}

/** Intersection over union of the pixels ≥ 128 (optionally only inside `box`). 0 when both are empty. */
export function maskIoU(a: Mask, b: Mask, box?: Box): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('maskIoU: sizes differ');
  const w = a.width;
  const x0 = box ? Math.max(0, Math.floor(box.x)) : 0;
  const y0 = box ? Math.max(0, Math.floor(box.y)) : 0;
  const x1 = box ? Math.min(w, Math.ceil(box.x + box.w)) : w;
  const y1 = box ? Math.min(a.height, Math.ceil(box.y + box.h)) : a.height;
  let inter = 0;
  let union = 0;
  const ad = a.data;
  const bd = b.data;
  for (let y = y0; y < y1; y++) {
    const row = y * w;
    for (let x = x0; x < x1; x++) {
      const pa = ad[row + x] >= 128;
      const pb = bd[row + x] >= 128;
      if (pa || pb) {
        union++;
        if (pa && pb) inter++;
      }
    }
  }
  return union === 0 ? 0 : inter / union;
}

/** Pixels ≥ 128. */
export function maskArea(m: Mask): number {
  let n = 0;
  const d = m.data;
  for (let i = 0; i < d.length; i++) if (d[i] >= 128) n++;
  return n;
}

/**
 * Share of the mask's pixels whose semantic class is in `allowed` (sampled
 * on the class map's grid). Null when the mask covers no class-map sample
 * or no classes are given.
 */
export function classAgreement(mask: Mask, classes: ClassMap, allowed: ReadonlySet<number>): number | null {
  if (allowed.size === 0 || classes.width === 0 || classes.height === 0) return null;
  const sx = mask.width / classes.width;
  const sy = mask.height / classes.height;
  let total = 0;
  let good = 0;
  for (let cy = 0; cy < classes.height; cy++) {
    const my = Math.min(mask.height - 1, Math.floor((cy + 0.5) * sy));
    const mrow = my * mask.width;
    const crow = cy * classes.width;
    for (let cx = 0; cx < classes.width; cx++) {
      const mx = Math.min(mask.width - 1, Math.floor((cx + 0.5) * sx));
      if (mask.data[mrow + mx] < 128) continue;
      total++;
      if (allowed.has(classes.labels[crow + cx])) good++;
    }
  }
  return total === 0 ? null : good / total;
}

/** Share of the class map (0..1) covered by each class id. */
export function classShares(classes: ClassMap): Float64Array {
  const shares = new Float64Array(256);
  const n = classes.labels.length;
  if (n === 0) return shares;
  for (let i = 0; i < n; i++) shares[classes.labels[i]]++;
  for (let c = 0; c < 256; c++) shares[c] /= n;
  return shares;
}

/**
 * Share of the class-map pixels inside `box` (class-map px) that belong to
 * `allowed`. Used to tell "the semantic model saw none of this class here"
 * (small doors and windows often vanish at 512 px) from "the mask is wrong".
 */
export function classPresence(classes: ClassMap, allowed: ReadonlySet<number>, box: Box): number {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(classes.width, Math.ceil(box.x + box.w));
  const y1 = Math.min(classes.height, Math.ceil(box.y + box.h));
  let n = 0;
  let hit = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      n++;
      if (allowed.has(classes.labels[y * classes.width + x])) hit++;
    }
  }
  return n === 0 ? 0 : hit / n;
}

/**
 * Pixels (at `width`×`height`, polygons scaled by `scale`) that other zones
 * claim from `zone`: nested holes entirely, and outside neighbours where they
 * don't overlap the zone's own outline. A candidate that spills into them is
 * probably "the whole house" instead of the facade.
 */
export function neighbourClaimMask(
  zone: Pick<SceneZone, 'id' | 'kind' | 'polygon'>,
  others: readonly Pick<SceneZone, 'id' | 'kind' | 'polygon'>[],
  width: number,
  height: number,
  scale: { x: number; y: number },
): Mask {
  const scaled = (poly: readonly Pt[]) => poly.map((p) => ({ x: p.x * scale.x, y: p.y * scale.y }));
  const claim = createMask(width, height);
  const outside = createMask(width, height);
  for (const o of others) {
    const role = neighbourRole(zone, o);
    if (role === 'hole') fillPolygon(claim, scaled(o.polygon), 'add', false);
    else if (role === 'outside') fillPolygon(outside, scaled(o.polygon), 'add', false);
  }
  const own = rasterizePolygon(width, height, scaled(zone.polygon));
  const c = claim.data;
  const out = outside.data;
  const ownD = own.data;
  for (let i = 0; i < c.length; i++) if (out[i] && !ownD[i]) c[i] = 255;
  return claim;
}

/** Share of the mask's pixels (≥ 128) that fall on `claim` (≥ 128); 0 for an empty mask. */
export function overlapShareOf(mask: Mask, claim: Mask): number {
  let n = 0;
  let hit = 0;
  const m = mask.data;
  const c = claim.data;
  for (let i = 0; i < m.length; i++) {
    if (m[i] < 128) continue;
    n++;
    if (c[i] >= 128) hit++;
  }
  return n === 0 ? 0 : hit / n;
}

export interface CandidateMetrics {
  /** IoU with the zone's approximate polygon. */
  iou: number;
  /** Share of the mask in the zone kind's semantic classes (null = no semantic check). */
  classShare: number | null;
  /** The decoder's own quality estimate (predicted IoU, 0..1). */
  modelScore: number;
  /** Share of the mask on pixels other zones claim (see neighbourClaimMask). */
  leak?: number;
}

/**
 * Score for picking among the decoder's candidates: mostly overlap with the
 * AI outline, then semantic agreement, a little of the model's confidence
 * (the highest model score alone tends to pick "the whole house"), minus
 * spill into areas other zones claim.
 */
export function candidateScore(m: CandidateMetrics): number {
  const model = Math.max(0, Math.min(1, m.modelScore));
  const base = m.classShare === null ? 0.8 * m.iou + 0.2 * model : 0.55 * m.iou + 0.3 * m.classShare + 0.15 * model;
  return base - 0.6 * (m.leak ?? 0);
}

/**
 * How well the sharpened outline, the AI's outline and the semantic classes
 * agree (0..1) — shown per zone. A precise mask legitimately differs from a
 * rough outline, so IoU is rescaled: ≥ 0.85 counts as full agreement.
 */
export function zoneAgreement(iou: number, classShare: number | null): number {
  const overlap = Math.min(1, iou / 0.85);
  const v = classShare === null ? overlap : 0.6 * overlap + 0.4 * classShare;
  return Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
}

export type AgreementLevel = 'high' | 'medium' | 'low';

export function agreementLevel(agreement: number): AgreementLevel {
  return agreement >= 0.75 ? 'high' : agreement >= 0.5 ? 'medium' : 'low';
}

/** Minimum IoU with the AI outline for a refined mask to replace it. */
export const MIN_REFINE_IOU = 0.3;

/**
 * Removes specks (components smaller than `minFrac` of the largest one and
 * below `minPx`) and fills pinholes (background components fully inside the
 * mask smaller than `holeFrac` of the mask area). In place; returns `m`.
 */
export function cleanMask(m: Mask, opts: { minFrac?: number; minPx?: number; holeFrac?: number } = {}): Mask {
  const minFrac = opts.minFrac ?? 0.04;
  const holeFrac = opts.holeFrac ?? 0.004;
  const { labels, components } = labelComponents(m);
  if (components.length === 0) return m;
  const largest = components.reduce((a, c) => Math.max(a, c.area), 0);
  const minArea = Math.max(opts.minPx ?? 24, largest * minFrac);
  const drop = new Uint8Array(components.length + 1);
  let kept = 0;
  let bx0 = m.width;
  let by0 = m.height;
  let bx1 = -1;
  let by1 = -1;
  for (const c of components) {
    if (c.area < minArea && c.area !== largest) drop[c.label] = 1;
    else {
      kept += c.area;
      bx0 = Math.min(bx0, c.x0);
      by0 = Math.min(by0, c.y0);
      bx1 = Math.max(bx1, c.x1);
      by1 = Math.max(by1, c.y1);
    }
  }
  const d = m.data;
  for (let i = 0; i < d.length; i++) if (labels[i] !== 0 && drop[labels[i]]) d[i] = 0;
  if (bx1 < 0) return m;
  // Pinholes: background components inside the kept bounds that never touch them.
  const region = { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 };
  const holes = labelComponents(m, 128, { invert: true, region });
  const maxHole = Math.max(4, kept * holeFrac);
  const fill = new Uint8Array(holes.components.length + 1);
  for (const c of holes.components) {
    const touches = c.x0 <= region.x || c.y0 <= region.y || c.x1 >= region.x + region.w - 1 || c.y1 >= region.y + region.h - 1;
    if (!touches && c.area <= maxHole) fill[c.label] = 1;
  }
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const i = y * m.width + x;
      const l = holes.labels[i];
      if (l !== 0 && fill[l]) d[i] = 255;
    }
  }
  return m;
}

/**
 * Limits a mask to the AI outline grown by `marginPx` (keeps a decoder that
 * "leaked" into the neighbour's lawn or the whole house in check). In place.
 */
export function clipToPolygonMargin(m: Mask, polygon: readonly Pt[], marginPx: number): Mask {
  if (polygon.length < 3) return m;
  const limit = rasterizePolygon(m.width, m.height, polygon);
  if (marginPx > 0) growMask(limit, marginPx);
  const d = m.data;
  const l = limit.data;
  for (let i = 0; i < d.length; i++) if (l[i] < d[i]) d[i] = l[i];
  return m;
}

/** Margin for clipToPolygonMargin: 12% of the outline's bounding-box diagonal, at least 12 px. */
export function clipMarginFor(polygon: readonly Pt[]): number {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of polygon) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!Number.isFinite(x0)) return 12;
  return Math.max(12, Math.hypot(x1 - x0, y1 - y0) * 0.12);
}

/** Union (max) of `src` into `dst` (same size). */
export function unionInto(dst: Mask, src: Mask): void {
  if (dst.width !== src.width || dst.height !== src.height) throw new Error('unionInto: sizes differ');
  const d = dst.data;
  const s = src.data;
  for (let i = 0; i < d.length; i++) if (s[i] > d[i]) d[i] = s[i];
}

/** True when the two masks overlap or come within `gapPx` of each other (≥ 128 coverage). */
export function masksTouch(a: Mask, b: Mask, gapPx = 2): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  const grown: Mask = { width: a.width, height: a.height, data: new Uint8Array(a.data) };
  if (gapPx > 0) growMask(grown, gapPx);
  const g = grown.data;
  const bd = b.data;
  for (let i = 0; i < g.length; i++) if (g[i] >= 128 && bd[i] >= 128) return true;
  return false;
}

/** Candidate indices ordered by area, smallest first. */
export function sizeOrder(areas: readonly number[]): number[] {
  return areas.map((_, i) => i).sort((a, b) => areas[a] - areas[b] || a - b);
}

/**
 * Default candidate for a click: the decoder's best predicted IoU, unless a
 * smaller (more specific) candidate scores within `tie` of it — a click on a
 * roof should give the roof, not the whole house; "Larger" is one tap away.
 * Candidates under `minArea` are only chosen when they are the best.
 */
export function pickClickCandidate(scores: ArrayLike<number>, areas: readonly number[], tie = 0.05, minArea = 0): number {
  let best = 0;
  for (let k = 1; k < areas.length; k++) if (scores[k] > scores[best]) best = k;
  let pick = best;
  for (let k = 0; k < areas.length; k++) {
    if (k === best || areas[k] >= areas[pick] || areas[k] < minArea || areas[k] === 0) continue;
    if (scores[k] >= scores[best] - tie) pick = k;
  }
  return pick;
}
