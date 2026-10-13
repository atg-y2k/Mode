/**
 * Scene panel section for the free on-device vision: "Sharpen outlines on
 * this device (free)" (EdgeTAM + SegFormer turn the AI's rough outlines into
 * exact masks, with per-area agreement), and "Map the scene without AI" when
 * Claude is off. One primary action, progress with the download size, clear
 * fallbacks when the browser can't run the models, and the SegFormer
 * license note.
 */
import { CircleAlert, Cpu, MousePointerClick, ScanSearch, WandSparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { findPhoto, isSketchZone, useStore } from '../../state/store';
import { Badge, Button, Section, cn } from '../../ui/common';
import { cancelVision, formatMB, MODELS, taskDownload, visionBackend, visionUnsupportedReason, type VisionStatus } from '../index';
import { agreementLevel } from '../scoring';
import { refreshCachedModels, useCachedModels, useVisionStatus } from './hooks';
import { mapSceneOffline, sharpenableZones, sharpenOutlines, useVisionJobs, type VisionJob, type ZoneOutcome } from './jobs';
import { startTapSelect } from './tapSelect';

export function RefineSection({ photoId }: { photoId: string }) {
  const photo = useStore((s) => findPhoto(s.project, photoId)?.photo);
  const space = useStore((s) => findPhoto(s.project, photoId)?.space);
  const health = useStore((s) => s.health);
  const job = useVisionJobs((s) => s.job);
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
  const pending = sharpenableZones(photo);
  const sharpenable = sharpenableZones(photo, true);
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
      ) : (
        <>
          {scene && sharpenable.length > 0 && (
            <SharpenBlock
              photoId={photoId}
              pendingCount={pending.length}
              total={sharpenable.length}
              disabled={otherBusy}
              cached={cached}
            />
          )}
          {(!scene || !aiZones) && (
            <OfflineMapBlock photoId={photoId} prominent={claudeOff} interior={interior} disabled={otherBusy} cached={cached} hasScene={!!scene} />
          )}
          {scene && sharpenable.length === 0 && aiZones && (
            <p className="text-xs text-muted">Every area’s outline is hand-edited in Fine-tune — nothing to sharpen.</p>
          )}
          {otherBusy && <p className="text-xs text-muted">Busy with another photo — this can run when it finishes.</p>}
          {error && <Note icon={<CircleAlert className="size-4 text-danger" />}>{error}</Note>}
          {status.stage === 'error' && !error && status.message && <Note icon={<CircleAlert className="size-4 text-danger" />}>{status.message}</Note>}
          {outcome && scene && <Outcomes items={outcome.items} zoneIds={new Set(scene.zones.map((z) => z.id))} />}
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
      <LicenseNote />
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
          ? `All ${total} area${total === 1 ? '' : 's'} have precise outlines.`
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
        {hasScene ? 'Add the main areas of this photo' : 'Claude is off, but this device can still map the photo'}: {finds} — outlined precisely, no AI or account needed.
      </p>
      <Button variant="primary" className="self-start" icon={<ScanSearch className="size-4" />} disabled={disabled} onClick={() => void mapSceneOffline(photoId)}>
        Map the scene without AI
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

function Outcomes({ items, zoneIds }: { items: ZoneOutcome[]; zoneIds: ReadonlySet<string> }) {
  const [all, setAll] = useState(false);
  const live = useMemo(() => items.filter((i) => zoneIds.has(i.zoneId)), [items, zoneIds]);
  if (live.length === 0) return null;
  const sharp = live.filter((i) => i.refined).length;
  const shown = all ? live : live.slice(0, 6);
  const focus = (id: string | null) => useStore.getState().setStudio({ focusZoneId: id });
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted">
        Last run: {sharp} of {live.length} sharpened
        <span className="font-normal text-subtle"> · agreement with the AI outline and what the photo shows</span>
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
      {live.some((i) => i.refined && agreementLevel(i.agreement) !== 'high') && (
        <p className="text-[11px] leading-snug text-subtle">“Check” areas may have grabbed a neighbour — fix them with Tap to select (Alt-click removes) or in Fine-tune. ⌘Z / Ctrl+Z undoes the whole run.</p>
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

function LicenseNote() {
  const seg = MODELS.segformer;
  return (
    <details className="text-[11px] leading-snug text-subtle">
      <summary className="cursor-pointer select-none hover:text-muted">
        Models &amp; licenses · <span className="text-muted">SegFormer is non-commercial use only</span>
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
          {seg.name} weights are under NVIDIA’s license for non-commercial use — fine for redesigning your own home; don’t use them for paid work. Models
          download from Hugging Face once and stay in this browser; photos never leave the device.
        </li>
      </ul>
    </details>
  );
}
