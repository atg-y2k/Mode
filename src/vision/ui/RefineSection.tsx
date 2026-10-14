/**
 * Scene panel section for the free on-device vision: "Sharpen outlines on
 * this device (free)" (EdgeTAM + SegFormer turn the AI's rough outlines into
 * exact masks, with per-area agreement), and "Map the scene" (on this device, free) when
 * Claude is off. One primary action, progress with the download size, clear
 * fallbacks when the browser can't run the models, and the SegFormer
 * licence: an explicit opt-in before its first use (NVIDIA non-commercial
 * weights), asked as a plain choice ("Sharper detection" / "Standard
 * detection", licence wording under "Licence details"), remembered on this
 * device and changeable under "Models & licenses". Declined, everything
 * still works with the Apache-2.0 models.
 */
import { CircleAlert, Cpu, ExternalLink, MousePointerClick, ScanSearch, WandSparkles, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { CONTEXT_ZONE_KINDS, type SceneZone } from '../../../shared/types';
import { findPhoto, isSketchZone, useStore } from '../../state/store';
import { Badge, Button, Section, cn } from '../../ui/common';
import { cancelVision, formatMB, MODELS, taskDownload, visionBackend, visionUnsupportedReason, type VisionStatus } from '../index';
import { SEGFORMER_LICENSE, setSegformerChoice, type SegformerChoice } from '../license';
import { agreementLevel } from '../scoring';
import { refreshCachedModels, useCachedModels, useSegformerChoice, useVisionStatus } from './hooks';
import {
  dismissSegformerConsent,
  mapSceneOffline,
  resolveSegformerConsent,
  sharpenableZones,
  sharpenOutlines,
  useVisionJobs,
  type PendingConsent,
  type VisionJob,
  type ZoneOutcome,
} from './jobs';
import { startTapSelect } from './tapSelect';

export function RefineSection({ photoId }: { photoId: string }) {
  const photo = useStore((s) => findPhoto(s.project, photoId)?.photo);
  const space = useStore((s) => findPhoto(s.project, photoId)?.space);
  const health = useStore((s) => s.health);
  const job = useVisionJobs((s) => s.job);
  const consent = useVisionJobs((s) => (s.consent?.photoId === photoId ? s.consent : null));
  const segformer = useSegformerChoice();
  const outcome = useVisionJobs((s) => s.outcomes[photoId]);
  const error = useVisionJobs((s) => s.errors[photoId]);
  const status = useVisionStatus();
  const unsupported = visionUnsupportedReason();
  const cached = useCachedModels(!unsupported);

  // After a run, the models are in the cache: refresh the "one-time download" note.
  const [hadJob, setHadJob] = useState(false);
  useEffect(() => {
    if (job) setHadJob(true);
    else if (hadJob) {
      setHadJob(false);
      refreshCachedModels();
    }
  }, [job, hadJob]);

  if (!photo || !space) return null;
  const scene = photo.scene;
  const claudeOff = !!health && (!health.ok || !health.ai.enabled);
  const aiZones = scene?.zones.some((z) => !isSketchZone(z)) ?? false;
  // Counted like the Scene panel's area list (not the sky or the street, though those are sharpened too).
  const listed = (z: SceneZone) => z.editable && !CONTEXT_ZONE_KINDS.includes(z.kind);
  const pendingCount = sharpenableZones(photo).filter(listed).length;
  const sharpenable = sharpenableZones(photo, true).filter(listed).length;
  const myJob = job?.photoId === photoId ? job : null;
  const otherBusy = !!job && !myJob;
  const interior = space.kind === 'interior';

  return (
    <Section
      title="On-device outlines"
      action={
        <Badge tone="accent">
          <Cpu className="size-3" aria-hidden /> Free · private
        </Badge>
      }
    >
      {unsupported ? (
        <Note icon={<CircleAlert className="size-4" />}>
          {unsupported} Outline areas with the lasso on the photo, or refine them with the brush in Fine-tune.
        </Note>
      ) : myJob ? (
        <JobProgress job={myJob} status={status} />
      ) : consent && !segformer ? (
        <SegformerConsent consent={consent} cached={cached} interior={interior} />
      ) : (
        <>
          {scene && sharpenable > 0 && (
            <SharpenBlock
              photoId={photoId}
              pendingCount={pendingCount}
              total={sharpenable}
              disabled={otherBusy}
              cached={cached}
            />
          )}
          {(!scene || !aiZones) && (
            <OfflineMapBlock photoId={photoId} prominent={claudeOff} interior={interior} disabled={otherBusy} cached={cached} hasScene={!!scene} />
          )}
          {scene && sharpenable === 0 && aiZones && (
            <p className="text-xs text-muted">Every area’s outline is hand-edited in Fine-tune — nothing to sharpen.</p>
          )}
          {otherBusy && <p className="text-xs text-muted">Busy with another photo — this can run when it finishes.</p>}
          {error && <Note icon={<CircleAlert className="size-4 text-danger" />}>{error}</Note>}
          {status.stage === 'error' && !error && status.message && <Note icon={<CircleAlert className="size-4 text-danger" />}>{status.message}</Note>}
          {outcome && scene && <Outcomes items={outcome.items} zoneIds={new Set(scene.zones.filter(listed).map((z) => z.id))} />}
          {scene && (
            <button
              type="button"
              onClick={() => {
                useStore.getState().setStudio({ sketch: 'none', showZones: true });
                useStore.getState().setView({ mobilePane: 'editor' });
                void startTapSelect(photo);
              }}
              className="flex items-center gap-2 self-start rounded-lg text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <MousePointerClick className="size-3.5" aria-hidden />
              Missing an area? Tap it on the photo to select it
            </button>
          )}
        </>
      )}
      <LicenseNote choice={segformer} />
    </Section>
  );
}

function backendLine(): string {
  const b = visionBackend();
  if (!b) return '';
  return b.backend === 'webgpu' ? 'Runs on your graphics chip — a few seconds.' : 'Runs on the processor — about a minute on most laptops.';
}

function downloadLine(task: Parameters<typeof taskDownload>[0], cached: Partial<Record<string, boolean>> | null): string {
  const d = taskDownload(task, cached ?? {});
  if (d.bytes === 0) return 'The models are already on this device.';
  return `One-time download: ${d.label} (${d.models.map((m) => `${m.name.replace(/ \(.*\)$/, '')} ${formatMB(m.bytes)}`).join(', ')}), then it works offline.`;
}

function SharpenBlock({
  photoId,
  pendingCount,
  total,
  disabled,
  cached,
}: {
  photoId: string;
  pendingCount: number;
  total: number;
  disabled: boolean;
  cached: Partial<Record<string, boolean>> | null;
}) {
  const allSharp = pendingCount === 0;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm leading-relaxed text-text">
        {allSharp
          ? total === 1
            ? 'The area has a precise outline.'
            : `All ${total} areas have precise outlines.`
          : 'Snap each area’s rough outline to the real edges in the photo, so changes stay exactly inside it.'}
      </p>
      {allSharp ? (
        <Button size="sm" variant="ghost" className="self-start max-lg:h-9" icon={<WandSparkles className="size-3.5" />} disabled={disabled} onClick={() => void sharpenOutlines(photoId, true)}>
          Sharpen again
        </Button>
      ) : (
        <Button variant="primary" className="self-start" icon={<WandSparkles className="size-4" />} disabled={disabled} onClick={() => void sharpenOutlines(photoId)}>
          Sharpen outlines on this device (free)
        </Button>
      )}
      {!allSharp && (
        <p className="text-[11px] leading-snug text-subtle">
          {pendingCount} area{pendingCount === 1 ? '' : 's'} · {downloadLine('refine', cached)} {backendLine()}
        </p>
      )}
    </div>
  );
}

function OfflineMapBlock({
  photoId,
  prominent,
  interior,
  disabled,
  cached,
  hasScene,
}: {
  photoId: string;
  prominent: boolean;
  interior: boolean;
  disabled: boolean;
  cached: Partial<Record<string, boolean>> | null;
  hasScene: boolean;
}) {
  const finds = interior ? 'walls, floor, ceiling, cabinets, counters and windows' : 'lawn, beds, trees, paths, walls, roof, windows and sky';
  if (!prominent) {
    return (
      <div className="flex flex-col gap-1">
        <Button size="sm" variant="ghost" className="self-start max-lg:h-9" icon={<ScanSearch className="size-3.5" />} disabled={disabled} onClick={() => void mapSceneOffline(photoId)}>
          Map it on this device instead (no AI)
        </Button>
        <p className="text-[11px] leading-snug text-subtle">
          Finds {finds} with free models — less detail than Claude (no style or architecture notes). {downloadLine(interior ? 'mapInterior' : 'mapExterior', cached)}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm leading-relaxed text-text">
        {hasScene ? 'Add the main areas of this photo' : 'Map this photo on this device'}: Mode finds the {finds} and outlines them precisely — free and private, no key or account needed.
      </p>
      <Button
        variant="primary"
        className="self-start"
        icon={<ScanSearch className="size-4" />}
        disabled={disabled}
        title="On this device, free"
        onClick={() => void mapSceneOffline(photoId)}
      >
        Map the scene
      </Button>
      <p className="text-[11px] leading-snug text-subtle">
        {downloadLine(interior ? 'mapInterior' : 'mapExterior', cached)} {backendLine()}
      </p>
    </div>
  );
}

function JobProgress({ job, status }: { job: VisionJob; status: VisionStatus }) {
  const downloading = status.stage === 'downloading';
  const fraction = downloading
    ? (status.progress ?? 0)
    : job.phase === 'sharpening' && job.total > 0
      ? job.done / job.total
      : null;
  const title = job.kind === 'map' ? 'Mapping the scene on this device' : 'Sharpening outlines';
  const detail = downloading
    ? `${status.message ?? 'Downloading the models'} · ${formatMB(status.loadedBytes ?? 0)} of ${formatMB(status.totalBytes ?? 0)} (first time only)`
    : job.phase === 'sharpening'
      ? `Sharpening ${Math.min(job.done + 1, job.total)} of ${job.total} areas…`
      : (status.message ?? (job.phase === 'mapping' ? 'Finding the areas…' : 'Getting ready…'));
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2 rounded-xl border border-accent/25 bg-accent-soft px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text">{title}</p>
          <p className="mt-0.5 text-xs text-muted">{detail}</p>
        </div>
        <Button size="sm" variant="ghost" className="-mr-1 max-lg:h-9" icon={<X className="size-3.5" />} onClick={cancelVision}>
          Cancel
        </Button>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
        {fraction === null ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/70" />
        ) : (
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(3, Math.round(fraction * 100))}%` }} />
        )}
      </div>
      <p className="text-[11px] text-subtle">You can keep working — the photo stays as it is until the outlines are ready.</p>
    </div>
  );
}

const LEVEL: Record<'high' | 'medium' | 'low', { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  high: { label: 'Sharp', tone: 'success' },
  medium: { label: 'Check', tone: 'warning' },
  low: { label: 'Unsure', tone: 'warning' },
};

/**
 * The last run's result per area. `zoneIds`: the areas still in the scene that
 * the Scene panel lists (not the sky or the street), so the counts match
 * "All N areas have precise outlines".
 */
function Outcomes({ items, zoneIds }: { items: ZoneOutcome[]; zoneIds: ReadonlySet<string> }) {
  const [all, setAll] = useState(false);
  const live = useMemo(() => items.filter((i) => zoneIds.has(i.zoneId)), [items, zoneIds]);
  if (live.length === 0) return null;
  const sharp = live.filter((i) => i.refined).length;
  const shown = all ? live : live.slice(0, 6);
  const focus = (id: string | null) => useStore.getState().setStudio({ focusZoneId: id });
  // The badges worth a second look, named as shown ("Check", "Unsure"), only when present.
  const levels = new Set(live.filter((i) => i.refined).map((i) => agreementLevel(i.agreement)));
  const doubtful = (['medium', 'low'] as const).filter((l) => levels.has(l)).map((l) => `“${LEVEL[l].label}”`);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted">
        Last run: {sharp} of {live.length} sharpened
        <span className="font-normal text-subtle"> · how well each sharpened outline agrees with the first outline</span>
      </p>
      <ul className="flex flex-col" onPointerLeave={() => focus(null)}>
        {shown.map((i) => {
          const level = LEVEL[agreementLevel(i.agreement)];
          return (
            <li key={i.zoneId}>
              <button
                type="button"
                onPointerEnter={() => focus(i.zoneId)}
                onFocus={() => focus(i.zoneId)}
                onBlur={() => focus(null)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent max-lg:min-h-9"
                title={i.refined ? `Agreement ${Math.round(i.agreement * 100)}%` : 'No candidate matched the outline well enough — kept as drawn'}
              >
                <span className="min-w-0 flex-1 truncate text-text">{i.label}</span>
                {i.refined ? <Badge tone={level.tone}>{level.label}</Badge> : <Badge>Kept as drawn</Badge>}
              </button>
            </li>
          );
        })}
      </ul>
      {live.length > 6 && (
        <button type="button" onClick={() => setAll(!all)} className="self-start text-xs font-medium text-accent hover:underline">
          {all ? 'Show fewer' : `Show all ${live.length}`}
        </button>
      )}
      {doubtful.length > 0 && (
        <p className="text-[11px] leading-snug text-subtle">
          {doubtful.join(' and ')} areas may have grabbed a neighbour — fix them with Tap to select (Alt-click removes) or in Fine-tune.
          ⌘Z / Ctrl+Z undoes the whole run.
        </p>
      )}
    </div>
  );
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className={cn('flex gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted')}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * The SegFormer licence, shown before its first use (C5), as a choice a
 * homeowner can judge: sharper detection (non-commercial weights) or
 * standard detection (no restrictions), each with what it downloads for the
 * parked action; the licence wording itself sits under "Licence details".
 * Nothing downloads before a choice; the parked action runs right after
 * either answer.
 */
function SegformerConsent({ consent, cached, interior }: { consent: PendingConsent; cached: Partial<Record<string, boolean>> | null; interior: boolean }) {
  const seg = MODELS.segformer;
  const task = consent.action === 'map' || consent.action === 'remap' ? (interior ? 'mapInterior' : 'mapExterior') : 'refine';
  // Each choice's own total (standard maps with CLIPSeg instead, so it isn't always the smaller one).
  const download = (semantic: boolean) => {
    const d = taskDownload(task, cached ?? {}, semantic);
    return d.bytes ? ` (${d.label} download)` : '';
  };
  const what = consent.action === 'map' ? 'map the scene' : consent.action === 'remap' ? 'map the scene again' : 'sharpen the outlines';
  // The action may have been parked from the photo ("Map the scene") with the
  // question below the fold: bring the whole card into view and move focus to it
  // (the card, not a choice, so nothing nudges towards accepting the licence).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [consent.photoId, consent.action]);
  return (
    <div
      ref={ref}
      role="group"
      aria-labelledby="mode-segformer-title"
      aria-describedby="mode-segformer-desc"
      tabIndex={-1}
      className="flex flex-col gap-2.5 rounded-xl border border-accent/30 bg-accent-soft px-3 py-3 outline-none"
    >
      <div className="flex items-start gap-2">
        <ScanSearch className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0">
          <p id="mode-segformer-title" className="text-sm font-medium text-text">
            One choice before the first download
          </p>
          <p id="mode-segformer-desc" className="mt-1 text-xs leading-relaxed text-muted">
            How should this device detect the areas in your photo?
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <ConsentChoice title={`Sharper detection${download(true)}`} onClick={() => resolveSegformerConsent('accepted')}>
          Free for personal, non-commercial use — fine for your own home, not for paid or client work.
        </ConsentChoice>
        <ConsentChoice title={`Standard detection${download(false)}`} onClick={() => resolveSegformerConsent('declined')}>
          No restrictions. Areas may be found a little less precisely.
        </ConsentChoice>
        <Button size="sm" variant="ghost" className="self-start max-lg:h-9" onClick={dismissSegformerConsent}>
          Cancel
        </Button>
      </div>
      <details className="text-[11px] leading-snug text-muted">
        <summary className="cursor-pointer select-none rounded font-medium hover:text-text focus-visible:outline-2 focus-visible:outline-accent">Licence details</summary>
        <div className="mt-1.5 flex flex-col gap-1.5">
          <p>
            Sharper detection adds {seg.name}, which {seg.purpose}. Its weights are under the{' '}
            <a href={SEGFORMER_LICENSE.url} target="_blank" rel="noreferrer" className="font-medium text-accent underline-offset-2 hover:underline">
              {SEGFORMER_LICENSE.name}
              <ExternalLink className="ml-0.5 inline size-3 align-[-1px]" aria-hidden />
            </a>
            : <strong className="font-semibold text-text">{SEGFORMER_LICENSE.summary.replace(/\.$/, '')}</strong>.
          </p>
          <p>{SEGFORMER_LICENSE.detail}</p>
          <p>{SEGFORMER_LICENSE.without}</p>
        </div>
      </details>
      <p className="text-[11px] leading-snug text-subtle">
        Then Mode will {what}; the models download once, then work offline. Your choice is remembered on this device — change it any time under “Models &amp; licenses”.
      </p>
    </div>
  );
}

/** One answer of the licence question: a plain title (the button's name) and what it means (its description). */
function ConsentChoice({ title, children, onClick }: { title: string; children: ReactNode; onClick: () => void }) {
  const id = useId();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-describedby={id}
      className="flex flex-col items-start gap-0.5 rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="text-sm font-medium text-text">{title}</span>
      <span id={id} aria-hidden className="text-xs leading-snug text-muted">
        {children}
      </span>
    </button>
  );
}

const CHOICE_TEXT: Record<SegformerChoice | 'unset', string> = {
  accepted: 'Sharper detection (SegFormer, licence accepted)',
  declined: 'Standard detection (SegFormer off)',
  unset: 'Sharper detection is for non-commercial use',
};

function LicenseNote({ choice }: { choice: SegformerChoice | null }) {
  const seg = MODELS.segformer;
  return (
    <details className="text-[11px] leading-snug text-subtle">
      <summary className="cursor-pointer select-none hover:text-muted">
        Models &amp; licenses · <span className="text-muted">{CHOICE_TEXT[choice ?? 'unset']}</span>
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1 pl-1">
        {Object.values(MODELS).map((m) => (
          <li key={m.key}>
            <a href={m.licenseUrl} target="_blank" rel="noreferrer" className="font-medium text-muted underline-offset-2 hover:underline">
              {m.name}
            </a>{' '}
            — {m.purpose}. {m.license}.
          </li>
        ))}
        <li>
          {seg.name}: {SEGFORMER_LICENSE.summary} {SEGFORMER_LICENSE.without} Models download from Hugging Face once and stay in this browser; photos
          never leave the device.
        </li>
        <li className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
          <span className="text-muted">
            {choice === 'accepted' ? 'You accepted the SegFormer licence.' : choice === 'declined' ? 'You chose not to use SegFormer.' : 'You’ll be asked before SegFormer is first used.'}
          </span>
          {choice === 'accepted' && (
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => setSegformerChoice('declined')}>
              Stop using it
            </button>
          )}
          {choice === 'declined' && (
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => setSegformerChoice(null)}>
              Ask me again
            </button>
          )}
        </li>
      </ul>
    </details>
  );
}
