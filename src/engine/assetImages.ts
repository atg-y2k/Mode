/**
 * Turns AssetDefs into drawable images (browser). Sources, in priority order:
 * asset.art (procedural, via renderArt) → asset.svg (AI vector) → asset.imageId
 * (raster in the blob store). Results are cached per asset id + tint.
 */
import type { AssetDef } from '../../shared/types';

/** SVG markup for vector assets (art or svg), optionally recolored by `tint`; null for raster assets. */
export declare function assetSvgMarkup(asset: AssetDef, tint?: string): string | null;

/** data: URL of the SVG for vector assets (sync, for <img> thumbnails); null for raster assets. */
export declare function assetSvgDataUrl(asset: AssetDef, tint?: string): string | null;

/** URL usable in <img src> for any asset (object URL for rasters). Cached. */
export declare function getAssetImageUrl(asset: AssetDef): Promise<string | null>;

/** Decoded image ready for ctx.drawImage. Cached. Rejects if the asset has no visual. */
export declare function getAssetImage(asset: AssetDef, tint?: string): Promise<CanvasImageSource>;

/** Cached image if already decoded, else undefined (and starts loading). */
export declare function peekAssetImage(asset: AssetDef, tint?: string): CanvasImageSource | undefined;

/** Forget cached images for an asset (after it is edited or deleted). */
export declare function evictAssetImage(assetId: string): void;
