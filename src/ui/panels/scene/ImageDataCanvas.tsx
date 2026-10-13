/** Draws an ImageDataLike (e.g. a background-removal result) into a canvas that scales to fit. */
import { useEffect, useRef } from 'react';
import type { ImageDataLike } from '../../../engine/types';
import { cn } from '../../common';

export function ImageDataCanvas({ image, label, className }: { image: ImageDataLike; label: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || image.width <= 0 || image.height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const out = ctx.createImageData(image.width, image.height);
    out.data.set(image.data);
    ctx.putImageData(out, 0, 0);
  }, [image]);
  return (
    <canvas
      ref={ref}
      width={Math.max(1, image.width)}
      height={Math.max(1, image.height)}
      role="img"
      aria-label={label}
      className={cn('block h-auto max-h-full w-auto max-w-full', className)}
    />
  );
}

/** Share of pixels that are at least partly opaque (0..1). */
export function opaqueShare(image: ImageDataLike): number {
  const d = image.data;
  const total = image.width * image.height;
  if (!total) return 0;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n / total;
}
