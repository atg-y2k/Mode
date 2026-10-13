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

/**
 * Decodes any browser-supported image (JPEG/PNG/WebP/GIF; HEIC where the
 * browser supports it), applies EXIF orientation, downscales with good quality.
 * Throws a readable Error for unsupported files.
 */
export declare function importImageFile(
  file: Blob,
  opts?: { maxSize?: number; keepAlpha?: boolean },
): Promise<ImportedImage>;

/** Decode a blob to pixels at its natural size. */
export declare function blobToImageData(blob: Blob): Promise<ImageDataLike>;

export declare function imageDataToBlob(img: ImageDataLike, type?: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob>;

export declare function blobToDataUrl(blob: Blob): Promise<string>;
export declare function dataUrlToBlob(dataUrl: string): Promise<Blob>;

/** JPEG data URL with long edge ≤ maxSize (default 1568, Claude's sweet spot) for AI requests. */
export declare function blobToAIDataUrl(blob: Blob, maxSize?: number): Promise<string>;

/** Same as blobToAIDataUrl but from a canvas (e.g. the current composite). */
export declare function canvasToAIDataUrl(canvas: HTMLCanvasElement | OffscreenCanvas, maxSize?: number): Promise<string>;

/** Triggers a browser download. */
export declare function downloadBlob(blob: Blob, filename: string): void;
