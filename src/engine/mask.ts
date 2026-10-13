/**
 * Coverage masks (0..255 per pixel) and the drawing operations used by the
 * editor's brush / eraser / polygon / lasso tools, plus compact RLE storage.
 */
import type { Pt } from '../../shared/types';
import type { ImageDataLike, Mask } from './types';

export type MaskMode = 'add' | 'erase';

export interface BrushOptions {
  /** Radius in pixels. */
  radius: number;
  /** 0..1 — 1 = hard edge, 0 = soft falloff from center. */
  hardness: number;
  mode: MaskMode;
  /** 0..1, default 1. Max coverage a single stamp adds/removes. */
  opacity?: number;
}

export declare function createMask(width: number, height: number): Mask;
export declare function cloneMask(m: Mask): Mask;
/** Copy src bytes into dst (same size). */
export declare function copyMaskInto(dst: Mask, src: Mask): void;
/** Covered area in pixels: sum(data) / 255. */
export declare function maskCoverage(m: Mask): number;
export declare function isMaskEmpty(m: Mask): boolean;
/** Bounding box of pixels > 0, or null when empty. */
export declare function maskBounds(m: Mask): { x: number; y: number; w: number; h: number } | null;
export declare function stampBrush(m: Mask, x: number, y: number, opts: BrushOptions): void;
/** Stamps along the segment with spacing ≈ radius/4 (excluding the `from` point). */
export declare function strokeBrush(m: Mask, from: Pt, to: Pt, opts: BrushOptions): void;
/** Fills a closed polygon (even-odd). Anti-aliased edges when `antialias` (default true). */
export declare function fillPolygon(m: Mask, points: Pt[], mode: MaskMode, antialias?: boolean): void;
export declare function invertMask(m: Mask): void;
export declare function clearMask(m: Mask): void;
export declare function fillMask(m: Mask): void;
/** Softens edges with a blur of `radius` px (in place). */
export declare function featherMask(m: Mask, radius: number): void;
/** Grows (dilate) the covered area by `radius` px (in place). */
export declare function growMask(m: Mask, radius: number): void;
/** Shrinks (erode) the covered area by `radius` px (in place). */
export declare function shrinkMask(m: Mask, radius: number): void;
/** target = target ∪/−/∩ other (same size). */
export declare function combineMasks(target: Mask, other: Mask, op: 'union' | 'subtract' | 'intersect'): void;
/** Compact run-length encoding (lossless). */
export declare function encodeMaskRLE(m: Mask): Uint8Array;
export declare function decodeMaskRLE(bytes: Uint8Array, width: number, height: number): Mask;
/** Nearest-neighbour resize (used when photos are re-imported at a different size). */
export declare function resizeMask(m: Mask, width: number, height: number): Mask;
/**
 * RGBA overlay for display: `hex` at `alpha` × coverage inside, transparent outside.
 * Writes into `out` when given (must be same size) to avoid allocations.
 */
export declare function maskToOverlay(m: Mask, hex: string, alpha: number, out?: ImageDataLike): ImageDataLike;
/** RGBA image with opaque `hex` pixels on the mask boundary (1-2 px), transparent elsewhere. */
export declare function maskOutline(m: Mask, hex: string): ImageDataLike;
