/**
 * Store glue for the on-device vision features (no React here):
 * - sharpenOutlines: refine a photo's zones into exact masks and write them
 *   to the scene (runtime.setMask + zone.maskId / polygon, one undo step);
 * - mapSceneOffline: build a scene map without Claude, then sharpen it;
 * - a tiny job store so progress and per-zone agreement survive panel switches.
 */
import { create } from 'zustand';
import { newId } from '../../../shared/ids';
import type { Photo, Pt, SceneMap, SceneZone, Space } from '../../../shared/types';
import * as runtime from '../../state/runtime';
import { findPhoto, isSketchZone, useStore } from '../../state/store';
import { offlineSceneMap, refineZonesDetailed, VisionError, type RefineDetail } from '../index';

export interface ZoneOutcome {
  zoneId: string;
  label: string;
  refined: boolean;
  agreement: number;
}

export interface VisionJob {
  photoId: string;
  kind: 'sharpen' | 'map';
  phase: 'preparing' | 'mapping' | 'sharpening';
  done: number;
  total: number;
}

interface VisionUIState {
  job: VisionJob | null;
  /** Latest sharpen results per photo (this session). */
  outcomes: Record<string, { at: number; items: ZoneOutcome[] }>;
  /** Last error per photo (cleared on the next run). */
  errors: Record<string, string | undefined>;
}

export const useVisionJobs = create<VisionUIState>(() => ({ job: null, outcomes: {}, errors: {} }));

const setJob = (job: VisionJob | null) => useVisionJobs.setState({ job });
const setError = (photoId: string, message: string | undefined) =>
  useVisionJobs.setState((s) => ({ errors: { ...s.errors, [photoId]: message } }));

/** A zone whose mask is shared with a Fine-tune surface (hand-edited outline — never overwritten). */
export function isHandEdited(photo: Photo, zone: SceneZone): boolean {
  return !!zone.maskId && photo.regions.some((r) => r.maskId === zone.maskId);
}

/**
 * Zones "Sharpen outlines" works on: every zone with an outline that is not
 * hand-edited in Fine-tune; unless `again`, only those without a precise mask
 * yet. Areas picked with Tap to select (a sketch with a mask) are never
 * redone — they are already exact.
 */
export function sharpenableZones(photo: Photo, again = false): SceneZone[] {
  return (photo.scene?.zones ?? []).filter(
    (z) => z.polygon.length >= 3 && !isHandEdited(photo, z) && (!z.maskId || (again && !isSketchZone(z))),
  );
}

function errorText(err: unknown): string {
  if (err instanceof VisionError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

function isCancel(err: unknown): boolean {
  return err instanceof VisionError && err.code === 'cancelled';
}

/**
 * Writes refined masks + outlines into the scene in one undoable step.
 * Zones the user changed or deleted while the models ran are left alone.
 */
export function applyRefinement(photoId: string, results: Map<string, RefineDetail>, started: Map<string, Pt[]>): number {
  const photo = findPhoto(useStore.getState().project, photoId)?.photo;
  if (!photo?.scene) return 0;
  const updates: { zoneId: string; maskId: string; polygon: Pt[] }[] = [];
  for (const [zoneId, r] of results) {
    if (!r.refined || !r.mask || !r.polygon || r.polygon.length < 3) continue;
    const zone = photo.scene.zones.find((z) => z.id === zoneId);
    if (!zone || zone.polygon !== started.get(zoneId) || isHandEdited(photo, zone)) continue;
    if (r.mask.width !== photo.width || r.mask.height !== photo.height) continue;
    const maskId = newId('msk');
    runtime.setMask(maskId, r.mask);
    updates.push({ zoneId, maskId, polygon: r.polygon });
  }
  if (updates.length === 0) return 0;
  useStore.getState().updateScene(
    photoId,
    (scene) => {
      for (const u of updates) {
        const z = scene.zones.find((x) => x.id === u.zoneId);
        if (!z) continue;
        z.maskId = u.maskId;
        z.polygon = u.polygon;
      }
    },
    {},
  );
  return updates.length;
}

async function runSharpen(photo: Photo, zones: SceneZone[], kind: VisionJob['kind']): Promise<{ sharpened: number; total: number }> {
  const scene = photo.scene;
  if (!scene || zones.length === 0) return { sharpened: 0, total: 0 };
  const started = new Map(zones.map((z) => [z.id, z.polygon]));
  setJob({ photoId: photo.id, kind, phase: 'preparing', done: 0, total: zones.length });
  const image = await runtime.loadPhotoImage(photo);
  const results = await refineZonesDetailed(photo.id, image, zones, {
    context: scene.zones,
    onProgress: (done, total) => setJob({ photoId: photo.id, kind, phase: 'sharpening', done, total }),
  });
  const sharpened = applyRefinement(photo.id, results, started);
  const items: ZoneOutcome[] = zones.map((z) => {
    const r = results.get(z.id);
    return { zoneId: z.id, label: z.label, refined: !!r?.refined, agreement: r?.agreement ?? 0 };
  });
  useVisionJobs.setState((s) => ({ outcomes: { ...s.outcomes, [photo.id]: { at: Date.now(), items } } }));
  return { sharpened, total: zones.length };
}

/** Sharpens the photo's zone outlines on this device. Resolves when done (errors are reported, not thrown). */
export async function sharpenOutlines(photoId: string, again = false): Promise<void> {
  if (useVisionJobs.getState().job) return;
  const photo = findPhoto(useStore.getState().project, photoId)?.photo;
  if (!photo?.scene) return;
  setError(photoId, undefined);
  try {
    const { sharpened, total } = await runSharpen(photo, sharpenableZones(photo, again), 'sharpen');
    if (total === 0) return;
    const kept = total - sharpened;
    useStore
      .getState()
      .notify(
        sharpened === 0
          ? 'No outline could be sharpened — the areas keep their outlines.'
          : `Sharpened ${sharpened} of ${total} outline${total === 1 ? '' : 's'} on this device${kept ? ` · ${kept} kept as drawn` : ''}.`,
        sharpened ? 'success' : 'info',
      );
  } catch (err) {
    if (!isCancel(err)) {
      setError(photoId, errorText(err));
      useStore.getState().notify(`Couldn't sharpen the outlines: ${errorText(err)}`, 'error');
    }
  } finally {
    setJob(null);
  }
}

/** An empty scene for a photo (sketches need one to live in). */
export function emptyScene(space: Space | undefined): SceneMap {
  return {
    category: space?.type ?? 'other-exterior',
    summary: '',
    viewpoint: '',
    style: '',
    boundaries: '',
    lighting: '',
    orientation: '',
    architecture: { style: '', features: [], materials: [], proportions: '', designLanguage: [], purpose: [] },
    zones: [],
    paths: [],
    keep: [],
    opportunities: [],
    createdAt: Date.now(),
    model: 'manual',
  };
}

/**
 * Maps the photo without Claude (semantic segmentation + CLIPSeg outdoors),
 * keeps any sketched areas, then sharpens the new outlines.
 */
export async function mapSceneOffline(photoId: string): Promise<void> {
  if (useVisionJobs.getState().job) return;
  const found = findPhoto(useStore.getState().project, photoId);
  if (!found) return;
  const { photo, space } = found;
  setError(photoId, undefined);
  setJob({ photoId, kind: 'map', phase: 'preparing', done: 0, total: 0 });
  try {
    const image = await runtime.loadPhotoImage(photo);
    setJob({ photoId, kind: 'map', phase: 'mapping', done: 0, total: 0 });
    const scene = await offlineSceneMap(photoId, image, space.kind === 'interior');
    const current = findPhoto(useStore.getState().project, photoId)?.photo;
    if (!current) return;
    if (current.scene && current.scene.zones.some((z) => !isSketchZone(z))) {
      useStore.getState().notify('This photo was mapped meanwhile — kept that map.', 'info');
      return;
    }
    if (scene.zones.length === 0) {
      useStore.getState().notify('Nothing clear enough to map here — outline the areas to change with the lasso or Tap to select.', 'info');
      return;
    }
    useStore.getState().setScene(photoId, scene);
    const mapped = findPhoto(useStore.getState().project, photoId)?.photo;
    if (!mapped) return;
    const ids = new Set(scene.zones.map((z) => z.id));
    const { sharpened } = await runSharpen(mapped, sharpenableZones(mapped).filter((z) => ids.has(z.id)), 'map');
    useStore.getState().notify(`Mapped ${scene.zones.length} areas on this device${sharpened ? ` and sharpened ${sharpened}` : ''} — no AI used.`, 'success');
  } catch (err) {
    if (!isCancel(err)) {
      setError(photoId, errorText(err));
      useStore.getState().notify(`Couldn't map the scene on this device: ${errorText(err)}`, 'error');
    }
  } finally {
    setJob(null);
  }
}
