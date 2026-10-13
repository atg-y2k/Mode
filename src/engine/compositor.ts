/**
 * Full render pipeline for one design of one photo (browser: uses canvas for
 * drawing placed objects). Order:
 *   original photo
 *   → region treatments in region order (paint via applyPaint, materials via
 *     applyMaterial), skipping design.hiddenRegionIds          [cached layer]
 *   → placed objects (sorted by z, contact shadows, flip/rotate/opacity) and
 *     visible fixture art for lights with showFixture
 *   → applyGrade(design.lighting)
 *   → renderLights(design.lights)
 * Fixture art is drawn before the grade so it darkens at night like the rest
 * of the scene; the glow added afterwards makes the fixtures read as lit.
 */
import type { AssetDef, Design, MaterialDef, Photo } from '../../shared/types';
import type { ImageDataLike, Mask } from './types';

export interface RenderContext {
  photo: Photo;
  design: Design;
  /** Original photo pixels at working resolution (photo.width × photo.height). */
  image: ImageDataLike;
  getMask(maskId: string): Mask | undefined;
  getMaterial(id: string): MaterialDef | undefined;
  getAsset(id: string): AssetDef | undefined;
  /** Bumped whenever a mask's pixels change; part of the treatment-layer cache key. */
  maskVersions?: Record<string, number>;
}

export interface RenderOptions {
  /** Default true. */
  includeObjects?: boolean;
  /** Default true. Grade + light glows. */
  includeLighting?: boolean;
  /** Only render the treatment of this region at full strength and others as-is (used for previews). Optional. */
  soloRegionId?: string;
}

/** Original + all visible region treatments (pure; no canvas). */
export declare function renderTreatmentsLayer(ctx: RenderContext): ImageDataLike;

/**
 * Stateful renderer used by the editor. Caches the treatment layer (keyed by
 * treatments, region list, hidden regions and mask versions) so dragging an
 * object or a lighting slider only redoes the cheap stages.
 */
export declare class DesignRenderer {
  constructor();
  /** Renders at full working resolution into `canvas` (resized to photo size). */
  render(ctx: RenderContext, canvas: HTMLCanvasElement | OffscreenCanvas, opts?: RenderOptions): Promise<void>;
  /** Drop caches (e.g. when switching photos). */
  reset(): void;
}

/** Final render as an image Blob (PNG by default, or JPEG with quality). */
export declare function renderDesignToBlob(
  ctx: RenderContext,
  type?: 'image/png' | 'image/jpeg',
  quality?: number,
): Promise<Blob>;

/** Before / after comparison image with small "Before" / "After" labels. */
export declare function renderBeforeAfterBlob(
  ctx: RenderContext,
  layout: 'side-by-side' | 'stacked',
): Promise<Blob>;
