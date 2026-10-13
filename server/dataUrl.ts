/** Helpers for the base64 image data URLs exchanged with the web app. */

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageData64 {
  mime: ImageMime;
  /** Raw base64 payload (no "data:" prefix). */
  base64: string;
}

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Parses a data URL already validated by the shared zod schema. Throws on anything else. */
export function parseImageDataUrl(dataUrl: string): ImageData64 {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) throw new Error('Expected a base64 image data URL');
  return { mime: m[1] as ImageMime, base64: m[2] };
}

/** Decoded size in bytes of a base64 payload. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function toDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

/** Detects PNG / JPEG / WebP from the first bytes; null if unknown. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'image/webp';
  }
  return null;
}

export function extensionFor(mime: ImageMime): string {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
}
