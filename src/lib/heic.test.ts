import { describe, expect, it } from 'vitest';
import { HEIC_UNSUPPORTED, heicHelp, heicUnsupportedError, isHeicHeader, isHeicName, looksLikeHeic, userPlatform } from './heic';

/** An ISO-BMFF `ftyp` box: size, "ftyp", major brand, minor version, compatible brands. */
function ftyp(major: string, compatible: string[]): Uint8Array<ArrayBuffer> {
  const size = 16 + 4 * compatible.length;
  const out = new Uint8Array(size + 8);
  new DataView(out.buffer).setUint32(0, size);
  const put = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  put(4, 'ftyp');
  put(8, major);
  compatible.forEach((b, i) => put(16 + 4 * i, b));
  put(size + 4, 'meta');
  return out;
}

describe('HEIC detection', () => {
  it('reads the brand from the file header', () => {
    expect(isHeicHeader(ftyp('heic', ['mif1', 'heic']))).toBe(true); // iPhone photo
    expect(isHeicHeader(ftyp('mif1', ['heic']))).toBe(true);
    expect(isHeicHeader(ftyp('hevc', ['msf1']))).toBe(true); // burst / sequence
    expect(isHeicHeader(ftyp('avif', ['mif1', 'miaf']))).toBe(false); // AVIF: browsers decode it
    expect(isHeicHeader(ftyp('mif1', ['avif']))).toBe(false);
    expect(isHeicHeader(ftyp('isom', ['mp41']))).toBe(false); // a video
    expect(isHeicHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]))).toBe(false); // JPEG
    expect(isHeicHeader(new Uint8Array(4))).toBe(false);
  });

  it('goes by type or extension, then by the header', async () => {
    expect(isHeicName(new File(['x'], 'IMG_1234.HEIC'))).toBe(true); // no MIME type (Windows)
    expect(isHeicName(new File(['x'], 'photo', { type: 'image/heif' }))).toBe(true);
    expect(isHeicName(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))).toBe(false);
    // A HEIC renamed to .jpg is still found; a real JPEG is not.
    expect(await looksLikeHeic(new File([ftyp('heic', ['mif1'])], 'renamed.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(await looksLikeHeic(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'real.jpg', { type: 'image/jpeg' }))).toBe(false);
    expect(await looksLikeHeic(new Blob([]))).toBe(false);
  });
});

describe('HEIC help', () => {
  it('knows the computer', () => {
    expect(userPlatform({ userAgentData: { platform: 'macOS' } })).toBe('mac');
    expect(userPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe('mac');
    expect(userPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe('windows');
    expect(userPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('other');
    expect(userPlatform(undefined)).toBe('other');
  });

  it('says how to get a JPEG on this computer, in plain words', () => {
    const mac = heicHelp('mac');
    expect(mac).toMatch(/^This browser can't open HEIC photos/);
    expect(mac).toContain('Preview and choose File → Export… → Format: JPEG');
    // Never "open Mode in Safari": projects live in each browser's own storage.
    expect(mac).not.toContain('Safari');
    expect(mac).toContain('Settings → Camera → Formats → Most Compatible');
    const win = heicHelp('windows');
    expect(win).toContain('Transfer to Mac or PC → Automatic');
    expect(win).not.toMatch(/Safari|Preview/); // neither is on a PC
    expect(heicHelp('other')).toContain('Preview');
    expect(heicHelp('other')).not.toContain('Safari');
    const err = heicUnsupportedError('mac');
    expect(err.name).toBe(HEIC_UNSUPPORTED);
    expect(err.message).toBe(mac);
  });
});
