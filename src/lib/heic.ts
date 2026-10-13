/**
 * HEIC / HEIF photos (the iPhone's default format). Safari decodes them;
 * Chrome, Edge and Firefox can't — so after decoding failed, Mode checks
 * whether the file is one and says how to get a JPEG instead of a generic
 * "couldn't be read". No DOM beyond a few bytes of the file and the browser's platform.
 */

/** ISO-BMFF brands of HEIC / HEIF still images and sequences (AVIF, which browsers decode, is not one). */
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

/** Error name of a HEIC photo this browser can't open (checked by name: mocks of this module keep working). */
export const HEIC_UNSUPPORTED = 'HeicUnsupportedError';

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** Whether the first bytes are an ISO-BMFF `ftyp` box naming a HEIC / HEIF brand (major or compatible). */
export function isHeicHeader(head: Uint8Array): boolean {
  if (head.length < 12 || ascii(head, 4) !== 'ftyp') return false;
  const size = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
  const end = Math.min(head.length, Math.max(16, size));
  // Major brand at 8, minor version at 12, compatible brands from 16.
  const brands = [ascii(head, 8)];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(head, at));
  if (brands.some((b) => AVIF_BRANDS.has(b))) return false;
  return brands.some((b) => HEIC_BRANDS.has(b));
}

/** By type or extension alone (a .heic picked on Windows often has no MIME type). */
export function isHeicName(file: Blob): boolean {
  const name = 'name' in file && typeof file.name === 'string' ? file.name : '';
  return /^image\/hei[cf](-sequence)?$/i.test(file.type) || /\.(heic|heif|hif)$/i.test(name);
}

/** Type, extension, or the file's own header (a HEIC renamed to .jpg). Never throws. */
export async function looksLikeHeic(file: Blob): Promise<boolean> {
  if (isHeicName(file)) return true;
  try {
    return isHeicHeader(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
  } catch {
    return false;
  }
}

export type UserPlatform = 'mac' | 'windows' | 'other';

/** The computer this browser runs on, for platform-specific steps. */
export function userPlatform(nav: { platform?: string; userAgent?: string; userAgentData?: { platform?: string } } | undefined = globalThis.navigator): UserPlatform {
  const hint = `${nav?.userAgentData?.platform ?? ''} ${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
  if (/Mac|iPhone|iPad/i.test(hint)) return 'mac';
  if (/Win/i.test(hint)) return 'windows';
  return 'other';
}

/** What to do about a HEIC photo this browser can't open: how to get a JPEG on this computer. */
export function heicHelp(platform: UserPlatform = userPlatform()): string {
  const lead = "This browser can't open HEIC photos (the iPhone's usual format), so add a JPEG copy instead.";
  const iphone = 'On the iPhone, Settings → Camera → Formats → Most Compatible takes JPEGs from now on.';
  // Never "open Mode in Safari": projects live in each browser's own storage, so Safari would start empty.
  if (platform === 'mac') return `${lead} Open the photo in Preview and choose File → Export… → Format: JPEG. ${iphone}`;
  if (platform === 'windows') {
    return `${lead} On the iPhone, Settings → Photos → Transfer to Mac or PC → Automatic copies photos to a PC as JPEGs, and Settings → Camera → Formats → Most Compatible takes JPEGs from now on.`;
  }
  return `${lead} On a Mac, open it in Preview and choose File → Export… → JPEG. ${iphone}`;
}

/** The error for a HEIC photo this browser couldn't decode. */
export function heicUnsupportedError(platform?: UserPlatform): Error {
  const err = new Error(heicHelp(platform));
  err.name = HEIC_UNSUPPORTED;
  return err;
}
