/**
 * Target masks for Studio runs (pure, DOM-free): which pixels of the photo a
 * brief may change — the union of its target zones (outline polygon, or the
 * refined mask when the user outlined the zone in Fine-tune) and its paths
 * (centerline buffered to the path's width, tapering with perspective) —
 * grown and feathered so generated content blends into the untouched photo.
 */
import type { DesignBrief, Pt, SceneMap, ScenePath, SceneZone } from '../../../shared/types';
import { combineMasks, createMask, featherMask, fillPolygon, growMask, isMaskEmpty, strokeBrush } from '../../engine/mask';
import type { Mask } from '../../engine/types';

/** Zone & path ids a brief may change: explicit targets plus every element's zones and paths (ids missing from the scene dropped). */
export function briefTargetIds(brief: DesignBrief, scene: SceneMap | undefined): { zoneIds: string[]; pathIds: string[] } {
  if (!scene) return { zoneIds: [], pathIds: [] };
  const zoneSet = new Set(scene.zones.map((z) => z.id));
  const pathSet = new Set(scene.paths.map((p) => p.id));
  const zoneIds = new Set<string>();
  const pathIds = new Set<string>();
  for (const id of brief.targetZoneIds) if (zoneSet.has(id)) zoneIds.add(id);
  for (const el of brief.elements) {
    for (const id of el.zoneIds) if (zoneSet.has(id)) zoneIds.add(id);
    for (const id of el.pathIds) if (pathSet.has(id)) pathIds.add(id);
  }
  return { zoneIds: [...zoneIds], pathIds: [...pathIds] };
}

/** Grow / feather radii (px) that read as a natural seam at the photo's size. */
export function blendRadii(width: number, height: number): { grow: number; feather: number } {
  const long = Math.max(width, height);
  return { grow: Math.max(2, Math.round(long * 0.006)), feather: Math.max(2, Math.round(long * 0.008)) };
}

/**
 * Half-width (px) of a path at height `y`. `widthPx` is the width at the near
 * end (the endpoint lowest in the frame); on a ground plane the apparent
 * width shrinks toward the horizon, assumed ~30% down the frame — clamped so
 * the far end keeps at least 35% of the near width.
 */
export function pathHalfWidthAt(path: Pick<ScenePath, 'points' | 'widthPx'>, y: number, photoHeight: number): number {
  const near = Math.max(...path.points.map((p) => p.y));
  const horizon = photoHeight * 0.3;
  const half = Math.max(1, path.widthPx / 2);
  if (near <= horizon + 1) return half;
  const k = (y - horizon) / (near - horizon);
  return half * Math.min(1, Math.max(0.35, k));
}

/** Rasterizes a path as a tapered band (max-combined) into `m`. */
export function rasterizePath(m: Mask, path: Pick<ScenePath, 'points' | 'widthPx'>, photoHeight: number): void {
  const pts = path.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length === 0) return;
  const stamp = (a: Pt, b: Pt) => {
    const r = pathHalfWidthAt(path, (a.y + b.y) / 2, photoHeight);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) {
      // strokeBrush ignores zero-length segments: nudge to get a round dot.
      strokeBrush(m, a, { x: a.x + 0.01, y: a.y }, { radius: r, hardness: 1, mode: 'add' });
    } else strokeBrush(m, a, b, { radius: r, hardness: 1, mode: 'add' });
  };
  if (pts.length === 1) {
    stamp(pts[0], pts[0]);
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    // Short pieces so the radius follows the perspective taper smoothly.
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 12));
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      stamp({ x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 }, { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 });
    }
  }
}

export interface TargetMaskOptions {
  /** Refined zone mask by id (photo size); zones fall back to their polygon when missing. */
  getMask?: (maskId: string) => Mask | undefined;
  /** Dilation radius in px (default from blendRadii). 0 = none. */
  grow?: number;
  /** Feather radius in px (default from blendRadii). 0 = hard edge. */
  feather?: number;
}

/**
 * Coverage mask (width×height) of the given zones and paths, grown and
 * feathered. Null when nothing is covered.
 */
export function maskFromTargets(
  width: number,
  height: number,
  zones: readonly SceneZone[],
  paths: readonly ScenePath[],
  opts: TargetMaskOptions = {},
): Mask | null {
  if (width <= 0 || height <= 0 || (zones.length === 0 && paths.length === 0)) return null;
  const m = createMask(width, height);
  for (const zone of zones) {
    const refined = zone.maskId ? opts.getMask?.(zone.maskId) : undefined;
    if (refined && refined.width === width && refined.height === height && !isMaskEmpty(refined)) combineMasks(m, refined, 'union');
    else if (zone.polygon.length >= 3) fillPolygon(m, zone.polygon, 'add');
  }
  for (const path of paths) rasterizePath(m, path, height);
  if (isMaskEmpty(m)) return null;
  const radii = blendRadii(width, height);
  const grow = opts.grow ?? radii.grow;
  const feather = opts.feather ?? radii.feather;
  if (grow > 0) growMask(m, grow);
  if (feather > 0) featherMask(m, feather);
  return m;
}

/**
 * Everything `brief` may change in a photo of `size` with `scene`. Null when
 * the brief targets nothing or its scope is the whole image.
 */
export function maskForBrief(
  size: { width: number; height: number },
  scene: SceneMap | undefined,
  brief: DesignBrief,
  opts: TargetMaskOptions = {},
): Mask | null {
  if (brief.scope === 'whole' || !scene) return null;
  const { zoneIds, pathIds } = briefTargetIds(brief, scene);
  const zones = scene.zones.filter((z) => zoneIds.includes(z.id));
  const paths = scene.paths.filter((p) => pathIds.includes(p.id));
  return maskFromTargets(size.width, size.height, zones, paths, opts);
}
