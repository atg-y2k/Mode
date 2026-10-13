/**
 * Turns AssetDefs into drawable images (browser). Sources, in priority order:
 * asset.art (procedural, via renderArt) → asset.svg (AI vector) → asset.imageId
 * (raster in the blob store). Results are cached per asset id + tint.
 *
 * Importing this module is DOM-free (the store imports it in node tests); DOM
 * APIs are only touched when an image is actually decoded.
 */
import type { AssetDef } from '../../shared/types';
import { renderArt, tintArt } from '../assets/art';
import { getBlob } from '../state/persistence';

/** SVG markup for vector assets (art or svg), optionally recolored by `tint`; null for raster assets. */
export function assetSvgMarkup(asset: AssetDef, tint?: string): string | null {
  if (asset.art) return renderArt(tint ? tintArt(asset.art, tint) : asset.art).svg;
  if (typeof asset.svg === 'string' && asset.svg.trim()) return asset.svg;
  return null;
}

/** data: URL for SVG markup. */
export function svgToDataUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** Small cache: markup string → data URL (thumbnails ask repeatedly). Keyed by asset id + tint. */
const dataUrls = new Map<string, { svg: string; url: string }>();
const DATA_URL_CACHE_MAX = 400;

/** data: URL of the SVG for vector assets (sync, for <img> thumbnails); null for raster assets. */
export function assetSvgDataUrl(asset: AssetDef, tint?: string): string | null {
  const svg = assetSvgMarkup(asset, tint);
  if (svg === null) return null;
  const key = cacheKey(asset.id, tint);
  const hit = dataUrls.get(key);
  if (hit && hit.svg === svg) return hit.url;
  const url = svgToDataUrl(svg);
  dataUrls.delete(key);
  dataUrls.set(key, { svg, url });
  if (dataUrls.size > DATA_URL_CACHE_MAX) dataUrls.delete(dataUrls.keys().next().value as string);
  return url;
}

function cacheKey(assetId: string, tint?: string): string {
  return `${assetId}\u0000${tint ?? ''}`;
}

/** Intrinsic size of an SVG document from its width/height attributes, else its viewBox. */
export function svgIntrinsicSize(svg: string): { width: number; height: number } | null {
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!open) return null;
  const attr = (name: string): number => {
    const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)(px)?\\s*["']`, 'i').exec(open);
    return m ? Number.parseFloat(m[1]) : NaN;
  };
  let width = attr('width');
  let height = attr('height');
  if (!(width > 0) || !(height > 0)) {
    const vb = /\sviewBox\s*=\s*["']([^"']+)["']/i.exec(open)?.[1];
    const parts = vb?.trim().split(/[\s,]+/).map(Number);
    if (parts && parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      width = parts[2];
      height = parts[3];
    }
  }
  return width > 0 && height > 0 ? { width, height } : null;
}

// ---------------------------------------------------------------------------
// Decoded image cache
// ---------------------------------------------------------------------------

interface ImageEntry {
  /** What the entry was built from; a different source (edited asset) invalidates it. */
  source: string;
  promise: Promise<CanvasImageSource>;
  image?: CanvasImageSource;
}

const images = new Map<string, ImageEntry>();
/** Object URLs of raster assets, keyed by asset id. */
const objectUrls = new Map<string, { imageId: string; promise: Promise<string | null>; url?: string | null }>();

/** Identity of the visual an asset (+ tint) currently resolves to. */
function sourceOf(asset: AssetDef, tint?: string): { kind: 'svg'; svg: string } | { kind: 'raster'; imageId: string } | null {
  const svg = assetSvgMarkup(asset, tint);
  if (svg !== null) return { kind: 'svg', svg };
  if (asset.imageId) return { kind: 'raster', imageId: asset.imageId };
  return null;
}

/** Decodes SVG markup with an explicit pixel size (needed for drawImage in Firefox / Safari). */
function decodeSvg(svg: string): Promise<CanvasImageSource> {
  if (typeof Image === 'undefined') return Promise.reject(new Error('SVG decoding needs a browser'));
  const size = svgIntrinsicSize(svg) ?? { width: 300, height: 300 };
  const img = new Image(Math.max(1, Math.round(size.width)), Math.max(1, Math.round(size.height)));
  img.decoding = 'async';
  const loaded = new Promise<CanvasImageSource>((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the asset artwork'));
  });
  img.src = svgToDataUrl(svg);
  return loaded;
}

async function decodeRaster(imageId: string): Promise<CanvasImageSource> {
  const blob = await getBlob(imageId);
  if (!blob) throw new Error('The asset image is missing from storage');
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  // Very old browsers: decode through an <img> and an object URL.
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not decode the asset image'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Returns the live cache entry for an asset (+ tint), creating / replacing it as needed. */
function entryFor(asset: AssetDef, tint?: string): ImageEntry {
  const src = sourceOf(asset, tint);
  if (!src) throw new Error(`Asset "${asset.name}" has no image`);
  const sourceKey = src.kind === 'svg' ? src.svg : `raster:${src.imageId}`;
  const key = cacheKey(asset.id, tint);
  const cached = images.get(key);
  // Strings from renderArt's cache are usually the same object, so this compare is cheap.
  if (cached && cached.source === sourceKey) return cached;
  const promise = src.kind === 'svg' ? decodeSvg(src.svg) : decodeRaster(src.imageId);
  const entry: ImageEntry = { source: sourceKey, promise };
  images.set(key, entry);
  // Replaced / evicted images are simply dropped (never closed): a render may
  // still be about to draw them, and the GC reclaims them afterwards.
  promise.then(
    (img) => {
      if (images.get(key) === entry) entry.image = img;
    },
    () => {
      // Forget failures so a later call (e.g. after the blob is restored) can retry.
      if (images.get(key) === entry) images.delete(key);
    },
  );
  return entry;
}

/** URL usable in <img src> for any asset (object URL for rasters). Cached. */
export async function getAssetImageUrl(asset: AssetDef): Promise<string | null> {
  const vector = assetSvgDataUrl(asset);
  if (vector) return vector;
  const imageId = asset.imageId;
  if (!imageId) return null;
  const cached = objectUrls.get(asset.id);
  if (cached && cached.imageId === imageId) return cached.promise;
  if (cached?.url) URL.revokeObjectURL(cached.url);
  const entry: { imageId: string; promise: Promise<string | null>; url?: string | null } = {
    imageId,
    promise: Promise.resolve(null),
  };
  entry.promise = (async () => {
    const blob = await getBlob(imageId);
    if (!blob) {
      // Not cached: the blob may be restored later (project import).
      if (objectUrls.get(asset.id) === entry) objectUrls.delete(asset.id);
      return null;
    }
    const url = URL.createObjectURL(blob);
    if (objectUrls.get(asset.id) === entry) entry.url = url;
    else URL.revokeObjectURL(url);
    return url;
  })();
  objectUrls.set(asset.id, entry);
  entry.promise.catch(() => {
    if (objectUrls.get(asset.id) === entry) objectUrls.delete(asset.id);
  });
  return entry.promise;
}

/** Decoded image ready for ctx.drawImage. Cached. Rejects if the asset has no visual. */
export async function getAssetImage(asset: AssetDef, tint?: string): Promise<CanvasImageSource> {
  return entryFor(asset, tint).promise;
}

/** Cached image if already decoded, else undefined (and starts loading). */
export function peekAssetImage(asset: AssetDef, tint?: string): CanvasImageSource | undefined {
  let entry: ImageEntry;
  try {
    entry = entryFor(asset, tint);
  } catch {
    return undefined;
  }
  if (!entry.image) entry.promise.catch(() => undefined);
  return entry.image;
}

/** Forget cached images for an asset (after it is edited or deleted). */
export function evictAssetImage(assetId: string): void {
  const prefix = `${assetId}\u0000`;
  for (const key of [...images.keys()]) if (key.startsWith(prefix)) images.delete(key);
  for (const key of [...dataUrls.keys()]) if (key.startsWith(prefix)) dataUrls.delete(key);
  const url = objectUrls.get(assetId);
  if (url) {
    objectUrls.delete(assetId);
    void url.promise.then((u) => u && URL.revokeObjectURL(u), () => undefined);
  }
}
