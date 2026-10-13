/**
 * Target masks for Studio runs (pure, DOM-free): which pixels of the photo a
 * brief may change — the union of its target zones (outline polygon, or the
 * refined mask when the user outlined the zone in Fine-tune) and its paths
 * (centerline buffered to the path's width, tapering with perspective), plus
 * room beside elements whose choices change their footprint (a wider or
 * curvier path) — grown and feathered so generated content blends into the
 * untouched photo.
 *
 * A run freezes its target when it starts (snapshotRunTarget →
 * Generation.target): later scene edits never widen or move it.
 */
import type { DesignBrief, ElementSpec, Generation, Pt, RunTarget, SceneMap, ScenePath, SceneZone, ZoneKind } from '../../../shared/types';
import { combineMasks, createMask, featherMask, fillPolygon, growMask, isMaskEmpty, strokeBrush } from '../../engine/mask';
import type { Mask } from '../../engine/types';

type ZoneShape = Pick<SceneZone, 'polygon' | 'maskId'>;
type PathShape = Pick<ScenePath, 'points' | 'widthPx'>;

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
export function rasterizePath(m: Mask, path: PathShape, photoHeight: number): void {
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
  /** Extra coverage (same size) unioned before growing / feathering — the footprint room. */
  extra?: Mask | null;
}

/**
 * Coverage mask (width×height) of the given zones and paths, grown and
 * feathered. Null when nothing is covered.
 */
export function maskFromTargets(
  width: number,
  height: number,
  zones: readonly ZoneShape[],
  paths: readonly PathShape[],
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
  if (opts.extra && opts.extra.width === width && opts.extra.height === height) combineMasks(m, opts.extra, 'union');
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
  const target = snapshotRunTarget(brief, scene, size);
  return target ? maskForRunTarget(size, target, opts) : null;
}

// ---------------------------------------------------------------------------
// Footprint room (a wider / curvier path needs ground beside the old one)
// ---------------------------------------------------------------------------

/** Ground a footprint-changing element may spill into. */
export const ROOM_GROUND_KINDS: readonly ZoneKind[] = ['lawn', 'planting-bed', 'yard-border'];
/** Long edge (px) the room is computed at; scaled up after (the feather hides the steps). */
const ROOM_SIZE = 512;
/** The room reaches at most this share of the photo's long edge from the element. */
const ROOM_MAX_SHARE = 0.12;

/** Whether one of the element's choices changes its footprint (wider, curvier, larger). */
export function growChoice(el: Pick<ElementSpec, 'dimensions' | 'choices'>): boolean {
  return el.dimensions.some((d) => (el.choices[d.id] ?? []).some((id) => d.options.find((o) => o.id === id)?.footprint === 'grow'));
}

/** Rough width (px) of a strip-like outline: 2·area / perimeter (≈ w for a long w-wide strip). */
export function stripWidth(polygon: readonly Pt[]): number {
  if (polygon.length < 3) return 0;
  let area = 0;
  let perim = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    area += a.x * b.y - b.x * a.y;
    perim += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return perim > 0 ? Math.abs(area) / perim : 0;
}

interface RoomGeometry {
  /** Growing zones / paths. */
  zones: readonly Pick<SceneZone, 'polygon'>[];
  paths: readonly PathShape[];
  /** Candidate ground outlines and outlines never covered. */
  ground: readonly (readonly Pt[])[];
  blockers: readonly (readonly Pt[])[];
}

/** The room at ≤ ROOM_SIZE px: grown elements ∩ ground − blockers, plus which ground / blocker outlines it touched. */
function computeRoom(width: number, height: number, g: RoomGeometry, maxEdge = ROOM_SIZE): { mask: Mask; k: number; ground: number[]; blockers: number[] } | null {
  if (width <= 0 || height <= 0) return null;
  const k = Math.min(1, maxEdge / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const sc = (p: Pt): Pt => ({ x: p.x * k, y: p.y * k });
  const reach = ROOM_MAX_SHARE * Math.max(w, h);
  const grown = createMask(w, h);
  for (const z of g.zones) {
    if (z.polygon.length < 3) continue;
    const m = createMask(w, h);
    fillPolygon(m, z.polygon.map(sc), 'add', false);
    growMask(m, Math.max(1, Math.min(reach, stripWidth(z.polygon) * k)));
    combineMasks(grown, m, 'union');
  }
  // About one walk width to each side, with the path's perspective taper.
  for (const p of g.paths) {
    const half = Math.max(1, (p.widthPx * k) / 2);
    rasterizePath(grown, { points: p.points.map(sc), widthPx: Math.min(p.widthPx * k * 3, 2 * (half + reach)) }, h);
  }
  if (isMaskEmpty(grown)) return null;
  const overlaps = (poly: readonly Pt[]): Mask | null => {
    if (poly.length < 3) return null;
    const m = createMask(w, h);
    fillPolygon(m, poly.map(sc), 'add', false);
    for (let i = 0; i < m.data.length; i++) if (m.data[i] && grown.data[i]) return m;
    return null;
  };
  const ground = createMask(w, h);
  const touchedGround: number[] = [];
  g.ground.forEach((poly, i) => {
    const m = overlaps(poly);
    if (!m) return;
    touchedGround.push(i);
    combineMasks(ground, m, 'union');
  });
  const touchedBlockers: number[] = [];
  const room = grown;
  combineMasks(room, ground, 'intersect');
  g.blockers.forEach((poly, i) => {
    const m = overlaps(poly);
    if (!m) return;
    touchedBlockers.push(i);
    combineMasks(room, m, 'subtract');
  });
  return { mask: room, k, ground: touchedGround, blockers: touchedBlockers };
}

/** Scales the small room back up to photo size (nearest). Null when empty. */
function upscaleRoom(small: Mask, k: number, width: number, height: number): Mask | null {
  if (isMaskEmpty(small)) return null;
  if (k === 1 && small.width === width && small.height === height) return small;
  const out = createMask(width, height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(small.height - 1, Math.floor(y * k));
    const row = sy * small.width;
    for (let x = 0; x < width; x++) out.data[y * width + x] = small.data[row + Math.min(small.width - 1, Math.floor(x * k))];
  }
  return out;
}

/**
 * Footprint room of a brief in a scene: for each element with a 'grow'
 * choice under 'Only selected areas', its zones and paths dilated by about
 * one walk width, ∩ the editable ground zones beside them (lawn, beds,
 * borders), never covering anything else (house, steps, trees, sky…).
 * Null when nothing grows; `room: null, empty: true` when no ground is
 * beside it — the UI warns that the new shape will be clipped.
 */
export function footprintRoom(
  scene: SceneMap | undefined,
  brief: DesignBrief,
  size: { width: number; height: number } = scene ? sceneSize(scene) : { width: 0, height: 0 },
): { elementIds: string[]; room: NonNullable<RunTarget['room']> | null; empty: boolean } | null {
  if (!scene || brief.scope === 'whole') return null;
  const zoneSet = new Set(scene.zones.map((z) => z.id));
  const pathSet = new Set(scene.paths.map((p) => p.id));
  const elementIds: string[] = [];
  const zoneIds = new Set<string>();
  const pathIds = new Set<string>();
  for (const el of brief.elements) {
    if (!growChoice(el)) continue;
    const z = el.zoneIds.filter((id) => zoneSet.has(id));
    const p = el.pathIds.filter((id) => pathSet.has(id));
    if (!z.length && !p.length) continue;
    elementIds.push(el.id);
    for (const id of z) zoneIds.add(id);
    for (const id of p) pathIds.add(id);
  }
  if (!elementIds.length) return null;
  const targets = new Set(briefTargetIds(brief, scene).zoneIds);
  const ground = scene.zones.filter((z) => ROOM_GROUND_KINDS.includes(z.kind) && z.editable !== false && !targets.has(z.id) && z.polygon.length >= 3);
  const blockers = scene.zones.filter((z) => !targets.has(z.id) && !ROOM_GROUND_KINDS.includes(z.kind) && z.polygon.length >= 3);
  const r = computeRoom(size.width, size.height, {
    zones: scene.zones.filter((z) => zoneIds.has(z.id)),
    paths: scene.paths.filter((p) => pathIds.has(p.id)),
    ground: ground.map((z) => z.polygon),
    blockers: blockers.map((z) => z.polygon),
  });
  if (!r || isMaskEmpty(r.mask)) return { elementIds, room: null, empty: true };
  return {
    elementIds,
    room: {
      zoneIds: [...zoneIds],
      pathIds: [...pathIds],
      zones: r.ground.map((i) => ({ id: ground[i].id, label: ground[i].label, kind: ground[i].kind, polygon: ground[i].polygon })),
      blockers: r.blockers.map((i) => blockers[i].polygon),
    },
    empty: false,
  };
}

/** Photo size a scene's outlines live in (its extent; callers pass the real size when they know it). */
function sceneSize(scene: SceneMap): { width: number; height: number } {
  let w = 1;
  let h = 1;
  for (const z of scene.zones) for (const p of z.polygon) (w = Math.max(w, p.x)), (h = Math.max(h, p.y));
  for (const pa of scene.paths) for (const p of pa.points) (w = Math.max(w, p.x)), (h = Math.max(h, p.y));
  return { width: Math.ceil(w), height: Math.ceil(h) };
}

// ---------------------------------------------------------------------------
// Run targets (frozen when a run starts)
// ---------------------------------------------------------------------------

/**
 * The areas `brief` may change in `scene`, as a snapshot a run keeps: its
 * target zones (outline + refined mask id) and paths, plus the footprint
 * room. Undefined for whole-image briefs and when nothing resolves. The
 * caller copies refined masks (they belong to the scene) before storing it.
 */
export function snapshotRunTarget(brief: DesignBrief, scene: SceneMap | undefined, size?: { width: number; height: number }): RunTarget | undefined {
  if (brief.scope === 'whole' || !scene) return undefined;
  const { zoneIds, pathIds } = briefTargetIds(brief, scene);
  if (zoneIds.length === 0 && pathIds.length === 0) return undefined;
  const zones = scene.zones
    .filter((z) => zoneIds.includes(z.id))
    .map((z) => ({ id: z.id, label: z.label, kind: z.kind, polygon: z.polygon.map((p) => ({ x: p.x, y: p.y })), ...(z.maskId ? { maskId: z.maskId } : {}) }));
  const paths = scene.paths
    .filter((p) => pathIds.includes(p.id))
    .map((p) => ({ id: p.id, label: p.label, from: p.from, to: p.to, points: p.points.map((q) => ({ x: q.x, y: q.y })), widthPx: p.widthPx, kind: p.kind }));
  const room = footprintRoom(scene, brief, size)?.room;
  return { zones, paths, ...(room ? { room } : {}) };
}

/** Coverage of a frozen run target (refined masks via opts.getMask), grown and feathered. Null when it covers nothing. */
export function maskForRunTarget(size: { width: number; height: number }, target: RunTarget, opts: TargetMaskOptions = {}): Mask | null {
  let extra: Mask | null = null;
  if (target.room && target.room.zones.length) {
    const grow = new Set(target.room.zoneIds);
    const growPaths = new Set(target.room.pathIds);
    const r = computeRoom(size.width, size.height, {
      zones: target.zones.filter((z) => grow.has(z.id)),
      paths: target.paths.filter((p) => growPaths.has(p.id)),
      ground: target.room.zones.map((z) => z.polygon),
      blockers: target.room.blockers,
    });
    extra = r ? upscaleRoom(r.mask, r.k, size.width, size.height) : null;
  }
  return maskFromTargets(size.width, size.height, target.zones, target.paths, { ...opts, extra });
}

/** Whether a brief names any zone or path at all (live or not). */
export function briefNamesTargets(brief: DesignBrief): boolean {
  return brief.targetZoneIds.length > 0 || brief.elements.some((e) => e.zoneIds.length > 0 || e.pathIds.length > 0);
}

/**
 * A run from an older save (no frozen target) whose areas are gone from
 * the scene (re-mapped, cleared, deleted): it must not become a
 * whole-image edit. False for whole-image briefs and briefs that never had
 * targets.
 */
export function runTargetLost(g: Pick<Generation, 'brief' | 'target'>, scene: SceneMap | undefined): boolean {
  if (g.target || g.brief.scope === 'whole' || !briefNamesTargets(g.brief)) return false;
  const { zoneIds, pathIds } = briefTargetIds(g.brief, scene);
  return zoneIds.length === 0 && pathIds.length === 0;
}

/** Error text when a run's areas were removed or re-mapped (legacy runs). */
export const TARGET_LOST_MESSAGE = "This run's areas were removed or re-mapped since it started — start it again, or pick the areas again in the brief.";

/**
 * The scene a run's prompt and labels read: the live scene with the run's
 * frozen target zones / paths (and room zones) put back under their own ids
 * — live zones that re-mapping gave the same kind and label are dropped so
 * they aren't listed as things to keep.
 */
export function sceneForRun(scene: SceneMap | undefined, g: Pick<Generation, 'target'>): SceneMap | undefined {
  const t = g.target;
  if (!t || !scene) return scene;
  const frozenZones = [...t.zones, ...(t.room?.zones ?? [])];
  const ids = new Set(frozenZones.map((z) => z.id));
  const twins = new Set(frozenZones.map((z) => `${z.kind}|${z.label}`));
  const zones: SceneZone[] = [
    ...frozenZones.map((z) => ({ description: '', editable: true, ...(scene.zones.find((x) => x.id === z.id) ?? {}), ...z }) as SceneZone),
    ...scene.zones.filter((z) => !ids.has(z.id) && !twins.has(`${z.kind}|${z.label}`)),
  ];
  const pathIds = new Set(t.paths.map((p) => p.id));
  const paths: ScenePath[] = [
    ...t.paths.map((p) => ({ description: '', ...(scene.paths.find((x) => x.id === p.id) ?? {}), ...p }) as ScenePath),
    ...scene.paths.filter((p) => !pathIds.has(p.id)),
  ];
  return { ...scene, zones, paths };
}

/** Cheap fingerprint of what a brief targets in a scene (ids, outlines, refined masks) — to notice a changed outline. */
export function targetFingerprint(brief: DesignBrief, scene: SceneMap | undefined): string {
  const { zoneIds, pathIds } = briefTargetIds(brief, scene);
  const zones = (scene?.zones ?? [])
    .filter((z) => zoneIds.includes(z.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((z) => `${z.id}:${z.maskId ?? ''}:${z.polygon.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}`);
  const paths = (scene?.paths ?? [])
    .filter((p) => pathIds.includes(p.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((p) => `${p.id}:${Math.round(p.widthPx)}:${p.points.map((q) => `${Math.round(q.x)},${Math.round(q.y)}`).join(' ')}`);
  let h = 2166136261;
  for (const ch of `${brief.scope}|${zones.join('|')}|${paths.join('|')}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36);
}

/**
 * Outline (photo px) of the band a path covers — the same perspective taper
 * as rasterizePath — for drawing the area a path change may touch.
 */
export function pathBandOutline(path: Pick<ScenePath, 'points' | 'widthPx'>, photoHeight: number, step = 24): Pt[] {
  const src = path.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (src.length < 2) return [];
  const pts: Pt[] = [src[0]];
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1];
    const b = src[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
    const nx = -(next.y - prev.y) / len;
    const ny = (next.x - prev.x) / len;
    const r = pathHalfWidthAt(path, pts[i].y, photoHeight);
    left.push({ x: pts[i].x + nx * r, y: pts[i].y + ny * r });
    right.push({ x: pts[i].x - nx * r, y: pts[i].y - ny * r });
  }
  return [...left, ...right.reverse()];
}
