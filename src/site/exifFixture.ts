/**
 * Test helper: builds a minimal JPEG whose APP1 segment carries EXIF + GPS
 * tags (little-endian TIFF), so capture parsing can be tested without binary
 * fixture files. Only used by tests.
 */
export interface ExifFixture {
  /** Decimal degrees (negative = S). */
  lat?: number;
  /** Decimal degrees (negative = W). */
  lon?: number;
  /** GPSImgDirection in degrees. */
  heading?: number;
  headingRef?: 'T' | 'M';
  /** "YYYY:MM:DD HH:MM:SS" */
  dateTimeOriginal?: string;
  /** "+02:00" */
  offsetTimeOriginal?: string;
}

type Entry = { tag: number; type: 2 | 4 | 5; count: number; data: Uint8Array | number };

const ascii = (s: string) => new TextEncoder().encode(`${s}\0`);

function rationals(values: [number, number][]): Uint8Array {
  const out = new Uint8Array(values.length * 8);
  const dv = new DataView(out.buffer);
  values.forEach(([n, d], i) => {
    dv.setUint32(i * 8, n, true);
    dv.setUint32(i * 8 + 4, d, true);
  });
  return out;
}

function dms(deg: number): [number, number][] {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const mFloat = (a - d) * 60;
  const m = Math.floor(mFloat);
  const s = Math.round((mFloat - m) * 60 * 10000);
  return [
    [d, 1],
    [m, 1],
    [s, 10000],
  ];
}

/** Serializes one IFD at `offset`; values that don't fit in 4 bytes go right after it. Returns the bytes. */
function ifd(entries: Entry[], offset: number): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const headerSize = 2 + sorted.length * 12 + 4;
  const extra: Uint8Array[] = [];
  let extraOffset = offset + headerSize;
  const head = new Uint8Array(headerSize);
  const dv = new DataView(head.buffer);
  dv.setUint16(0, sorted.length, true);
  sorted.forEach((e, i) => {
    const p = 2 + i * 12;
    dv.setUint16(p, e.tag, true);
    dv.setUint16(p + 2, e.type, true);
    dv.setUint32(p + 4, e.count, true);
    if (typeof e.data === 'number') dv.setUint32(p + 8, e.data, true);
    else if (e.data.length <= 4) head.set(e.data, p + 8);
    else {
      dv.setUint32(p + 8, extraOffset, true);
      extra.push(e.data);
      extraOffset += e.data.length + (e.data.length % 2);
      if (e.data.length % 2) extra.push(new Uint8Array(1));
    }
  });
  dv.setUint32(headerSize - 4, 0, true);
  return concat([head, ...extra]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function tiff(fx: ExifFixture): Uint8Array {
  const exifEntries: Entry[] = [];
  if (fx.dateTimeOriginal) exifEntries.push({ tag: 0x9003, type: 2, count: 20, data: ascii(fx.dateTimeOriginal) });
  if (fx.offsetTimeOriginal) exifEntries.push({ tag: 0x9011, type: 2, count: 7, data: ascii(fx.offsetTimeOriginal) });
  const gpsEntries: Entry[] = [];
  if (fx.lat !== undefined) {
    gpsEntries.push({ tag: 0x0001, type: 2, count: 2, data: ascii(fx.lat >= 0 ? 'N' : 'S') });
    gpsEntries.push({ tag: 0x0002, type: 5, count: 3, data: rationals(dms(fx.lat)) });
  }
  if (fx.lon !== undefined) {
    gpsEntries.push({ tag: 0x0003, type: 2, count: 2, data: ascii(fx.lon >= 0 ? 'E' : 'W') });
    gpsEntries.push({ tag: 0x0004, type: 5, count: 3, data: rationals(dms(fx.lon)) });
  }
  if (fx.heading !== undefined) {
    gpsEntries.push({ tag: 0x0010, type: 2, count: 2, data: ascii(fx.headingRef ?? 'T') });
    gpsEntries.push({ tag: 0x0011, type: 5, count: 1, data: rationals([[Math.round(fx.heading * 100), 100]]) });
  }
  // Layout: header (8) | IFD0 | Exif IFD | GPS IFD
  const ifd0Entries = (exifOff: number, gpsOff: number): Entry[] => [
    ...(exifEntries.length ? [{ tag: 0x8769, type: 4 as const, count: 1, data: exifOff }] : []),
    ...(gpsEntries.length ? [{ tag: 0x8825, type: 4 as const, count: 1, data: gpsOff }] : []),
    { tag: 0x0112, type: 4 as const, count: 1, data: 1 }, // Orientation (keeps IFD0 non-empty)
  ];
  const ifd0Size = ifd(ifd0Entries(0, 0), 8).length;
  const exifOff = 8 + ifd0Size;
  const exifBytes = exifEntries.length ? ifd(exifEntries, exifOff) : new Uint8Array(0);
  const gpsOff = exifOff + exifBytes.length;
  const gpsBytes = gpsEntries.length ? ifd(gpsEntries, gpsOff) : new Uint8Array(0);
  const header = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]);
  return concat([header, ifd(ifd0Entries(exifOff, gpsOff), 8), exifBytes, gpsBytes]);
}

/** A tiny JPEG (SOI, APP1 Exif, EOI) carrying the given tags. */
export function jpegWithExif(fx: ExifFixture): Uint8Array {
  const body = concat([new TextEncoder().encode('Exif\0\0'), tiff(fx)]);
  const len = body.length + 2;
  return concat([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff]), body, new Uint8Array([0xff, 0xd9])]);
}
