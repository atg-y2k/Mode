/**
 * Site header on planting elements: "Zone 7a · Part sun (5 h) · Deer: high"
 * — what the plant ratings below are judged against, with one-click fixes
 * for what is missing (ZIP and deer pressure in Settings, sun in the Scene
 * tab's sun study).
 */
import { MapPin, PawPrint, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from '../../../state/store';
import { cn } from '../../common';
import { openSettings } from '../../shell/shellUI';
import type { SiteHeader } from './siteHeader';

function Fix({ onClick, children, title }: { onClick: () => void; children: ReactNode; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}

function Part({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {icon}
      {children}
    </span>
  );
}

const Dot = () => (
  <span className="text-subtle" aria-hidden>
    ·
  </span>
);

export function FeasibilityHeader({ header, hasZip, className }: { header: SiteHeader; /** A ZIP is on file but gave no zone. */ hasZip?: boolean; className?: string }) {
  const toScene = () => useStore.getState().setStudio({ panel: 'scene' });
  const iconCls = 'size-3.5 shrink-0';
  return (
    <div
      role="group"
      aria-label={`Plant ratings are for: ${header.text}`}
      title="Plant options are rated for this spot: your hardiness zone, the sun on the areas this element targets, and deer pressure."
      className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] text-text', className)}
    >
      <Part icon={<MapPin className={cn(iconCls, header.zone ? 'text-accent' : 'text-subtle')} aria-hidden />}>
        {header.zone ?? (
          <Fix onClick={() => openSettings('project')} title="Your ZIP code gives the USDA hardiness zone every plant is checked against">
            {hasZip ? 'Set zone' : 'Add ZIP'}
          </Fix>
        )}
      </Part>
      <Dot />
      <Part icon={<Sun className={cn(iconCls, header.sun ? 'text-gold' : 'text-subtle')} aria-hidden />}>
        {header.sun ?? (
          <Fix onClick={toScene} title="Estimate the sun on this spot in the Scene tab (sun & orientation)">
            Set sun
          </Fix>
        )}
      </Part>
      <Dot />
      <Part icon={<PawPrint className={cn(iconCls, header.deer ? 'text-muted' : 'text-subtle')} aria-hidden />}>
        {header.deer ?? (
          <Fix onClick={() => openSettings('project')} title="Set deer pressure in project settings so deer favorites are flagged">
            Deer?
          </Fix>
        )}
      </Part>
    </div>
  );
}
