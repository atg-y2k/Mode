/**
 * Builds the engine's RenderContext for a photo + design from the store and
 * runtime caches. Shared by the editor canvas, exports, the AI panel (current
 * composite for AI renders) and thumbnails.
 */
import type { Design, Photo } from '../../shared/types';
import { getMaterial } from '../assets/catalog';
import type { RenderContext } from '../engine/compositor';
import * as runtime from './runtime';
import { resolveAsset, useStore } from './store';

/** Null until the photo pixels are loaded (call runtime.preloadPhoto first). */
export function buildRenderContext(photo: Photo, design: Design): RenderContext | null {
  const image = runtime.getPhotoImage(photo.id);
  if (!image) return null;
  return {
    photo,
    design,
    image,
    getMask: runtime.getMask,
    getMaterial,
    getAsset: resolveAsset,
    maskVersions: useStore.getState().maskVersions,
  };
}

/** Loads pixels + masks if needed, then builds the context. */
export async function loadRenderContext(photo: Photo, design: Design): Promise<RenderContext> {
  await runtime.preloadPhoto(photo);
  const ctx = buildRenderContext(photo, design);
  if (!ctx) throw new Error('Photo could not be loaded');
  return ctx;
}
