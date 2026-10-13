/**
 * Small UI pieces shared by the Studio panels: blob images, option visuals,
 * plant-feasibility badges, chips, inline-editable text, AI progress / error
 * notes, callouts and the climate prompt.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, ImageOff, Info, MapPin, Pencil, Sparkles, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import type { OptionVisual, PlantFeasibility } from '../../../../shared/types';
import { fetchClimate } from '../../../lib/studio';
import { useStore } from '../../../state/store';
import { Button, Spinner, cn } from '../../common';
import { useBlobUrl } from '../../shell/hooks';
import { openSettings } from '../../shell/shellUI';
import { aiAvailability, aiUsable, formatElapsed } from './aiErrors';
import { clearAiJob, cancelAiJob, runAiJob, useAiJob, useElapsed, type AiJob } from './aiJobs';
import { Diagram } from './Diagram';
import { artDataUrl, useTextureSwatch } from './swatches';

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export function BlobImage({
  imageId,
  alt,
  className,
  fit = 'cover',
  fallback,
}: {
  imageId: string | null | undefined;
  alt: string;
  className?: string;
  fit?: 'cover' | 'contain';
  fallback?: ReactNode;
}) {
  const state = useBlobUrl(imageId);
  if (state.status === 'ready') {
    return <img src={state.url} alt={alt} draggable={false} className={cn('block size-full', fit === 'cover' ? 'object-cover' : 'object-contain', className)} />;
  }
  if (state.status === 'missing' || state.status === 'idle') {
    return (
      fallback ?? (
        <div className={cn('flex size-full items-center justify-center bg-surface-2 text-subtle', className)} role="img" aria-label={`${alt} (image unavailable)`}>
          <ImageOff className="size-5" aria-hidden />
        </div>
      )
    );
  }
  return <div className={cn('size-full animate-pulse bg-surface-2', className)} aria-hidden />;
}

function TextureVisual({ texture, span }: { texture: Extract<OptionVisual, { kind: 'texture' }>['texture']; span?: number }) {
  const url = useTextureSwatch(texture, undefined, span);
  if (url && url !== 'error') return <img src={url} alt="" draggable={false} className="block size-full object-cover" />;
  // Instant preview while the swatch renders (or if it can't): the material's palette.
  const colors = texture.colors.length ? texture.colors : ['#999999'];
  return (
    <div
      className={cn('size-full', url === null && 'animate-pulse')}
      style={{ background: colors.length > 1 ? `linear-gradient(135deg, ${colors.join(', ')})` : colors[0] }}
      aria-hidden
    />
  );
}

/** The swatch of an element option, filling its (square) container. */
export function OptionVisualView({ visual, span, className }: { visual: OptionVisual | undefined; span?: number; className?: string }) {
  let body: ReactNode;
  switch (visual?.kind) {
    case 'texture':
      body = <TextureVisual texture={visual.texture} span={span} />;
      break;
    case 'color':
      body = <div className="size-full" style={{ backgroundColor: visual.hex }} aria-hidden />;
      break;
    case 'colors':
      body = (
        <div className="flex size-full" aria-hidden>
          {visual.hexes.map((hex, i) => (
            <div key={`${hex}${i}`} className="h-full flex-1" style={{ backgroundColor: hex }} />
          ))}
        </div>
      );
      break;
    case 'art': {
      const url = artDataUrl(visual.art);
      body = url ? <img src={url} alt="" draggable={false} className="block size-full object-contain p-1.5" /> : <Sparkles className="size-5 text-subtle" aria-hidden />;
      break;
    }
    case 'diagram':
      body = <Diagram id={visual.diagram} className="size-full p-1" />;
      break;
    case 'image':
      body = <BlobImage imageId={visual.imageId} alt="" />;
      break;
    default:
      body = <Sparkles className="size-5 text-subtle" aria-hidden />;
  }
  return <div className={cn('flex items-center justify-center overflow-hidden bg-surface-2', className)}>{body}</div>;
}

// ---------------------------------------------------------------------------
// Badges & chips
// ---------------------------------------------------------------------------

export const FEASIBILITY_META: Record<PlantFeasibility['rating'], { label: string; short: string; icon: LucideIcon; className: string }> = {
  good: { label: 'Good fit for your site', short: 'Good fit', icon: CircleCheck, className: 'bg-success/15 text-success' },
  caution: { label: 'Use with caution', short: 'Caution', icon: TriangleAlert, className: 'bg-warning/15 text-warning' },
  poor: { label: 'Poor fit for your site', short: 'Poor fit', icon: CircleX, className: 'bg-danger-soft text-danger' },
};

/** Plant feasibility badge; the reasons show on hover / long-press (title) and to screen readers. */
export function FeasibilityBadge({ feasibility, compact, className }: { feasibility: PlantFeasibility; compact?: boolean; className?: string }) {
  const meta = FEASIBILITY_META[feasibility.rating];
  const Icon = meta.icon;
  const reasons = feasibility.reasons.filter(Boolean).join('\n');
  return (
    <span
      title={reasons ? `${meta.label}:\n${reasons}` : meta.label}
      className={cn('inline-flex items-center gap-1 rounded-full font-medium', compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]', meta.className, className)}
    >
      <Icon className={compact ? 'size-3' : 'size-3.5'} aria-hidden />
      <span>{meta.short}</span>
      {reasons && <span className="sr-only">: {feasibility.reasons.join('; ')}</span>}
    </span>
  );
}

/** Toggle chip (aria-pressed). */
export function Chip({
  pressed,
  onClick,
  children,
  icon,
  title,
  onHover,
  disabled,
  className,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  title?: string;
  onHover?: (hovering: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      disabled={disabled}
      onClick={onClick}
      onPointerEnter={onHover ? () => onHover(true) : undefined}
      onPointerLeave={onHover ? () => onHover(false) : undefined}
      onFocus={onHover ? () => onHover(true) : undefined}
      onBlur={onHover ? () => onHover(false) : undefined}
      className={cn(
        'inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors lg:min-h-8',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50',
        pressed ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-text',
        className,
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline editing
// ---------------------------------------------------------------------------

/** Text that turns into an input on click. Enter / blur saves (empty reverts), Escape cancels. */
export function InlineText({
  value,
  onCommit,
  label,
  className,
  placeholder,
  maxLength = 120,
}: {
  value: string;
  onCommit: (value: string) => void;
  /** Accessible name, e.g. "Rename element". */
  label: string;
  className?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        title={label}
        aria-label={`${label}: ${value || placeholder || ''}`}
        className={cn('group/inline inline-flex min-w-0 max-w-full items-center gap-1 rounded-md text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent', className)}
      >
        <span className={cn('truncate', !value && 'text-subtle')}>{value || placeholder}</span>
        <Pencil className="size-3 shrink-0 text-subtle opacity-0 transition-opacity group-hover/inline:opacity-100 group-focus-visible/inline:opacity-100" aria-hidden />
      </button>
    );
  }
  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== value) onCommit(next);
  };
  return (
    <input
      ref={inputRef}
      value={draft}
      maxLength={maxLength}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setEditing(false);
        }
      }}
      className={cn('h-8 min-w-0 rounded-md border border-accent bg-surface px-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25', className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Notes, AI states
// ---------------------------------------------------------------------------

export function Callout({
  tone = 'info',
  icon,
  title,
  children,
  action,
  onDismiss,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'accent';
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const tones = {
    info: 'border-line bg-surface-2 text-muted',
    accent: 'border-accent/30 bg-accent-soft text-text',
    warning: 'border-warning/30 bg-warning/10 text-text',
    danger: 'border-danger/30 bg-danger-soft text-text',
  };
  const iconTone = { info: 'text-muted', accent: 'text-accent', warning: 'text-warning', danger: 'text-danger' };
  return (
    <div role={tone === 'danger' ? 'alert' : undefined} className={cn('flex gap-2.5 rounded-xl border px-3 py-2.5 text-xs leading-relaxed', tones[tone], className)}>
      <span className={cn('mt-0.5 shrink-0', iconTone[tone])}>{icon ?? <Info className="size-4" aria-hidden />}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-text">{title}</p>}
        {children && <div className={cn(title ? 'mt-0.5' : null, 'text-muted')}>{children}</div>}
        {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-mr-1 -mt-0.5 size-6 shrink-0 rounded-md text-subtle hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-accent">
          <X className="mx-auto size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Running AI job: label, elapsed time, a hint about how long it takes, Cancel. */
export function AiProgress({ job, hint, onCancel, className }: { job: AiJob; hint?: string; onCancel?: () => void; className?: string }) {
  const elapsed = useElapsed(job.startedAt, job.status === 'running');
  return (
    <div role="status" aria-live="polite" className={cn('flex items-center gap-3 rounded-xl border border-accent/25 bg-accent-soft px-3 py-2.5', className)}>
      <Spinner className="size-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-medium text-text">
          {job.label} <span className="font-normal tabular-nums text-muted">· {formatElapsed(elapsed)}</span>
        </p>
        {hint && <p className="mt-0.5 text-muted">{hint}</p>}
      </div>
      <Button size="sm" className="max-lg:h-9" variant="ghost" onClick={onCancel ?? (() => cancelAiJob(job.key))}>
        Cancel
      </Button>
    </div>
  );
}

/** Progress or error of a job, or nothing. */
export function AiJobStatus({ jobKey, hint, onRetry, className }: { jobKey: string; hint?: string; onRetry?: () => void; className?: string }) {
  const job = useAiJob(jobKey);
  if (!job) return null;
  if (job.status === 'running') return <AiProgress job={job} hint={hint} className={className} />;
  if (job.status === 'error') {
    return (
      <Callout
        tone="danger"
        icon={<TriangleAlert className="size-4" aria-hidden />}
        className={className}
        onDismiss={() => clearAiJob(jobKey)}
        action={
          onRetry && (
            <Button size="sm" className="max-lg:h-9" onClick={onRetry}>
              Try again
            </Button>
          )
        }
      >
        {job.error}
      </Callout>
    );
  }
  return null;
}

/** Explains why AI features are unavailable (nothing while they are usable). */
export function AiUnavailableNote({ action, className }: { /** e.g. "get suggestions" */ action: string; className?: string }) {
  const health = useStore((s) => s.health);
  const availability = aiAvailability(health);
  if (availability.state === 'ready' || availability.state === 'unknown') return null;
  return (
    <Callout
      tone="warning"
      icon={<Sparkles className="size-4" aria-hidden />}
      title={availability.state === 'offline' ? `Can't ${action} right now` : `Turn on AI to ${action}`}
      className={className}
      action={
        <>
          <Button size="sm" className="max-lg:h-9" onClick={() => openSettings('server')}>
            How to turn on AI
          </Button>
          <Button size="sm" className="max-lg:h-9" variant="ghost" onClick={() => void useStore.getState().refreshHealth()}>
            Check again
          </Button>
        </>
      }
    >
      {availability.reason}
    </Callout>
  );
}

export function useAiReady(): boolean {
  return aiUsable(aiAvailability(useStore((s) => s.health)));
}

// ---------------------------------------------------------------------------
// Climate
// ---------------------------------------------------------------------------

export const CLIMATE_JOB = 'climate';

/** Projects whose climate prompt was dismissed (this session). */
const dismissedClimate = new Set<string>();

/** Looks up the project's climate profile from its ZIP / zone and stores it. */
export function lookUpClimate(): void {
  const project = useStore.getState().project;
  if (!project) return;
  const loc = project.location;
  void runAiJob(
    CLIMATE_JOB,
    async (signal) => {
      const climate = await fetchClimate({ zip: loc.zip?.trim() || null, hardinessZone: loc.hardinessZone?.trim() || null, notes: loc.notes?.trim() || null }, signal);
      if (signal.aborted) return climate;
      const s = useStore.getState();
      if (s.project?.id !== project.id) return climate;
      const current = s.project.location;
      s.updateProjectInfo({ location: { ...current, climate, hardinessZone: current.hardinessZone?.trim() || climate.hardinessZone } });
      s.notify(`Climate added — USDA zone ${climate.hardinessZone}. Plant choices now check against it.`, 'success');
      return climate;
    },
    { label: 'Looking up your climate…', what: 'look up your climate', toastErrors: false },
  );
}

/**
 * Exterior photos without a climate profile: plant feasibility needs one.
 * With a ZIP or zone on file the profile can be looked up right here,
 * otherwise Settings asks for the ZIP.
 */
export function ClimateCallout({ setting, className }: { setting: 'interior' | 'exterior'; className?: string }) {
  const projectId = useStore((s) => s.project?.id);
  const location = useStore((s) => s.project?.location);
  const aiReady = useAiReady();
  const job = useAiJob(CLIMATE_JOB);
  const [dismissed, setDismissed] = useState(() => !!projectId && dismissedClimate.has(projectId));
  if (setting !== 'exterior' || !location || location.climate || dismissed) return null;
  if (job?.status === 'running') return <AiProgress job={job} hint="Hardiness zone, frost dates and rainfall for your area." className={className} />;
  const hasPlace = !!(location.zip?.trim() || location.hardinessZone?.trim());
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <AiJobStatus jobKey={CLIMATE_JOB} onRetry={lookUpClimate} />
      <Callout
        tone="accent"
        icon={<MapPin className="size-4" aria-hidden />}
        title={hasPlace ? 'Check plants against your climate' : 'Add your ZIP code for plants that thrive'}
        onDismiss={() => {
          if (projectId) dismissedClimate.add(projectId);
          setDismissed(true);
        }}
        action={
          hasPlace && aiReady ? (
            <>
              <Button size="sm" className="max-lg:h-9" variant="primary" onClick={lookUpClimate}>
                Look up climate
              </Button>
              <Button size="sm" className="max-lg:h-9" variant="ghost" onClick={() => openSettings('project')}>
                Project settings
              </Button>
            </>
          ) : (
            <Button size="sm" className="max-lg:h-9" variant="primary" onClick={() => openSettings('project')}>
              {hasPlace ? 'Open project settings' : 'Add ZIP code'}
            </Button>
          )
        }
      >
        {hasPlace
          ? `Mode knows your ${location.zip?.trim() ? `ZIP (${location.zip.trim()})` : `zone (${location.hardinessZone?.trim()})`} but not your climate yet. A climate profile lets every plant option show whether it will thrive here.`
          : 'Plant options are rated for your hardiness zone, frost dates and rainfall — Mode needs your ZIP code to know them.'}
      </Callout>
    </div>
  );
}
