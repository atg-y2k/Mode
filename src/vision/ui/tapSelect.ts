/**
 * "Tap to select" in the Studio viewer: click an area of the photo and
 * EdgeTAM outlines it (on this device). The selection is a union of parts:
 * a positive click outside the selection starts a new part (both lawns on
 * either side of the walk), a click inside refines that part, Alt-click /
 * right-click (or the Remove toggle on touch) adds a negative point to the
 * part under it. "Smaller / Larger" cycles the decoder's candidates.
 * Keep turns the selection into a user zone (source 'sketch') with a precise
 * mask — or adds it to a sketched zone it touches.
 */
import { create } from 'zustand';
import { newId } from '../../../shared/ids';
import type { Photo, Pt, SceneZone, Space, ZoneKind } from '../../../shared/types';
import { createMask } from '../../engine/mask';
import type { Mask } from '../../engine/types';
import * as runtime from '../../state/runtime';
import { findPhoto, isSketchZone, useStore } from '../../state/store';
import { ZONE_KIND_LABELS } from '../../ui/studio/panels/zones';
import { zonePolygon } from '../contours';
import { getVisionStatus, guessZoneKind, prepareVision, segmentClick, VisionError } from '../index';
import { cleanMask, maskArea, masksTouch, rasterizePolygon, unionInto } from '../scoring';
import { emptyScene } from './jobs';

export interface TapPart {
  positive: Pt[];
  negative: Pt[];
  /** Candidate chosen by size (undefined = automatic). */
  rank?: number;
  /** The automatic choice and the number of candidates, from the last decode. */
  autoRank: number;
  ranks: number;
  mask: Mask | null;
  /** Bumped on every prompt change; stale decodes are dropped. */
  seq: number;
}

interface TapState {
  active: boolean;
  photoId: string | null;
  phase: 'loading' | 'ready' | 'error';
  error?: string;
  parts: TapPart[];
  /** Index of the part the last click touched (Smaller / Larger act on it). */
  current: number;
  /** Touch: the next taps remove instead of add. */
  removeMode: boolean;
  /** Decodes in flight. */
  busy: number;
  /** Hover preview (low resolution), when the device is fast enough. */
  preview: Mask | null;
  /** Last decode time (ms) — hover previews only when cheap. */
  decodeMs: number | null;
  /** Changes whenever the drawn selection changes. */
  version: number;
}

const initial: Omit<TapState, 'active' | 'photoId'> = {
  phase: 'loading',
  error: undefined,
  parts: [],
  current: -1,
  removeMode: false,
  busy: 0,
  preview: null,
  decodeMs: null,
  version: 0,
};

export const useTapSelect = create<TapState>(() => ({ active: false, photoId: null, ...initial }));

const get = () => useTapSelect.getState();
const set = (patch: Partial<TapState> | ((s: TapState) => Partial<TapState>)) => useTapSelect.setState(patch);

/** History of added points for Undo. */
let history: { part: number; negative: boolean }[] = [];
let session = 0;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Starts tap selection on a photo: loads the photo and encodes it (downloads EdgeTAM the first time). */
export async function startTapSelect(photo: Photo): Promise<void> {
  const my = ++session;
  history = [];
  set({ active: true, photoId: photo.id, ...initial });
  try {
    const image = await runtime.loadPhotoImage(photo);
    if (my !== session) return;
    await prepareVision(photo.id, image);
    if (my !== session) return;
    set({ phase: 'ready' });
  } catch (err) {
    if (my !== session || (err instanceof VisionError && err.code === 'cancelled')) return;
    set({ phase: 'error', error: message(err) });
  }
}

export function stopTapSelect(): void {
  session++;
  history = [];
  if (get().active) set({ active: false, photoId: null, ...initial });
}

/** Index of the part whose mask covers `pt` (≥ 128), or -1. */
function partAt(parts: TapPart[], pt: Pt): number {
  for (let i = parts.length - 1; i >= 0; i--) {
    const m = parts[i].mask;
    if (!m) continue;
    const x = Math.floor(pt.x);
    const y = Math.floor(pt.y);
    if (x >= 0 && y >= 0 && x < m.width && y < m.height && m.data[y * m.width + x] >= 128) return i;
  }
  return -1;
}

async function decodePart(index: number): Promise<void> {
  const s = get();
  const part = s.parts[index];
  const photoId = s.photoId;
  if (!part || !photoId) return;
  const seq = part.seq;
  const my = session;
  set((st) => ({ busy: st.busy + 1 }));
  try {
    const r = await segmentClick(photoId, { positive: part.positive, negative: part.negative }, { rank: part.rank });
    const now = get();
    if (my !== session || now.parts[index] !== part || part.seq !== seq) return;
    const parts = [...now.parts];
    parts[index] = { ...part, mask: r.mask, autoRank: part.rank === undefined ? r.rank : part.autoRank, ranks: r.ranks };
    set((st) => ({ parts, decodeMs: r.ms, version: st.version + 1 }));
  } catch (err) {
    if (my === session && !(err instanceof VisionError && err.code === 'cancelled')) {
      useStore.getState().notify(`Couldn't select that area: ${message(err)}`, 'error');
    }
  } finally {
    if (my === session) set((st) => ({ busy: Math.max(0, st.busy - 1) }));
  }
}

/** A click at `pt` (photo px). `negative` removes what is under it from the selection. */
export function tapAt(pt: Pt, negative: boolean): void {
  const s = get();
  if (!s.active || s.phase !== 'ready') return;
  const remove = negative || s.removeMode;
  const parts = [...s.parts];
  const hit = partAt(parts, pt);
  let index: number;
  if (remove) {
    index = hit >= 0 ? hit : s.current >= 0 ? s.current : parts.length - 1;
    if (index < 0) return; // nothing selected yet
    const p = parts[index];
    parts[index] = { ...p, negative: [...p.negative, pt], rank: undefined, seq: p.seq + 1 };
  } else if (hit >= 0) {
    index = hit;
    const p = parts[hit];
    parts[hit] = { ...p, positive: [...p.positive, pt], rank: undefined, seq: p.seq + 1 };
  } else {
    index = parts.length;
    parts.push({ positive: [pt], negative: [], autoRank: 0, ranks: 0, mask: null, seq: 1 });
  }
  history.push({ part: index, negative: remove });
  set({ parts, current: index, preview: null });
  void decodePart(index);
}

/** Removes the last click. */
export function undoTap(): void {
  const last = history.pop();
  if (!last) return;
  const parts = [...get().parts];
  const p = parts[last.part];
  if (!p) return;
  const next = last.negative ? { ...p, negative: p.negative.slice(0, -1) } : { ...p, positive: p.positive.slice(0, -1) };
  if (next.positive.length === 0) {
    parts.splice(last.part, 1);
    history = history.filter((h) => h.part !== last.part).map((h) => (h.part > last.part ? { ...h, part: h.part - 1 } : h));
    set((st) => ({ parts, current: parts.length - 1, version: st.version + 1 }));
    return;
  }
  parts[last.part] = { ...next, rank: undefined, seq: p.seq + 1 };
  set({ parts, current: last.part });
  void decodePart(last.part);
}

/** Smaller (-1) / larger (+1) candidate for the part last clicked. */
export function resizeSelection(dir: -1 | 1): void {
  const s = get();
  const i = s.current;
  const p = s.parts[i];
  if (!p || p.ranks < 2) return;
  const from = p.rank ?? p.autoRank;
  const rank = Math.max(0, Math.min(p.ranks - 1, from + dir));
  if (rank === from) return;
  const parts = [...s.parts];
  parts[i] = { ...p, rank, seq: p.seq + 1 };
  set({ parts });
  void decodePart(i);
}

export function canResize(dir: -1 | 1): boolean {
  const s = get();
  const p = s.parts[s.current];
  if (!p || p.ranks < 2) return false;
  const r = p.rank ?? p.autoRank;
  return dir < 0 ? r > 0 : r < p.ranks - 1;
}

export function setRemoveMode(on: boolean): void {
  set({ removeMode: on });
}

export function clearSelection(): void {
  history = [];
  set((st) => ({ parts: [], current: -1, preview: null, version: st.version + 1 }));
}

// ---------------------------------------------------------------------------
// Hover preview (only when a decode is cheap: WebGPU or a fast CPU)
// ---------------------------------------------------------------------------

const PREVIEW_MAX_MS = 150;
let hoverPending: Pt | null = null;
let hoverBusy = false;

/** True when hover previews are worth running on this device. */
export function hoverPreviewEnabled(): boolean {
  const s = get();
  if (!s.active || s.phase !== 'ready') return false;
  if (getVisionStatus().backend === 'webgpu') return true;
  return s.decodeMs !== null && s.decodeMs <= PREVIEW_MAX_MS;
}

/** Pointer moved to `pt` (photo px) or left the photo (null). Latest position wins. */
export function hoverAt(pt: Pt | null): void {
  const s = get();
  if (!pt || !hoverPreviewEnabled() || s.busy > 0 || partAt(s.parts, pt) >= 0) {
    hoverPending = null;
    if (s.preview) set({ preview: null });
    return;
  }
  hoverPending = pt;
  if (!hoverBusy) void runHover();
}

async function runHover(): Promise<void> {
  hoverBusy = true;
  const my = session;
  try {
    while (hoverPending && my === session) {
      const pt = hoverPending;
      hoverPending = null;
      const photoId = get().photoId;
      if (!photoId) break;
      const r = await segmentClick(photoId, { positive: [pt] }, { maxSize: 384 });
      if (my !== session) break;
      // Dropped if a click started a decode meanwhile (the selection matters more).
      if (get().busy === 0 && hoverPending === null) set({ preview: r.mask });
    }
  } catch {
    // Previews are best-effort.
  } finally {
    hoverBusy = false;
  }
}

// ---------------------------------------------------------------------------
// Keep
// ---------------------------------------------------------------------------

/** Union of the parts' masks (photo size), or null when nothing is selected. */
export function selectionMask(): Mask | null {
  const parts = get().parts.filter((p) => p.mask);
  if (parts.length === 0) return null;
  const first = parts[0].mask as Mask;
  const out = createMask(first.width, first.height);
  for (const p of parts) if (p.mask && p.mask.width === out.width && p.mask.height === out.height) unionInto(out, p.mask);
  return maskArea(out) > 0 ? out : null;
}

/** Mask of an existing zone (its precise mask, else its outline), at photo size. */
async function zoneMask(photo: Photo, zone: SceneZone): Promise<Mask> {
  if (zone.maskId) {
    try {
      const m = await runtime.loadMask(zone.maskId, photo.width, photo.height);
      if (maskArea(m) > 0) return m;
    } catch {
      // fall back to the outline
    }
  }
  return rasterizePolygon(photo.width, photo.height, zone.polygon);
}

/** Sketched zones the selection touches (candidates for "Add to …"), closest overlap first. */
export async function touchingSketchZones(photo: Photo, mask: Mask): Promise<SceneZone[]> {
  const out: SceneZone[] = [];
  const gap = Math.max(2, Math.round(Math.max(photo.width, photo.height) * 0.01));
  for (const z of photo.scene?.zones ?? []) {
    if (!isSketchZone(z) || z.polygon.length < 3) continue;
    if (masksTouch(mask, await zoneMask(photo, z), gap)) out.push(z);
  }
  return out;
}

/** Zone outline of a selection: all its significant parts, simplified for the photo size. */
function outlineOf(mask: Mask) {
  const tolerancePx = Math.max(1.5, Math.max(mask.width, mask.height) * 0.0015);
  return zonePolygon(mask, { tolerancePx }).map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
}

function nextLabel(base: string, labels: readonly string[]): string {
  if (!labels.includes(base)) return base;
  let n = 2;
  while (labels.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * Turns the selection into an area of the scene: a new user zone (kind
 * guessed from the semantic map when it was computed for this photo, else
 * "other"), targeted by the brief — or, with `extendZoneId`, merged into
 * that sketched zone. Returns the zone id.
 */
export async function keepSelection(space: Space | undefined, extendZoneId?: string): Promise<string | null> {
  const s = get();
  const store = useStore.getState();
  const found = s.photoId ? findPhoto(store.project, s.photoId) : undefined;
  const raw = selectionMask();
  if (!found || !raw) return null;
  const { photo } = found;
  if (raw.width !== photo.width || raw.height !== photo.height) return null;
  const mask = cleanMask(raw, { minFrac: 0.02 });
  const target = extendZoneId ? photo.scene?.zones.find((z) => z.id === extendZoneId) : undefined;

  if (target) {
    const merged = await zoneMask(photo, target);
    const combined: Mask = { width: merged.width, height: merged.height, data: new Uint8Array(merged.data) };
    unionInto(combined, mask);
    const polygon = outlineOf(combined);
    if (polygon.length < 3) return null;
    const maskId = newId('msk');
    runtime.setMask(maskId, combined);
    store.updateScene(
      photo.id,
      (scene) => {
        const z = scene.zones.find((x) => x.id === target.id);
        if (!z) return;
        z.maskId = maskId;
        z.polygon = polygon;
        z.source = 'sketch';
      },
      {},
    );
    store.notify(`Added to “${target.label}”.`, 'success');
    clearSelection();
    return target.id;
  }

  const polygon = outlineOf(mask);
  if (polygon.length < 3) {
    store.notify('That selection is too small to keep.', 'info');
    return null;
  }
  const interior = found.space.kind === 'interior';
  const guessed: ZoneKind | null = await guessZoneKind(photo.id, mask, interior);
  const kind: ZoneKind = guessed ?? 'other';
  if (!photo.scene) store.setScene(photo.id, emptyScene(space ?? found.space));
  const labels = findPhoto(useStore.getState().project, photo.id)?.photo.scene?.zones.map((z) => z.label) ?? [];
  const label = nextLabel(kind === 'other' ? 'Selected area' : `${ZONE_KIND_LABELS[kind]} (selected)`, labels);
  const id = newId('zone');
  const maskId = newId('msk');
  runtime.setMask(maskId, mask);
  store.updateScene(
    photo.id,
    (scene) => {
      scene.zones.push({
        id,
        kind,
        label,
        description: 'Selected on the photo with Tap to select (outlined on this device)',
        polygon,
        maskId,
        editable: true,
        source: 'sketch',
      });
    },
    {},
  );
  store.updateDraft(photo.id, (d) => void d.targetZoneIds.push(id), {});
  store.notify(`${label} added to the areas that may change.`, 'success');
  clearSelection();
  return id;
}
