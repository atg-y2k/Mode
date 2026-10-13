/** Small helpers shared by the Studio server modules. */
import { StudioError } from './errors';

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageData64 {
  mime: ImageMime;
  /** Raw base64 payload (no "data:" prefix). */
  base64: string;
}

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Parses a base64 image data URL (already validated by the shared zod schema). */
export function parseImageDataUrl(dataUrl: string): ImageData64 {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) throw new StudioError('bad_request', 'Expected a base64 image data URL (JPEG, PNG or WebP).', 400);
  return { mime: m[1] as ImageMime, base64: m[2] };
}

export function toDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

/** Decoded size in bytes of a base64 payload. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export type SniffedImageMime = ImageMime | 'image/gif' | 'image/avif';

/** Detects the image type from its first bytes; null when it isn't a known raster format. */
export function sniffImageMime(bytes: Uint8Array): SniffedImageMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const decoded = Buffer.from(b64, 'base64');
  const out = new Uint8Array(decoded.length);
  out.set(decoded);
  return out;
}

export function extensionFor(mime: ImageMime): string {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
}

export interface Deadline {
  signal: AbortSignal;
  /** True when the deadline (not the caller) aborted the signal. */
  timedOut(): boolean;
}

/** A signal that aborts when `parent` aborts or after `ms`. */
export function deadline(parent: AbortSignal | undefined, ms: number): Deadline {
  const timer = AbortSignal.timeout(ms);
  return { signal: parent ? AbortSignal.any([parent, timer]) : timer, timedOut: () => timer.aborted };
}

/** Lowercase kebab-case id from any text ("Stone Size!" -> "stone-size"). */
export function slugify(text: string, fallback = 'item'): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/** Normalizes '#abc' / 'ABCDEF' / '#AbCdEf' to '#abcdef'; null when not a hex color. */
export function normalizeHex(value: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return `#${hex.toLowerCase()}`;
}

export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/** Trims to at most `max` characters, preferring to cut at a sentence boundary. */
export function truncateText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return lastStop > max * 0.6 ? cut.slice(0, lastStop + 1) : `${cut.slice(0, max - 1)}…`;
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
