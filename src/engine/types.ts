/**
 * Pixel-level types for the rendering engine. Everything in src/engine works on
 * these plain structures so it runs (and is unit-tested) without a DOM.
 * A browser ImageData satisfies ImageDataLike.
 */

export interface ImageDataLike {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8ClampedArray;
}

/** Coverage mask, 0 = outside, 255 = fully inside. Same size as the photo. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RGB {
  r: number; // 0..255
  g: number;
  b: number;
}

/** CIE L*a*b* (D65). L 0..100. */
export interface Lab {
  l: number;
  a: number;
  b: number;
}

export function createImageDataLike(width: number, height: number, fill?: RGB): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill?.r ?? 0;
    data[i + 1] = fill?.g ?? 0;
    data[i + 2] = fill?.b ?? 0;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

export function cloneImageData(img: ImageDataLike): ImageDataLike {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}
