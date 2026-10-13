/**
 * Preparing a planned variation for a manual hand-off (lazily, when the user
 * opens it): the run's starting image + target mask → the engine's export
 * (crop / ratio / marker; src/handoff) → the app-specific prompt → both
 * images stored in the blob store and the pack saved on planned[i].handoff.
 *
 * The export only depends on the run (starting image, target) and the app,
 * so it is computed once per run × app and shared by its items; the prompt
 * differs per item. Decoded pixels and blobs are cached in memory for the
 * clipboard (which needs a Promise<Blob> synchronously inside a click).
 */
import { newId } from '../../../../shared/ids';
import type { DesignBrief, Generation, HandoffApp, HandoffPack, Photo, PlannedVariation } from '../../../../shared/types';
import { createMask } from '../../../engine/mask';
import type { ImageDataLike, Mask } from '../../../engine/types';
import { buildHandoffPrompt, markerColorName, prepareHandoff, promptContextFromScene, ratioLabel, type PreparedHandoff } from '../../../handoff';
import { blobToImageData } from '../../../lib/imageImport';
import * as db from '../../../state/persistence';
import * as runtime from '../../../state/runtime';
import { findPhoto, findVariation, useStore } from '../../../state/store';
import { resizePixels } from '../composite';
import { buildTargetMask } from '../generate';
import { briefTargetIds } from '../maskFromZones';
import { appLabel, findPlanned, rollupStatus, type PlannedRef } from './planned';
import { setItemError, setJob } from './session';

const store = () => useStore.getState();

/** Pixels a run works from: its starting image at photo size and the area that may change. */
export interface RunAssets {
  base: ImageDataLike;
  target: Mask;
  /** No targets / scope 'whole': the full frame may change. */
  wholeImage: boolean;
}

/** Small LRU of promises (decoded photos are large: keep only a few runs). */
class PromiseCache<T> {
  private map = new Map<string, Promise<T>>();
  constructor(private limit: number) {}
  get(key: string, make: () => Promise<T>): Promise<T> {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const p = make();
    this.map.set(key, p);
    p.catch(() => {
      if (this.map.get(key) === p) this.map.delete(key);
    });
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as string);
    return p;
  }
  forget(prefix: string): void {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k);
  }
}

const assetsCache = new PromiseCache<RunAssets>(3);
const exportCache = new PromiseCache<PreparedHandoff>(4);

function lookup(ref: PlannedRef): { photo: Photo; generation: Generation; planned: PlannedVariation } | undefined {
  const photo = findPhoto(store().project, ref.photoId)?.photo;
  const found = findPlanned(photo, ref.generationId, ref.plannedId);
  return photo && found ? { photo, generation: found.generation, planned: found.planned } : undefined;
}

export function lookupPlanned(ref: PlannedRef) {
  return lookup(ref);
}

async function loadBase(photo: Photo, g: Generation): Promise<ImageDataLike> {
  if (g.baseVariationId) {
    const v = findVariation(photo, g.baseVariationId);
    const blob = v ? await db.getBlob(v.imageId) : undefined;
    if (!blob) throw new Error('The variation this run starts from was deleted — start a new run from the original.');
    return resizePixels(await blobToImageData(blob), photo.width, photo.height);
  }
  return resizePixels(await runtime.loadPhotoImage(photo), photo.width, photo.height);
}

/** Target mask of a brief at photo size (refined zone masks loaded first); a full mask for whole-image briefs. */
export async function targetMaskFor(photo: Photo, brief: DesignBrief): Promise<{ mask: Mask; wholeImage: boolean }> {
  const { zoneIds } = briefTargetIds(brief, photo.scene);
  const zones = photo.scene?.zones.filter((z) => z.maskId && zoneIds.includes(z.id)) ?? [];
  await Promise.all(zones.map((z) => runtime.loadMask(z.maskId as string, photo.width, photo.height).catch(() => undefined)));
  const mask = buildTargetMask(photo, brief);
  if (mask) return { mask, wholeImage: false };
  const full = createMask(photo.width, photo.height);
  full.data.fill(255);
  return { mask: full, wholeImage: true };
}

/** Starting image + target of a run (cached per run). */
export function runAssets(photo: Photo, g: Generation): Promise<RunAssets> {
  return assetsCache.get(g.id, async () => {
    const [base, target] = await Promise.all([loadBase(photo, g), targetMaskFor(photo, g.brief)]);
    return { base, target: target.mask, wholeImage: target.wholeImage };
  });
}

/** The engine's export of a run for one app (cached per run × app). */
export function preparedExport(photo: Photo, g: Generation, app: HandoffApp): Promise<PreparedHandoff> {
  return exportCache.get(`${g.id}:${app}`, async () => {
    const assets = await runAssets(photo, g);
    return prepareHandoff(assets.base, assets.target, { app, ...(assets.wholeImage ? { fullFrame: true } : {}) });
  });
}

/** Forget cached pixels of a run (e.g. after the run was deleted). */
export function forgetRunCaches(generationId: string): void {
  assetsCache.forget(generationId);
  exportCache.forget(`${generationId}:`);
}

/** What the prompt needs to know about the exported frame. */
export interface FrameInfo {
  ratio: string;
  /** Marker hex ('' = whole image, no marker). */
  markerColor: string;
  /** Exported region of the photo (position words are relative to it). */
  crop: HandoffPack['crop'];
}

/** The app-specific prompt for one planned item. */
export function packPrompt(
  photo: Photo,
  g: Generation,
  planned: Pick<PlannedVariation, 'brief'>,
  app: HandoffApp,
  frame: FrameInfo,
  strictness?: NonNullable<DesignBrief['strictness']>,
): string {
  const targetZoneIds = briefTargetIds(g.brief, photo.scene).zoneIds;
  const ctx = promptContextFromScene(
    photo.scene,
    g.brief,
    targetZoneIds,
    { app, instruction: planned.brief, ratio: frame.ratio, markerColorName: markerColorName(frame.markerColor), references: [] },
    { view: frame.crop, frame: { width: photo.width, height: photo.height } },
  );
  return buildHandoffPrompt(strictness ? { ...ctx, strictness } : ctx);
}

// ---------------------------------------------------------------------------
// Blobs (memory first: the clipboard wants them without waiting on IndexedDB)
// ---------------------------------------------------------------------------

const blobMemo = new Map<string, Blob>();
const pngMemo = new Map<string, Promise<Blob>>();

function remember(id: string, blob: Blob): void {
  blobMemo.set(id, blob);
  if (blobMemo.size > 24) blobMemo.delete(blobMemo.keys().next().value as string);
}

export async function packBlob(id: string): Promise<Blob> {
  const hit = blobMemo.get(id);
  if (hit) return hit;
  const blob = await db.getBlob(id);
  if (!blob) throw new Error('The prepared image is missing from storage — reopen this hand-off to prepare it again.');
  remember(id, blob);
  return blob;
}

/** PNG copy of a stored image (the only image type every browser's clipboard accepts). */
export function packPng(id: string): Promise<Blob> {
  let p = pngMemo.get(id);
  if (!p) {
    p = packBlob(id).then(toPng);
    pngMemo.set(id, p);
    p.catch(() => pngMemo.delete(id));
    if (pngMemo.size > 12) pngMemo.delete(pngMemo.keys().next().value as string);
  }
  return p;
}

export async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      c.getContext('2d')!.drawImage(bitmap, 0, 0);
      return await c.convertToBlob({ type: 'image/png' });
    }
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d')!.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode PNG'))), 'image/png'));
  } finally {
    bitmap.close();
  }
}

/** Starts the PNG conversion early so a later click finds it ready. */
export function warmPack(pack: HandoffPack): void {
  void packPng(pack.markedImageId).catch(() => undefined);
  void packPng(pack.cleanImageId).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<HandoffPack>>();

export interface EnsurePackOptions {
  /** Prepare for this app (default: the item's pack app, else the Studio's hand-off app). */
  app?: HandoffApp;
  /** Rebuild the prompt with this strictness (keeps the images). */
  strictness?: NonNullable<DesignBrief['strictness']>;
}

async function blobsExist(pack: HandoffPack): Promise<boolean> {
  if (blobMemo.has(pack.markedImageId) && blobMemo.has(pack.cleanImageId)) return true;
  const [a, b] = await Promise.all([db.getBlob(pack.markedImageId), db.getBlob(pack.cleanImageId)]);
  if (a) remember(pack.markedImageId, a);
  if (b) remember(pack.cleanImageId, b);
  return !!a && !!b;
}

/**
 * The item's hand-off pack, prepared now when missing (or for another app /
 * strictness). Concurrent calls for the same item share one preparation.
 */
export function ensurePack(ref: PlannedRef, opts: EnsurePackOptions = {}): Promise<HandoffPack> {
  const key = `${ref.plannedId}:${opts.app ?? ''}:${opts.strictness ?? ''}`;
  const running = inflight.get(key);
  if (running) return running;
  const p = buildPack(ref, opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function buildPack(ref: PlannedRef, opts: EnsurePackOptions): Promise<HandoffPack> {
  const found = lookup(ref);
  if (!found) throw new Error('This hand-off is no longer in the project.');
  const { photo, generation, planned } = found;
  const existing = planned.handoff;
  const app = opts.app ?? existing?.app ?? store().studio.handoffApp;

  // Same app, images still stored: reuse (only the prompt may change).
  if (existing && existing.app === app && (await blobsExist(existing))) {
    if (!opts.strictness) return existing;
    const frame = { ratio: ratioLabel(existing.outW, existing.outH), markerColor: existing.markerColor, crop: existing.crop };
    const prompt = packPrompt(photo, generation, planned, app, frame, opts.strictness);
    savePack(ref, { ...existing, prompt });
    return { ...existing, prompt };
  }

  setItemError(ref.plannedId, null);
  setJob(ref.plannedId, { kind: 'preparing', message: `Preparing the photo for ${appLabel(app)}…` });
  try {
    const prepared = await preparedExport(photo, generation, app);
    // Strictness defaults to the run's brief (promptContextFromScene reads it).
    const prompt = packPrompt(photo, generation, planned, app, prepared, opts.strictness);
    const cleanImageId = newId('img');
    const markedImageId = newId('img');
    await Promise.all([db.putBlob(cleanImageId, prepared.clean), db.putBlob(markedImageId, prepared.marked)]);
    remember(cleanImageId, prepared.clean);
    remember(markedImageId, prepared.marked);
    const pack: HandoffPack = {
      app,
      prompt,
      crop: prepared.crop,
      outW: prepared.outW,
      outH: prepared.outH,
      markerColor: prepared.markerColor,
      cleanImageId,
      markedImageId,
      createdAt: Date.now(),
    };
    // The item may have been deleted (or prepared by someone else) meanwhile.
    const still = lookup(ref);
    if (!still) {
      void db.deleteBlobs([cleanImageId, markedImageId]);
      throw new Error('This hand-off is no longer in the project.');
    }
    const old = still.planned.handoff;
    savePack(ref, pack);
    if (old && old.cleanImageId !== cleanImageId) void db.deleteBlobs([old.cleanImageId, old.markedImageId]);
    warmPack(pack);
    return pack;
  } catch (err) {
    setItemError(ref.plannedId, (err as Error).message || 'Could not prepare this hand-off.');
    throw err;
  } finally {
    setJob(ref.plannedId, null);
  }
}

function savePack(ref: PlannedRef, pack: HandoffPack): void {
  store().updateGeneration(ref.photoId, ref.generationId, (g) => {
    const p = g.planned?.find((x) => x.id === ref.plannedId);
    if (!p) return;
    p.handoff = pack;
    if (p.status !== 'failed') return;
    // A failed hand-off that could be prepared now waits for the user again.
    p.status = 'awaiting-handoff';
    delete p.error;
    const r = rollupStatus(g as Generation);
    g.status = r.status;
    if (r.error) g.error = r.error;
    else delete g.error;
  });
}

/** Drops an item's prepared pack (e.g. switching apps); it is prepared again when opened. */
export function dropPack(ref: PlannedRef): void {
  const found = lookup(ref);
  const pack = found?.planned.handoff;
  if (!pack) return;
  store().updateGeneration(ref.photoId, ref.generationId, (g) => {
    const p = g.planned?.find((x) => x.id === ref.plannedId);
    if (p) delete p.handoff;
  });
  void db.deleteBlobs([pack.cleanImageId, pack.markedImageId]);
}
