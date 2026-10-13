/**
 * Browser image helpers: import user photos (EXIF orientation respected,
 * downscaled to a working size), decode to pixels, encode, and data URLs.
 */
import type { ImageDataLike } from '../engine/types';

/** Long edge of the working resolution used for editing & masks. */
export const WORKING_MAX_SIZE = 1600;
export const THUMB_MAX_SIZE = 320;

export interface ImportedImage {
  /** JPEG (quality ~0.9) at ≤ maxSize long edge; PNG if the source has transparency and keepAlpha. */
  blob: Blob;
  width: number;
  height: number;
  /** JPEG thumbnail ≤ THUMB_MAX_SIZE. */
  thumb: Blob;
}

const JPEG_QUALITY = 0.9;
const THUMB_QUALITY = 0.82;
const AI_QUALITY = 0.85;
/**
 * Largest canvas we ever allocate (iOS Safari refuses canvases above ~16.7 MP
 * and silently draws nothing). The first downscale step jumps below it.
 */
const MAX_CANVAS_PIXELS = 16_000_000;

// ---------------------------------------------------------------------------
// Canvas helpers (OffscreenCanvas when it has a 2D context, else <canvas>)
// ---------------------------------------------------------------------------

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

let offscreen2d: boolean | null = null;

function supportsOffscreen2d(): boolean {
  if (offscreen2d === null) {
    try {
      offscreen2d = typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(1, 1).getContext('2d');
    } catch {
      offscreen2d = false;
    }
  }
  return offscreen2d;
}

function makeCanvas(width: number, height: number): AnyCanvas {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (supportsOffscreen2d()) return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') throw new Error('Image processing needs a browser canvas');
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function context(canvas: AnyCanvas, opts?: CanvasRenderingContext2DSettings): Ctx2D {
  const ctx = canvas.getContext('2d', opts) as Ctx2D | null;
  if (!ctx) throw new Error('Could not create a drawing canvas (the device may be low on memory)');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Frees a canvas' backing store early (matters on mobile Safari). */
function release(canvas: AnyCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

async function encodeCanvas(canvas: AnyCanvas, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, quality);
  });
}

/** Target size with the long edge ≤ maxSize (never upscales). */
function fitSize(width: number, height: number, maxSize: number): { width: number; height: number } {
  const scale = Math.min(1, maxSize / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * High-quality downscale: halve repeatedly (each step averages 2×2 blocks, so
 * no aliasing), then one final 'high' quality draw to the exact size. With
 * `background`, the result is composited onto that color (for JPEG output).
 */
function drawScaled(source: CanvasImageSource, sw: number, sh: number, tw: number, th: number, background?: string): AnyCanvas {
  let cur: CanvasImageSource = source;
  let cw = sw;
  let ch = sh;
  let temp: AnyCanvas | null = null;
  while (cw > tw * 2 || ch > th * 2) {
    let nw = Math.max(tw, Math.ceil(cw / 2));
    let nh = Math.max(th, Math.ceil(ch / 2));
    if (nw * nh > MAX_CANVAS_PIXELS) {
      // Huge source: jump straight under the canvas budget.
      const k = Math.sqrt(MAX_CANVAS_PIXELS / (nw * nh));
      nw = Math.max(tw, Math.floor(nw * k));
      nh = Math.max(th, Math.floor(nh * k));
    }
    if (nw === cw && nh === ch) break;
    const next = makeCanvas(nw, nh);
    context(next).drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    if (temp) release(temp);
    temp = next;
    cur = next;
    cw = nw;
    ch = nh;
  }
  const out = makeCanvas(tw, th);
  const ctx = context(out);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, tw, th);
  }
  ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, tw, th);
  if (temp) release(temp);
  return out;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

function isHeic(file: Blob): boolean {
  const name = 'name' in file && typeof file.name === 'string' ? file.name : '';
  return /^image\/hei[cf](-sequence)?$/i.test(file.type) || /\.(heic|heif)$/i.test(name);
}

async function decodeWithImageElement(blob: Blob): Promise<Decoded> {
  if (typeof Image === 'undefined') throw new Error('No image decoder available');
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) {
    URL.revokeObjectURL(url);
    throw new Error('The image has no intrinsic size');
  }
  return { source: img, width, height, close: () => URL.revokeObjectURL(url) };
}

/**
 * Decodes a blob with EXIF orientation applied: createImageBitmap first
 * (fast, off the main thread in most browsers), <img> as the fallback
 * (Safari quirks, SVG). <img> applies EXIF orientation by default.
 */
async function decode(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      if (bmp.width && bmp.height) return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
      bmp.close();
    } catch {
      // fall through to <img>
    }
  }
  return decodeWithImageElement(blob);
}

/** Readable error for a file the browser could not decode. */
function decodeError(file: Blob): Error {
  if (isHeic(file)) return new Error("This browser can't read HEIC photos — export as JPEG or use Safari");
  const mb = file.size / (1024 * 1024);
  if (mb > 40) {
    return new Error(`This image is too large for the browser to open (${mb.toFixed(0)} MB). Export a smaller JPEG and try again.`);
  }
  return new Error("This image couldn't be read — it may be damaged or in an unsupported format. Use JPEG, PNG or WebP.");
}

function checkLooksLikeImage(file: Blob): void {
  if (file.size === 0) throw new Error('The file is empty');
  const t = file.type.toLowerCase();
  if (t && !t.startsWith('image/') && t !== 'application/octet-stream') {
    throw new Error(`This file isn't an image (${t}). Use JPEG, PNG, WebP or HEIC.`);
  }
}

/** Formats that can carry transparency (worth checking the alpha channel). */
function mayHaveAlpha(file: Blob): boolean {
  return !/^image\/(jpe?g|heic|heif|bmp)$/i.test(file.type);
}

function canvasHasAlpha(canvas: AnyCanvas): boolean {
  const ctx = context(canvas, { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let p = 3; p < data.length; p += 4) if (data[p] < 255) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decodes any browser-supported image (JPEG/PNG/WebP/GIF; HEIC where the
 * browser supports it), applies EXIF orientation, downscales with good quality.
 * Throws a readable Error for unsupported files.
 */
export async function importImageFile(
  file: Blob,
  opts: { maxSize?: number; keepAlpha?: boolean } = {},
): Promise<ImportedImage> {
  checkLooksLikeImage(file);
  const maxSize = Math.max(16, Math.round(opts.maxSize ?? WORKING_MAX_SIZE));
  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw decodeError(file);
  }
  try {
    const { width, height } = fitSize(decoded.width, decoded.height, maxSize);
    const wantAlpha = !!opts.keepAlpha && mayHaveAlpha(file);
    let work = drawScaled(decoded.source, decoded.width, decoded.height, width, height, wantAlpha ? undefined : '#ffffff');
    decoded.close();
    let type: 'image/png' | 'image/jpeg' = 'image/jpeg';
    if (wantAlpha) {
      if (canvasHasAlpha(work)) type = 'image/png';
      else {
        // Opaque after all: flatten so the JPEG never picks up black.
        const flat = drawScaled(work, width, height, width, height, '#ffffff');
        release(work);
        work = flat;
      }
    }
    const blob = await encodeCanvas(work, type, type === 'image/jpeg' ? JPEG_QUALITY : undefined);
    const t = fitSize(width, height, THUMB_MAX_SIZE);
    const thumbCanvas = drawScaled(work, width, height, t.width, t.height, '#ffffff');
    const thumb = await encodeCanvas(thumbCanvas, 'image/jpeg', THUMB_QUALITY);
    release(thumbCanvas);
    release(work);
    return { blob, width, height, thumb };
  } catch (err) {
    decoded.close();
    const msg = (err as Error)?.message || String(err);
    throw new Error(`This image couldn't be processed: ${msg}`);
  }
}

/** Decode a blob to pixels at its natural size. */
export async function blobToImageData(blob: Blob): Promise<ImageDataLike> {
  let decoded: Decoded;
  try {
    decoded = await decode(blob);
  } catch {
    throw decodeError(blob);
  }
  try {
    const canvas = makeCanvas(decoded.width, decoded.height);
    const ctx = context(canvas, { willReadFrequently: true });
    ctx.drawImage(decoded.source, 0, 0);
    const img = ctx.getImageData(0, 0, decoded.width, decoded.height);
    release(canvas);
    return img;
  } finally {
    decoded.close();
  }
}

export async function imageDataToBlob(img: ImageDataLike, type: 'image/png' | 'image/jpeg' = 'image/png', quality?: number): Promise<Blob> {
  const canvas = makeCanvas(img.width, img.height);
  const ctx = context(canvas);
  const data = img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  ctx.putImageData(data, 0, 0);
  if (type === 'image/jpeg') {
    // putImageData ignores compositing: flatten onto white so transparency doesn't turn black.
    const flat = drawScaled(canvas, img.width, img.height, img.width, img.height, '#ffffff');
    release(canvas);
    const out = await encodeCanvas(flat, type, quality ?? JPEG_QUALITY);
    release(flat);
    return out;
  }
  const out = await encodeCanvas(canvas, type, quality);
  release(canvas);
  return out;
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
      reader.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

/** Parses base64 and percent-encoded data URLs (no network, works for large payloads). */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('Not a data URL');
  const header = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  const params = header.split(';');
  const type = params[0] || 'text/plain';
  if (params.slice(1).some((p) => p.toLowerCase() === 'base64')) {
    let bin: string;
    try {
      bin = atob(payload.replace(/\s+/g, ''));
    } catch {
      throw new Error('The image data is corrupt (invalid base64)');
    }
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  return new Blob([decodeURIComponent(payload)], { type });
}

async function canvasSourceToAIDataUrl(source: CanvasImageSource, width: number, height: number, maxSize: number): Promise<string> {
  const t = fitSize(width, height, maxSize);
  const canvas = drawScaled(source, width, height, t.width, t.height, '#ffffff');
  const blob = await encodeCanvas(canvas, 'image/jpeg', AI_QUALITY);
  release(canvas);
  return blobToDataUrl(blob);
}

/** JPEG data URL with long edge ≤ maxSize (default 1568, Claude's sweet spot) for AI requests. */
export async function blobToAIDataUrl(blob: Blob, maxSize = 1568): Promise<string> {
  let decoded: Decoded;
  try {
    decoded = await decode(blob);
  } catch {
    throw decodeError(blob);
  }
  try {
    return await canvasSourceToAIDataUrl(decoded.source, decoded.width, decoded.height, maxSize);
  } finally {
    decoded.close();
  }
}

/** Same as blobToAIDataUrl but from a canvas (e.g. the current composite). */
export async function canvasToAIDataUrl(canvas: HTMLCanvasElement | OffscreenCanvas, maxSize = 1568): Promise<string> {
  if (!canvas.width || !canvas.height) throw new Error('The canvas is empty');
  return canvasSourceToAIDataUrl(canvas, canvas.width, canvas.height, maxSize);
}

/** Triggers a browser download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke late: Safari / iOS start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
