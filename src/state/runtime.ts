/**
 * In-memory caches for pixel data that is too heavy for the store:
 * decoded photos (ImageDataLike + Lab cache) and region masks.
 * Masks are mutated in place by editor tools; callers then call
 * `markMaskDirty(id)` which bumps the store's maskVersions (re-render) and
 * schedules a debounced write to IndexedDB.
 */
import type { Photo } from '../../shared/types';
import { createMask } from '../engine/mask';
import { computeLabImage, type LabImage } from '../engine/selection';
import type { ImageDataLike, Mask } from '../engine/types';
import { blobToImageData } from '../lib/imageImport';
import * as db from './persistence';

const masks = new Map<string, Mask>();
const images = new Map<string, ImageDataLike>(); // photoId -> pixels
const labs = new Map<string, LabImage>(); // photoId -> Lab cache
const pendingMaskWrites = new Map<string, ReturnType<typeof setTimeout>>();
const loadingPhotos = new Map<string, Promise<ImageDataLike>>();

type MaskListener = (maskId: string) => void;
let maskListener: MaskListener | null = null;

/** The store registers itself here to receive mask change notifications. */
export function onMaskChanged(listener: MaskListener): void {
  maskListener = listener;
}

export function getMask(maskId: string): Mask | undefined {
  return masks.get(maskId);
}

/** Returns the cached mask, else loads it from IndexedDB, else creates an empty one. */
export async function loadMask(maskId: string, width: number, height: number): Promise<Mask> {
  const cached = masks.get(maskId);
  if (cached) return cached;
  const stored = await db.getMask(maskId);
  const mask = stored && stored.width === width && stored.height === height ? stored : createMask(width, height);
  // Another caller may have created it while we awaited.
  const raced = masks.get(maskId);
  if (raced) return raced;
  masks.set(maskId, mask);
  return mask;
}

/** Registers a brand-new (or replaced) mask and persists it. */
export function setMask(maskId: string, mask: Mask): void {
  masks.set(maskId, mask);
  markMaskDirty(maskId);
}

/** Call after mutating a mask's pixels in place. */
export function markMaskDirty(maskId: string, persistDelayMs = 600): void {
  maskListener?.(maskId);
  const prev = pendingMaskWrites.get(maskId);
  if (prev) clearTimeout(prev);
  pendingMaskWrites.set(
    maskId,
    setTimeout(() => {
      pendingMaskWrites.delete(maskId);
      const m = masks.get(maskId);
      if (m) void db.putMask(maskId, m);
    }, persistDelayMs),
  );
}

/** Write any pending mask changes immediately (before export / page hide). */
export async function flushMasks(): Promise<void> {
  const ids = [...pendingMaskWrites.keys()];
  for (const id of ids) {
    clearTimeout(pendingMaskWrites.get(id));
    pendingMaskWrites.delete(id);
    const m = masks.get(id);
    if (m) await db.putMask(id, m);
  }
}

export function forgetMasks(maskIds: string[]): void {
  for (const id of maskIds) {
    masks.delete(id);
    const t = pendingMaskWrites.get(id);
    if (t) clearTimeout(t);
    pendingMaskWrites.delete(id);
  }
}

export function getPhotoImage(photoId: string): ImageDataLike | undefined {
  return images.get(photoId);
}

/** Decoded pixels of a photo (cached). */
export function loadPhotoImage(photo: Photo): Promise<ImageDataLike> {
  const cached = images.get(photo.id);
  if (cached) return Promise.resolve(cached);
  const inflight = loadingPhotos.get(photo.id);
  if (inflight) return inflight;
  const p = (async () => {
    const blob = await db.getBlob(photo.imageId);
    if (!blob) throw new Error(`Photo "${photo.name}" is missing from storage`);
    const img = await blobToImageData(blob);
    images.set(photo.id, img);
    return img;
  })();
  loadingPhotos.set(photo.id, p);
  p.finally(() => loadingPhotos.delete(photo.id)).catch(() => undefined);
  return p;
}

/** Lab cache for color-aware selection tools (computed lazily, cached). */
export function getPhotoLab(photoId: string): LabImage | undefined {
  const cached = labs.get(photoId);
  if (cached) return cached;
  const img = images.get(photoId);
  if (!img) return undefined;
  const lab = computeLabImage(img);
  labs.set(photoId, lab);
  return lab;
}

/** Loads the photo pixels and every region mask so the editor can render synchronously. */
export async function preloadPhoto(photo: Photo): Promise<ImageDataLike> {
  const [img] = await Promise.all([
    loadPhotoImage(photo),
    ...photo.regions.map((r) => loadMask(r.maskId, photo.width, photo.height)),
    // Zones sharpened on-device or refined in Fine-tune carry exact masks.
    ...(photo.scene?.zones ?? []).flatMap((z) => (z.maskId ? [loadMask(z.maskId, photo.width, photo.height)] : [])),
  ]);
  return img;
}

export function forgetPhoto(photoId: string): void {
  images.delete(photoId);
  labs.delete(photoId);
}

/** Persist pending mask edits, then drop everything (closing a project). */
export async function clearRuntime(): Promise<void> {
  await flushMasks();
  masks.clear();
  images.clear();
  labs.clear();
}
