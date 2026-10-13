/**
 * Studio run orchestration (browser):
 *   brief + scene + idea board → POST plan → N × POST render-variation
 *   (in parallel, max 3 at a time) → protect pixels outside the target mask
 *   (scope 'zones') → store variation blobs + Variation records as each arrives.
 * Progress is published through store.setRunProgress; runs can be cancelled.
 */
import type { DesignBrief, Photo, SceneMap } from '../../../shared/types';
import type { Mask } from '../../engine/types';

export interface StartRunOptions {
  photoId: string;
  /** 'variations' = N takes on the brief; 'compare' = one variation per option of one dimension. */
  mode: 'variations' | 'compare';
  compare?: { elementId: string; dimensionId: string; optionIds: string[] };
  /** Start from this variation instead of the original (default: the variation shown in the viewer). */
  baseVariationId?: string | null;
  /** Refine: what to change relative to the base variation ("more like this, but wider path"). */
  feedback?: string;
  /** Override the brief (default: the photo's draft). */
  brief?: DesignBrief;
  /** Override store.studio.variationCount. */
  count?: number;
}

/** Starts a run and resolves with the new generation id as soon as it is created (rendering continues). */
export declare function startRun(opts: StartRunOptions): Promise<string>;

export declare function cancelRun(generationId: string): void;

/**
 * Coverage mask (photo size) of everything the brief may change: target zones
 * + element zones (polygon or refined mask) + element paths (buffered
 * centerline) — grown and feathered for natural blending. Null when the brief
 * has no targets or scope is 'whole'.
 */
export declare function buildTargetMask(photo: Photo, brief: DesignBrief): Mask | null;

/** Compact description of a scene for prompts (summary, architecture, zones with sun, paths, keep-list). */
export declare function sceneSummaryText(scene: SceneMap): string;
