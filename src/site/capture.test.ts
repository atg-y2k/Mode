import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { captureFromTags, readPhotoCapture } from './capture';
import { jpegWithExif } from './exifFixture';

/**
 * An iPhone-structured JPEG (crafted: no real person's photo): big-endian
 * ("MM") TIFF with IFD0 (Make Apple, Model iPhone 15 Pro, Orientation 6), an
 * Exif IFD with a 1.4 KB Apple MakerNote, the full iPhone GPS IFD (altitude,
 * speed, GPSImgDirectionRef T, GPSImgDirection 217.8031°, GPSDestBearing,
 * GPSHPositioningError…), an IFD1 thumbnail, then a real baseline JPEG image.
 */
const IPHONE_JPEG = readFileSync(new URL('./__fixtures__/iphone-gps-heading.jpg', import.meta.url));

const jpeg = (fx: Parameters<typeof jpegWithExif>[0]) => new Blob([jpegWithExif(fx) as BlobPart], { type: 'image/jpeg' });

describe('readPhotoCapture (exifr lite)', () => {
  it('reads GPS, GPSImgDirection and DateTimeOriginal with its offset', async () => {
    const cap = await readPhotoCapture(
      jpeg({ lat: 38.9968, lon: -77.1352, heading: 200.5, dateTimeOriginal: '2024:06:15 10:30:00', offsetTimeOriginal: '-04:00' }),
    );
    expect(cap?.lat).toBeCloseTo(38.9968, 4);
    expect(cap?.lon).toBeCloseTo(-77.1352, 4);
    expect(cap?.headingDeg).toBe(200.5);
    // 10:30 at UTC−4 = 14:30 UTC.
    expect(cap?.takenAt).toBe(Date.UTC(2024, 5, 15, 14, 30, 0));
  });

  it('handles southern / eastern hemispheres and magnetic headings', async () => {
    const cap = await readPhotoCapture(jpeg({ lat: -33.5, lon: 151.25, heading: 10, headingRef: 'M' }));
    expect(cap).toEqual({ lat: -33.5, lon: 151.25, headingDeg: 10 });
  });

  it('reads a time without an offset as local time', async () => {
    const cap = await readPhotoCapture(jpeg({ dateTimeOriginal: '2023:12:01 18:05:09' }));
    expect(cap).toEqual({ takenAt: new Date(2023, 11, 1, 18, 5, 9).getTime() });
  });

  it('returns undefined without EXIF, for other formats and for garbage', async () => {
    expect(await readPhotoCapture(jpeg({}))).toBeUndefined();
    expect(await readPhotoCapture(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]))).toBeUndefined();
    expect(await readPhotoCapture(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00])]))).toBeUndefined();
    expect(await readPhotoCapture(new Blob([]))).toBeUndefined();
  });
});

describe('C13: exifr build and a phone JPEG with GPSImgDirection', () => {
  it('reads GPS, the compass heading and the capture time from an iPhone-style JPEG', async () => {
    const cap = await readPhotoCapture(new Blob([IPHONE_JPEG], { type: 'image/jpeg' }));
    expect(cap).toEqual({ lat: 38.9968, lon: -77.1352, headingDeg: 217.8, takenAt: Date.UTC(2024, 5, 15, 14, 30, 0) });
  });

  it('reads only the head of a large photo (EXIF sits at the start)', async () => {
    const big = new Blob([IPHONE_JPEG, new Uint8Array(3_000_000)], { type: 'image/jpeg' });
    expect((await readPhotoCapture(big))?.headingDeg).toBe(217.8);
  });

  it('documents why the whole block is parsed: `pick` throws in the lite build, gps() has no heading', async () => {
    const lite = await import('exifr/dist/lite.esm.mjs');
    await expect(lite.parse(IPHONE_JPEG, { pick: ['GPSImgDirection'] })).rejects.toThrow();
    expect(await lite.gps(IPHONE_JPEG)).not.toHaveProperty('GPSImgDirection');
    const mini = await import('exifr/dist/mini.esm.mjs' as string);
    await expect(mini.parse(IPHONE_JPEG, { pick: ['GPSImgDirection'] })).rejects.toThrow();
    // Without dictionaries the heading comes back as tag 17, which captureFromTags also reads.
    const raw = await mini.parse(IPHONE_JPEG, { tiff: true, exif: true, gps: true, ifd1: false, makerNote: false });
    expect(raw[17]).toBeCloseTo(217.8031, 4);
    expect(captureFromTags(raw)?.headingDeg).toBe(217.8);
  });
});

describe('captureFromTags', () => {
  it('drops (0, 0) "no fix" coordinates and out-of-range values', () => {
    expect(captureFromTags({ latitude: 0, longitude: 0 })).toBeUndefined();
    expect(captureFromTags({ latitude: 95, longitude: 10 })).toBeUndefined();
    expect(captureFromTags({ GPSImgDirection: 400 })).toBeUndefined();
    expect(captureFromTags({ GPSImgDirection: 360 })).toEqual({ headingDeg: 0 });
  });

  it('falls back to the GPS UTC time stamp when there is no offset', () => {
    const cap = captureFromTags({ DateTimeOriginal: '2024:06:15 10:30:00', GPSDateStamp: '2024:06:15', GPSTimeStamp: [14, 30, 5] });
    expect(cap?.takenAt).toBe(Date.UTC(2024, 5, 15, 14, 30, 5));
  });

  it('ignores implausible dates', () => {
    expect(captureFromTags({ DateTimeOriginal: '1970:01:01 00:00:00', OffsetTimeOriginal: '+00:00' })).toBeUndefined();
    expect(captureFromTags({ DateTimeOriginal: '0000:00:00 00:00:00' })).toBeUndefined();
    expect(captureFromTags(null)).toBeUndefined();
  });
});
