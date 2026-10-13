/**
 * Photo-realistic repainting of a masked surface.
 *
 * The original photo supplies shading (light falloff, shadows, texture); the
 * paint supplies hue/chroma and base lightness. A uniform region painted with
 * a color must come out as (very nearly) that color; darker pixels stay darker,
 * highlights stay highlights. Finish controls how much specular highlight is
 * kept (flat ≈ none, gloss ≈ most).
 */
import type { PaintFinish } from '../../shared/types';
import type { ImageDataLike, Mask } from './types';

export interface RegionStats {
  /** Number of pixels with mask > 0, weighted by coverage (sum(mask)/255). */
  count: number;
  meanL: number;
  meanA: number;
  meanB: number;
  /** 10th / 90th percentile of L inside the region. */
  p10L: number;
  p90L: number;
}

export interface PaintOptions {
  hex: string;
  finish: PaintFinish;
  /** 0..1 */
  strength: number;
}

/** Lab statistics of `src` inside `mask`. Empty mask -> count 0 and neutral values. */
export declare function computeRegionStats(src: ImageDataLike, mask: Mask): RegionStats;

/**
 * Paints `mask` area. Reads shading from `src` (the ORIGINAL photo) and writes
 * into `dst` (the composite so far, same size), blending by mask coverage × strength.
 * Pixels where mask = 0 are untouched. `stats` may be passed to skip recomputation.
 */
export declare function applyPaint(
  src: ImageDataLike,
  dst: ImageDataLike,
  mask: Mask,
  opts: PaintOptions,
  stats?: RegionStats,
): void;
