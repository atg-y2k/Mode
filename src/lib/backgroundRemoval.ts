/**
 * Lightweight background removal for user-uploaded asset photos (a plant or
 * fixture shot against a plain wall / sky / product-page white): flood-fills
 * from the image border over colors similar to the border, feathers the edge,
 * then trims fully transparent margins. Pure pixels — no ML.
 */
import type { ImageDataLike } from '../engine/types';

export interface BackgroundRemovalOptions {
  /** ΔE tolerance from sampled border colors (default 18). */
  tolerance?: number;
  /** Edge feather radius in px (default 1.5). */
  feather?: number;
}

/** Returns a NEW image with background alpha = 0. */
export declare function removeBackground(img: ImageDataLike, opts?: BackgroundRemovalOptions): ImageDataLike;

/** Crops away fully transparent rows/columns (keeps a 2px margin). */
export declare function trimTransparent(img: ImageDataLike): ImageDataLike;

/** True if a meaningful share (> 2%) of pixels is already transparent. */
export declare function hasTransparency(img: ImageDataLike): boolean;
