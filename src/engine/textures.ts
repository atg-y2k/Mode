/**
 * Procedural, seamlessly tiling material textures (wood, tile, brick, pavers,
 * gravel, mulch, grass, siding, roofing…). Deterministic for a given spec+seed.
 * Pure pixel generation — no canvas — so it also runs in tests and workers.
 */
import type { TextureSpec } from '../../shared/types';
import type { ImageDataLike } from './types';

/** One full repeat period of a texture. Tiling it edge-to-edge must show no seams. */
export interface TextureTile extends ImageDataLike {
  /** Pixels per real-world inch the tile was generated at. */
  pxPerInch: number;
}

/** Hard cap for a tile side; generators reduce pxPerInch to fit. */
export const MAX_TILE_SIZE = 1024;

/**
 * Generates the tile. The repeat period depends on the pattern (e.g. a running
 * bond brick period is 2 rows; herringbone has its own period); the tile must
 * contain whole periods so it repeats seamlessly. Noise-based patterns (gravel,
 * mulch, grass, concrete, stucco, terrazzo, marble) use periodic noise.
 */
export declare function generateTexture(spec: TextureSpec, pxPerInch: number): TextureTile;

/** Memoized generateTexture (small LRU keyed by spec + pxPerInch). */
export declare function getTexture(spec: TextureSpec, pxPerInch: number): TextureTile;

/**
 * Square swatch for the UI (e.g. 96×96), showing roughly `spanIn` inches of
 * the material (default: about 3 repeat units).
 */
export declare function textureSwatch(spec: TextureSpec, sizePx: number, spanIn?: number): ImageDataLike;
