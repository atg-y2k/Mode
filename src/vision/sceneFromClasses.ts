/**
 * Offline scene map (no Claude) from semantic segmentation, pure:
 * ADE20K labels (+ CLIPSeg probabilities for what ADE20K lacks — roof,
 * driveway, patio, mulched beds) → per-kind masks → smoothed connected
 * components → zones with simplified outlines in photo px, plus a category
 * guess from the class mix.
 */
import { newId } from '../../shared/ids';
import { CONTEXT_ZONE_KINDS, type SceneMap, type SceneZone, type SpaceType, type ZoneKind } from '../../shared/types';
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
      if (compLabels[i] === label) counts.set(labels[i], (counts.get(labels[i]) ?? 0) + 1);
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

  reclassify(found, W, interior);

  const sx = photo.width / W;
  const sy = photo.height / H;
  const zones: OfflineZone[] = [];
  const byKind = new Map<ZoneKind, Found[]>();
  for (const f of found) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  for (const [kind, list] of byKind) {
    const used = new Map<string, number>();
    list.sort((a, b) => a.comp.x0 + a.comp.x1 - (b.comp.x0 + b.comp.x1));
    for (const f of list) {
      const polygon = largestContour(f.mask, { tolerancePx: 0.9, scaleX: sx, scaleY: sy });
      if (polygon.length < 3) continue;
      let label = ZONE_KIND_LABELS[kind];
      if (list.length > 1) {
        const pos = positionWord((f.comp.x0 + f.comp.x1) / 2, W);
        const n = (used.get(pos) ?? 0) + 1;
        used.set(pos, n);
        label = `${label} — ${pos}${n > 1 ? ` ${n}` : ''}`;
      }
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
    }
  }
  zones.sort((a, b) => b.area - a.area);
  return zones.slice(0, 28);
}

/**
 * Kind fixes that need the whole picture: the main building vs neighbours,
 * the front door vs other / garage doors.
 */
function reclassify(found: Found[], W: number, interior: boolean): void {
  if (interior) {
    return;
  }
  const facades = found.filter((f) => f.kind === 'facade').sort((a, b) => b.comp.area - a.comp.area);
  const main = facades[0];
  for (const f of facades.slice(1)) {
    const gap = Math.max(f.comp.x0 - main.comp.x1, main.comp.x0 - f.comp.x1, 0);
    if (f.comp.area < main.comp.area * 0.35 && gap > W * 0.02) f.kind = 'neighbor';
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
}

/** One-line summary of what the offline map found. */
export function offlineSummary(zones: readonly Pick<OfflineZone, 'kind' | 'editable'>[]): string {
  const counts = new Map<ZoneKind, number>();
  for (const z of zones) counts.set(z.kind, (counts.get(z.kind) ?? 0) + 1);
  const parts = [...counts.entries()].map(([k, n]) => (n > 1 ? `${n}× ${ZONE_KIND_LABELS[k].toLowerCase()}` : ZONE_KIND_LABELS[k].toLowerCase()));
  if (parts.length === 0) return 'Mapped on this device without AI — no clear areas were found; outline the areas to change by hand.';
  return `Mapped on this device without AI: ${parts.join(', ')}. Outlines are approximate — sharpen them or adjust by hand.`;
}

export const OFFLINE_MODEL_LABEL = 'On-device (SegFormer-B2';

/** A SceneMap from offline zones (no architecture reading, no paths). */
export function buildOfflineScene(zones: readonly OfflineZone[], category: SpaceType, usedClip: boolean, now = Date.now()): SceneMap {
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
    summary: offlineSummary(zones),
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
    model: `${OFFLINE_MODEL_LABEL}${usedClip ? ' + CLIPSeg' : ''}, no AI)`,
  };
}

/** Category guess for an offline map. */
export function offlineCategory(classes: ClassMap, interior: boolean): SpaceType {
  return guessCategory(classShares(classes), interior);
}
