/** The contract between textures.ts and the per-pattern generators. */
import type { NormSpec } from './spec';
import type { FinishOptions, Surface } from './surface';

export interface PatternPlan {
  /** Tile span in inches; must hold whole repeat periods of the pattern. */
  spanX: number;
  spanY: number;
  /**
   * Feature size (inches) that should span ≥ ~2 px while generating — about
   * a third of the pattern's element (board, brick, pebble). When the
   * requested resolution is coarser, the tile is generated supersampled and
   * box-filtered down, so small elements average instead of aliasing. Joints
   * and edges are anti-aliased analytically and don't need this.
   */
  minFeatureIn: number;
  /** Paints albedo (+ explicit shading) and relief; returns the finish options. */
  render(s: Surface): FinishOptions;
}

export type PatternFactory = (spec: NormSpec) => PatternPlan;
