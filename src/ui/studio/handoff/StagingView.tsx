/**
 * Staging (InvokeAI's staging area): a returned hand-off result shown over
 * the original before it joins the variations — before/after slider,
 * alignment badge (aligned / colour drift / "model changed N areas outside —
 * protected"), a toggleable heatmap of what the model changed outside the
 * target (dropped by the composite), and Accept / Reject / Retry with a
 * stricter prompt / Skip, plus one-line fix prompts to paste into the same
 * chat. Replaces the viewer while open (like the compare grid).
 */
import { Check, Columns2, Copy, Flame, RotateCcw, ShieldAlert, SkipForward, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { HandoffApp, Photo } from '../../../../shared/types';
import { fixPromptsFor, markerColorName } from '../../../handoff';
import { findPhoto, findVariation, useStore } from '../../../state/store';
import { cn } from '../../common';
import { useBlobUrl, useElementSize } from '../hooks';
import { acceptStaged, closeStaging, rejectStaged, retryStricter, skipPlanned } from './actions';
import { AlignmentBadge, AppIcon, useFlash } from './bits';
import { eventWindow, writeText } from './clipboard';
import { alignmentSummary, appLabel, findPlanned, type PlannedRef } from './planned';
import { useHandoffSession, type ImportExtras } from './session';

function fitBox(areaW: number, areaH: number, aspect: number): { w: number; h: number } {
  if (areaW <= 0 || areaH <= 0) return { w: 0, h: 0 };
  let w = areaW;
  let h = w / aspect;
  if (h > areaH) {
    h = areaH;
    w = h * aspect;
  }
  return { w: Math.floor(w), h: Math.floor(h) };
}

/** Red heat where the model changed things outside the target, plus boxes around the notable areas. */
function Heatmap({ extras, photo, w, h }: { extras: ImportExtras; photo: Photo; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { changeMap } = extras;
    c.width = changeMap.width;
    c.height = changeMap.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(changeMap.width, changeMap.height);
    for (let i = 0, o = 0; i < changeMap.data.length; i++, o += 4) {
      const v = changeMap.data[i];
      if (v < 8) continue;
      img.data[o] = 255;
      img.data[o + 1] = Math.max(0, 140 - v);
      img.data[o + 2] = 40;
      img.data[o + 3] = Math.min(220, 40 + v);
    }
    ctx.putImageData(img, 0, 0);
  }, [extras]);
  const sx = w / photo.width;
  const sy = h / photo.height;
  return (
    <>
      <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
      {extras.blobs.slice(0, 8).map((b, i) => (
        <span
          key={i}
          className="pointer-events-none absolute rounded-md border-2 border-white/90 shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          style={{ left: b.x * sx, top: b.y * sy, width: Math.max(8, b.w * sx), height: Math.max(8, b.h * sy) }}
        />
      ))}
    </>
  );
}

function BeforeAfter({
  photo,
  beforeId,
  afterId,
  afterThumbId,
  extras,
  showSlider,
  showHeat,
  app,
}: {
  photo: Photo;
  beforeId: string;
  afterId: string;
  afterThumbId: string;
  extras: ImportExtras | undefined;
  showSlider: boolean;
  showHeat: boolean;
  app: HandoffApp | undefined;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const area = useElementSize(areaRef);
  const before = useBlobUrl(beforeId);
  const after = useBlobUrl(afterId);
  const afterThumb = useBlobUrl(afterThumbId);
  const [pos, setPos] = useState(0.5);
  const dragging = useRef(false);
  const box = fitBox(area.width, area.height, photo.width / Math.max(1, photo.height));
  const afterUrl = after.url ?? afterThumb.url;

  const setFromEvent = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos(Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))));
  };

  return (
    <div ref={areaRef} className="relative grid h-full w-full place-items-center">
      {box.w > 0 && (
        <div
          className="relative overflow-hidden rounded-lg bg-white/5 select-none"
          style={{ width: box.w, height: box.h, touchAction: showSlider ? 'none' : undefined }}
          onPointerDown={(e) => {
            if (!showSlider) return;
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            setFromEvent(e);
          }}
          onPointerMove={(e) => dragging.current && setFromEvent(e)}
          onPointerUp={() => void (dragging.current = false)}
          onPointerCancel={() => void (dragging.current = false)}
        >
          {afterUrl && <img src={afterUrl} alt="The returned result" className="absolute inset-0 h-full w-full object-cover" draggable={false} />}
          {showSlider && before.url && (
            <img
              src={before.url}
              alt="Your photo"
              className="absolute inset-0 h-full w-full object-cover"
              style={{ clipPath: `inset(0 ${(1 - pos) * 100}% 0 0)` }}
              draggable={false}
            />
          )}
          {showHeat && extras && <Heatmap extras={extras} photo={photo} w={box.w} h={box.h} />}
          {showSlider && (
            <>
              <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_rgb(0_0_0/0.5)]" style={{ left: pos * box.w - 1 }} />
              <div
                role="slider"
                tabIndex={0}
                aria-label="Before / after divider"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pos * 100)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 0.05));
                  else if (e.key === 'ArrowRight') setPos((p) => Math.min(1, p + 0.05));
                  else return;
                  e.preventDefault();
                }}
                className="absolute top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full bg-white text-black shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                style={{ left: pos * box.w }}
              >
                <Columns2 className="size-4" />
              </div>
              <span className="pointer-events-none absolute top-2.5 left-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">Your photo</span>
              <span className="pointer-events-none absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
                <AppIcon app={app} className="size-3" /> {appLabel(app)} result
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FixChip({ text, label }: { text: string; label: string }) {
  const [copied, flash] = useFlash();
  return (
    <button
      type="button"
      onClick={(e) =>
        writeText(eventWindow(e), text).then(
          () => {
            flash();
            useStore.getState().notify('Copied — paste it into the same chat, then bring the new image back here.', 'info');
          },
          () => useStore.getState().notify("Couldn't copy — the text is in the tooltip.", 'error'),
        )
      }
      title={text}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-colors',
        copied ? 'bg-success/25 text-white' : 'bg-white/10 text-white/85 hover:bg-white/20',
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {label}
    </button>
  );
}

/** Below this size of the photo pane, staging opens as a full-window overlay (phones, short laptop screens). */
const MIN_INLINE = { width: 560, height: 520 };

export function StagingView({ photo, stagingRef }: { photo: Photo; stagingRef: PlannedRef }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(hostRef);
  const overlay = size.width > 0 && (size.width < MIN_INLINE.width || size.height < MIN_INLINE.height);
  const content = <StagingContent photo={photo} stagingRef={stagingRef} />;
  return (
    <div ref={hostRef} className="h-full w-full bg-stage">
      {size.width === 0
        ? null
        : overlay
          ? createPortal(
              <div className="fixed inset-0 z-40 h-dvh pb-[env(safe-area-inset-bottom)]" role="dialog" aria-label="Review the returned image">
                {content}
              </div>,
              document.body,
            )
          : content}
    </div>
  );
}

function StagingContent({ photo, stagingRef }: { photo: Photo; stagingRef: PlannedRef }) {
  const found = findPlanned(photo, stagingRef.generationId, stagingRef.plannedId);
  const extras = useHandoffSession((s) => s.extras[stagingRef.plannedId]);
  const [slider, setSlider] = useState(true);
  const [heat, setHeat] = useState(false);
  const staged = found?.planned.staged;
  const interior = useStore((s) => findPhoto(s.project, photo.id)?.space.kind === 'interior');

  // The item was accepted / rejected elsewhere (strip, PiP) or the run deleted.
  useEffect(() => {
    if (!staged) closeStaging();
  }, [staged]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) {
        e.preventDefault();
        e.stopPropagation();
        closeStaging();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!found || !staged) return null;
  const { planned, generation } = found;
  const report = staged.source.alignment;
  const summary = report ? alignmentSummary(report, extras?.blobs.length) : null;
  const app = staged.source.app;
  const beforeId = (generation.baseVariationId ? findVariation(photo, generation.baseVariationId)?.imageId : undefined) ?? photo.imageId;
  const fixes = fixPromptsFor(app ?? 'chatgpt', interior, markerColorName(planned.handoff?.markerColor ?? ''));

  return (
    <div className="flex h-full w-full flex-col bg-stage text-white">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 pt-3 pb-2 sm:px-5">
        <span className="mt-1 text-white/60">
          <AppIcon app={app} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-white/55">
            Back from {appLabel(app)}
            <span className="max-md:hidden"> · review before it joins your variations</span>
          </div>
          <h2 className="truncate font-display text-lg leading-tight" title={planned.brief}>
            {planned.title}
            {planned.optionLabel && planned.optionLabel !== planned.title && <span className="text-white/60"> · {planned.optionLabel}</span>}
          </h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {report && <AlignmentBadge report={report} areas={extras?.blobs.length} tone="stage" />}
          <div className="flex gap-0.5 rounded-lg bg-white/10 p-0.5">
            <button
              type="button"
              aria-pressed={slider}
              onClick={() => setSlider((x) => !x)}
              title="Before / after slider"
              className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium', slider ? 'bg-white text-black' : 'text-white/85 hover:bg-white/15')}
            >
              <Columns2 className="size-3.5" /> <span className="max-sm:sr-only">Before / after</span>
            </button>
            {extras && (
              <button
                type="button"
                aria-pressed={heat}
                onClick={() => setHeat((x) => !x)}
                title="Where the model changed things outside the outline (all of it was put back from your photo)"
                className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium', heat ? 'bg-white text-black' : 'text-white/85 hover:bg-white/15')}
              >
                <Flame className="size-3.5" /> <span className="max-sm:sr-only">Changes outside</span>
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={closeStaging}
            aria-label="Close staging (Esc)"
            title="Back to the photo (Esc) — the result stays waiting"
            className="grid size-8 place-items-center rounded-lg bg-white/10 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="relative min-h-48 flex-1 px-4 sm:px-5">
        <BeforeAfter
          photo={photo}
          beforeId={beforeId}
          afterId={staged.imageId}
          afterThumbId={staged.thumbId}
          extras={extras}
          showSlider={slider}
          showHeat={heat}
          app={app}
        />
      </div>

      <div className="flex flex-col gap-2.5 px-4 pt-2.5 pb-3 sm:px-5">
        {summary && (
          <p
            className={cn('flex items-start gap-1.5 text-xs leading-relaxed max-sm:line-clamp-2', summary.tone === 'warning' ? 'text-gold' : 'text-white/70')}
            title={summary.detail}
          >
            {summary.tone === 'warning' && <ShieldAlert className="mt-px size-3.5 shrink-0" />}
            {summary.detail}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => acceptStaged(stagingRef)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black shadow-lg hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Check className="size-4" /> Accept
          </button>
          <button
            type="button"
            onClick={() => void retryStricter(stagingRef)}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-xl px-3.5 text-sm font-medium',
              summary?.suggestStricter ? 'bg-gold/90 text-black hover:bg-gold' : 'bg-white/10 text-white hover:bg-white/20',
            )}
            title="Discard this result and prepare the same variation with a stricter prompt (start a new chat)"
            aria-label="Retry with a stricter prompt"
          >
            <RotateCcw className="size-4" />
            <span>
              Retry<span className="max-sm:hidden"> with a stricter prompt</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => rejectStaged(stagingRef)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/10 px-3.5 text-sm font-medium text-white hover:bg-white/20"
            title="Discard this result — the variation waits for another try"
          >
            <Trash2 className="size-4" /> Reject
          </button>
          <button
            type="button"
            onClick={() => skipPlanned(stagingRef)}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white"
            title="Discard it and don't make this variation"
          >
            <SkipForward className="size-4" /> Skip
          </button>
        </div>
        {fixes.length > 0 && (
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[11px] text-white/55">Fix in the same chat:</span>
            <div className="scroll-thin -mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 pb-0.5">
              {fixes.map((f) => (
                <FixChip key={f.id} text={f.text} label={f.label} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
