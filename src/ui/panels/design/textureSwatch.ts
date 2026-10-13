/**
 * Texture swatches for material pickers: textureSwatch() pixels drawn to a
 * canvas and turned into a data URL, memoized per key (material id + size).
 *
 * Generating a texture tile takes a few to tens of milliseconds, so swatches
 * are produced off the critical path: requests join a queue that is drained
 * in short time slices between frames, in request order (the grid renders
 * top-down, so visible tiles come first). Requests nobody waits for any more
 * (the panel was closed) are skipped. Failures are cached so the UI falls
 * back to a palette gradient instead of retrying forever.
 */
import { useEffect, useState } from 'react';
import type { MaterialDef, TextureSpec } from '../../../../shared/types';
import { textureSwatch } from '../../../engine/textures';

type Entry = { status: 'ready'; url: string } | { status: 'failed' };

const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const queue: { key: string; spec: TextureSpec; size: number }[] = [];
const queued = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Time budget per slice so scrolling and typing stay responsive. */
const SLICE_MS = 12;

/** Pixel size used for every material swatch (one cache entry per material). */
export const MATERIAL_SWATCH_PX = 192;

function renderDataUrl(spec: TextureSpec, size: number): string {
  const img = textureSwatch(spec, size);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  const out = ctx.createImageData(img.width, img.height);
  out.data.set(img.data);
  ctx.putImageData(out, 0, 0);
  // Textures are opaque: JPEG keeps the data URLs small.
  return canvas.toDataURL('image/jpeg', 0.9);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function pump(): void {
  timer = null;
  const start = now();
  while (queue.length > 0) {
    const job = queue.shift()!;
    queued.delete(job.key);
    if (cache.has(job.key) || !listeners.get(job.key)?.size) continue;
    let entry: Entry;
    try {
      entry = { status: 'ready', url: renderDataUrl(job.spec, job.size) };
    } catch (err) {
      console.warn('[materials] texture swatch failed', job.key, err);
      entry = { status: 'failed' };
    }
    cache.set(job.key, entry);
    for (const fn of listeners.get(job.key) ?? []) fn();
    if (now() - start > SLICE_MS) break;
  }
  if (queue.length > 0) timer = setTimeout(pump, 16);
}

function request(key: string, spec: TextureSpec, size: number): void {
  if (cache.has(key) || queued.has(key)) return;
  queued.add(key);
  queue.push({ key, spec, size });
  if (!timer) timer = setTimeout(pump, 0);
}

function subscribe(key: string, fn: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(key);
  };
}

export type SwatchState = { status: 'loading' } | Entry;

/** Data URL of a texture swatch for `key` (render size `sizePx`), generated lazily. */
export function useTextureSwatch(key: string | undefined, spec: TextureSpec | undefined, sizePx: number): SwatchState {
  const fullKey = key && spec ? `${key}@${sizePx}` : undefined;
  const [, force] = useState(0);
  const entry = fullKey ? cache.get(fullKey) : undefined;
  const ready = !!entry;
  useEffect(() => {
    if (!fullKey || !spec) return;
    if (cache.has(fullKey)) {
      // Finished between render and effect (another tile asked first): show it.
      if (!ready) force((n) => n + 1);
      return;
    }
    const unsubscribe = subscribe(fullKey, () => force((n) => n + 1));
    request(fullKey, spec, sizePx);
    return unsubscribe;
  }, [fullKey, spec, sizePx, ready]);
  if (!fullKey) return { status: 'failed' };
  return entry ?? { status: 'loading' };
}

/** Swatch of a catalog material. */
export function useMaterialSwatch(material: MaterialDef | undefined): SwatchState {
  return useTextureSwatch(material?.id, material?.texture, MATERIAL_SWATCH_PX);
}

/** CSS gradient of a texture's palette — the placeholder while (or if) the real swatch is unavailable. */
export function paletteGradient(spec: TextureSpec | undefined): string {
  const colors = (spec?.colors ?? []).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)).slice(0, 4);
  if (colors.length === 0) return 'linear-gradient(135deg, rgb(128 128 128 / 0.35), rgb(128 128 128 / 0.15))';
  if (colors.length === 1) return colors[0];
  return `linear-gradient(135deg, ${colors.join(', ')})`;
}
