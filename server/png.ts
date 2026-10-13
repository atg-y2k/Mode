/**
 * Minimal PNG reader/writer for one job: trimming the transparent margins of
 * generated cut-out images so an asset's base sits on the bottom edge (Mode
 * anchors placed objects at their bottom-center) and its aspect is accurate.
 *
 * Supports 8-bit RGBA, non-interlaced PNGs (what image models return for
 * transparent backgrounds). Anything else is passed through unchanged.
 */
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Refuse to decode absurd sizes (memory guard). */
const MAX_PIXELS = 40_000_000;

export interface PngSize {
  width: number;
  height: number;
}

export interface RgbaImage extends PngSize {
  data: Uint8Array;
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 33) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return false;
  return true;
}

// zlib.crc32 only exists from Node 22.2; keep a tiny table-based CRC-32 instead.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

/** Width/height from the IHDR chunk, or null if not a PNG. */
export function readPngSize(bytes: Uint8Array): PngSize | null {
  if (!isPng(bytes)) return null;
  const width = readU32(bytes, 16);
  const height = readU32(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes 8-bit RGBA non-interlaced PNGs; returns null for any other kind. */
export function decodePngRgba(bytes: Uint8Array): RgbaImage | null {
  if (!isPng(bytes)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) return null;
    if (type === 'IHDR') {
      width = readU32(bytes, start);
      height = readU32(bytes, start + 4);
      const bitDepth = bytes[start + 8];
      const colorType = bytes[start + 9];
      const interlace = bytes[start + 12];
      if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) return null;
      if (width === 0 || height === 0 || width * height > MAX_PIXELS) return null;
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(start, end));
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4;
  }
  if (!width || !height || idat.length === 0) return null;

  let raw: Uint8Array;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * 4;
  if (raw.length < height * (stride + 1)) return null;

  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const left = x >= 4 ? data[dst + x - 4] : 0;
      const up = y > 0 ? data[prev + x] : 0;
      const upLeft = y > 0 && x >= 4 ? data[prev + x - 4] : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = v;
          break;
        case 1:
          out = v + left;
          break;
        case 2:
          out = v + up;
          break;
        case 3:
          out = v + ((left + up) >> 1);
          break;
        case 4:
          out = v + paeth(left, up, upLeft);
          break;
        default:
          return null;
      }
      data[dst + x] = out & 0xff;
    }
  }
  return { width, height, data };
}

function chunk(type: string, payload: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + payload.length)), 8 + payload.length);
  return out;
}

/** Encodes RGBA pixels as a PNG (Sub filter on every row, zlib level 6). */
export function encodePngRgba(img: RgbaImage): Uint8Array {
  const { width, height, data } = img;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 1; // Sub
    const src = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? data[src + x - 4] : 0;
      raw[rowStart + 1 + x] = (data[src + x] - left) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export interface TrimResult extends PngSize {
  bytes: Uint8Array;
  trimmed: boolean;
}

/**
 * Crops fully transparent margins (alpha ≤ threshold), keeping `margin`
 * pixels on every side. Returns the original bytes when nothing to trim, the
 * image is empty, or the PNG isn't 8-bit RGBA.
 */
export function trimTransparentPng(bytes: Uint8Array, opts: { alphaThreshold?: number; margin?: number } = {}): TrimResult {
  const size = readPngSize(bytes);
  const passthrough = (): TrimResult => ({ bytes, trimmed: false, width: size?.width ?? 0, height: size?.height ?? 0 });
  const img = decodePngRgba(bytes);
  if (!img) return passthrough();

  const threshold = opts.alphaThreshold ?? 8;
  const margin = opts.margin ?? 2;
  const { width, height, data } = img;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return passthrough(); // fully transparent

  minX = Math.max(0, minX - margin);
  minY = Math.max(0, minY - margin);
  maxX = Math.min(width - 1, maxX + margin);
  maxY = Math.min(height - 1, maxY + margin);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w === width && h === height) return passthrough();

  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((minY + y) * width + minX) * 4;
    out.set(data.subarray(src, src + w * 4), y * w * 4);
  }
  return { bytes: encodePngRgba({ width: w, height: h, data: out }), trimmed: true, width: w, height: h };
}
