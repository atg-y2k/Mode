/**
 * Image URLs for option visuals:
 * - texture swatches (textureSwatch → canvas → JPEG data URL), generated off
 *   the critical path in an idle-time queue (a pixel-generated swatch takes
 *   tens of milliseconds) and cached;
 * - procedural art (renderArt → SVG data URL), cached.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { ArtSpec } from '../../../../shared/art';
import type { TextureSpec } from '../../../../shared/types';
import { renderArt } from '../../../assets/art';
import { textureSwatch } from '../../../engine/textures';

/** Swatch pixel size (option cards are ~80–96 css px; 2× for sharp screens). */
export const SWATCH_PX = 176;

type Entry = { status: 'ready'; url: string } | { status: 'error' };

const CACHE_MAX = 320;
const cache = new Map<string, Entry>();
const queued = new Map<string, { spec: TextureSpec; size: number; span?: number }>();
const listeners = new Set<() => void>();
let scheduled = false;

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function textureKey(spec: TextureSpec, size: number, span?: number): string {
  return `${size}|${span ?? ''}|${spec.pattern}|${spec.colors.join(',')}|${spec.unitWidthIn}x${spec.unitHeightIn}|${spec.joint ? `${spec.joint.color}/${spec.joint.widthIn}` : ''}|${spec.variation}|${spec.seed}`;
}

function remember(key: string, entry: Entry): void {
  cache.set(key, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

function renderSwatch(spec: TextureSpec, size: number, span?: number): string {
  const img = textureSwatch(spec, size, span);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  const data = ctx.createImageData(img.width, img.height);
  data.data.set(img.data);
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function work(deadline?: { timeRemaining(): number }): void {
  scheduled = false;
  const start = performance.now();
  let changed = false;
  for (const [key, job] of queued) {
    queued.delete(key);
    try {
      remember(key, { status: 'ready', url: renderSwatch(job.spec, job.size, job.span) });
    } catch {
      remember(key, { status: 'error' });
    }
    changed = true;
    const left = deadline ? deadline.timeRemaining() : 12 - (performance.now() - start);
    if (left < 4) break;
  }
  if (changed) emit();
  if (queued.size > 0) schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback((d) => work(d), { timeout: 120 });
  else setTimeout(() => work(), 16);
}

/** Data URL of a texture swatch, null while it is being generated, 'error' if generation failed. */
export function useTextureSwatch(spec: TextureSpec | undefined, size = SWATCH_PX, span?: number): string | null | 'error' {
  const key = spec ? textureKey(spec, size, span) : '';
  const entry = useSyncExternalStore(subscribe, () => (key ? cache.get(key) : undefined), () => undefined);
  useEffect(() => {
    if (!spec || !key || cache.has(key) || queued.has(key)) return;
    queued.set(key, { spec, size, span });
    schedule();
  }, [key, spec, size, span]);
  if (!entry) return null;
  return entry.status === 'ready' ? entry.url : 'error';
}

const artCache = new Map<string, string>();

/** SVG data URL of procedural art (cached); null if the art can't be rendered. */
export function artDataUrl(spec: ArtSpec): string | null {
  const key = JSON.stringify(spec);
  const hit = artCache.get(key);
  if (hit) return hit;
  try {
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderArt(spec).svg)}`;
    artCache.set(key, url);
    if (artCache.size > CACHE_MAX) artCache.delete(artCache.keys().next().value as string);
    return url;
  } catch {
    return null;
  }
}
