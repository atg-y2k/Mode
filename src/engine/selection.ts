/**
 * Color-aware selection tools: magic wand (flood fill by perceptual color
 * distance) and smart brush (a brush that only paints pixels similar to the
 * color under the cursor when the stroke started).
 */
import type { Pt } from '../../shared/types';
import type { BrushOptions } from './mask';
import type { ImageDataLike, Lab, Mask } from './types';

/**
 * Per-pixel Lab cache (3 floats per pixel: L, a, b). Computing it once per photo
 * keeps the wand / smart brush interactive.
 */
export type LabImage = { width: number; height: number; data: Float32Array };
export declare function computeLabImage(img: ImageDataLike): LabImage;

export interface WandOptions {
  /** Max color distance (CIE76 ΔE) from the seed color, typical 4..40. */
  tolerance: number;
  /** true = flood fill from the seed; false = every similar pixel in the photo. */
  contiguous: boolean;
  /** Seed color = average of a (2r+1)² window around the click (default r = 2). */
  sampleRadius?: number;
}

/** Returns a NEW mask (255 selected, 0 not, with 1px anti-aliased edge). */
export declare function magicWand(lab: LabImage, seed: Pt, opts: WandOptions): Mask;

export interface SmartBrushOptions extends BrushOptions {
  /** Max ΔE from the reference color. */
  tolerance: number;
}

/**
 * One smart-brush stamp: like stampBrush but only affects pixels whose color is
 * within tolerance of `reference` (default: the color under (x, y)).
 * Returns the reference used so a drag stroke can keep it constant.
 */
export declare function smartBrushStamp(
  lab: LabImage,
  mask: Mask,
  x: number,
  y: number,
  opts: SmartBrushOptions,
  reference?: Lab,
): Lab;

/** Smart-brush along a segment (spacing ≈ radius/4). */
export declare function smartBrushStroke(
  lab: LabImage,
  mask: Mask,
  from: Pt,
  to: Pt,
  opts: SmartBrushOptions,
  reference: Lab,
): void;
