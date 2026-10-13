import { describe, expect, it } from 'vitest';
import { decodePngRgba, encodePngRgba, readPngSize, trimTransparentPng } from './png';
import { boxPng } from './testing';

describe('png', () => {
  it('round-trips RGBA pixels', () => {
    const width = 7;
    const height = 5;
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 37 + 11) & 0xff;
    const decoded = decodePngRgba(encodePngRgba({ width, height, data }));
    expect(decoded).not.toBeNull();
    expect(decoded?.width).toBe(width);
    expect(decoded?.height).toBe(height);
    expect(Array.from(decoded!.data)).toEqual(Array.from(data));
  });

  it('reads the size from IHDR', () => {
    expect(readPngSize(boxPng(30, 20, { x0: 0, y0: 0, x1: 1, y1: 1 }))).toEqual({ width: 30, height: 20 });
    expect(readPngSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('trims transparent margins, keeping a small margin', () => {
    const png = boxPng(100, 80, { x0: 20, y0: 10, x1: 60, y1: 70 });
    const r = trimTransparentPng(png, { margin: 2 });
    expect(r.trimmed).toBe(true);
    expect(r.width).toBe(44);
    expect(r.height).toBe(64);
    const decoded = decodePngRgba(r.bytes)!;
    // Opaque box starts 2px in from the new edges.
    expect(decoded.data[(2 * decoded.width + 2) * 4 + 3]).toBe(255);
    expect(decoded.data[(1 * decoded.width + 1) * 4 + 3]).toBe(0);
  });

  it('passes through images with nothing to trim or nothing visible', () => {
    const full = boxPng(10, 10, { x0: 0, y0: 0, x1: 10, y1: 10 });
    expect(trimTransparentPng(full)).toMatchObject({ trimmed: false, width: 10, height: 10 });
    const empty = boxPng(10, 10, { x0: 0, y0: 0, x1: 0, y1: 0 });
    expect(trimTransparentPng(empty)).toMatchObject({ trimmed: false, width: 10, height: 10 });
  });

  it('ignores non-PNG input', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(decodePngRgba(jpeg)).toBeNull();
    expect(trimTransparentPng(jpeg)).toMatchObject({ trimmed: false, bytes: jpeg });
  });
});
