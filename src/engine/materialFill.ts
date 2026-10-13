/**
 * Applies a material texture to a masked region, keeping the photo's shading.
 *
 * Mapping:
 * - 'screen': texture laid flat in image space at `pxPerInch` (photo px per
 *   real inch), rotated by `rotationDeg` — good for walls seen head-on.
 * - 'plane': the region has a perspective quad (Region.plane). A homography
 *   maps each pixel to (u, v) inches on the real surface, so floors, patios and
 *   lawns recede correctly.
 */
import type { MaterialDef, MaterialTreatment, Photo, Quad, Region } from '../../shared/types';
import type { RegionStats } from './recolor';
import type { TextureTile } from './textures';
import type { ImageDataLike, Mask } from './types';

export type TextureMapping =
  | { kind: 'screen'; pxPerInch: number; rotationDeg: number; offsetX?: number; offsetY?: number }
  | { kind: 'plane'; quad: Quad; widthIn: number; heightIn: number; rotationDeg: number };

export interface MaterialOptions {
  tile: TextureTile;
  mapping: TextureMapping;
  /** Multiplied into the texture color. */
  tint?: string;
  /** 0..1 */
  strength: number;
  /** 0..1 — how much of the photo's light/shadow variation to keep (default 0.85). */
  shading?: number;
}

/**
 * Writes the textured surface into `dst` where mask > 0, sampling the tile with
 * bilinear filtering and wrap-around, modulated by the shading of `src`
 * (the ORIGINAL photo) relative to the region's mean lightness.
 */
export declare function applyMaterial(
  src: ImageDataLike,
  dst: ImageDataLike,
  mask: Mask,
  opts: MaterialOptions,
  stats?: RegionStats,
): void;

/**
 * Chooses the mapping for a region:
 * - region.plane present -> 'plane' using its real size if known, else an
 *   estimate (calibration, else assume the quad spans ~12 ft wide);
 * - else 'screen' using calibration px/ft when available, else a heuristic
 *   (a typical surface ~ 12-15 ft across the photo width).
 * The treatment's scale multiplies the material's real unit size; rotation is added.
 */
export declare function mappingForRegion(
  region: Region,
  photo: Pick<Photo, 'width' | 'height' | 'calibration'>,
  treatment: MaterialTreatment,
  material: MaterialDef,
): { mapping: TextureMapping; tilePxPerInch: number };
