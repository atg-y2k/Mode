/**
 * Turning an image provider's output into a variation of the user's photo:
 * center-crop to the photo's aspect (providers may answer in their own
 * sizes), high-quality resize to the photo size, then alpha-composite over
 * the base so pixels outside the target mask stay exactly as photographed
 * (feathered at the seam). Also the provider mask encoding (OpenAI
 * convention: opaque = keep, transparent = may change) and thumbnails.
 *
 * The pixel math is pure (ImageDataLike) and unit-tested; the canvas helpers
 * run in the browser (OffscreenCanvas when available).
 */
import { THUMB_MAX_SIZE, imageDataToBlob } from '../../lib/imageImport';
import { maskBounds } from '../../engine/mask';
import type { ImageDataLike, Mask } from '../../engine/types';

// ---------------------------------------------------------------------------
// Pure pixel math
// ---------------------------------------------------------------------------

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Centered source rect of a `srcW`×`srcH` image with the aspect ratio of
 * `dstW`×`dstH` (the whole source when the aspects already match within ½ px).
 */
export function centerCropRect(srcW: number, srcH: number, dstW: number, dstH: number): CropRect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return { sx: 0, sy: 0, sw: Math.max(0, srcW), sh: Math.max(0, srcH) };
  const dstAspect = dstW / dstH;
  const srcAspect = srcW / srcH;
  if (Math.abs(srcW - srcH * dstAspect) < 0.5) return { sx: 0, sy: 0, sw: srcW, sh: srcH };
  if (srcAspect > dstAspect) {
    const sw = srcH * dstAspect;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  const sh = srcW / dstAspect;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}

/**
 * out = base · (1 − m) + top · m with m = mask / 255, per pixel. Pixels where
 * the mask is 0 are copied from `base` bit-exactly. All three must have the
 * same size. Alpha of the result is the base's alpha.
 */
export function alphaComposite(base: ImageDataLike, top: ImageDataLike, mask: Mask): ImageDataLike {
  const { width, height } = base;
  if (top.width !== width || top.height !== height || mask.width !== width || mask.height !== height) {
    throw new Error(`alphaComposite: size mismatch (base ${width}×${height}, top ${top.width}×${top.height}, mask ${mask.width}×${mask.height})`);
  }
  const out = new Uint8ClampedArray(base.data);
  const b = maskBounds(mask);
  if (!b) return { width, height, data: out };
  const t = top.data;
  const m = mask.data;
  for (let y = b.y; y < b.y + b.h; y++) {
    let mi = y * width + b.x;
    let pi = mi * 4;
    for (let x = 0; x < b.w; x++, mi++, pi += 4) {
      const a = m[mi];
      if (a === 0) continue;
      if (a === 255) {
        out[pi] = t[pi];
        out[pi + 1] = t[pi + 1];
        out[pi + 2] = t[pi + 2];
        continue;
      }
      const k = a / 255; // Uint8ClampedArray rounds on store
      out[pi] = out[pi] + (t[pi] - out[pi]) * k;
      out[pi + 1] = out[pi + 1] + (t[pi + 1] - out[pi + 1]) * k;
      out[pi + 2] = out[pi + 2] + (t[pi + 2] - out[pi + 2]) * k;
    }
  }
  return { width, height, data: out };
}

/**
 * The provider mask in the OpenAI images-edit convention: black RGBA whose
 * alpha is 255 where the photo must be kept and 0 where it may change
 * (alpha = 255 − coverage, so feathered seams become partially transparent).
 */
export function maskToKeepAlpha(mask: Mask): ImageDataLike {
  const n = mask.width * mask.height;
  const data = new Uint8ClampedArray(n * 4);
  const m = mask.data;
  for (let i = 0, p = 3; i < n; i++, p += 4) data[p] = 255 - m[i];
  return { width: mask.width, height: mask.height, data };
}

/** Size that fits `w`×`h` inside a `max` square, never upscaling. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(1, w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

// ---------------------------------------------------------------------------
// Canvas (browser)
// ---------------------------------------------------------------------------

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function context2d(c: AnyCanvas): Ctx2D {
  const ctx = c.getContext('2d', { willReadFrequently: true }) as Ctx2D | null;
  if (!ctx) throw new Error('This browser could not create a 2D canvas.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

type Drawable = ImageBitmap | AnyCanvas;

/**
 * Draws `crop` of `src` into a dstW×dstH canvas with high-quality smoothing.
 * Large reductions step down by halves first so detail doesn't alias.
 */
function drawResized(src: Drawable, crop: CropRect, dstW: number, dstH: number): AnyCanvas {
  let current: Drawable = src;
  let rect = crop;
  while (rect.sw / 2 >= dstW && rect.sh / 2 >= dstH) {
    const w = Math.max(1, Math.round(rect.sw / 2));
    const h = Math.max(1, Math.round(rect.sh / 2));
    const step = createCanvas(w, h);
    context2d(step).drawImage(current as CanvasImageSource, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, w, h);
    current = step;
    rect = { sx: 0, sy: 0, sw: w, sh: h };
  }
  const out = createCanvas(dstW, dstH);
  context2d(out).drawImage(current as CanvasImageSource, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, dstW, dstH);
  return out;
}

function readPixels(c: AnyCanvas): ImageDataLike {
  const img = context2d(c).getImageData(0, 0, c.width, c.height);
  return { width: img.width, height: img.height, data: img.data };
}

function putPixels(img: ImageDataLike): AnyCanvas {
  const c = createCanvas(img.width, img.height);
  const data = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  context2d(c).putImageData(data, 0, 0);
  return c;
}

/** Decodes an image blob and returns it center-cropped to the target aspect and resized to width×height. */
export async function decodeToSize(blob: Blob, width: number, height: number): Promise<ImageDataLike> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('The image provider returned an image this browser could not read.');
  }
  try {
    const crop = centerCropRect(bitmap.width, bitmap.height, width, height);
    return readPixels(drawResized(bitmap, crop, width, height));
  } finally {
    bitmap.close();
  }
}

/** JPEG thumbnail (long edge ≤ THUMB_MAX_SIZE). */
export async function thumbnailBlob(img: ImageDataLike, max = THUMB_MAX_SIZE): Promise<Blob> {
  const { width, height } = fitWithin(img.width, img.height, max);
  if (width === img.width && height === img.height) return imageDataToBlob(img, 'image/jpeg', 0.85);
  const small = readPixels(drawResized(putPixels(img), { sx: 0, sy: 0, sw: img.width, sh: img.height }, width, height));
  return imageDataToBlob(small, 'image/jpeg', 0.85);
}

/**
 * Provider output → final variation pixels at the photo's size: fit (crop +
 * resize) and, when `mask` is given, keep `base` outside it.
 */
export async function compositeVariation(result: Blob, base: ImageDataLike, mask: Mask | null): Promise<ImageDataLike> {
  const fitted = await decodeToSize(result, base.width, base.height);
  return mask ? alphaComposite(base, fitted, mask) : fitted;
}

/** Re-fits pixels of another size to width×height (e.g. a base variation saved at an older photo size). */
export function resizePixels(img: ImageDataLike, width: number, height: number): ImageDataLike {
  if (img.width === width && img.height === height) return img;
  const crop = centerCropRect(img.width, img.height, width, height);
  return readPixels(drawResized(putPixels(img), crop, width, height));
}
