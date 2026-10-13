/**
 * Photo capture metadata (GPS, compass heading, time) read with exifr (MIT)
 * from the ORIGINAL file — the import pipeline re-encodes photos, which strips
 * EXIF. The location stays on this device (photo.capture).
 *
 * Uses exifr's "lite" build: JPEG + HEIC, with the TIFF/EXIF/GPS tag
 * dictionaries (the "mini" build has no dictionaries, so GPSImgDirection would
 * come back as tag 17). It is imported on demand so it stays out of the main
 * bundle. exifr's own Blob reader needs FileReader (browser only), so the file
 * is read into an ArrayBuffer here — just the head for JPEGs, where EXIF lives.
 *
 * Verified against the bundled exifr 7.1.3 builds (C13; capture.test.ts with
 * an iPhone-structured JPEG, __fixtures__/iphone-gps-heading.jpg):
 * - `parse(file, { pick: [...] })` THROWS in the mini and lite builds (and in
 *   the full build it drops GPSLongitudeRef, flipping western longitudes), so
 *   the whole TIFF/EXIF/GPS block is parsed instead;
 * - `exifr.gps()` returns only latitude/longitude — no heading;
 * - the heading is read as `GPSImgDirection`, or tag 17 (0x0011) should a
 *   build without dictionaries ever be used.
 */
import type { PhotoCapture } from '../../shared/types';

/** JPEG APP1 (EXIF) sits at the start of the file and is at most 64 KB; leave room for APP0/APP2 before it. */
const JPEG_HEAD_BYTES = 256 * 1024;
/** HEIC keeps EXIF in an item that may sit anywhere; don't read absurdly large files. */
const MAX_FULL_READ_BYTES = 64 * 1024 * 1024;

type Kind = 'jpeg' | 'heic' | null;

function sniff(head: Uint8Array): Kind {
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpeg';
  // ISO-BMFF: "....ftyp" + brand (heic, heix, mif1, msf1, hevc, avif…)
  if (head.length >= 12 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'heic';
  return null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** "+02:00" / "-0400" → minutes east of UTC. */
function offsetMinutes(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^\s*([+-])(\d{2}):?(\d{2})\s*$/.exec(v);
  if (!m) return undefined;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -mins : mins;
}

/** Local wall-clock parts of an EXIF date (exifr revives "YYYY:MM:DD hh:mm:ss" as a local-time Date). */
function wallClock(v: unknown): [number, number, number, number, number, number] | undefined {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return [v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds()];
  }
  if (typeof v === 'string') {
    const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/.exec(v.trim());
    if (m) return [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)];
  }
  return undefined;
}

function gpsTimestamp(dateStamp: unknown, timeStamp: unknown): number | undefined {
  if (typeof dateStamp !== 'string') return undefined;
  const d = /^(\d{4})[:-](\d{2})[:-](\d{2})/.exec(dateStamp.trim());
  if (!d) return undefined;
  let hms: number[] | undefined;
  if (Array.isArray(timeStamp) && timeStamp.length >= 2 && timeStamp.every(finite)) hms = timeStamp as number[];
  else if (typeof timeStamp === 'string') hms = timeStamp.split(':').map(Number);
  if (!hms || !hms.every(Number.isFinite)) return undefined;
  return Date.UTC(+d[1], +d[2] - 1, +d[3], hms[0], hms[1] ?? 0, Math.floor(hms[2] ?? 0));
}

/** Plausible capture time: after digital cameras existed, not in the future. */
function plausibleTime(ms: number | undefined): number | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  return ms >= Date.UTC(1990, 0, 1) && ms <= Date.now() + 86_400_000 ? ms : undefined;
}

/**
 * Builds a PhotoCapture from exifr's parsed tags. Pure (tested in node).
 * Time: DateTimeOriginal with its OffsetTimeOriginal (exact) → GPS date/time
 * stamp (UTC) → DateTimeOriginal read as this device's local time.
 * The heading is kept as recorded (true or magnetic north — magnetic
 * declination in the US is within ±20°, below what a sun estimate needs).
 */
export function captureFromTags(tags: Record<string, unknown> | null | undefined): PhotoCapture | undefined {
  if (!tags || typeof tags !== 'object') return undefined;
  const out: PhotoCapture = {};
  const lat = tags.latitude;
  const lon = tags.longitude;
  // (0, 0) is "no fix" written by some apps, not a real photo location.
  if (finite(lat) && finite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) {
    out.lat = Math.round(lat * 1e6) / 1e6;
    out.lon = Math.round(lon * 1e6) / 1e6;
  }
  // GPSImgDirection is GPS tag 0x0011 (17): the key exifr uses when it has no tag dictionary.
  const heading = tags.GPSImgDirection ?? tags[17];
  if (finite(heading) && heading >= 0 && heading <= 360) out.headingDeg = Math.round((heading % 360) * 10) / 10;

  const parts = wallClock(tags.DateTimeOriginal ?? tags.CreateDate);
  const offset = offsetMinutes(tags.OffsetTimeOriginal ?? tags.OffsetTime);
  let takenAt: number | undefined;
  if (parts && offset !== undefined) takenAt = Date.UTC(...parts) - offset * 60_000;
  takenAt ??= gpsTimestamp(tags.GPSDateStamp, tags.GPSTimeStamp);
  if (takenAt === undefined && parts) takenAt = new Date(...parts).getTime();
  const t = plausibleTime(takenAt);
  if (t !== undefined) out.takenAt = t;

  return Object.keys(out).length ? out : undefined;
}

type ExifrParse = (data: ArrayBuffer | Uint8Array, options?: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;
let exifrParse: Promise<ExifrParse> | null = null;

function loadExifr(): Promise<ExifrParse> {
  exifrParse ??= import('exifr/dist/lite.esm.mjs').then((m) => m.parse as unknown as ExifrParse);
  return exifrParse;
}

const EXIFR_OPTIONS = {
  tiff: true,
  exif: true,
  gps: true,
  ifd1: false,
  interop: false,
  xmp: false,
  icc: false,
  iptc: false,
  jfif: false,
  makerNote: false,
  userComment: false,
};

/**
 * Reads GPS, compass heading and capture time from an original photo file
 * (before downscaling strips EXIF). Undefined when the file has none (common
 * after messaging apps strip it) or isn't a JPEG/HEIC. Never throws.
 */
export async function readPhotoCapture(file: Blob): Promise<PhotoCapture | undefined> {
  try {
    const kind = sniff(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if (!kind) return undefined;
    const parse = await loadExifr();
    if (kind === 'jpeg') {
      // EXIF is always near the start of a JPEG; only an unusually large segment
      // before it (cut off mid-way → parse error) needs the whole file.
      try {
        return captureFromTags(await parse(await file.slice(0, JPEG_HEAD_BYTES).arrayBuffer(), EXIFR_OPTIONS));
      } catch {
        if (file.size <= JPEG_HEAD_BYTES) return undefined;
      }
    }
    if (file.size > MAX_FULL_READ_BYTES) return undefined;
    return captureFromTags(await parse(await file.arrayBuffer(), EXIFR_OPTIONS));
  } catch {
    return undefined;
  }
}
