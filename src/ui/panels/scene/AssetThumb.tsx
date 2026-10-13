/**
 * Asset thumbnails on a checkerboard (so transparency reads as transparency).
 * Vector assets resolve synchronously through assetSvgDataUrl; raster assets
 * (uploads, AI photos) load their object URL from assetImages. Both are
 * memoized per asset object, which the store replaces on every edit.
 */
import { useEffect, useState } from 'react';
import { Leaf, Lightbulb, Shapes } from 'lucide-react';
import type { AssetDef } from '../../../../shared/types';
import { assetSvgDataUrl, getAssetImageUrl } from '../../../engine/assetImages';
import { cn, Spinner } from '../../common';

const vectorCache = new WeakMap<AssetDef, Map<string, string | null>>();
const rasterCache = new WeakMap<AssetDef, string | null>();

/** Cached data URL of a vector asset (null for rasters or when the art can't render). */
export function vectorThumbUrl(asset: AssetDef, tint?: string): string | null {
  if (!asset.art && !asset.svg) return null;
  let byTint = vectorCache.get(asset);
  if (!byTint) {
    byTint = new Map();
    vectorCache.set(asset, byTint);
  }
  const key = tint ?? '';
  const hit = byTint.get(key);
  if (hit !== undefined) return hit;
  let url: string | null = null;
  try {
    url = assetSvgDataUrl(asset, tint);
  } catch {
    url = null;
  }
  byTint.set(key, url);
  return url;
}

export type ThumbState = { status: 'ready'; url: string } | { status: 'loading' } | { status: 'missing' };

export function useAssetThumb(asset: AssetDef | undefined, tint?: string): ThumbState {
  const vector = asset ? vectorThumbUrl(asset, tint) : null;
  const raster = !!asset && !vector && !!asset.imageId;
  const [loaded, setLoaded] = useState<{ asset: AssetDef; url: string | null } | null>(null);

  useEffect(() => {
    if (!raster || !asset || rasterCache.has(asset)) return;
    let alive = true;
    getAssetImageUrl(asset)
      .then((url) => {
        rasterCache.set(asset, url);
        if (alive) setLoaded({ asset, url });
      })
      .catch(() => {
        rasterCache.set(asset, null);
        if (alive) setLoaded({ asset, url: null });
      });
    return () => {
      alive = false;
    };
  }, [asset, raster]);

  if (!asset) return { status: 'missing' };
  if (vector) return { status: 'ready', url: vector };
  if (!raster) return { status: 'missing' };
  const url = rasterCache.has(asset) ? rasterCache.get(asset) : loaded?.asset === asset ? loaded.url : undefined;
  if (url === undefined) return { status: 'loading' };
  return url ? { status: 'ready', url } : { status: 'missing' };
}

function FallbackIcon({ asset }: { asset: AssetDef | undefined }) {
  const Icon = asset?.category === 'plant' ? Leaf : asset?.category === 'lighting' ? Lightbulb : Shapes;
  return <Icon className="size-5 text-subtle" aria-hidden />;
}

export function AssetThumb({
  asset,
  tint,
  className,
  padded = true,
}: {
  asset: AssetDef | undefined;
  tint?: string;
  className?: string;
  /** Inner padding so art doesn't touch the frame (off for tiny thumbs). */
  padded?: boolean;
}) {
  const thumb = useAssetThumb(asset, tint);
  return (
    <div className={cn('bg-checker relative flex items-center justify-center overflow-hidden rounded-lg bg-surface-2', className)}>
      {thumb.status === 'ready' ? (
        <img
          src={thumb.url}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className={cn('size-full object-contain', padded && 'p-1.5')}
        />
      ) : thumb.status === 'loading' ? (
        <Spinner />
      ) : (
        <FallbackIcon asset={asset} />
      )}
    </div>
  );
}
