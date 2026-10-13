/**
 * "Add a surface" tiles: the surfaces most relevant to the space first, the
 * rest behind "More surfaces". Tapping a tile creates the surface, selects it
 * and arms the smart brush (step 1 → 2 of the flow).
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { SURFACE_LABELS, type SpaceType, type SurfaceKind } from '../../../../shared/types';
import { materialsForSurface } from '../../../assets/catalog';
import { Button, cn } from '../../common';
import { addSurface } from './actions';
import { SurfaceIcon } from './icons';
import { SURFACE_HINTS, prefersMaterial, surfaceKindsFor } from './surfaceKinds';

export type FinishPurpose = 'paint' | 'materials';

function hasMaterials(kind: SurfaceKind): boolean {
  try {
    return materialsForSurface(kind).length > 0;
  } catch {
    return true;
  }
}

/** Reorders the offer for a purpose: surfaces that suit it first (topped up to 8). */
function orderForPurpose(primary: SurfaceKind[], more: SurfaceKind[], purpose: FinishPurpose | undefined): { primary: SurfaceKind[]; more: SurfaceKind[] } {
  if (!purpose) return { primary, more };
  const fits = (k: SurfaceKind) => (purpose === 'paint' ? !prefersMaterial(k) && k !== 'other' : hasMaterials(k));
  const first = primary.filter(fits);
  for (const k of more) if (first.length < 8 && fits(k)) first.push(k);
  const chosen = new Set(first);
  return { primary: first, more: [...primary, ...more].filter((k) => !chosen.has(k)) };
}

export function AddSurfaceGrid({
  spaceType,
  purpose,
  onAdded,
  className,
}: {
  spaceType: SpaceType | undefined;
  /** Put surfaces that suit paint / materials first (Paint and Materials panels). */
  purpose?: FinishPurpose;
  onAdded?: (regionId: string) => void;
  className?: string;
}) {
  const [showMore, setShowMore] = useState(false);
  const { primary, more } = useMemo(() => {
    const base = surfaceKindsFor(spaceType);
    return orderForPurpose(base.primary, base.more, purpose);
  }, [spaceType, purpose]);

  const add = (kind: SurfaceKind) => {
    const id = addSurface(kind);
    if (id) onAdded?.(id);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {primary.map((k) => (
          <SurfaceTile key={k} kind={k} onClick={() => add(k)} />
        ))}
      </div>
      {showMore && (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4" aria-label="More surfaces">
          {more.map((k) => (
            <SurfaceTile key={k} kind={k} onClick={() => add(k)} quiet />
          ))}
        </div>
      )}
      {more.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start text-muted"
          aria-expanded={showMore}
          icon={showMore ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          onClick={() => setShowMore((v) => !v)}
        >
          {showMore ? 'Fewer surfaces' : `More surfaces (${more.length})`}
        </Button>
      )}
    </div>
  );
}

function SurfaceTile({ kind, onClick, quiet }: { kind: SurfaceKind; onClick: () => void; quiet?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${SURFACE_LABELS[kind]} — ${SURFACE_HINTS[kind]}`}
      aria-label={`Add surface: ${SURFACE_LABELS[kind]}`}
      className={cn(
        'group flex h-[4.25rem] min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border px-1.5 text-center text-xs font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        quiet
          ? 'border-line bg-surface-2/60 text-muted hover:border-accent/40 hover:bg-accent-soft/50 hover:text-text'
          : 'border-line bg-surface text-text shadow-sm hover:border-accent/50 hover:bg-accent-soft/50',
      )}
    >
      <span className={cn('transition-colors', quiet ? 'text-subtle group-hover:text-accent' : 'text-accent')}>
        <SurfaceIcon surface={kind} className="size-[18px]" />
      </span>
      <span className="line-clamp-2 leading-tight">{SURFACE_LABELS[kind]}</span>
    </button>
  );
}
