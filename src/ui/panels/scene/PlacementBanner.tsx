/**
 * "Tap the photo to place …" hint shown in the panel while a placement is
 * armed, with a way to stop placing.
 */
import { MousePointerClick } from 'lucide-react';
import { findAsset } from '../../../assets/catalog';
import { useStore } from '../../../state/store';
import { Button } from '../../common';
import { isLineBeam } from './lights';
import { cancelPlacement, placementName, usePointerVerb } from './placement';

export function PlacementBanner({ only }: { only?: 'object' | 'light' }) {
  const placement = useStore((s) => s.placement);
  const library = useStore((s) => s.library);
  const verb = usePointerVerb();
  if (!placement || (only && placement.kind !== only)) return null;
  const name = placementName(placement, (id) => findAsset(id, library)) ?? 'it';
  const line = placement.kind === 'light' && isLineBeam(placement.beam);
  const title = line ? `Drag across the photo to draw ${name}` : `${verb} the photo to place ${name}`;
  const detail = line
    ? 'Start at one end and release at the other.'
    : placement.kind === 'object'
      ? 'Aim for the spot where its base touches the ground or floor.'
      : 'Aim for where the fixture sits — the glow spreads from there.';
  return (
    <div className="px-4 pt-3">
      <div role="status" className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2.5">
        <MousePointerClick className="size-5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-text">{title}</p>
          <p className="text-xs text-muted">
            {detail}
            {verb === 'Click' && ' Hold Shift to place several.'}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={cancelPlacement}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
