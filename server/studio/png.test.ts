import { describe, expect, it } from 'vitest';
import { decodePngAlpha, describeEditableRegion, editableRegion } from './png';
import { PNG_1PX_B64, encodeRgbaPng } from './testing';

describe('decodePngAlpha', () => {
  it('reads the alpha channel of an RGBA PNG', () => {
    const png = encodeRgbaPng(4, 3, (x, y) => (x + y) * 20);
    const map = decodePngAlpha(png);
    expect(map?.width).toBe(4);
    expect(map?.height).toBe(3);
    expect(Array.from(map!.alpha)).toEqual([0, 20, 40, 60, 20, 40, 60, 80, 40, 60, 80, 100]);
  });

  it.each([1, 2, 3, 4] as const)('undoes row filter %i', (filter) => {
    const alpha = (x: number, y: number) => (x * 31 + y * 17) & 0xff;
    const map = decodePngAlpha(encodeRgbaPng(7, 5, alpha, filter))!;
    const expected = Array.from({ length: 35 }, (_, i) => alpha(i % 7, Math.floor(i / 7)));
    expect(Array.from(map.alpha)).toEqual(expected);
  });

  it('reads an opaque PNG and rejects garbage', () => {
    const map = decodePngAlpha(Buffer.from(PNG_1PX_B64, 'base64'));
    expect(map?.alpha[0]).toBe(255);
    expect(decodePngAlpha(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('editableRegion', () => {
  it('locates the transparent (editable) area', () => {
    // bottom-left quarter transparent
    const map = decodePngAlpha(encodeRgbaPng(12, 12, (x, y) => (x < 6 && y >= 6 ? 0 : 255)))!;
    const region = editableRegion(map)!;
    expect(region.coverage).toBeCloseTo(0.25);
    expect(region.box).toEqual({ x0: 0, y0: 0.5, x1: 0.5, y1: 1 });
    expect(region.areas).toContain('lower left');
    const text = describeEditableRegion(region);
    expect(text).toContain('25%');
    expect(text).toContain('0% to 50% of the width');
  });

  it('returns null when nothing or everything may change', () => {
    expect(editableRegion(decodePngAlpha(encodeRgbaPng(4, 4, () => 255))!)).toBeNull();
    expect(editableRegion(decodePngAlpha(encodeRgbaPng(4, 4, () => 0))!)).toBeNull();
  });
});
