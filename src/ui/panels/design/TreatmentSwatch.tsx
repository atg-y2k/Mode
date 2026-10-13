/**
 * Visual of what is applied to a surface: a paint chip, a material texture
 * thumbnail, or a dashed "untouched" tile.
 */
import { ImageOff } from 'lucide-react';
import type { MaterialDef, Treatment } from '../../../../shared/types';
import { getMaterial } from '../../../assets/catalog';
import { cn } from '../../common';
import { displayHex, paintDisplayName } from './paint';
import { paletteGradient, useMaterialSwatch } from './textureSwatch';

/** Texture thumbnail of a material (palette gradient while it renders). */
export function MaterialThumb({ material, className, rounded = 'rounded-lg' }: { material: MaterialDef | undefined; className?: string; rounded?: string }) {
  const swatch = useMaterialSwatch(material);
  const base = cn('relative block shrink-0 overflow-hidden border border-black/10', rounded, className);
  if (swatch.status === 'ready') {
    return <img src={swatch.url} alt="" draggable={false} className={cn(base, 'object-cover')} />;
  }
  return (
    <span aria-hidden className={cn(base, swatch.status === 'loading' && 'animate-pulse')} style={{ background: paletteGradient(material?.texture) }}>
      {!material && <ImageOff className="absolute inset-0 m-auto size-1/2 text-white/80" />}
    </span>
  );
}

/** Short label for a treatment ("Alabaster Mist", "Wide oak planks", "Untouched"). */
export function treatmentLabel(t: Treatment | undefined): string {
  if (!t) return 'Untouched';
  if (t.type === 'paint') return `${paintDisplayName(t)} · ${displayHex(t.hex)}`;
  return getMaterial(t.materialId)?.name ?? 'Material (missing from catalog)';
}

/** Small square visual of a treatment. */
export function TreatmentSwatch({ treatment, hidden, className = 'size-8' }: { treatment: Treatment | undefined; hidden?: boolean; className?: string }) {
  if (!treatment) {
    return <span aria-hidden className={cn('block shrink-0 rounded-lg border border-dashed border-line-strong bg-surface-2', className)} />;
  }
  const dim = hidden && 'opacity-35 grayscale';
  if (treatment.type === 'paint') {
    return <span aria-hidden className={cn('block shrink-0 rounded-lg border border-black/10 shadow-inner', dim, className)} style={{ backgroundColor: treatment.hex }} />;
  }
  return <MaterialThumb material={getMaterial(treatment.materialId)} className={cn(dim, className)} />;
}
