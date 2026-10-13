/** The contract between textures.ts and the per-pattern generators. */
import type { NormSpec } from './spec';
import type { FinishOptions, Surface } from './surface';

export interface PatternPlan {
  /** Tile span in inches; must hold whole repeat periods of the pattern. */
  spanX: number;
  spanY: number;
  /**
   * Smallest feature (inches) that should span ≥ ~2 px while generating. When
   * the requested resolution is coarser, the tile is generated supersampled
   * and box-filtered down, so fine detail averages instead of aliasing.
   */
  minFeatureIn: number;
  /** Paints albedo (+ explicit shading) and relief; returns the finish options. */
  render(s: Surface): FinishOptions;
}

export type PatternFactory = (spec: NormSpec) => PatternPlan;
