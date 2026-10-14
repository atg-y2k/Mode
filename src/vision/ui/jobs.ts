/**
 * Store glue for the on-device vision features (no React here):
 * - sharpenOutlines: refine a photo's zones into exact masks and write them
 *   to the scene (runtime.setMask + zone.maskId / polygon, one undo step);
 * - mapSceneOffline: build a scene map without Claude, then sharpen it
 *   (canMapOnDevice: whether this browser can run it at all; useDeviceMapping:
 *   whether it is running for a photo);
 * - a tiny job store so progress and per-zone agreement survive panel switches;
 * - the SegFormer licence gate: before the first task that would use
 *   SegFormer (non-commercial weights), the action waits in `consent` until
 *   the user accepts or declines in the Scene panel (resolveSegformerConsent).
 */
import { create } from 'zustand';
import { newId } from '../../../shared/ids';
import { CONTEXT_ZONE_KINDS, type Photo, type Pt, type SceneMap, type SceneZone, type Space } from '../../../shared/types';
import * as runtime from '../../state/runtime';
import { findPhoto, isSketchZone, useStore } from '../../state/store';
import { isDesktopViewport } from '../../ui/shell/hooks';
import { offlineSceneMap, refineZonesDetailed, VisionError, visionUnsupportedReason, type RefineDetail } from '../index';
import { segformerAllowed, segformerChoice, setSegformerChoice, type SegformerChoice } from '../license';
import { offlineSceneCategory, offlineSummary } from '../sceneFromClasses';

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

/** An action waiting for the SegFormer licence decision. */
export interface PendingConsent {
  photoId: string;
  action: 'sharpen' | 'sharpen-again' | 'map' | 'remap';
}

interface VisionUIState {
  job: VisionJob | null;
  /** Set while an action waits for the SegFormer licence decision (shown in the Scene panel). */
  consent?: PendingConsent | null;
  /** Latest sharpen results per photo (this session). */
  outcomes: Record<string, { at: number; items: ZoneOutcome[] }>;
  /** Last error per photo (cleared on the next run). */
  errors: Record<string, string | undefined>;
}

export const useVisionJobs = create<VisionUIState>(() => ({ job: null, consent: null, outcomes: {}, errors: {} }));

const setJob = (job: VisionJob | null) => useVisionJobs.setState({ job });

/** True while this photo is being mapped on this device (for "Mapping the scene…" states). */
export function useDeviceMapping(photoId: string | null | undefined): boolean {
  return useVisionJobs((s) => !!photoId && s.job?.photoId === photoId && s.job.kind === 'map');
}

/**
 * True (and the action parked in `consent`) when the SegFormer licence hasn't
 * been decided yet: the Scene panel shows the summary with Use / Continue
 * without. The panel is brought forward when the action came from elsewhere
 * (the photo's "Map on this device").
 */
function awaitingConsent(photoId: string, action: PendingConsent['action']): boolean {
  if (segformerChoice() !== null) return false;
  useVisionJobs.setState({ consent: { photoId, action } });
  const s = useStore.getState();
  if (s.studio.panel !== 'scene') s.setStudio({ panel: 'scene' });
  // Phones show one pane at a time: bring the panel with the question forward.
  if (!isDesktopViewport() && s.view.mobilePane !== 'panel') s.setView({ mobilePane: 'panel' });
  return true;
}

/** Records the SegFormer decision (remembered on this device) and runs the parked action. */
export function resolveSegformerConsent(choice: SegformerChoice): void {
  const pending = useVisionJobs.getState().consent;
  setSegformerChoice(choice);
  useVisionJobs.setState({ consent: null });
  if (!pending) return;
  if (pending.action === 'map' || pending.action === 'remap') void mapSceneOffline(pending.photoId, { replace: pending.action === 'remap' });
  else void sharpenOutlines(pending.photoId, pending.action === 'sharpen-again');
}

/** Drops a parked action without deciding. */
export function dismissSegformerConsent(): void {
  useVisionJobs.setState({ consent: null });
}
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

async function runSharpen(photo: Photo, zones: SceneZone[], kind: VisionJob['kind']): Promise<{ sharpened: number; total: number; items: ZoneOutcome[] }> {
  const scene = photo.scene;
  if (!scene || zones.length === 0) return { sharpened: 0, total: 0, items: [] };
  const started = new Map(zones.map((z) => [z.id, z.polygon]));
  setJob({ photoId: photo.id, kind, phase: 'preparing', done: 0, total: zones.length });
  const image = await runtime.loadPhotoImage(photo);
  const results = await refineZonesDetailed(photo.id, image, zones, {
    context: scene.zones,
    semantic: segformerAllowed(),
    onProgress: (done, total) => setJob({ photoId: photo.id, kind, phase: 'sharpening', done, total }),
  });
  const sharpened = applyRefinement(photo.id, results, started);
  const items: ZoneOutcome[] = zones.map((z) => {
    const r = results.get(z.id);
    return { zoneId: z.id, label: z.label, refined: !!r?.refined, agreement: r?.agreement ?? 0 };
  });
  useVisionJobs.setState((s) => ({ outcomes: { ...s.outcomes, [photo.id]: { at: Date.now(), items } } }));
  return { sharpened, total: zones.length, items };
}

/** Sharpens the photo's zone outlines on this device. Resolves when done (errors are reported, not thrown). */
export async function sharpenOutlines(photoId: string, again = false): Promise<void> {
  if (useVisionJobs.getState().job) return;
  const photo = findPhoto(useStore.getState().project, photoId)?.photo;
  if (!photo?.scene) return;
  if (awaitingConsent(photoId, again ? 'sharpen-again' : 'sharpen')) return;
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

/** True when this browser can run the on-device models (the free map that needs no Claude key). */
export function canMapOnDevice(): boolean {
  return visionUnsupportedReason() === null;
}

/** Ends `text` with a full stop, so it can sit between two sentences of a message. */
function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Maps the photo without Claude (semantic segmentation + CLIPSeg outdoors),
 * keeps any sketched areas, then sharpens the new outlines. `replace`
 * (an explicit re-map) replaces an existing map; otherwise a map that is
 * already there (or arrives meanwhile) is kept. The map is saved before the
 * sharpening starts: when only the sharpening fails (e.g. the network drops
 * while its model downloads), the map stays and the message says so.
 */
export async function mapSceneOffline(photoId: string, opts: { replace?: boolean } = {}): Promise<void> {
  if (useVisionJobs.getState().job) return;
  const found = findPhoto(useStore.getState().project, photoId);
  if (!found) return;
  if (awaitingConsent(photoId, opts.replace ? 'remap' : 'map')) return;
  const { photo, space } = found;
  setError(photoId, undefined);
  setJob({ photoId, kind: 'map', phase: 'preparing', done: 0, total: 0 });
  try {
    const image = await runtime.loadPhotoImage(photo);
    setJob({ photoId, kind: 'map', phase: 'mapping', done: 0, total: 0 });
    const mappedScene = await offlineSceneMap(photoId, image, space.kind === 'interior', segformerAllowed());
    const now = findPhoto(useStore.getState().project, photoId);
    const current = now?.photo;
    if (!now || !current) return;
    // The user's space type (as it is now) stays the category; the class-mix guess only fills in a generic one.
    // The summary's "Not found: …" follows that category (a backyard has no front door to miss).
    const category = offlineSceneCategory(mappedScene.category, now.space.type);
    const scene: SceneMap = { ...mappedScene, category, summary: offlineSummary(mappedScene.zones, category) };
    if (!opts.replace && current.scene && current.scene.zones.some((z) => !isSketchZone(z))) {
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
    // The areas the Scene panel lists (not the sky or the street around them), and how many of those were sharpened.
    const listed = new Set(scene.zones.filter((z) => z.editable && !CONTEXT_ZONE_KINDS.includes(z.kind)).map((z) => z.id));
    const areas = `${listed.size} area${listed.size === 1 ? '' : 's'}`;
    let items: ZoneOutcome[];
    try {
      ({ items } = await runSharpen(mapped, sharpenableZones(mapped).filter((z) => ids.has(z.id)), 'map'));
    } catch (err) {
      if (isCancel(err)) throw err;
      // The map is saved: say so, and how to finish the outlines — not "Couldn't map the scene".
      useStore
        .getState()
        .notify(
          `Mapped ${areas} on this device, but the outlines couldn't be sharpened. ${sentence(errorText(err))} Use “Sharpen outlines” in the Scene panel later.`,
          'info',
        );
      return;
    }
    const sharpened = items.filter((i) => i.refined && listed.has(i.zoneId)).length;
    useStore.getState().notify(`Mapped ${areas} on this device${sharpened ? ` and sharpened ${sharpened}` : ''} — no AI used.`, 'success');
  } catch (err) {
    if (!isCancel(err)) {
      setError(photoId, errorText(err));
      useStore.getState().notify(`Couldn't map the scene on this device: ${errorText(err)}`, 'error');
    }
  } finally {
    setJob(null);
  }
}
