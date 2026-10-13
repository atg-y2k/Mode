/**
 * Minimal PNG reader for edit masks (OpenAI convention: opaque = keep,
 * transparent = may change). Only what the Studio needs: decode the alpha
 * channel of 8-bit non-interlaced PNGs (RGBA, gray+alpha, RGB/gray/palette
 * with tRNS) and describe the editable region in words for providers without
 * mask support (Gemini).
 */
import { inflateSync } from 'node:zlib';

export interface AlphaMap {
  width: number;
  height: number;
  /** One byte per pixel, 0 = transparent. */
  alpha: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Refuse absurd sizes (a mask is at most a few megapixels). */
const MAX_PIXELS = 40_000_000;

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes the alpha channel of a PNG; null for unsupported or corrupt files. */
export function decodePngAlpha(png: Uint8Array): AlphaMap | null {
  try {
    if (png.length < 33 || SIGNATURE.some((b, i) => png[i] !== b)) return null;
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = -1;
    let interlace = 0;
    let trns: Uint8Array | null = null;
    const idat: Uint8Array[] = [];

    while (offset + 8 <= png.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
      const data = png.subarray(offset + 8, offset + 8 + length);
      if (type === 'IHDR') {
        width = view.getUint32(offset + 8);
        height = view.getUint32(offset + 12);
        bitDepth = png[offset + 16];
        colorType = png[offset + 17];
        interlace = png[offset + 20];
      } else if (type === 'tRNS') {
        trns = data;
      } else if (type === 'IDAT') {
        idat.push(data);
      } else if (type === 'IEND') {
        break;
      }
      offset += 12 + length;
    }

    if (!width || !height || width * height > MAX_PIXELS || bitDepth !== 8 || interlace !== 0) return null;
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType as 0 | 2 | 3 | 4 | 6];
    if (!channels) return null;

    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    if (raw.length < height * (stride + 1)) return null;

    const alpha = new Uint8Array(width * height);
    let prev = new Uint8Array(stride);
    let line = new Uint8Array(stride);
    for (let y = 0; y < height; y++) {
      const base = y * (stride + 1);
      const filter = raw[base];
      for (let x = 0; x < stride; x++) {
        const v = raw[base + 1 + x];
        const left = x >= channels ? line[x - channels] : 0;
        const up = prev[x];
        const upLeft = x >= channels ? prev[x - channels] : 0;
        let out: number;
        switch (filter) {
          case 0: out = v; break;
          case 1: out = v + left; break;
          case 2: out = v + up; break;
          case 3: out = v + ((left + up) >> 1); break;
          case 4: out = v + paeth(left, up, upLeft); break;
          default: return null;
        }
        line[x] = out & 0xff;
      }
      for (let x = 0; x < width; x++) {
        const p = x * channels;
        let a = 255;
        if (colorType === 6) a = line[p + 3];
        else if (colorType === 4) a = line[p + 1];
        else if (colorType === 3 && trns) a = line[p] < trns.length ? trns[line[p]] : 255;
        else if (colorType === 0 && trns && trns.length >= 2) a = line[p] === trns[1] ? 0 : 255;
        else if (colorType === 2 && trns && trns.length >= 6) {
          a = line[p] === trns[1] && line[p + 1] === trns[3] && line[p + 2] === trns[5] ? 0 : 255;
        }
        alpha[y * width + x] = a;
      }
      [prev, line] = [line, prev];
    }
    return { width, height, alpha };
  } catch {
    return null;
  }
}

export interface EditableRegion {
  /** Share of the image that may change, 0..1. */
  coverage: number;
  /** Bounding box of the editable pixels, normalized 0..1. */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Names of the 3×3 grid cells with meaningful editable area ("lower left"…). */
  areas: string[];
}

const ROWS = ['upper', 'middle', 'lower'];
const COLS = ['left', 'center', 'right'];

/** Editable (transparent) region of a mask; null when nothing (or everything) is editable. */
export function editableRegion(mask: AlphaMap, threshold = 128): EditableRegion | null {
  const { width, height, alpha } = mask;
  let count = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  const cells = new Array<number>(9).fill(0);
  for (let y = 0; y < height; y++) {
    const row = Math.min(2, Math.floor((y * 3) / height));
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] >= threshold) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      cells[row * 3 + Math.min(2, Math.floor((x * 3) / width))]++;
    }
  }
  const total = width * height;
  if (count === 0 || count >= total * 0.98) return null;
  const cellArea = total / 9;
  const areas: string[] = [];
  cells.forEach((n, i) => {
    if (n >= cellArea * 0.08) {
      const r = ROWS[Math.floor(i / 3)];
      const c = COLS[i % 3];
      areas.push(r === 'middle' && c === 'center' ? 'center' : `${r} ${c}`);
    }
  });
  return {
    coverage: count / total,
    box: { x0: x0 / width, y0: y0 / height, x1: (x1 + 1) / width, y1: (y1 + 1) / height },
    areas,
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** One or two sentences locating the editable region, for prompts. */
export function describeEditableRegion(region: EditableRegion): string {
  const { box, coverage, areas } = region;
  const where = areas.length ? ` (the ${areas.join(', ')} part${areas.length > 1 ? 's' : ''} of the frame)` : '';
  return (
    `The area you may change covers about ${pct(coverage)} of the photo, within the box from ${pct(box.x0)} to ${pct(box.x1)} ` +
    `of the width (left to right) and ${pct(box.y0)} to ${pct(box.y1)} of the height (top to bottom)${where}. ` +
    'Everything outside that area must stay exactly as it is in the photo.'
  );
}
