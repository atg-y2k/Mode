/**
 * Crop + resize on a 2D canvas (GPU-backed, much faster than the pure
 * resampler), for the export. Works on the main thread and in workers with
 * OffscreenCanvas; undefined when no canvas is available (node), so callers
 * fall back to the pure resampler. A single high-quality draw suffices:
 * exports enlarge, or shrink less than 2×.
 */
import type { ImageDataLike } from '../engine/types';
import type { Resizer } from './prepare';
import { resampleRGBA } from './resample';

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): AnyCanvas | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  } catch {
    // fall through
  }
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: AnyCanvas | null, opts?: CanvasRenderingContext2DSettings): Ctx | null {
  try {
    return (c?.getContext('2d', opts) as Ctx | null) ?? null;
  } catch {
    return null;
  }
}

export function canvasResizer(): Resizer | undefined {
  if (!ctx2d(makeCanvas(1, 1)) || typeof ImageData === 'undefined') return undefined;
  return (img, rect, w, h) => {
    const shrink = Math.max(rect.w / w, rect.h / h);
    const src = makeCanvas(img.width, img.height);
    const dst = makeCanvas(w, h);
    const sctx = ctx2d(src);
    const dctx = ctx2d(dst, { willReadFrequently: true });
    if (!src || !dst || !sctx || !dctx || shrink > 2) return resampleRGBA(img, rect, w, h);
    sctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    dctx.imageSmoothingEnabled = true;
    dctx.imageSmoothingQuality = 'high';
    dctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
    const out = dctx.getImageData(0, 0, w, h);
    src.width = 0;
    src.height = 0;
    return { width: w, height: h, data: out.data };
  };
}

/** Encodes pixels with an OffscreenCanvas (workers); null when unavailable. */
export async function encodeOffscreen(img: ImageDataLike, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined' || typeof ImageData === 'undefined') return null;
  const c = new OffscreenCanvas(img.width, img.height);
  const ctx = ctx2d(c) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx || typeof c.convertToBlob !== 'function') return null;
  if (type === 'image/jpeg') {
    // JPEG has no alpha: flatten onto white like imageImport does.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, img.width, img.height);
    const tmp = new OffscreenCanvas(img.width, img.height);
    const tctx = ctx2d(tmp) as OffscreenCanvasRenderingContext2D | null;
    if (!tctx) return null;
    tctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    ctx.drawImage(tmp, 0, 0);
  } else {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  }
  return c.convertToBlob({ type, quality });
}
